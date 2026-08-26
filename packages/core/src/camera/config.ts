/**
 * Constantes de la camara. Aqui vive el "feel" del producto.
 *
 * Todos los numeros estan expuestos a proposito: la diferencia entre un zoom
 * que se siente intencional y uno que marea son estas cifras, no el algoritmo.
 * Los tests golden existen para poder tocarlas sin romper el comportamiento sin
 * darse cuenta.
 */

export interface CameraConfig {
  // --- Agrupacion de clicks ---------------------------------------------
  /** Hueco sin actividad que cierra un grupo. Clicks encadenados (rellenar un
   *  formulario) forman un solo zoom en vez de uno por campo. */
  idleMs: number;

  // --- Tiempos del tramo -------------------------------------------------
  /** Se empieza a ampliar ANTES del click. Si el zoom llega despues, el
   *  espectador ya vio el resultado y el movimiento sobra. */
  leadInMs: number;
  /** Cuanto se mantiene la ampliacion tras la ultima actividad. */
  holdMs: number;
  /** Tramos mas juntos que esto se fusionan, para evitar el efecto yo-yo. */
  mergeGapMs: number;
  /** Por debajo de esto el tramo se descarta: un zoom mas corto es un parpadeo. */
  minDurationMs: number;

  // --- Encuadre ----------------------------------------------------------
  /** Margen alrededor del elemento, en fraccion de su propio tamano. */
  paddingFraction: number;
  /** Margen minimo en px, para que un boton pequeno no quede pegado al borde. */
  minPaddingPx: number;
  /** Por debajo de esta escala no compensa ampliar: se descarta el tramo. */
  minScale: number;
  /** Techo de ampliacion. Lo fija el presupuesto de calidad, no el gusto. */
  maxScale: number;

  // --- Movimiento --------------------------------------------------------
  /** Tiempo de asentamiento del muelle, en ms. */
  settleMs: number;
  /** Amortiguacion. 1.0 = critico, sin rebote. Ligeramente por debajo da
   *  el punch caracteristico sin llegar a oscilar de forma visible. */
  damping: number;

  // --- Seguimiento del cursor -------------------------------------------
  /** Fraccion central de la vista donde el cursor NO arrastra la camara.
   *  Sin zona muerta la camara tiembla siguiendo cada temblor del raton. */
  deadZone: number;
  /** Si la camara sigue al cursor mientras mantiene la ampliacion. */
  followCursor: boolean;

  // --- Guardas anti-mareo ------------------------------------------------
  /** Velocidad de scroll por encima de la cual se corta la ampliacion.
   *  Ampliar mientras la pagina se desplaza rapido es la receta del mareo. */
  scrollCutPxPerSec: number;
}

/** Base compartida. Los presets solo cambian lo que los distingue de verdad. */
const BASE: CameraConfig = {
  idleMs: 1200,
  leadInMs: 400,
  holdMs: 900,
  mergeGapMs: 800,
  minDurationMs: 700,
  paddingFraction: 0.6,
  minPaddingPx: 80,
  minScale: 1.15,
  maxScale: 1.56,
  settleMs: 600,
  damping: 0.9,
  deadZone: 0.6,
  followCursor: true,
  scrollCutPxPerSec: 800,
};

export type CameraPresetName = 'sutil' | 'normal' | 'marcado';

export const CAMERA_PRESETS: Record<CameraPresetName, CameraConfig> = {
  /** Apenas se nota que hay camara. Para demos largas y densas. */
  sutil: { ...BASE, maxScale: 1.25, settleMs: 850, holdMs: 1100, paddingFraction: 0.9 },
  /** El punto de referencia. */
  normal: { ...BASE },
  /** Movimiento rapido y ampliacion agresiva. Para clips cortos de redes. */
  marcado: { ...BASE, settleMs: 420, damping: 0.82, holdMs: 700, paddingFraction: 0.35 },
};

/**
 * Ajusta un preset al presupuesto real de calidad del material.
 *
 * El techo de ampliacion no es una preferencia estetica: por encima del margen
 * medido se empieza a ampliar pixeles. Esta funcion existe para que sea
 * imposible configurar una camara que produce material blando sin querer.
 */
export function cameraConfigForBudget(
  preset: CameraConfig,
  maxSharpZoom: number,
  allowSoft = false,
): CameraConfig {
  if (allowSoft) return { ...preset };
  return { ...preset, maxScale: Math.min(preset.maxScale, Math.max(1, maxSharpZoom)) };
}
