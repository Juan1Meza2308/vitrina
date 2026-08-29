/**
 * Valores por defecto de un proyecto de composicion.
 *
 * Viven aqui y no en el CLI a proposito: cualquier cosa que produzca una
 * grabacion (el CLI, la app de escritorio, una herramienta de desarrollo) tiene
 * que escribir una carpeta `.vitrina` completa. Si cada productor inventa sus
 * defaults, unas grabaciones se pueden abrir en el editor y otras no.
 */
import type { Background, CaptureSize, Project } from './types.ts';
import { computeQualityBudget } from './quality.ts';

export interface ProjectDefaults {
  /** Se muestra en la barra de navegador sintetica. */
  host?: string;
  /** Tamano capturado. Decide la forma de la salida y el tipo de marco. */
  capture?: CaptureSize;
  /** Lienzo de salida. Por defecto 720p, el punto fijado del proyecto. */
  exportSize?: CaptureSize;
  fps?: number;
}

/** Tamanos verticales estandar, de mayor a menor. */
const VERTICALES: CaptureSize[] = [{ w: 1080, h: 1920 }, { w: 720, h: 1280 }];

/**
 * Salida que corresponde a una captura.
 *
 * Dos reglas, y la segunda cuesta mas de ver:
 *
 * 1. La FORMA sigue a la de la fuente. Una grabacion vertical exportada a 720p
 *    sale casi toda fondo, con una tira de contenido en medio.
 *
 * 2. La salida no puede dejar al material sin margen de zoom. Es lo que ya hace
 *    el camino apaisado sin decirlo —captura 1600, exporta 1280— y es de donde
 *    sale el 1.56x. En vertical importa mas: el reencuadre a proporcion de
 *    movil estrecha mucho la captura, y exportar eso al lienzo mas grande que
 *    haya no solo deja la camara sin recorrido, sino que AMPLIA en reposo y el
 *    video sale blando. Medido antes de la regla: `fluido` daba 0.87x.
 *
 * El margen no se estima con una formula aparte: se pregunta a
 * `computeQualityBudget`, que deriva de la MISMA geometria que dibuja el
 * compositor. Una formula propia aqui volveria a divergir en cuanto cambiara el
 * marco, que es justo el error que este proyecto ya cometio una vez.
 */
const MARGEN_MINIMO = 1.15;
/** Los mismos valores que pone `defaultProject`: el calculo debe coincidir. */
const MARCO_POR_DEFECTO = { fill: 0.8, chrome: 'phone' } as const;

export function defaultExportFor(capture: CaptureSize): CaptureSize {
  if (capture.h <= capture.w) return { w: 1280, h: 720 };
  const daMargen = (v: CaptureSize): boolean =>
    computeQualityBudget(capture, { width: v.w, height: v.h }, MARCO_POR_DEFECTO)
      .maxSharpZoom >= MARGEN_MINIMO;
  return VERTICALES.find(daMargen) ?? VERTICALES[VERTICALES.length - 1]!;
}

export function defaultProject(opts: ProjectDefaults = {}): Project {
  const size = opts.exportSize
    ?? (opts.capture ? defaultExportFor(opts.capture) : { w: 1280, h: 720 });
  const vertical = size.h > size.w;
  return {
    version: 1,
    background: { kind: 'linear', from: '#6d5efc', to: '#c3f53c', angle: 135 },
    // fill 0.8 no es una eleccion estetica caprichosa: es lo que deja 1.56x de
    // margen de zoom nitido capturando a 1600x900 y exportando a 720p. Cambiarlo
    // mueve el techo de ampliacion, y por eso la UI lo recalcula en vivo.
    frame: {
      fill: 0.8,
      // El marco de movil ya impone su propio radio minimo; en horizontal este
      // es el redondeo de la ventana de navegador.
      radius: 14,
      shadow: 40,
      chrome: vertical ? 'phone' : 'macos',
      chromeLabel: opts.host ?? 'localhost',
      // Encendidos de fabrica: son la ventaja de capturar desde el DOM y sin
      // ellos nadie los descubre. Se apagan desde el editor.
      labels: true,
      keys: true,
    },
    zooms: [],
    trimStartMs: 0,
    trimEndMs: null,
    export: { width: size.w, height: size.h, fps: opts.fps ?? 60, format: 'mp4' },
  };
}

/** Dominio legible para la barra sintetica, tolerante a urls raras. */
/**
 * Color con el que se tine la ventana cuando esta grabacion esta abierta.
 *
 * El material de la interfaz toma un poco del color de lo que hay detras, y en
 * el editor "lo que hay detras" es la demo: su fondo. Sale del proyecto, que ya
 * lo lleva, sin decodificar nada.
 *
 * Con un fondo de imagen se devuelve null en vez de inventar un color: habria
 * que decodificarla y muestrearla, y un tinte equivocado es peor que ninguno.
 * Sin fondo, tampoco hay tinte: no hay de donde sacarlo.
 */
export function colorDominante(background: Background): string | null {
  switch (background.kind) {
    case 'solid': return background.color;
    // El primero del degradado y no una media: es el que ocupa la esquina
    // superior izquierda, que es de donde cae la luz del material.
    case 'linear': return background.from;
    case 'mesh': return background.colors[0] ?? null;
    default: return null;
  }
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host || 'localhost';
  } catch {
    return 'localhost';
  }
}
