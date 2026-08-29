export { composite, sourceToOutput } from './compositor.ts';
export type { CompositeOptions } from './compositor.ts';
export { paintBackground, withAlpha } from './background.ts';
export { drawFrame, drawNotch } from './chrome.ts';
export { CursorSource, drawCursor } from './cursor.ts';
export {
  OverlaySource, drawLabel, drawKeys, drawWatermark, anclarEnEsquina, nombreTecla,
} from './overlays.ts';
export { drawCamara, cajaDeCamara, recorteCover } from './camara.ts';
export type { OverlaySample } from './overlays.ts';
export type { Ctx, ImageLike, CursorSample } from './types.ts';
