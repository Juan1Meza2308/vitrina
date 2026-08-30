/**
 * De la demo a la guia escrita.
 *
 * Un grabador de pixeles no puede hacer esto: solo sabe QUE SE VIO. Vitrina
 * guarda QUE PASO —cada click con el texto del elemento, cada tecla, cada
 * instante—, y eso es exactamente el material de un tutorial escrito. El
 * comentario de `ZoomSegment.label` lo dice desde el primer dia; esto es
 * construirlo.
 *
 * De aqui salen tres cosas con la misma lista de pasos: la guia en Markdown,
 * los capitulos con marca de tiempo y los subtitulos de accion.
 *
 * Dos reglas que no se negocian:
 *
 *  - **Los instantes van en tiempo de SALIDA.** Un paso que apuntara al
 *    material mandaria al lector a un segundo que el video no tiene en cuanto
 *    hubiera un corte o un tramo acelerado. Lo resuelve `TimeMap.outputAt`, que
 *    ademas dice cuando un paso no llega al video: entonces no es un paso.
 *  - **Nunca se reconstruye lo que se escribio.** El log guarda que se pulso una
 *    tecla, jamas cual, y esa garantia no se rompe aqui: una escritura se cuenta
 *    como "Escribe en «Email»", nunca con el texto. Lo mismo con lo tapado, que
 *    llega con la etiqueta a nulo.
 */
import type { InputEvent, Rect } from './types.ts';
import type { TimeMap } from './timemap.ts';
import { conIdioma, type Idioma, type T } from './idioma.ts';

export type TipoPaso = 'click' | 'escritura' | 'tecla' | 'marca';

export interface Paso {
  /** Instante en el VIDEO, con cortes y velocidades ya descontados. */
  tSalidaMs: number;
  /** Instante en el material. Lo necesita quien vaya a sacar el frame. */
  tFuenteMs: number;
  tipo: TipoPaso;
  /** Frase lista para leer. */
  titulo: string;
  /** Caja del elemento en px de la fuente, para recortar la captura. */
  rect?: Rect | null;
}

export interface OpcionesGuia {
  events: InputEvent[];
  /** Epoch del arranque de la captura: `manifest.startedAt`. */
  startedAt: number;
  map: TimeMap;
  /**
   * Hueco a partir del cual dos teclas dejan de ser la misma escritura.
   * Con menos, escribir despacio saldria como diez pasos.
   */
  huecoEscrituraMs?: number;
  /**
   * Idioma de los pasos. Por defecto espanol, que es el idioma del proyecto.
   *
   * La guia es un fichero que se comparte con terceros, asi que sale en el
   * idioma en el que estabas trabajando: si tienes la app en ingles, quien la
   * lea espera ingles.
   */
  idioma?: Idioma;
}

/** Teclas que valen como paso por si solas: confirman o cancelan algo. */
const TECLAS_CON_SENTIDO = new Set(['Enter', 'Escape', 'Tab', 'Backspace', 'Delete']);

/** Comillas segun el idioma: las latinas en espanol, las dobles en ingles. */
const comillas = (texto: string, idioma: Idioma) =>
  (idioma === 'es' ? `«${texto}»` : `"${texto}"`);

/**
 * Convierte el log en una lista de pasos.
 *
 * Se ignoran movimientos, ruedas y scroll: son como se llega, no lo que se
 * hace. Un tutorial que dijera "mueve el raton a la derecha" seria ruido.
 */
export function pasosDe(opts: OpcionesGuia): Paso[] {
  const t = conIdioma(opts.idioma ?? 'es');
  const hueco = opts.huecoEscrituraMs ?? 1500;
  const eventos = [...opts.events].sort((a, b) => a.t - b.t);

  const pasos: Paso[] = [];
  /** Etiqueta del ultimo elemento pulsado: es donde se esta escribiendo. */
  let campo: string | null = null;
  /** Escritura en curso, para agrupar la rafaga en un solo paso. */
  let escribiendo: { desde: number; hasta: number; campo: string | null } | null = null;

  const cerrarEscritura = () => {
    if (!escribiendo) return;
    const tSalida = opts.map.outputAt(escribiendo.desde);
    if (tSalida !== null) {
      pasos.push({
        tSalidaMs: tSalida,
        tFuenteMs: escribiendo.desde,
        tipo: 'escritura',
        titulo: escribiendo.campo
          ? t('Escribe en {campo}', { campo: comillas(escribiendo.campo, t.idioma) })
          : t('Escribe'),
      });
    }
    escribiendo = null;
  };

  for (const e of eventos) {
    const fuente = e.t - opts.startedAt;
    if (fuente < 0) continue;

    if (e.type === 'key' && e.key === 'char') {
      // Rafaga de escritura: se agrupa mientras las teclas se sigan de cerca.
      if (escribiendo && fuente - escribiendo.hasta <= hueco) escribiendo.hasta = fuente;
      else {
        cerrarEscritura();
        escribiendo = { desde: fuente, hasta: fuente, campo };
      }
      continue;
    }

    // Cualquier otra cosa cierra la escritura en curso: se cambio de tarea.
    cerrarEscritura();

    const tSalida = opts.map.outputAt(fuente);
    if (tSalida === null) continue;      // cortado: no es un paso del video

    if (e.type === 'down') {
      const etiqueta = e.label?.trim() || null;
      campo = etiqueta;
      // Un doble click es un solo paso: la segunda linea diria lo mismo.
      const previo = pasos.at(-1);
      if (previo?.tipo === 'click' && previo.titulo === tituloDeClick(etiqueta, t)
          && tSalida - previo.tSalidaMs < 600) {
        continue;
      }
      pasos.push({
        tSalidaMs: tSalida,
        tFuenteMs: fuente,
        tipo: 'click',
        titulo: tituloDeClick(etiqueta, t),
        rect: e.rect ?? null,
      });
    } else if (e.type === 'key' && e.key && TECLAS_CON_SENTIDO.has(e.key)) {
      pasos.push({
        tSalidaMs: tSalida,
        tFuenteMs: fuente,
        tipo: 'tecla',
        titulo: t('Pulsa {tecla}', { tecla: e.key }),
      });
    } else if (e.type === 'mark') {
      pasos.push({
        tSalidaMs: tSalida,
        tFuenteMs: fuente,
        tipo: 'marca',
        titulo: e.label?.trim() || 'Momento señalado',
      });
    }
  }
  cerrarEscritura();

  return pasos.sort((a, b) => a.tSalidaMs - b.tSalidaMs);
}

