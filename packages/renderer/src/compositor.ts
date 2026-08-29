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
import { drawFrame, drawNotch } from './chrome.ts';
import { drawCursor } from './cursor.ts';
import { drawLabel, drawKeys, drawWatermark } from './overlays.ts';
import { drawCamara } from './camara.ts';
import type { Ctx, CursorSample, ImageLike } from './types.ts';
import type { OverlaySample } from './overlays.ts';

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
  /** Rotulo y teclas del instante. Se calculan con `OverlaySource`. */
  overlay?: OverlaySample | null;
  /** Imagen de la marca de agua, ya cargada. */
  watermarkImage?: ImageLike | null;
  /**
   * Frame de la camara web en este instante, con el tamano de su fuente.
   *
   * Llega ya resuelto —un `<video>` en el navegador, una imagen decodificada en
   * Node— por la misma razon que el fondo y la marca: aqui dentro no se
   * decodifica nada, o el compositor dejaria de servir en los dos sitios.
   */
  cam?: { img: ImageLike; w: number; h: number } | null;
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

  const { window, content, radius, contentRadius } = layout;

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

  drawFrame(ctx, layout, project.frame);

  const view = clampView(viewRect(o.camera, sourceSize), sourceSize);

  // Con bisel la pantalla tiene sus propias esquinas: el recorte exterior queda
  // lejos y sin este segundo recorte el video asomaria por las esquinas de la
  // carcasa. Con barra de navegador no hace falta y no se paga.
  if (contentRadius > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(content.x, content.y, content.w, content.h, contentRadius);
    ctx.clip();
  }
  ctx.drawImage(
    o.source,
    view.x, view.y, view.w, view.h,
    content.x, content.y, content.w, content.h,
  );
  if (contentRadius > 0) ctx.restore();

  // La muesca, sobre el video ya dibujado: en un telefono real se come un trozo
  // de pantalla. Dentro del recorte de la ventana, para que respete el cuerpo.
  drawNotch(ctx, layout, project.frame);
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

  // 4. Rotulos y teclas, debajo del cursor para que la flecha no quede tapada.
  if (o.overlay) {
    if (project.frame.labels && o.overlay.label) {
      const at = sourceToOutput(o.overlay.label, view, content);
      if (at) drawLabel(ctx, o.overlay.label.text, at, o.overlay.label.opacity, content);
    }
    if (project.frame.keys && o.overlay.keys) {
      drawKeys(ctx, o.overlay.keys.teclas, o.overlay.keys.opacity, content);
    }
  }

  // 5. Camara web, anclada al lienzo como la marca: es quien cuenta la demo, no
  //    parte de ella. Va DEBAJO de la marca de agua a proposito, para que la
  //    firma siga leyendose si las dos caen en la misma esquina.
  if (project.camara && o.cam) {
    drawCamara(ctx, o.cam.img, { w: o.cam.w, h: o.cam.h }, project.camara, { w: W, h: H });
  }

  // 6. Marca de agua, sobre el lienzo y fuera del recorte de la ventana: es una
  //    firma, no parte de la demo, asi que no se mueve con el zoom.
  if (project.watermark && o.watermarkImage) {
    const img = o.watermarkImage as unknown as { width: number; height: number };
    drawWatermark(
      ctx, img,
      (x, y, w, h) => ctx.drawImage(o.watermarkImage!, x, y, w, h),
      project.watermark, { w: W, h: H },
    );
  }

  // 7. Cursor, siempre lo ultimo y siempre al mismo tamano en pantalla.
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
