/**
 * Matematica de calidad: hasta donde se puede ampliar sin que se vea blando.
 *
 * Es el modulo que alimenta el indicador "zoom nitido hasta N x" de la UI.
 * Ninguna herramienta del mercado lo muestra, y es justo el numero que decide
 * si una demo sale nitida o pastosa.
 *
 * La intuicion habitual —"margen = ancho_captura / ancho_export"— es FALSA en
 * cuanto el look lleva fondo y padding. Lo que importa es a cuantos pixeles de
 * salida se dibuja la ventana, no cuanto mide el lienzo entero:
 *
 *   ventanaPx = anchoExport * fill
 *   A escala s se muestrea una region fuente de (anchoCaptura / s) px y se
 *   dibuja en ventanaPx px. No hay upscale mientras:
 *
 *       anchoCaptura / s >= ventanaPx      =>      s <= anchoCaptura / ventanaPx
 *
 * Ejemplo real del proyecto: captura 1600x900, export 1280x720, fill 0.8.
 *   ventanaPx = 1024  ->  margen = 1600 / 1024 = 1.5625x
 * En reposo (s = 1) se submuestrea 1600 -> 1024, que se ve mas nitido que 1:1.
 */
import type { CaptureSize, ExportSettings } from './types.ts';
import { layoutFrame, type FrameStyleInput } from './layout.ts';
import { PRESETS_MEDIDOS, MEDIDO_EN } from './presets.medidos.ts';

export interface QualityBudget {
  /** Ancho en px de salida al que se dibuja la ventana grabada. */
  windowPx: number;
  /** Zoom maximo sin upscale. Por debajo de 1 significa que ya se esta ampliando en reposo. */
  maxSharpZoom: number;
  /**
   * Factor de submuestreo en reposo. > 1 es bueno: hay supersampling y la
   * imagen sale mas limpia que un 1:1.
   */
  restSupersample: number;
  /** El material da para el look pedido sin ampliar nada. */
  sharpAtRest: boolean;
}

/**
 * @param capture Tamano real de los frames grabados.
 * @param exportSettings Lienzo de salida.
 * @param frame Estilo del marco: `fill` decide cuanta salida ocupa la ventana.
 */
export function computeQualityBudget(
  capture: CaptureSize,
  exportSettings: Pick<ExportSettings, 'width' | 'height'>,
  frame: FrameStyleInput,
): QualityBudget {
  // Se deriva de la MISMA geometria que usa el compositor. Calcularlo aparte
  // seria prometer una nitidez que el render no entrega: con barra de navegador
  // o con marcos muy altos, la ventana se encoge y el margen baja con ella.
  const windowPx = layoutFrame(capture, exportSettings, frame).content.w;
  const maxSharpZoom = windowPx > 0 ? capture.w / windowPx : 0;
  return {
    windowPx,
    maxSharpZoom,
    restSupersample: maxSharpZoom,
    sharpAtRest: maxSharpZoom >= 1,
  };
}

/**
 * Texto para la UI. Se muestra siempre, tambien cuando la noticia es mala:
 * el usuario tiene que enterarse ANTES de grabar, no al ver el export.
 */
export function describeBudget(b: QualityBudget): string {
  if (!b.sharpAtRest) {
    return `sin margen: ya se amplia ${(1 / b.maxSharpZoom).toFixed(2)}x en reposo`;
  }
  return `zoom nitido hasta ${b.maxSharpZoom.toFixed(2)}x`;
}

/**
 * Recorta una escala pedida al maximo nitido, si se pide asi.
 * Devuelve tambien si hubo recorte, para que la UI pueda avisar en vez de
 * degradar en silencio.
 */
export function clampZoom(
  requested: number,
  budget: QualityBudget,
  allowSoft: boolean,
): { scale: number; clamped: boolean } {
  if (allowSoft || requested <= budget.maxSharpZoom) {
    return { scale: requested, clamped: false };
  }
  return { scale: budget.maxSharpZoom, clamped: true };
}

export interface CapturePreset {
  name: string;
  capture: CaptureSize;
  /** fps mediano medido en M0 sobre este hardware. Ver spikes/HALLAZGOS.md. */
  measuredFps: number;
  /**
   * Peor hueco entre frames (p95) medido durante movimiento continuo.
   *
   * La mediana sola miente: a 2560x1440 da 35 fps, que parecen suficientes para
   * exportar a 30, pero el p95 de 76 ms significa huecos de dos frames y medio
   * que se ven como tirones. Elegir preset por la mediana produce material que
   * se nota mal sin que los numeros lo expliquen.
   */
  p95DeltaMs: number;
}

/**
 * Presets con el rendimiento REAL medido, no teorico.
 *
 * Los numeros viven en `presets.medidos.ts` porque los reescribe
 * `npm run calibrar`: el techo del pipeline depende de la maquina, y unos
 * numeros de otro equipo eligen mal. El techo medido en el equipo de
 * desarrollo resulto ser ~100 MP/s, y la calidad JPEG no influye.
 */
export const CAPTURE_PRESETS: CapturePreset[] = PRESETS_MEDIDOS;

/** Maquina en la que se midieron los presets vigentes. */
export { MEDIDO_EN };

/**
 * El preset mas nitido que sostiene los fps pedidos sin tirones perceptibles.
 *
 * Un preset se acepta si su mediana llega a los fps objetivo Y su p95 no supera
 * dos intervalos de frame: por encima de eso el ojo ve el salto.
 *
 * La lista es un parametro y no se lee directamente de `CAPTURE_PRESETS` para
 * poder probar la REGLA con datos fijos. Desde que existe `npm run calibrar`,
 * los presets cambian con la maquina, y unos tests que afirmaran "a 30 fps sale
 * 1920x1080" estarian comprobando el hardware, no el codigo: pasarian aqui y
 * fallarian en cualquier otro equipo.
 */
export function pickPreset(
  targetFps: number,
  presets: CapturePreset[] = CAPTURE_PRESETS,
): CapturePreset {
  const frameBudgetMs = (1000 / targetFps) * 2;
  const viable = presets.filter(
    (p) => p.measuredFps >= targetFps && p.p95DeltaMs <= frameBudgetMs,
  );
  return viable.at(-1) ?? (presets[0] as CapturePreset);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
