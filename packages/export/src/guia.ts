/**
 * Escribe la guia de una grabacion: pasos, capturas, capitulos y subtitulos.
 *
 * El QUE decir lo calcula `@vitrina/core` (`guia.ts`), que es puro y se prueba
 * sin navegador. Aqui solo se saca cada captura del frame que tocaba y se
 * escriben los ficheros.
 *
 * **La captura es el frame CRUDO, recortado al elemento, no el frame compuesto
 * del video.** Es la decision menos obvia del fichero: el fondo degradado y el
 * marco de ventana son el envoltorio del video, y en un tutorial escrito solo
 * roban espacio a lo unico que importa —el boton del que habla el paso—. Por
 * eso se recorta a la caja del elemento con margen, que es exactamente lo que
 * un lector necesita para reconocer donde tiene que pulsar.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  FrameIndex, TimeMap, pasosDe, capitulosDe, srtDe, guiaMarkdown, reloj, conIdioma,
} from '@vitrina/core';
import type { InputEvent, Manifest, Paso, Project, Rect, Idioma, T } from '@vitrina/core';

export interface OpcionesGuia {
  /** Carpeta `.vitrina`. */
  recordingDir: string;
  /** Ancho de las capturas en px. */
  ancho?: number;
  /** Titulo de la guia. Por defecto, el host de la url grabada. */
  titulo?: string;
  /**
   * Idioma de los pasos. Lo pasa quien exporta —la app manda el suyo— porque
   * este fichero se comparte con otros: sale en el idioma en el que estabas
   * trabajando, no en el del proyecto.
   */
  idioma?: Idioma;
}

export interface ResultadoGuia {
  pasos: Paso[];
  /** Ficheros escritos, relativos a la carpeta. */
  ficheros: string[];
}

const leer = async <T>(p: string): Promise<T> =>
  JSON.parse(await fsp.readFile(p, 'utf8')) as T;

/**
 * Caja de la captura a partir de la del elemento.
 *
 * Se ensancha con margen y se le exige un minimo: un recorte pegado a un boton
 * de 80 px no dice DONDE esta ese boton, y una captura sin contexto obliga a
 * ver el video igualmente, que es lo que la guia venia a evitar.
 */
export function encuadreDePaso(
  rect: Rect | null | undefined,
  marco: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  if (!rect || rect.w <= 0 || rect.h <= 0) return { x: 0, y: 0, ...marco };

  // Un recorte demasiado cerrado no dice DONDE esta el boton. Mas de la mitad
  // del ancho conserva la fila entera y sigue siendo un primer plano.
  const minAncho = marco.w * 0.55;
  const margen = Math.max(rect.w * 0.6, marco.w * 0.06);
  let w = Math.max(minAncho, rect.w + margen * 2);
  let h = w * (marco.h / marco.w);

  // Si el minimo se come el frame entero, se devuelve el frame entero: recortar
  // mas alla de los bordes dejaria bandas vacias.
  if (w >= marco.w || h >= marco.h) return { x: 0, y: 0, ...marco };

  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let x = Math.round(cx - w / 2);
  let y = Math.round(cy - h / 2);
  x = Math.min(Math.max(0, x), marco.w - w);
  y = Math.min(Math.max(0, y), marco.h - h);
  w = Math.round(w);
  h = Math.round(h);
  return { x, y, w, h };
}

export async function exportarGuia(opts: OpcionesGuia): Promise<ResultadoGuia> {
  const root = path.resolve(opts.recordingDir);
  const manifest = await leer<Manifest>(path.join(root, 'manifest.json'));
  const events = await leer<InputEvent[]>(path.join(root, 'events.json'));
  const project = await leer<Project>(path.join(root, 'project.json'));

  const map = new TimeMap({
    durationMs: manifest.durationMs,
    trimStartMs: project.trimStartMs,
    trimEndMs: project.trimEndMs,
    cuts: project.cuts,
    speeds: project.speeds,
  });

  const pasos = pasosDe({ events, startedAt: manifest.startedAt, map, idioma: opts.idioma });
  if (pasos.length === 0) {
    throw new Error(
      'La grabacion no tiene pasos que contar: sin clicks ni teclas no hay guia.',
    );
  }

  const index = new FrameIndex(manifest);
  const marco = manifest.capture ?? manifest.viewport;
  const ancho = opts.ancho ?? 960;
  const dirCapturas = path.join(root, 'guia');
  await fsp.rm(dirCapturas, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(dirCapturas, { recursive: true });

  const capturas: (string | null)[] = [];
  const ficheros: string[] = [];

  for (const [i, paso] of pasos.entries()) {
    const file = index.at(paso.tFuenteMs);
    if (!file) { capturas.push(null); continue; }

    try {
      const img = await loadImage(path.join(root, 'frames', file));
      const caja = encuadreDePaso(paso.rect, marco);
      // Nunca se amplia: una captura estirada se ve peor que una mas pequena, y
      // en una guia la nitidez es lo que hace reconocible el boton.
      const anchoReal = Math.min(ancho, caja.w);
      const alto = Math.round(anchoReal * (caja.h / caja.w));
      const c = createCanvas(anchoReal, alto);
      c.getContext('2d')
        .drawImage(img, caja.x, caja.y, caja.w, caja.h, 0, 0, anchoReal, alto);

      const nombre = `guia/paso-${String(i + 1).padStart(2, '0')}.png`;
      await fsp.writeFile(path.join(root, nombre), c.toBuffer('image/png'));
      capturas.push(nombre);
      ficheros.push(nombre);
    } catch {
      // Un frame ilegible se queda sin captura, pero el paso sigue contandose:
      // la guia con una imagen menos vale; una guia a medias, no.
      capturas.push(null);
    }
  }

  const t = conIdioma(opts.idioma ?? 'es');
  const titulo = opts.titulo ?? t('Cómo se hace en {donde}', { donde: hostDe(manifest.url, t) });
  const md = guiaMarkdown({ titulo, url: manifest.url, pasos, capturas, idioma: opts.idioma });
  await fsp.writeFile(path.join(root, 'guia.md'), md);
  ficheros.push('guia.md');

  const capitulos = capitulosDe(pasos)
    .map((c) => `${reloj(c.tMs)} ${c.titulo}`)
    .join('\n');
  await fsp.writeFile(path.join(root, 'capitulos.txt'), `${capitulos}\n`);
  ficheros.push('capitulos.txt');

  await fsp.writeFile(path.join(root, 'guia.srt'), srtDe(pasos, map.outputDurationMs));
  ficheros.push('guia.srt');

  return { pasos, ficheros };
}

/**
 * El host de la url grabada, o un nombre generico.
 *
 * El generico se traduce porque acaba en el TITULO de la guia: un `file://` o
 * un `localhost` sin host dejaba «How to do it in tu app» en la version
 * inglesa, que es de las cosas que delatan una traduccion a medias.
 */
function hostDe(url: string, t: T): string {
  try {
    return new URL(url).host || t('tu app');
  } catch {
    return t('tu app');
  }
}