/**
 * Sin etiqueta no se inventa una.
 *
 * Pasa con un icono sin texto y, a proposito, con todo lo tapado: el log deja
 * la etiqueta a nulo para que tapar los pixeles no deje el texto escrito en
 * otro sitio. La guia tiene que respetarlo igual.
 */
function tituloDeClick(etiqueta: string | null, t: T): string {
  return etiqueta
    ? t('Pulsa {que}', { que: comillas(etiqueta, t.idioma) })
    : t('Pulsa aquí');
}

/** `1:04`, o `1:02:03` si la demo pasa de la hora. */
export function reloj(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const dos = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${m}:${dos(s)}`;
}

export interface Capitulo {
  tMs: number;
  titulo: string;
}

/**
 * Capitulos para la descripcion del video.
 *
 * Si hay momentos senalados a mano, mandan: quien graba sabe mejor que nadie
 * donde empieza cada parte. Si no, se reparten los clicks dejando aire entre
 * capitulos —una lista con veinte entradas en dos minutos no es un indice, es
 * la misma demo otra vez—.
 *
 * El primero SIEMPRE va en 0:00: YouTube no acepta la lista si no.
 */
export function capitulosDe(pasos: Paso[], separacionMs = 20_000): Capitulo[] {
  const marcas = pasos.filter((p) => p.tipo === 'marca');
  const base = marcas.length > 0 ? marcas : pasos.filter((p) => p.tipo === 'click');

  const out: Capitulo[] = [];
  for (const p of base) {
    const ultimo = out.at(-1);
    if (ultimo && p.tSalidaMs - ultimo.tMs < separacionMs) continue;
    out.push({ tMs: p.tSalidaMs, titulo: p.titulo });
  }

  // El primero tiene que caer EXACTAMENTE en 0:00. Si el primer capitulo ya
  // esta casi ahi se mueve al cero en vez de anteponerle un "Inicio": dos
  // entradas seguidas en 0:00 son un indice roto, no un indice con portada.
  if (out.length === 0) out.push({ tMs: 0, titulo: 'Inicio' });
  else if (out[0]!.tMs <= 1500) out[0]!.tMs = 0;
  else out.unshift({ tMs: 0, titulo: 'Inicio' });
  return out;
}

/** `00:00:01,500`, que es como los quiere SRT. */
function tiempoSrt(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${dos(Math.floor(t / 3600000))}:${dos(Math.floor(t / 60000) % 60)}`
    + `:${dos(Math.floor(t / 1000) % 60)},${String(t % 1000).padStart(3, '0')}`;
}

/**
 * Subtitulos de accion.
 *
 * No son una transcripcion —para eso hace falta oir la voz— sino lo que se esta
 * haciendo en cada momento, que es justo lo que un video mudo no cuenta. Cada
 * rotulo dura hasta el paso siguiente, con un tope: un cartel de treinta
 * segundos deja de leerse y se convierte en parte del decorado.
 */
export function srtDe(pasos: Paso[], duracionMs: number, maxMs = 3000): string {
  return pasos.map((p, i) => {
    const siguiente = pasos[i + 1]?.tSalidaMs ?? duracionMs;
    const fin = Math.min(siguiente, p.tSalidaMs + maxMs, duracionMs);
    return `${i + 1}\n${tiempoSrt(p.tSalidaMs)} --> ${tiempoSrt(Math.max(fin, p.tSalidaMs + 400))}\n`
      + `${p.titulo}\n`;
  }).join('\n');
}

/**
 * La guia en Markdown.
 *
 * Las capturas se pasan ya escritas —esto es core y no sabe de ficheros—: quien
 * las genera decide donde viven y con que nombre.
 */
export function guiaMarkdown(opts: {
  titulo: string;
  url: string;
  pasos: Paso[];
  /** Ruta relativa de la captura de cada paso, en el mismo orden. */
  capturas?: (string | null)[];
  idioma?: Idioma;
}): string {
  const t = conIdioma(opts.idioma ?? 'es');
  const lineas: string[] = [`# ${opts.titulo}`, ''];
  lineas.push(t('Guía generada de una demo grabada en {url}.', { url: opts.url }), '');

  opts.pasos.forEach((p, i) => {
    lineas.push(`## ${i + 1}. ${p.titulo}`, '');
    lineas.push(`\`${reloj(p.tSalidaMs)}\` ${t('del vídeo')}`, '');
    const captura = opts.capturas?.[i];
    if (captura) lineas.push(`![${t('Paso {n}', { n: i + 1 })}](${captura})`, '');
  });

  return lineas.join('\n');
}
