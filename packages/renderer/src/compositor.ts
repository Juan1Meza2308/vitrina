/**
 * Compositor: monta un frame de salida.
 *
 * Orden de capas, de atras a delante:
 *   fondo -> silueta con sombra -> [recorte] barra + contenido -> borde -> cursor
 *
 * El paso de la silueta no es decorativo. `clip()` con un rectangulo redondeado
 * anula `shadowBlur`, asi que la sombra hay que pintarla ANTES, como una forma
 * opaca del tamano de la ventana. Dibujar primero y recortar despues es el
 * orden que hace que las esquinas redondeadas y la sombra convivan.
 */
import { layoutFrame, viewRect } from '@vitrina/core';
import type { CameraState, CaptureSize, Project } from '@vitrina/core';
import { paintBackground } from './background.ts';
import { drawChrome } from './chrome.ts';
import { drawCursor } from './cursor.ts';
import type { Ctx, CursorSample, ImageLike } from './types.ts';

export interface CompositeOptions {
  ctx: Ctx;
  /** Frame de origen ya decodificado. */
  source: ImageLike;
  sourceSize: CaptureSize;
  camera: CameraState;
  project: Project;
  cursor?: CursorSample | null;
  /** Imagen de fondo ya decodificada, si el proyecto usa `background.kind`
   *  'image'. Se pasa decodificada para que el compositor sirva igual en Node
   *  y en el navegador. */
  backgroundImage?: ImageLike | null;
}

export function composite(o: CompositeOptions): void {
  const { ctx, project, sourceSize } = o;
  const W = project.export.width;
  const H = project.export.height;
  const layout = layoutFrame(sourceSize, project.export, project.frame);

  // Siempre, no solo con fondo transparente: si no, un fondo que no cubra todo
  // el lienzo arrastraria restos del frame anterior.
  ctx.clearRect(0, 0, W, H);
  paintBackground(ctx, project.background, W, H, o.backgroundImage);

  const { window, content, barH, radius } = layout;

  // 1. Silueta con sombra. Se pinta opaca porque una sombra sobre una forma
  //    semitransparente se ve a traves del contenido.
  if (project.frame.shadow > 0) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = project.frame.shadow;
    ctx.shadowOffsetY = project.frame.shadow * 0.35;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.roundRect(window.x, window.y, window.w, window.h, radius);
    ctx.fill();
    ctx.restore();
  }

  // 2. Contenido y barra, recortados a la ventana redondeada.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(window.x, window.y, window.w, window.h, radius);
  ctx.clip();

  drawChrome(ctx, window, barH, project.frame);

  const view = clampView(viewRect(o.camera, sourceSize), sourceSize);
  ctx.drawImage(
    o.source,
    view.x, view.y, view.w, view.h,
    content.x, content.y, content.w, content.h,
  );
  ctx.restore();

  // 3. Borde fino por encima: separa la ventana del fondo cuando ambos son
  //    oscuros, que es el caso habitual con apps en modo oscuro.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(window.x + 0.5, window.y + 0.5, window.w - 1, window.h - 1, radius);
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // 4. Cursor, siempre lo ultimo y siempre al mismo tamano en pantalla.
  if (o.cursor && project.frame.cursor !== 'none') {
    const at = sourceToOutput(o.cursor, view, content);
    // Fuera del encuadre no se dibuja: si no, se pegaria al borde de la ventana.
    if (at) drawCursor(ctx, o.cursor, at, H);
  }
}

/**
 * De coordenadas de la fuente a coordenadas del lienzo de salida.
 * Devuelve null si el punto queda fuera de la region visible.
 */
export function sourceToOutput(
  p: { x: number; y: number },
  view: { x: number; y: number; w: number; h: number },
  content: { x: number; y: number; w: number; h: number },
): { x: number; y: number } | null {
  const u = (p.x - view.x) / view.w;
  const v = (p.y - view.y) / view.h;
  if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) return null;
  return { x: content.x + u * content.w, y: content.y + v * content.h };
}

/**
 * La camara ya recorta a los bordes, pero un `srcRect` que se sale medio pixel
 * por error de coma flotante hace que `drawImage` pinte una franja transparente.
 * Es barato asegurarlo aqui.
 */
function clampView(
  v: { x: number; y: number; w: number; h: number },
  size: CaptureSize,
): { x: number; y: number; w: number; h: number } {
  const w = Math.min(v.w, size.w);
  const h = Math.min(v.h, size.h);
  return {
    x: Math.min(Math.max(0, v.x), size.w - w),
    y: Math.min(Math.max(0, v.y), size.h - h),
    w,
    h,
  };
}
