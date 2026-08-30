import type { T } from '@vitrina/core';

/**
 * Lo que se le ensena a alguien cuando algo falla.
 *
 * Hasta ahora la interfaz mostraba `e.message` tal cual. Lo que se leia al
 * fallar una exportacion era esto:
 *
 *   spawn C:\Users\Juan\AppData\Local\Programs\Vitrina\resources\ffmpeg.exe ENOENT
 *
 * No dice que paso, no dice que hacer, y ensena la ruta del disco de quien lo
 * sufre —que grabando una demo para publicarla es justo lo que no quiere en
 * pantalla—. Ademas cinco de esos mensajes estaban escritos en espanol a pelo,
 * asi que en ingles salian en espanol.
 *
 * El detalle tecnico no se pierde: viaja aparte y la interfaz lo ensena
 * plegado. Es lo que hace falta para reportar el fallo, y no lo que hace falta
 * para decidir que hacer ahora.
 *
 * **Aqui no se traduce nada.** Un aviso guarda QUE paso, no la frase; la frase
 * la compone `textoDe` al pintar. Traducir al fallar dejaba el mensaje
 * congelado en el idioma de ese instante, y con la app recien abierta ese
 * instante es antes de que carguen los ajustes: en ingles salia en espanol.
 * Verificado en la app de verdad, que es donde se vio.
 */
export interface Aviso {
  /** Un mensaje nuestro, ya escrito. Si esta, se ensena tal cual. */
  texto?: string;
  /** Que se estaba intentando. Decide la primera frase. */
  intento?: Intento;
  /** Por que fallo, si se reconoce. Decide la segunda. */
  causa?: Causa;
  /** El mensaje original, para reportar el fallo. */
  detalle?: string;
}

export type Intento =
  | 'camara' | 'microfono' | 'voz' | 'grabacion'
  | 'exportacion' | 'guia' | 'apertura' | 'general';

export type Causa =
  | 'permiso' | 'sinDispositivo' | 'ocupado' | 'disco' | 'escritura'
  | 'ffmpeg' | 'navegador';

/** Un aviso sin causa tecnica detras: un mensaje nuestro y ya esta. */
export const aviso = (texto: string): Aviso => ({ texto });

/**
 * Por que fallo, si se reconoce.
 *
 * Solo estan las que le pueden pasar a cualquiera y tienen una salida. Inventar
 * una explicacion para un error desconocido seria peor que no dar ninguna: el
 * mensaje crudo esta en el detalle, y ahi al menos es cierto.
 */
function causaDe(crudo: string, nombre: string): Causa | undefined {
  // Los de `getUserMedia` vienen por nombre, que es lo estable: el texto lo
  // escribe el navegador y cambia entre versiones e idiomas.
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') return 'permiso';
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') return 'sinDispositivo';
  if (nombre === 'NotReadableError' || nombre === 'AbortError') return 'ocupado';
  if (/ENOSPC/.test(crudo)) return 'disco';
  if (/EACCES|EPERM/.test(crudo)) return 'escritura';
  if (/ffmpeg/i.test(crudo) && /ENOENT|no se pudo ejecutar/i.test(crudo)) return 'ffmpeg';
  if (/no expuso CDP|se cerro nada mas arrancar/i.test(crudo)) return 'navegador';
  return undefined;
}

/**
 * Convierte una excepcion en un aviso.
 *
 * Los mensajes que escribimos nosotros pasan enteros: ya estan en el idioma de
 * la app y ya dicen que hacer —los de ffmpeg y navegador que faltan, por
 * ejemplo—. Todos empiezan por «Vitrina», que es lo que los distingue de un
 * error del sistema.
 */
export function explicar(e: unknown, intento: Intento = 'general'): Aviso {
  const crudo = e instanceof Error ? e.message : String(e);
  const nombre = e instanceof Error ? e.name : '';
  if (crudo.startsWith('Vitrina')) return { texto: crudo };
  return { intento, causa: causaDe(crudo, nombre), detalle: crudo };
}

/** La frase que se lee, compuesta en el idioma de AHORA. */
export function textoDe(a: Aviso, t: T): string {
  if (a.texto) return a.texto;
  const que = queSeIntentaba(a.intento ?? 'general', t);
  const porque = a.causa ? porQue(a.causa, t) : null;
  return porque ? `${que} ${porque}` : que;
}

function queSeIntentaba(intento: Intento, t: T): string {
  switch (intento) {
    case 'camara': return t('No se pudo encender la cámara.');
    case 'microfono': return t('No se pudo encender el micrófono.');
    case 'voz': return t('No se pudo grabar la voz.');
    case 'grabacion': return t('No se pudo empezar a grabar.');
    case 'exportacion': return t('No se pudo exportar el vídeo.');
    case 'guia': return t('No se pudo crear la guía.');
    case 'apertura': return t('No se pudo abrir la grabación.');
    default: return t('Algo no ha salido bien.');
  }
}

function porQue(causa: Causa, t: T): string {
  switch (causa) {
    case 'permiso':
      return t('El sistema no dio permiso. Búscalo en los ajustes de privacidad '
        + 'de tu equipo y vuelve a intentarlo.');
    case 'sinDispositivo':
      return t('No hay ninguno conectado, o el que elegiste ya no está.');
    case 'ocupado':
      return t('Otro programa lo está usando. Ciérralo y vuelve a intentarlo.');
    case 'disco':
      return t('No queda espacio en el disco.');
    case 'escritura':
      return t('El sistema no dejó escribir ahí. Prueba con otra carpeta.');
    case 'ffmpeg':
      return t('Falta ffmpeg, que es lo que escribe el vídeo. Vitrina trae el '
        + 'suyo; si no aparece, señálalo a mano desde la pantalla de inicio.');
    case 'navegador':
      return t('El navegador no llegó a abrirse. Si tienes uno abierto en modo '
        + 'depuración, ciérralo y vuelve a intentarlo.');
  }
}
