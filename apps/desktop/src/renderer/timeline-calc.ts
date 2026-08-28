/**
 * Matematica de la linea de tiempo: marcas de la regla y picos de la onda.
 *
 * Vive aparte del componente porque es lo unico de la linea de tiempo que se
 * puede probar sin pintar, y es justo donde se esconden los fallos de este tipo
 * de interfaz: una regla con marcas cada 1.37 s, una onda que cambia de forma
 * segun lo largo que sea el audio.
 */

/** Pasos "redondos" para las marcas, en ms. Nadie lee una regla cada 1.37 s. */
const PASOS_MS = [
  100, 200, 500,
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
];

export interface Marca {
  ms: number;
  /** Fraccion 0-1 de la anchura total. */
  f: number;
  etiqueta: string;
}

/** m:ss, o s.d por debajo del segundo para que las marcas finas se distingan. */
export function etiquetaTiempo(ms: number, pasoMs: number): string {
  if (pasoMs < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Marcas de la regla para una duracion y una anchura dadas.
 *
 * El paso se elige por la anchura disponible, no por la duracion: la misma
 * grabacion ampliada al doble tiene que ensenar el doble de marcas. Se busca el
 * paso redondo mas pequeno que deje al menos `separacionMin` px entre marcas,
 * porque amontonarlas las vuelve ilegibles y es peor que tener menos.
 */
export function marcasDeRegla(
  durationMs: number,
  anchoPx: number,
  separacionMin = 70,
): Marca[] {
  if (!(durationMs > 0) || !(anchoPx > 0)) return [];

  const pasoMs = PASOS_MS.find((p) => (p / durationMs) * anchoPx >= separacionMin)
    ?? PASOS_MS[PASOS_MS.length - 1]!;

  const out: Marca[] = [];
  for (let ms = 0; ms <= durationMs + 1; ms += pasoMs) {
    out.push({ ms, f: ms / durationMs, etiqueta: etiquetaTiempo(ms, pasoMs) });
  }
  return out;
}

/**
 * Reduce las muestras de audio a N columnas de altura 0-1.
 *
 * Se toma el PICO de cada tramo y no la media: la media de una voz normal ronda
 * 0.02 y la onda saldria plana, sin decir donde se hablo, que es justo para lo
 * que sirve.
 *
 * Siempre devuelve exactamente `columnas` valores, tenga el audio la longitud
 * que tenga: la onda tiene que ocupar el ancho de la pista, no depender de que
 * la grabacion fuera larga o corta.
 */
export function picos(muestras: Float32Array, columnas: number): Float32Array {
  const n = Math.max(1, Math.floor(columnas));
  const out = new Float32Array(n);
  if (muestras.length === 0) return out;

  const porColumna = muestras.length / n;
  for (let i = 0; i < n; i++) {
    const desde = Math.floor(i * porColumna);
    const hasta = Math.min(muestras.length, Math.max(desde + 1, Math.floor((i + 1) * porColumna)));
    let pico = 0;
    for (let j = desde; j < hasta; j++) {
      const v = Math.abs(muestras[j]!);
      if (v > pico) pico = v;
    }
    out[i] = Math.min(1, pico);
  }
  return out;
}
