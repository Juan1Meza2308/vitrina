/**
 * Puente tipado entre el renderer y el proceso principal.
 *
 * Se expone una superficie cerrada y nombrada, no `ipcRenderer` en crudo: el
 * renderer carga contenido que compone y dibuja, y no tiene por que poder
 * invocar cualquier canal.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  CameraPresetName, CapturePreset, Cut, InputEvent, Manifest, Orientacion, Project,
} from '@vitrina/core';

export interface RecordingData {
  dir: string;
  manifest: Manifest;
  events: InputEvent[];
  project: Project;
}

export type { Look } from '../main/ajustes.ts';
import type { Look } from '../main/ajustes.ts';

export interface Ajustes {
  url: string;
  presetName: string;
  orientacion: Orientacion;
  micOn: boolean;
  micDeviceId: string;
  tapar: string;
  camOn: boolean;
  camDeviceId: string;
  tema: 'oscuro' | 'claro';
  looks: Look[];
  lookPorDefecto: string | null;
}

export interface GrabacionReciente {
  dir: string;
  nombre: string;
  durationMs: number;
  startedAt: number;
  /** Sello de un frame de la grabacion, como data URL. Null si no se pudo leer. */
  miniatura: string | null;
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

/** Lo que devuelve un export, ya resumido para poder ensenarlo. */
export interface ResultadoExport {
  file: string;
  settings: { width: number; height: number; fps: number; format: string };
  frames: number;
  durationMs: number;
  bytes: number;
  elapsedMs: number;
  warnings: string[];
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

  // La camara sigue el mismo camino que el microfono: trozos segun llegan, y
  // por `send` y no `invoke` porque nadie espera respuesta y una promesa por
  // trozo solo anadiria latencia a lo que compite con el screencast.
  camStart: (startedAt: number, mimeType: string, w: number, h: number): Promise<void> =>
    ipcRenderer.invoke('cam:start', startedAt, mimeType, w, h),
  camChunk: (chunk: Uint8Array): void => ipcRenderer.send('cam:chunk', chunk),
  camStop: (): Promise<unknown> => ipcRenderer.invoke('cam:stop'),

  // La voz doblada: el mismo camino que la narracion, con la carpeta explicita
  // porque doblar pasa en el editor y mucho despues de grabar.
  vozStart: (dir: string): Promise<void> => ipcRenderer.invoke('voz:start', dir),
  vozChunk: (chunk: Uint8Array): void => ipcRenderer.send('voz:chunk', chunk),
  vozStop: (): Promise<unknown> => ipcRenderer.invoke('voz:stop'),

  startRecording: (
    url: string,
    presetName: string,
    orientacion: Orientacion,
    /** Selectores CSS a difuminar, tal y como se escribieron en el campo. */
    tapar?: string,
  ): Promise<{
    dir: string; preset: CapturePreset;
    atajos: Record<string, string>;
    /** Los que el sistema no dejo registrar. Hay que decirlo: un atajo mudo es
     *  peor que no tenerlo. */
    atajosFallidos: string[];
  }> =>
    ipcRenderer.invoke('record:start', { url, presetName, orientacion, tapar }),
  stopRecording: (): Promise<RecordingData> => ipcRenderer.invoke('record:stop'),
  /** Pausa o reanuda. Devuelve si quedo pausada. */
  pausarGrabacion: (): Promise<boolean> => ipcRenderer.invoke('record:pausa'),
  marcarMomento: (): Promise<void> => ipcRenderer.invoke('record:marcar'),
  /** Atajos globales pulsados con la ventana detras. */
  onAtajoGrabacion: (cb: (que: string) => void) => subscribe<string>('record:atajo', cb),
  onPausaCambiada: (cb: (pausada: boolean) => void) => subscribe<boolean>('record:pausa', cb),
  repetirGrabacion: (dir: string, presetName?: string, texto?: string): Promise<RecordingData> =>
    ipcRenderer.invoke('record:repeat', { dir, presetName, texto }),
  onRecordProgress: (cb: (p: RecordProgress) => void) => subscribe('record:progress', cb),

  openRecording: (): Promise<RecordingData | null> => ipcRenderer.invoke('recording:open'),
  recientes: (limite = 5): Promise<GrabacionReciente[]> =>
    ipcRenderer.invoke('recordings:recent', limite),
  /**
   * Ruta en disco de un fichero soltado sobre la ventana.
   *
   * Desde Electron 32 `File.path` ya no existe: hay que pedirla por `webUtils`,
   * que es una API del preload y no del renderer. Sin esto, soltar una carpeta
   * solo da un nombre suelto y no se puede abrir nada.
   */
  rutaDeFichero: (f: File): string => webUtils.getPathForFile(f),
  ajustes: (): Promise<Ajustes> => ipcRenderer.invoke('settings:get'),
  elegirMarca: (dir: string): Promise<string | null> =>
    ipcRenderer.invoke('watermark:choose', dir),
  guardarAjustes: (parcial: Partial<Ajustes>): Promise<Ajustes> =>
    ipcRenderer.invoke('settings:set', parcial),
  loadRecording: (dir: string): Promise<RecordingData> => ipcRenderer.invoke('recording:load', dir),
  saveProject: (dir: string, project: Project): Promise<void> =>
    ipcRenderer.invoke('recording:saveProject', dir, project),

  planCamera: (dir: string, preset: CameraPresetName): Promise<Project> =>
    ipcRenderer.invoke('camera:plan', dir, preset),

  runExport: (opts: { dir: string; preset: string; cameraPreset: CameraPresetName; soft: boolean }):
    // Cancelar no es un error: el proceso principal devuelve una marca en vez
    // de lanzar, y quien llama decide como contarlo.
    Promise<ResultadoExport | { cancelled: true }> => ipcRenderer.invoke('export:run', opts),
  cancelExport: (): Promise<void> => ipcRenderer.invoke('export:cancel'),
  /** Escribe la guia escrita de la grabacion: pasos, capturas y capitulos. */
  exportarGuia: (dir: string): Promise<{ pasos: number; ficheros: string[] }> =>
    ipcRenderer.invoke('guia:run', dir),
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
