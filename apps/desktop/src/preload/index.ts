/**
 * Puente tipado entre el renderer y el proceso principal.
 *
 * Se expone una superficie cerrada y nombrada, no `ipcRenderer` en crudo: el
 * renderer carga contenido que compone y dibuja, y no tiene por que poder
 * invocar cualquier canal.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type {
  CameraPresetName, CapturePreset, Cut, InputEvent, Manifest, Orientacion, Project,
} from '@vitrina/core';

export interface RecordingData {
  dir: string;
  manifest: Manifest;
  events: InputEvent[];
  project: Project;
}

export interface RecordProgress {
  frames: number;
  events: number;
  elapsedMs: number;
}

export interface ExportProgressMsg {
  frame: number;
  totalFrames: number;
  fraction: number;
  fps: number;
  etaMs: number;
}

export interface ExportPresetInfo {
  name: string;
  width: number;
  height: number;
  fps: number;
  format: string;
  nota: string;
}

/** Suscripcion que devuelve su propia funcion de baja, para poder limpiarla
 *  desde un efecto de React sin tener que recordar el nombre del canal. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api = {
  capturePresets: (): Promise<CapturePreset[]> => ipcRenderer.invoke('presets:capture'),
  exportPresets: (): Promise<ExportPresetInfo[]> => ipcRenderer.invoke('presets:export'),
  cameraPresets: (): Promise<CameraPresetName[]> => ipcRenderer.invoke('presets:camera'),

  prepareRecording: (): Promise<string> => ipcRenderer.invoke('record:prepare'),
  audioStart: (startedAt: number, mimeType: string): Promise<void> =>
    ipcRenderer.invoke('audio:start', startedAt, mimeType),
  // `send` y no `invoke`: los trozos llegan cada segundo y no hay respuesta que
  // esperar; una promesa por trozo solo anadiria latencia.
  audioChunk: (chunk: Uint8Array): void => ipcRenderer.send('audio:chunk', chunk),
  audioStop: (): Promise<unknown> => ipcRenderer.invoke('audio:stop'),

  startRecording: (
    url: string,
    presetName: string,
    orientacion: Orientacion,
  ): Promise<{ dir: string; preset: CapturePreset }> =>
    ipcRenderer.invoke('record:start', { url, presetName, orientacion }),
  stopRecording: (): Promise<RecordingData> => ipcRenderer.invoke('record:stop'),
  onRecordProgress: (cb: (p: RecordProgress) => void) => subscribe('record:progress', cb),

  openRecording: (): Promise<RecordingData | null> => ipcRenderer.invoke('recording:open'),
  loadRecording: (dir: string): Promise<RecordingData> => ipcRenderer.invoke('recording:load', dir),
  saveProject: (dir: string, project: Project): Promise<void> =>
    ipcRenderer.invoke('recording:saveProject', dir, project),

  planCamera: (dir: string, preset: CameraPresetName): Promise<Project> =>
    ipcRenderer.invoke('camera:plan', dir, preset),

  runExport: (opts: { dir: string; preset: string; cameraPreset: CameraPresetName; soft: boolean }) =>
    ipcRenderer.invoke('export:run', opts),
  cancelExport: (): Promise<void> => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb: (p: ExportProgressMsg) => void) => subscribe('export:progress', cb),

  /** Detecta silencios en la narracion. Devuelve tramos, no los aplica. */
  detectarSilencios: (dir: string): Promise<Cut[]> =>
    ipcRenderer.invoke('audio:silencios', dir),

  /** Copia una imagen dentro de la grabacion y devuelve su nombre relativo. */
  chooseBackground: (dir: string): Promise<string | null> =>
    ipcRenderer.invoke('background:choose', dir),

  reveal: (target: string): Promise<void> => ipcRenderer.invoke('shell:reveal', target),

  /** Grabacion abierta desde la linea de comandos, al arrancar. */
  onRecordingOpened: (cb: (d: RecordingData) => void) => subscribe('recording:opened', cb),
  onRecordingError: (cb: (msg: string) => void) => subscribe('recording:error', cb),
};

export type VitrinaApi = typeof api;

contextBridge.exposeInMainWorld('vitrina', api);
