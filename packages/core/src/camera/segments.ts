/**
 * De log de entrada a tramos de zoom.
 *
 * Esta es la parte del motor que decide QUE encuadrar y CUANDO. El movimiento
 * en si lo resuelve despues el muelle en `track.ts`.
 *
 * La ventaja de grabar desde el DOM se cobra aqui: cada click trae el
 * rectangulo del control pulsado, asi que el encuadre es la caja real del boton
 * o del formulario. Un grabador de pixeles solo puede inventarse un radio
 * alrededor del cursor y esperar que el elemento quepa.
 */
import type { CaptureSize, InputEvent, Rect, ZoomSegment } from '../types.ts';
import type { CameraConfig } from './config.ts';
import { boxAround, padRect, rectCenter, scaleToFit, unionRect } from './geometry.ts';

export interface PlanOptions {
  events: InputEvent[];
  viewport: CaptureSize;
  /** Epoch en ms del inicio de la captura. Convierte los eventos a tiempo relativo. */
  startedAt: number;
  durationMs: number;
  config: CameraConfig;
}

interface Cluster {
  rect: Rect;
  firstMs: number;
  /** Ultimo evento que mantiene vivo el grupo, incluida la escritura. */
  lastMs: number;
  /** Primera etiqueta util del grupo. Nombra el tramo en el timeline. */
  label: string | null;
}

interface Interval {
  start: number;
  end: number;
}

/** Caja por defecto para un click sin rect: raro, pero pasa en canvas y SVG. */
const FALLBACK_BOX_PX = 180;

export function planSegments(opts: PlanOptions): ZoomSegment[] {
  const { viewport, startedAt, durationMs, config } = opts;

  const events = opts.events
    .map((e) => ({ ...e, rt: e.t - startedAt }))
    .filter((e) => e.rt >= 0 && e.rt <= durationMs)
    .sort((a, b) => a.rt - b.rt);

  const clusters = clusterClicks(events, viewport, config);
  extendWithTyping(clusters, events, config);

  let segments = clusters
    .map((c) => toSegment(c, viewport, config, durationMs))
    .filter((s): s is ZoomSegment => s !== null);

  segments = mergeClose(segments, viewport, config);
  segments = applyScrollCuts(segments, findScrollBursts(events, config));

  return segments.filter((s) => s.endMs - s.startMs >= config.minDurationMs);
}

type TimedEvent = InputEvent & { rt: number };

function clusterClicks(
  events: TimedEvent[],
  viewport: CaptureSize,
  config: CameraConfig,
): Cluster[] {
  const clusters: Cluster[] = [];
  let current: Cluster | null = null;

  for (const e of events) {
    if (e.type !== 'down' || e.x === undefined || e.y === undefined) continue;

    const box = e.rect ?? boxAround({ x: e.x, y: e.y }, FALLBACK_BOX_PX);

    if (current) {
      const idle = e.rt - current.lastMs > config.idleMs;
      // Si juntar este click ensancha tanto el grupo que ya no compensa
      // ampliar, es que el usuario se ha ido a otra zona: mejor dos tramos.
      const merged = unionRect(current.rect, box);
      const tooWide = rawScale(padRect(merged, config.paddingFraction, config.minPaddingPx), viewport)
        < config.minScale;

      if (idle || tooWide) {
        clusters.push(current);
        current = null;
      } else {
        current.rect = merged;
        current.lastMs = e.rt;
        current.label ??= e.label ?? null;
        continue;
      }
    }
    current = { rect: box, firstMs: e.rt, lastMs: e.rt, label: e.label ?? null };
  }

  if (current) clusters.push(current);
  return clusters;
}

/**
 * Escribir en un campo no genera clicks, pero el usuario sigue mirando ahi.
 * Sin esto, la camara se alejaria en mitad de un formulario.
 */
function extendWithTyping(clusters: Cluster[], events: TimedEvent[], config: CameraConfig): void {
  for (const c of clusters) {
    let last = c.lastMs;
    for (const e of events) {
      if (e.rt <= last) continue;
      if (e.type !== 'key' && e.type !== 'up') continue;
      if (e.rt - last > config.idleMs) break;
      last = e.rt;
    }
    c.lastMs = last;
  }
}

