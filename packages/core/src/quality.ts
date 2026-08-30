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
import { conIdioma, type T } from './idioma.ts';
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
export function describeBudget(b: QualityBudget, t: T = conIdioma('es')): string {
  if (!b.sharpAtRest) {
    return t('sin margen: ya se amplía {escala}x en reposo',
      { escala: (1 / b.maxSharpZoom).toFixed(2) });
  }
  return t('zoom nítido hasta {escala}x', { escala: b.maxSharpZoom.toFixed(2) });
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
  /** Tamano real de cada frame. Es lo que ven la camara y el compositor. */
  capture: CaptureSize;
  /**
   * Viewport CSS emulado, cuando no coincide con `capture`.
   *
   * En vista de movil son 430x932 mientras los frames miden 1290x2796: la
   * pagina maqueta como un telefono y el video sale a resolucion de publicar.
   */
  css?: CaptureSize;
  /** Escala de dispositivo forzada al navegador. Ausente o 1 en horizontal. */
  dsf?: number;
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

export type Orientacion = 'horizontal' | 'vertical';

/** Que forma tiene un tamano de captura. */
export function orientacionDe(size: CaptureSize): Orientacion {
  return size.h > size.w ? 'vertical' : 'horizontal';
}

/**
 * Configuraciones de captura en vista de movil, de menos a mas resolucion.
 *
 * `css` es el viewport que ve la pagina, y es lo que decide que la web muestre
 * su diseno movil: 390 y 430 px son anchos de telefono reales, por debajo del
 * punto de ruptura de practicamente cualquier sitio responsive. No se puede
 * subir para ganar resolucion sin perder justo eso.
 *
 * La resolucion sale de `dsf`, la escala de dispositivo forzada al navegador.
 * M0 concluyo que no habia forma de tener las dos cosas porque
 * `Page.startScreencast` ignora el `deviceScaleFactor` de `Emulation`. Es
 * cierto por esa via, pero forzando la escala al LANZAR el navegador
 * (`--force-device-scale-factor`) el surface nace ya escalado y el screencast
 * entrega css x dsf. Medido en M7: 430x932 a escala 3 da frames de 1290x2796
 * con la pagina viendose a 430 px y `devicePixelRatio` 3.
 *
 * Solo escalas exactas: 1.5 no entrego el tamano pedido (M7c), 2, 2.5 y 3 si.
 */
const MOVILES: { css: CaptureSize; dsf: number }[] = [
  { css: { w: 390, h: 844 }, dsf: 2 },     // 780x1688
  { css: { w: 430, h: 932 }, dsf: 2 },     // 860x1864
  { css: { w: 430, h: 932 }, dsf: 2.5 },   // 1075x2330
  { css: { w: 430, h: 932 }, dsf: 3 },     // 1290x2796
];

/**
 * Devuelve el preset en la orientacion pedida.
 *
 * En vertical no transpone ni reencuadra: cambia a la configuracion de movil
 * del mismo escalon. Girar el preset apaisado daba una pantalla 16:9 —marco
 * rechoncho, 0.57 frente al 0.47 real— y ademas un viewport de 800 o 900 px en
 * el que la web sigue mostrando su diseno de escritorio, que es lo contrario de
 * lo que se busca al grabar en vertical.
 */
export function paraOrientacion(
  preset: CapturePreset,
  a: Orientacion,
  escalones: { css: CaptureSize; dsf: number }[] = MOVILES,
): CapturePreset {
  if (orientacionDe(preset.capture) === a) return preset;
  if (a === 'horizontal') {
    return { ...preset, capture: { w: preset.capture.h, h: preset.capture.w } };
  }
  // El escalon se elige por posicion en la lista, no por pixeles: los presets
  // apaisados estan ordenados de mas fluido a mas nitido y los moviles tambien,
  // asi que "el tercero" significa lo mismo en las dos escaleras.
  const i = Math.min(escalones.length - 1, Math.max(0, indiceDe(preset)));
  const m = escalones[i]!;
  return {
    ...preset,
    css: m.css,
    dsf: m.dsf,
    capture: { w: Math.round(m.css.w * m.dsf), h: Math.round(m.css.h * m.dsf) },
  };
}

/** Posicion del preset en la escalera de calidad estandar. */
function indiceDe(preset: CapturePreset): number {
  const i = CAPTURE_PRESETS.findIndex((p) => p.name === preset.name);
  return i >= 0 ? i : 1;
}

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
