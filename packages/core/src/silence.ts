/**
 * Lectura del informe de silencios de ffmpeg.
 *
 * La deteccion la hace el filtro `silencedetect`: es una linea de argumentos
 * contra un algoritmo propio. Lo que hay aqui es la parte que se equivoca de
 * verdad si se hace a ojo — pasar los tiempos del fichero de audio a tiempos
 * del material, que no empiezan a la vez — y por eso vive aparte y con tests.
 */
import type { Cut } from './timemap.ts';

/** Por debajo de esto se considera silencio. Deja pasar el ruido de sala. */
export const UMBRAL_DB = -32;
/** Silencios mas cortos son pausas naturales del habla, no huecos que quitar. */
export const MIN_SILENCIO_S = 0.6;
/**
 * Margen que se respeta a cada lado del corte.
 *
 * Cortar justo en el limite detectado se come la inspiracion previa y el
 * arranque de la palabra siguiente, y el resultado suena entrecortado. Es mejor
 * quitar un poco menos de lo que se podria.
 */
export const MARGEN_MS = 150;
/** Tras aplicar margenes y limites, un corte mas corto que esto no compensa. */
const MIN_CORTE_MS = 300;

export interface ParseSilenceOptions {
  /**
   * Cuanto antes arranco el audio que el video, en ms. Es
   * `manifest.startedAt - audio.startedAt`, la inversa de `audioTimeFor`.
   */
  adelantoMs: number;
  durationMs: number;
  margenMs?: number;
}

/**
 * Convierte el stderr de ffmpeg en cortes, en tiempo del material.
 *
 * Un `silence_start` sin su `silence_end` se descarta: ocurre cuando la
 * grabacion termina en silencio, y en ese caso el final ya lo resuelve el
 * recorte, no hace falta inventar un corte abierto.
 */
export function parseSilenceReport(stderr: string, opts: ParseSilenceOptions): Cut[] {
  const margen = opts.margenMs ?? MARGEN_MS;
  const cortes: Cut[] = [];
  let inicio: number | null = null;

  for (const linea of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(linea);
    if (s) {
      inicio = Number(s[1]) * 1000 - opts.adelantoMs;
      continue;
    }
    const e = /silence_end:\s*(-?[\d.]+)/.exec(linea);
    if (!e || inicio === null) continue;

    const fin = Number(e[1]) * 1000 - opts.adelantoMs;
    const corte = {
      startMs: Math.max(0, inicio + margen),
      endMs: Math.min(opts.durationMs, fin - margen),
    };
    inicio = null;
    if (corte.endMs - corte.startMs >= MIN_CORTE_MS) cortes.push(corte);
  }
  return cortes;
}

/** Argumentos del filtro, para que umbrales y llamada no se separen. */
export function silenceFilter(umbralDb = UMBRAL_DB, minSegundos = MIN_SILENCIO_S): string {
  return `silencedetect=noise=${umbralDb}dB:d=${minSegundos}`;
}
