export type {
  Rect, InputEvent, InputEventType, Frame, CaptureSize, Manifest,
  Background, FrameStyle, ZoomSegment, Project, ExportSettings, Watermark,
} from './types.ts';
export {
  computeQualityBudget, describeBudget, clampZoom, pickPreset, CAPTURE_PRESETS, MEDIDO_EN,
  paraOrientacion, orientacionDe,
} from './quality.ts';
export type { QualityBudget, CapturePreset, Orientacion } from './quality.ts';
export { FrameIndex } from './frames.ts';
export { audioAlignment, audioTimeFor, supportsAudio } from './audio.ts';
export { TimeMap } from './timemap.ts';
export { parseSilenceReport, silenceFilter, UMBRAL_DB, MIN_SILENCIO_S, MARGEN_MS } from './silence.ts';
export { tramosSinActividad, ahorroDe, IDLE_MIN_MS, IDLE_OBJETIVO_MS, IDLE_MARGEN_MS } from './idle.ts';
export type { IdleOptions } from './idle.ts';
export type { ParseSilenceOptions } from './silence.ts';
export type { Cut, Keep, Speed, TimeMapOptions } from './timemap.ts';
export { RATE_MIN, RATE_MAX } from './timemap.ts';
export type { AudioTrack, AudioAlignment } from './audio.ts';
export { layoutFrame, notchRect } from './layout.ts';
export type { FrameLayout, FrameStyleInput, Insets } from './layout.ts';
export { defaultProject, defaultExportFor, hostFromUrl } from './project.ts';
export type { ProjectDefaults } from './project.ts';
export {
  planSegments, buildCameraTrack, CameraTrack, CursorPath, SUAVIZADO_CURSOR_MS, autoCamera,
  CAMERA_PRESETS, cameraConfigForBudget,
  moveSegment, moveSegmentTarget, resizeSegment, deleteSegment, setSegmentScale, insertSegment,
  hasManualEdits, clampTrim, MIN_DURACION_MS,
  viewRect, clampCenter, unionRect, padRect, rectCenter, scaleToFit, boxAround,
} from './camera/index.ts';
export type {
  CameraConfig, CameraPresetName, CameraState, Point, PlanOptions, BuildTrackOptions,
  EditContext, InsertOptions,
} from './camera/index.ts';
