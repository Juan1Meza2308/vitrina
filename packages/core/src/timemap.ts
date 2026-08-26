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
 */

/** Trozo del material que NO aparece en la salida. */
export interface Cut {
  startMs: number;
  endMs: number;
}

export interface Keep {
  start: number;
  end: number;
}

export interface TimeMapOptions {
  durationMs: number;
  trimStartMs?: number;
  trimEndMs?: number | null;
  cuts?: Cut[];
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

    this.keeps = restarCortes({ start: inicio, end: Math.max(inicio, fin) }, opts.cuts ?? []);
    this.offsets = [];
    let acumulado = 0;
    for (const k of this.keeps) {
      this.offsets.push(acumulado);
      acumulado += k.end - k.start;
    }
    this.outputDurationMs = acumulado;
  }

  /** Un mapa sin cortes ni recorte: la salida es el original tal cual. */
  get esIdentidad(): boolean {
    return this.keeps.length === 1
      && this.keeps[0]!.start === 0
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
        return Math.min(k.end, k.start + (outputMs - off));
      }
    }
    return this.keeps[0]!.start;
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

/** Resta una lista de cortes a un intervalo, normalizando por el camino. */
function restarCortes(base: Keep, cuts: Cut[]): Keep[] {
  const limpios = cuts
    .map((c) => ({ start: Math.min(c.startMs, c.endMs), end: Math.max(c.startMs, c.endMs) }))
    .filter((c) => c.end > base.start && c.start < base.end)
    .map((c) => ({ start: Math.max(c.start, base.start), end: Math.min(c.end, base.end) }))
    .sort((a, b) => a.start - b.start);

  // Fusionar los que se tocan: dos cortes solapados no quitan el doble.
  const fundidos: Keep[] = [];
  for (const c of limpios) {
    const ultimo = fundidos.at(-1);
    if (ultimo && c.start <= ultimo.end) ultimo.end = Math.max(ultimo.end, c.end);
    else fundidos.push({ ...c });
  }

  const keeps: Keep[] = [];
  let cursor = base.start;
  for (const c of fundidos) {
    if (c.start > cursor) keeps.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < base.end) keeps.push({ start: cursor, end: base.end });

  // Si los cortes se comieron todo, se conserva el intervalo entero: un video
  // de cero frames no es un resultado util, y silencio absoluto de punta a
  // punta es mas probable que sea un microfono mudo que una demo sin nada.
  return keeps.length > 0 ? keeps : [base];
}