function toSegment(
  c: Cluster,
  viewport: CaptureSize,
  config: CameraConfig,
  durationMs: number,
): ZoomSegment | null {
  const padded = padRect(c.rect, config.paddingFraction, config.minPaddingPx);
  const scale = scaleToFit(padded, viewport, config.minScale, config.maxScale);

  // Si ni siquiera con el maximo permitido se amplia de forma perceptible,
  // no vale la pena mover la camara.
  if (rawScale(padded, viewport) < config.minScale) return null;

  const startMs = Math.max(0, c.firstMs - config.leadInMs);
  const endMs = Math.min(durationMs, c.lastMs + config.holdMs);
  if (endMs <= startMs) return null;

  return { startMs, endMs, target: padded, scale, auto: true, label: c.label };
}

/**
 * Dos tramos casi pegados producen un alejamiento y una nueva ampliacion en
 * menos de un segundo. Se ve como un tic. Mejor mantenerse ampliado y encuadrar
 * la union de ambos.
 */
function mergeClose(
  segments: ZoomSegment[],
  viewport: CaptureSize,
  config: CameraConfig,
): ZoomSegment[] {
  const out: ZoomSegment[] = [];
  for (const seg of segments) {
    const prev = out.at(-1);
    if (!prev || seg.startMs - prev.endMs > config.mergeGapMs) {
      out.push({ ...seg });
      continue;
    }
    const target = unionRect(prev.target, seg.target);
    // Fusionar solo si la union sigue cabiendo con ampliacion util. Si no,
    // `scaleToFit` subiria la escala al minimo permitido y la vista resultante
    // no contendria su propio objetivo: peor que aceptar la transicion.
    if (rawScale(target, viewport) < config.minScale) {
      out.push({ ...seg });
      continue;
    }
    prev.endMs = Math.max(prev.endMs, seg.endMs);
    prev.target = target;
    prev.label ??= seg.label ?? null;
    prev.scale = scaleToFit(target, viewport, config.minScale, config.maxScale);
  }
  return out;
}

/** Rafagas de scroll rapido, en tiempo relativo. */
function findScrollBursts(events: TimedEvent[], config: CameraConfig): Interval[] {
  const GAP_MS = 200;
  const bursts: Interval[] = [];
  let run: TimedEvent[] = [];

  const flush = () => {
    if (run.length < 2) {
      run = [];
      return;
    }
    const first = run[0]!;
    const last = run.at(-1)!;
    const seconds = Math.max(0.1, (last.rt - first.rt) / 1000);
    const total = run.reduce((sum, e) => sum + Math.abs(e.dy ?? 0), 0);
    if (total / seconds > config.scrollCutPxPerSec) {
      bursts.push({ start: first.rt, end: last.rt });
    }
    run = [];
  };

  for (const e of events) {
    if (e.type !== 'wheel') continue;
    const prev = run.at(-1);
    if (prev && e.rt - prev.rt > GAP_MS) flush();
    run.push(e);
  }
  flush();
  return bursts;
}

/**
 * Ampliar mientras la pagina se desplaza rapido marea. Se recorta el tramo al
 * trozo mas largo que no solape con ninguna rafaga; si no queda nada util, el
 * filtro de duracion minima lo descarta despues.
 */
function applyScrollCuts(segments: ZoomSegment[], bursts: Interval[]): ZoomSegment[] {
  if (bursts.length === 0) return segments;

  return segments.map((seg) => {
    let pieces: Interval[] = [{ start: seg.startMs, end: seg.endMs }];
    for (const b of bursts) {
      const next: Interval[] = [];
      for (const p of pieces) {
        if (b.end <= p.start || b.start >= p.end) {
          next.push(p);
          continue;
        }
        if (b.start > p.start) next.push({ start: p.start, end: b.start });
        if (b.end < p.end) next.push({ start: b.end, end: p.end });
      }
      pieces = next;
    }
    const longest = pieces.reduce<Interval | null>(
      (best, p) => (!best || p.end - p.start > best.end - best.start ? p : best),
      null,
    );
    if (!longest) return { ...seg, startMs: seg.startMs, endMs: seg.startMs };
    return { ...seg, startMs: longest.start, endMs: longest.end };
  });
}

/** Escala sin recortar, para decidir si un encuadre merece la pena. */
function rawScale(rect: Rect, viewport: CaptureSize): number {
  if (rect.w <= 0 || rect.h <= 0) return 0;
  return Math.min(viewport.w / rect.w, viewport.h / rect.h);
}

export { rectCenter };
