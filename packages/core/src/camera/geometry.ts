/**
 * Geometria de la camara.
 *
 * Convenio: la camara es `{cx, cy, scale}` sobre las coordenadas de la FUENTE
 * (el viewport grabado). El compositor la traduce a un `srcRect` para
 * `drawImage`. Por eso ampliar no cuesta nada y no pierde nitidez mientras se
 * mantenga dentro del presupuesto: solo se muestrea una region mas pequena.
 */
import type { CaptureSize, Rect } from '../types.ts';

export interface CameraState {
  cx: number;
  cy: number;
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Region de la fuente que se ve con esta camara. */
export function viewRect(state: CameraState, viewport: CaptureSize): Rect {
  const w = viewport.w / state.scale;
  const h = viewport.h / state.scale;
  return { x: state.cx - w / 2, y: state.cy - h / 2, w, h };
}

/**
 * Mantiene la vista dentro de la fuente.
 *
 * Se aplica DESPUES de integrar el muelle, no solo al objetivo: con
 * amortiguacion por debajo de 1 hay sobreoscilacion, y sin este recorte se
 * asomaria el borde del material durante el rebote.
 */
export function clampCenter(cx: number, cy: number, scale: number, viewport: CaptureSize): Point {
  const halfW = viewport.w / scale / 2;
  const halfH = viewport.h / scale / 2;
  // Si la vista es mas grande que la fuente (scale < 1) no hay margen: se centra.
  const x = halfW * 2 >= viewport.w ? viewport.w / 2 : clamp(cx, halfW, viewport.w - halfW);
  const y = halfH * 2 >= viewport.h ? viewport.h / 2 : clamp(cy, halfH, viewport.h - halfH);
  return { x, y };
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Margen proporcional al elemento, con un minimo para que un boton pequeno
 *  no acabe encajado contra el borde de la vista. */
export function padRect(r: Rect, fraction: number, minPx: number): Rect {
  const padX = Math.max(r.w * fraction, minPx);
  const padY = Math.max(r.h * fraction, minPx);
  return { x: r.x - padX, y: r.y - padY, w: r.w + padX * 2, h: r.h + padY * 2 };
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * Escala que hace que `rect` quepa justo en la vista.
 *
 * Se toma el minimo de los dos ejes para que el elemento entre entero: usar el
 * maximo lo recortaria, que es peor que quedarse corto de ampliacion.
 */
export function scaleToFit(
  rect: Rect,
  viewport: CaptureSize,
  minScale: number,
  maxScale: number,
): number {
  if (rect.w <= 0 || rect.h <= 0) return minScale;
  const s = Math.min(viewport.w / rect.w, viewport.h / rect.h);
  return clamp(s, minScale, maxScale);
}

/** Caja alrededor de un punto, para clicks que llegaron sin rect de elemento. */
export function boxAround(p: Point, size: number): Rect {
  return { x: p.x - size / 2, y: p.y - size / 2, w: size, h: size };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
