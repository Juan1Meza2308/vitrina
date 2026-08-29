export { exportRecording, clampZooms, ExportAbortedError } from './exporter.ts';
export type { ExportOptions, ExportProgress, ExportResult } from './exporter.ts';
export { EXPORT_PRESETS, resolvePreset, extensionFor } from './presets.ts';
export type { ExportPreset, ExportPresetName } from './presets.ts';
// Vive en core porque lo comparten el exportador y el preview del editor,
// que corre en el navegador y no puede cargar dependencias nativas.
export { FrameIndex } from '@vitrina/core';
export {
  cadenaAtempo, findFfmpeg, origenDeFfmpeg, comoInstalarFfmpeg, startEncoder,
} from './ffmpeg.ts';
export type { Encoder } from './ffmpeg.ts';
export { exportarGuia, encuadreDePaso } from './guia.ts';
export type { OpcionesGuia as OpcionesExportarGuia, ResultadoGuia } from './guia.ts';
