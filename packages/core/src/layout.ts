/**
 * Geometria del marco: donde cae la ventana grabada dentro del lienzo de salida.
 *
 * Vive en `core` y no en el compositor porque el presupuesto de calidad depende
 * de ella. El margen de zoom nitido es `ancho_fuente / ancho_mostrado`, asi que
 * si la geometria y la matematica de calidad divergen, la UI promete una
 * nitidez que el render no entrega.
 *
 * El modelo es de INSETS por lado y no de "barra superior", porque hay dos
 * formas distintas de enmarcar: una barra de navegador solo come alto por
 * arriba, mientras que un marco de movil rodea el contenido por los cuatro
 * lados. Con insets ambos casos son el mismo calculo.
 */
import type { CaptureSize, FrameStyle, Rect } from './types.ts';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FrameLayout {
  /** Cuerpo exterior: marco mas contenido. */
  window: Rect;
  /** Region donde se dibuja el video. */
  content: Rect;
  /** Cuanto ocupa el marco por cada lado. */
  insets: Insets;
  /**
   * Alto de la barra de navegador sintetica. Es `insets.top` cuando el chrome
   * es una barra, y 0 en los demas casos. Se conserva porque el compositor
   * dibuja la barra a partir de el.
   */
  barH: number;
  /** Radio efectivo, ya recortado para que no exceda la mitad del lado menor. */
  radius: number;
  /**
   * Radio de la pantalla interior. 0 cuando el recorte exterior ya basta, que
   * es el caso de las barras de navegador: sin insets laterales, las esquinas
   * del contenido son las de la ventana. Con bisel hay que redondear aparte, y
   * concentricamente, o el hueco entre carcasa y pantalla se ve torcido.
   */
  contentRadius: number;
}

export type FrameStyleInput = Pick<FrameStyle, 'fill'> & Partial<FrameStyle>;

const SIN_MARCO: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Proporcion de la barra respecto al ancho del contenido, con topes legibles. */
function altoBarra(width: number): number {
  return Math.round(Math.min(44, Math.max(22, width * 0.032)));
}

/**
 * Geometria de la muesca, colgando del borde superior de la pantalla.
 *
 * Vive en `core` y no en el compositor para que los tests y la verificacion
 * puedan muestrear donde cae sin replicar la formula: duplicada, cambiarla
 * dejaria las comprobaciones mirando otro sitio y pasando por casualidad.
 *
 * Proporciones tomadas de un telefono real: ancho ~41% de la pantalla y alto
 * ~19% de ese ancho. Que se quede lejos de la mitad del ancho es lo que hace
 * que se lea como muesca y no como barra: la app sigue viendose a los lados.
 */
export function notchRect(content: Rect): Rect {
  const w = content.w * 0.41;
  const h = Math.max(6, w * 0.19);
  return { x: content.x + (content.w - w) / 2, y: content.y, w, h };
}

/**
 * Bisel del marco de movil, proporcional al ancho del cuerpo.
 *
 * Uniforme arriba y a los lados, como un telefono actual: la muesca cuelga
 * DENTRO de la pantalla en vez de comerse una banda entera, que era lo que
 * hacia que el marco se viera pesado por arriba.
 *
 * Abajo lleva mas que a los lados, tambien como los telefonos reales: la barra
 * de gestos ocupa ese hueco y sin el la carcasa se ve descompensada.
 */
function biselMovil(width: number): Insets {
  const lado = Math.round(Math.min(26, Math.max(10, width * 0.022)));
  return { top: lado, right: lado, bottom: Math.round(lado * 1.35), left: lado };
}

/** Cuanto marco hay por cada lado, segun el estilo de chrome. */
function insetsFor(chrome: FrameStyle['chrome'], contentW: number): Insets {
  switch (chrome) {
    case 'macos':
    case 'windows':
      return { ...SIN_MARCO, top: altoBarra(contentW) };
    case 'phone':
      return biselMovil(contentW);
    default:
      return SIN_MARCO;
  }
}

export function layoutFrame(
  source: CaptureSize,
  exportSize: { width: number; height: number },
  frame: FrameStyleInput,
): FrameLayout {
  const fill = Math.min(1, Math.max(0.05, frame.fill));
  const chrome = frame.chrome ?? 'none';
  const aspect = source.h > 0 ? source.w / source.h : 16 / 9;

  // `fill` es fraccion del ancho de SALIDA y define el cuerpo exterior, no el
  // contenido: si el marco no contara, subir el bisel desbordaria el lienzo.
  let windowW = exportSize.width * fill;
  let insets = insetsFor(chrome, Math.max(1, windowW));

  // El alto no puede pasarse del lienzo. Los insets dependen del ancho y el
  // ancho del alto disponible, asi que se itera: dos pasadas convergen de sobra.
  for (let i = 0; i < 3; i++) {
    const contentW = Math.max(1, windowW - insets.left - insets.right);
    const total = contentW / aspect + insets.top + insets.bottom;
    if (total <= exportSize.height) break;
    const contentHMax = Math.max(1, exportSize.height - insets.top - insets.bottom);
    windowW = contentHMax * aspect + insets.left + insets.right;
    insets = insetsFor(chrome, Math.max(1, windowW));
  }

  const contentW = Math.max(1, windowW - insets.left - insets.right);
  const contentH = contentW / aspect;
  const windowH = contentH + insets.top + insets.bottom;

  const x = (exportSize.width - windowW) / 2;
  const y = (exportSize.height - windowH) / 2;

  // Un marco de movil sin esquinas muy redondeadas no se lee como un movil, asi
  // que ahi el radio tiene un minimo propio en vez de heredar el del proyecto.
  const radioPedido = chrome === 'phone'
    ? Math.max(frame.radius ?? 0, windowW * 0.09)
    : (frame.radius ?? 0);
  const radius = Math.min(radioPedido, windowW / 2, windowH / 2);

  return {
    window: { x, y, w: windowW, h: windowH },
    content: { x: x + insets.left, y: y + insets.top, w: contentW, h: contentH },
    insets,
    contentRadius: chrome === 'phone'
      ? Math.max(0, Math.min(radius - insets.left, contentW / 2, contentH / 2))
      : 0,
    barH: chrome === 'macos' || chrome === 'windows' ? insets.top : 0,
    radius,
  };
}
