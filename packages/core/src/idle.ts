/**
 * Detecta los tramos en los que no pasa nada, para acelerarlos.
 *
 * Es el hermano de `silence.ts`: aquel busca huecos en la narracion, este busca
 * huecos en la ACTIVIDAD. Una demo real esta llena de esperas —una carga, un
 * formulario que se rellena, un scroll largo— y en tiempo real cansan; el
 * material sigue siendo necesario, asi que acelerarlo es mejor que cortarlo.
 *
 * Se deduce del log de eventos y no de los pixeles a proposito. Comparar frames
 * marcaria como "actividad" cualquier animacion, un spinner o un cursor
 * parpadeando en un input, que es justo lo que hay durante una espera.
 */
import type { InputEvent, Speed } from './types.ts';
import { RATE_MAX } from './timemap.ts';

export interface IdleOptions {
  /** Por debajo de esto no compensa: acelerar un hueco corto se nota como un tiron. */
  minMs?: number;
  /** A cuanto se quiere reducir cada espera. La velocidad sale de aqui. */
  objetivoMs?: number;
  /**
   * Margen que se respeta a cada lado.
   *
   * Sin el, la aceleracion arranca en el instante del ultimo click y el gesto
   * del usuario se ve a camara rapida, que es lo que se queria evitar.
   */
  margenMs?: number;
}

export const IDLE_MIN_MS = 1500;
export const IDLE_OBJETIVO_MS = 1200;
export const IDLE_MARGEN_MS = 250;

/**
 * Tramos sin actividad, ya convertidos en velocidades.
 *
 * La velocidad no es fija: sale de cuanto dura la espera, porque lo que molesta
 * no es la espera sino su duracion. Una de 3 s a 2x sigue siendo lenta; con un
 * objetivo comun, todas acaban durando mas o menos lo mismo en el video.
 */
export function tramosSinActividad(
  events: InputEvent[],
  startedAt: number,
  durationMs: number,
  opts: IdleOptions = {},
): Speed[] {
  const minMs = opts.minMs ?? IDLE_MIN_MS;
  const objetivoMs = Math.max(100, opts.objetivoMs ?? IDLE_OBJETIVO_MS);
  const margenMs = opts.margenMs ?? IDLE_MARGEN_MS;

  const marcas = events
    .map((e) => e.t - startedAt)
    .filter((t) => t >= 0 && t <= durationMs)
    .sort((a, b) => a - b);

  // Los extremos cuentan como actividad: la grabacion empieza y acaba ahi, y un
  // hueco al principio no es una espera sino que aun no habia empezado nada.
  const hitos = [0, ...marcas, durationMs];

  const out: Speed[] = [];
  for (let i = 1; i < hitos.length; i++) {
    const desde = hitos[i - 1]!;
    const hasta = hitos[i]!;
    if (hasta - desde < minMs) continue;

    const startMs = desde + margenMs;
    const endMs = hasta - margenMs;
    const dur = endMs - startMs;
    if (dur <= 0) continue;

    const rate = Math.min(RATE_MAX, Math.max(1, dur / objetivoMs));
    if (rate <= 1) continue;
    out.push({ startMs, endMs, rate: Number(rate.toFixed(2)) });
  }
  return out;
}

/** Cuanto se ahorra en la salida, en ms. Para poder decirlo antes de aplicarlo. */
export function ahorroDe(speeds: Speed[]): number {
  return speeds.reduce((acc, s) => {
    const dur = Math.abs(s.endMs - s.startMs);
    return acc + dur - dur / s.rate;
  }, 0);
}
