/**
 * El compositor se escribe contra la API estandar de Canvas 2D y NADA mas.
 *
 * Esa es la restriccion que hace posible que el mismo codigo dibuje el preview
 * en el navegador y los frames del export en Node: en el navegador el contexto
 * viene de un `<canvas>` y en Node de `@napi-rs/canvas`, que implementa la
 * misma superficie sobre Skia. Si el preview y el export tuvieran dos
 * implementaciones, lo que se ve al editar no seria lo que sale exportado, y
 * ese desajuste es imposible de depurar despues.
 *
 * En Node los tipos no coinciden nominalmente aunque la API si; el puente se
 * hace con un unico cast en el punto de entrada, no repartido por el codigo.
 */
export type Ctx = CanvasRenderingContext2D;
export type ImageLike = CanvasImageSource;

/** Estado del cursor en un instante, ya resuelto desde el log de entrada. */
export interface CursorSample {
  /** Posicion en coordenadas de la FUENTE, no de la salida. */
  x: number;
  y: number;
  /** El boton esta pulsado: el cursor se encoge un poco. */
  pressed: boolean;
  /** 0 = invisible, 1 = opaco. Baja cuando el raton lleva rato quieto. */
  opacity: number;
  /** Ondas de click activas, con su progreso de 0 a 1. */
  ripples: number[];
}
