/**
 * Mapa de tiempo entre la salida y el material original.
 *
 * Recortar los extremos y quitar silencios son la misma operacion vista de dos
 * formas: trozos del original que no llegan al video. En cuanto existe un solo
 * hueco, el instante 5 s de la salida deja de ser el instante 5 s de la
 * grabacion, y TODO lo que consulta por tiempo —el frame vigente, la posicion
 * de la camara, el trozo de narracion— tiene que preguntar por aqui.
 *
 * Se resuelve con una lista de tramos conservados en lugar de con una formula:
 * los cortes pueden solaparse entre si, salirse del recorte o venir en
 * cualquier orden, y normalizarlos una vez al construir es mas barato y mucho
 * mas facil de razonar que comprobarlo en cada consulta.
 *
 * Cada tramo lleva ademas su VELOCIDAD, y eso hace que acelerar un trozo salga
 * casi gratis: el exportador saca el frame, la posicion de la camara y el
 * cursor de `sourceAt(instante de salida)`, asi que en cuanto este mapa
 * remapea, el video, el zoom y el puntero se aceleran solos. Lo unico que hay
 * que tratar aparte es el audio, que no se puede muestrear: hay que estirarlo.
 */

/** Trozo del material que NO aparece en la salida. */
export interface Cut {
  startMs: number;
  endMs: number;
}

/**
 * Trozo del material que se reproduce a otra velocidad.
 *
 * `rate` es cuanto material se consume por segundo de salida: 2 va al doble,
 * 0.5 a camara lenta. Se guarda como dato, igual que los cortes, para que
 * quitarlo devuelva el tramo original sin haber degradado nada.
 */
export interface Speed {
  startMs: number;
  endMs: number;
  rate: number;
}

/** Fuera de estos limites `atempo` deja de sonar y el video pierde el sentido. */
export const RATE_MIN = 0.25;
export const RATE_MAX = 8;

export interface Keep {
  start: number;
  end: number;
  /** Velocidad del tramo. 1 salvo que el usuario lo haya acelerado. */
  rate: number;
}

export interface TimeMapOptions {
  durationMs: number;
  trimStartMs?: number;
  trimEndMs?: number | null;
  cuts?: Cut[];
  speeds?: Speed[];
}

export class TimeMap {
  /** Tramos conservados, en tiempo de la fuente, ordenados y sin solapes. */
  readonly keeps: Keep[];
  /** Duracion del video resultante. */
  readonly outputDurationMs: number;
  /** Inicio de cada tramo en tiempo de SALIDA, para no recalcularlo al buscar. */
  private readonly offsets: number[];

  constructor(opts: TimeMapOptions) {
    const inicio = Math.max(0, opts.trimStartMs ?? 0);
    const fin = Math.min(opts.durationMs, opts.trimEndMs ?? opts.durationMs);

    const conservados = restarCortes(
      { start: inicio, end: Math.max(inicio, fin), rate: 1 }, opts.cuts ?? []);
    this.keeps = partirPorVelocidad(conservados, opts.speeds ?? []);

    this.offsets = [];
    let acumulado = 0;
    for (const k of this.keeps) {
      this.offsets.push(acumulado);
      // La duracion de SALIDA de un tramo es su duracion de material dividida
      // por la velocidad: a 2x, cuatro segundos de grabacion ocupan dos.
      acumulado += (k.end - k.start) / k.rate;
    }
    this.outputDurationMs = acumulado;
  }

  /** Un mapa sin cortes, recorte ni velocidades: la salida es el original. */
  get esIdentidad(): boolean {
    return this.keeps.length === 1
      && this.keeps[0]!.start === 0
      && this.keeps[0]!.rate === 1
      && this.outputDurationMs > 0;
  }

  /**
   * Instante del material que corresponde a un instante de la salida.
   *
   * Fuera de rango se satura en vez de extrapolar: pedir mas alla del final
   * debe devolver el ultimo frame, no un tiempo que no existe.
   */
  sourceAt(outputMs: number): number {
    if (this.keeps.length === 0) return 0;
    if (outputMs <= 0) return this.keeps[0]!.start;

    for (let i = this.keeps.length - 1; i >= 0; i--) {
      const off = this.offsets[i]!;
      if (outputMs >= off) {
        const k = this.keeps[i]!;
        return Math.min(k.end, k.start + (outputMs - off) * k.rate);
      }
    }
    return this.keeps[0]!.start;
  }

