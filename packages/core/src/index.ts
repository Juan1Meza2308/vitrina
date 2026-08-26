export type {
  Rect, InputEvent, InputEventType, Frame, CaptureSize, Manifest,
  Background, FrameStyle, ZoomSegment, Project, ExportSettings,
} from './types.ts';
export {
  computeQualityBudget, describeBudget, clampZoom, pickPreset, CAPTURE_PRESETS, MEDIDO_EN,
} from './quality.ts';
export type { QualityBudget, CapturePreset } from './quality.ts';
export { FrameIndex } from './frames.ts';
export { audioAlignment, audioTimeFor, supportsAudio } from './audio.ts';
export { TimeMap } from './timemap.ts';
export { parseSilenceReport, silenceFilter, UMBRAL_DB, MIN_SILENCIO_S, MARGEN_MS } from './silence.ts';
export type { ParseSilenceOptions } from './silence.ts';
export type { Cut, Keep, TimeMapOptions } from './timemap.ts';
export type { AudioTrack, AudioAlignment } from './audio.ts';
export { layoutFrame } from './layout.ts';
export type { FrameLayout, FrameStyleInput } from './layout.ts';
export { defaultProject, hostFromUrl } from './project.ts';
export type { ProjectDefaults } from './project.ts';
export {
  planSegments, buildCameraTrack, CameraTrack, CursorPath, autoCamera,
  CAMERA_PRESETS, cameraConfigForBudget,
  moveSegment, moveSegmentTarget, resizeSegment, deleteSegment, setSegmentScale, insertSegment,
  hasManualEdits, clampTrim, MIN_DURACION_MS,
  viewRect, clampCenter, unionRect, padRect, rectCenter, scaleToFit, boxAround,
} from './camera/index.ts';
export type {
  CameraConfig, CameraPresetName, CameraState, Point, PlanOptions, BuildTrackOptions,
  EditContext, InsertOptions,
} from './camera/index.ts';
