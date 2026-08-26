/**
 * Geometria del marco: donde cae la ventana grabada dentro del lienzo de salida.
 *
 * Vive en `core` y no en el compositor porque el presupuesto de calidad depende
 * de ella. El margen de zoom nitido es `ancho_fuente / ancho_mostrado`, asi que
 * si la geometria y la matematica de calidad divergen, la UI promete una
 * nitidez que el render no entrega.
 */
import type { CaptureSize, FrameStyle, Rect } from './types.ts';

export interface FrameLayout {
  /** Ventana completa: barra de navegador sintetica mas contenido. */
  window: Rect;
  /** Region donde se dibuja el video. */
  content: Rect;
  /** Alto de la barra sintetica. 0 si no hay chrome. */
  barH: number;
  /** Radio efectivo, ya recortado para que no exceda la mitad del lado menor. */
  radius: number;
}

export type FrameStyleInput = Pick<FrameStyle, 'fill'> & Partial<FrameStyle>;

/** Proporcion de la barra respecto al ancho de la ventana, con topes legibles. */
function barHeightFor(width: number, chrome: FrameStyle['chrome']): number {
  if (!chrome || chrome === 'none') return 0;
  return Math.round(Math.min(44, Math.max(22, width * 0.032)));
}

export function layoutFrame(
  source: CaptureSize,
  exportSize: { width: number; height: number },
  frame: FrameStyleInput,
): FrameLayout {
  const fill = Math.min(1, Math.max(0.05, frame.fill));
  const chrome = frame.chrome ?? 'none';
  const aspect = source.h > 0 ? source.w / source.h : 16 / 9;

  let contentW = exportSize.width * fill;
  let barH = barHeightFor(contentW, chrome);

  // El alto no puede pasarse del lienzo. La barra depende del ancho y el ancho
  // del alto disponible, asi que se itera: dos pasadas convergen de sobra.
  for (let i = 0; i < 2; i++) {
    const total = contentW / aspect + barH;
    if (total <= exportSize.height) break;
    contentW = Math.max(1, (exportSize.height - barH) * aspect);
    barH = barHeightFor(contentW, chrome);
  }

  const contentH = contentW / aspect;
  const windowH = contentH + barH;
  const x = (exportSize.width - contentW) / 2;
  const y = (exportSize.height - windowH) / 2;

  const radius = Math.min(frame.radius ?? 0, contentW / 2, windowH / 2);

  return {
    window: { x, y, w: contentW, h: windowH },
    content: { x, y: y + barH, w: contentW, h: contentH },
    barH,
    radius,
  };
}
