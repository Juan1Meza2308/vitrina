/**
 * Motor de camara: convierte lo que hizo el usuario en como se mueve el encuadre.
 *
 *   InputEvent[]  --planSegments-->  ZoomSegment[]  --buildCameraTrack-->  CameraTrack
 *
 * Los tramos son datos editables: el timeline los muestra, el usuario los mueve
 * y la pista se reconstruye. Por eso las dos etapas estan separadas.
 */
export { planSegments } from './segments.ts';
export type { PlanOptions } from './segments.ts';
export { buildCameraTrack, CameraTrack, CursorPath, SUAVIZADO_CURSOR_MS } from './track.ts';
export type { BuildTrackOptions } from './track.ts';
export { CAMERA_PRESETS, cameraConfigForBudget } from './config.ts';
export {
  moveSegment, moveSegmentTarget, resizeSegment, deleteSegment, setSegmentScale, insertSegment,
  hasManualEdits, clampTrim, MIN_DURACION_MS,
} from './edit.ts';
export type { EditContext, InsertOptions } from './edit.ts';
export type { CameraConfig, CameraPresetName } from './config.ts';
export {
  viewRect, clampCenter, unionRect, padRect, rectCenter, scaleToFit, boxAround,
} from './geometry.ts';
export type { CameraState, Point } from './geometry.ts';

import { planSegments } from './segments.ts';
import { buildCameraTrack, type CameraTrack } from './track.ts';
import type { CameraConfig } from './config.ts';
import type { CaptureSize, InputEvent, ZoomSegment } from '../types.ts';

/** Camino corto: log de entrada -> camara lista para componer. */
export function autoCamera(opts: {
  events: InputEvent[];
  viewport: CaptureSize;
  startedAt: number;
  durationMs: number;
  config: CameraConfig;
}): { segments: ZoomSegment[]; track: CameraTrack } {
  const segments = planSegments(opts);
  return { segments, track: buildCameraTrack({ ...opts, segments }) };
}