  /**
   * Velocidad vigente en un instante del MATERIAL.
   *
   * La usa la reproduccion del preview, que avanza en tiempo de fuente: sin
   * esto reproduciria los tramos acelerados a tiempo real y el editor mentiria
   * respecto al video exportado.
   */
  rateAt(sourceMs: number): number {
    for (const k of this.keeps) {
      if (sourceMs < k.start) return 1;
      if (sourceMs <= k.end) return k.rate;
    }
    return 1;
  }

  /**
   * Empuja un instante fuera de un corte, hacia delante.
   *
   * Lo usa la reproduccion del preview: al llegar a un silencio hay que saltar
   * al otro lado en vez de reproducirlo, o lo que se ve no es lo que se exporta.
   */
  skip(sourceMs: number): number {
    for (const k of this.keeps) {
      if (sourceMs < k.start) return k.start;
      if (sourceMs <= k.end) return sourceMs;
    }
    return this.keeps.at(-1)?.end ?? sourceMs;
  }
}

/**
 * Parte los tramos conservados en los limites de velocidad.
 *
 * Cada instante del material acaba en exactamente un tramo con exactamente una
 * velocidad, asi que `sourceAt` sigue siendo una busqueda y una multiplicacion.
 * En los solapes gana la region que empieza antes: hace falta una regla y esta
 * es estable —no depende del orden en que el usuario las creara— y facil de
 * explicar.
 */
function partirPorVelocidad(keeps: Keep[], speeds: Speed[]): Keep[] {
  const regiones: Speed[] = [];
  for (const s of speeds
    .map((v) => ({
      startMs: Math.min(v.startMs, v.endMs),
      endMs: Math.max(v.startMs, v.endMs),
      rate: Math.min(RATE_MAX, Math.max(RATE_MIN, v.rate)),
    }))
    .filter((v) => v.endMs > v.startMs && v.rate !== 1)
    .sort((a, b) => a.startMs - b.startMs)) {
    const previa = regiones.at(-1);
    const inicio = previa ? Math.max(s.startMs, previa.endMs) : s.startMs;
    if (s.endMs > inicio) regiones.push({ ...s, startMs: inicio });
  }
  if (regiones.length === 0) return keeps;

  const out: Keep[] = [];
  for (const k of keeps) {
    let cursor = k.start;
    for (const r of regiones) {
      if (r.endMs <= cursor || r.startMs >= k.end) continue;
      const a = Math.max(r.startMs, cursor);
      const b = Math.min(r.endMs, k.end);
      if (a > cursor) out.push({ start: cursor, end: a, rate: 1 });
      if (b > a) out.push({ start: a, end: b, rate: r.rate });
      cursor = b;
    }
    if (cursor < k.end) out.push({ start: cursor, end: k.end, rate: 1 });
  }
  return out;
}

interface Intervalo { start: number; end: number }

/** Resta una lista de cortes a un intervalo, normalizando por el camino. */
function restarCortes(base: Keep, cuts: Cut[]): Keep[] {
  // Los cortes son intervalos, no tramos conservados: no tienen velocidad. Se
  // les da tipo propio en vez de reaprovechar `Keep`, que desde que lleva
  // `rate` significa otra cosa.
  const limpios: Intervalo[] = cuts
    .map((c) => ({ start: Math.min(c.startMs, c.endMs), end: Math.max(c.startMs, c.endMs) }))
    .filter((c) => c.end > base.start && c.start < base.end)
    .map((c) => ({ start: Math.max(c.start, base.start), end: Math.min(c.end, base.end) }))
    .sort((a, b) => a.start - b.start);

  // Fusionar los que se tocan: dos cortes solapados no quitan el doble.
  const fundidos: Intervalo[] = [];
  for (const c of limpios) {
    const ultimo = fundidos.at(-1);
    if (ultimo && c.start <= ultimo.end) ultimo.end = Math.max(ultimo.end, c.end);
    else fundidos.push({ ...c });
  }

  const keeps: Keep[] = [];
  let cursor = base.start;
  for (const c of fundidos) {
    if (c.start > cursor) keeps.push({ start: cursor, end: c.start, rate: 1 });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < base.end) keeps.push({ start: cursor, end: base.end, rate: 1 });

  // Si los cortes se comieron todo, se conserva el intervalo entero: un video
  // de cero frames no es un resultado util, y silencio absoluto de punta a
  // punta es mas probable que sea un microfono mudo que una demo sin nada.
  return keeps.length > 0 ? keeps : [base];
}
