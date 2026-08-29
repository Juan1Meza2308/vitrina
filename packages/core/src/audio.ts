/**
 * Alineacion del audio con el video.
 *
 * El microfono y el screencast se graban en procesos distintos: el audio en el
 * renderer de Electron con MediaRecorder, y los frames en el principal por CDP.
 * Lo unico que comparten es el reloj de pared, asi que cada uno anota su
 * `Date.now()` de arranque y el desfase se calcula aqui.
 *
 * El audio se arranca ANTES que el video a proposito. Empezar los dos a la vez
 * es imposible —abrir el navegador tarda un par de segundos— y si el audio
 * llegara tarde faltaria sonido al principio, que no se puede inventar. Con
 * arranque anticipado sobra audio al principio, y sobrar se resuelve saltando.
 */

export interface AudioTrack {
  /** Nombre del fichero dentro de la carpeta `.vitrina`. */
  file: string;
  /** Epoch en ms del arranque real de la captura de audio. */
  startedAt: number;
  mimeType: string;
}

export interface AudioAlignment {
  /** Segundos a saltar dentro del fichero de audio. */
  seekSec: number;
  /** Segundos de silencio a anteponer, si el audio empezo tarde. */
  delaySec: number;
}

/**
 * @param videoStartedAt Epoch en ms del arranque del screencast.
 * @param trimStartMs Recorte aplicado al video, en ms desde su propio inicio.
 */
export function audioAlignment(
  audio: AudioTrack,
  videoStartedAt: number,
  trimStartMs = 0,
): AudioAlignment {
  // Instante del fichero de audio que corresponde al frame 0 de la salida.
  const posicionMs = (videoStartedAt - audio.startedAt) + trimStartMs;

  // Solo uno de los dos puede ser distinto de cero: o sobra audio al principio
  // y se salta, o falta y se rellena con silencio.
  return {
    seekSec: Math.max(0, posicionMs) / 1000,
    delaySec: Math.max(0, -posicionMs) / 1000,
  };
}

/**
 * Instante del fichero de audio que corresponde a un instante del material.
 *
 * `audioAlignment` resuelve el caso simple (un unico salto al principio). Esto
 * hace falta cuando se quitan trozos del interior: cada tramo conservado
 * necesita su propio par de tiempos dentro del fichero.
 *
 * El parametro es cualquier pista con `startedAt`, no solo la de audio: la
 * camara web tiene el mismo problema y la misma solucion, y con esto los cortes
 * y las aceleraciones le salen gratis igual que al video.
 */
export function audioTimeFor(
  pista: { startedAt: number },
  videoStartedAt: number,
  sourceMs: number,
): number {
  return Math.max(0, (videoStartedAt - pista.startedAt + sourceMs) / 1000);
}

/** Formatos que admiten pista de audio. El GIF no, por definicion. */
export function supportsAudio(format: string): boolean {
  return format === 'mp4' || format === 'webm' || format === 'mov';
}
