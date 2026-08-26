/**
 * Proceso principal.
 *
 * Aqui vive todo lo que necesita Node: el grabador (que lanza y controla un
 * navegador aparte por CDP) y el exportador (que habla con ffmpeg). El renderer
 * solo recibe datos y pide acciones.
 *
 * Los frames de la grabacion se sirven por un protocolo propio `vitrina://` en
 * vez de mandarlos por IPC. Un preview con scrubbing pide frames continuamente
 * y convertirlos a base64 para cruzar el puente los duplicaria de tamano y
 * bloquearia el hilo principal en cada movimiento del cursor.
 */
import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Recorder } from '@vitrina/capture-cdp';
import {
  CAPTURE_PRESETS, CAMERA_PRESETS, cameraConfigForBudget, computeQualityBudget,
  defaultProject, hostFromUrl, planSegments, parseSilenceReport, silenceFilter,
} from '@vitrina/core';
import type { AudioTrack, CameraPresetName, Cut, InputEvent, Manifest, Project } from '@vitrina/core';
import { exportRecording, EXPORT_PRESETS, ExportAbortedError, findFfmpeg } from '@vitrina/export';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);

const RECORDINGS = path.join(app.getPath('videos'), 'Vitrina');

let win: BrowserWindow | null = null;
let recorder: Recorder | null = null;
let recordingDir = '';
/** Carpeta que sirve el protocolo `vitrina://`. */
let servedDir = '';
let exportController: AbortController | null = null;
/** Escritura en curso de la pista de microfono. */
let audioStream: fs.WriteStream | null = null;
let audioTrack: AudioTrack | null = null;

/**
 * Dos esquemas propios, y los dos hacen falta.
 *
 * `app://` sirve la interfaz. Cargarla desde `file://` parece mas simple pero
 * no lo es: un origen `file://` tiene prohibido pedir a cualquier otro esquema,
 * con CORS o sin el, asi que el preview no podria leer ni un frame. Servida
 * desde un esquema estandar, la app tiene un origen de verdad.
 *
 * `vitrina://` sirve los frames de la grabacion abierta, con CORS habilitado
 * para que `app://` pueda leerlos.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  {
    scheme: 'vitrina',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

/**
 * Ruta de grabacion pasada por linea de comandos.
 *
 * Sirve para abrir una carpeta `.vitrina` directamente (asociacion de archivo,
 * atajo, o arrastrar sobre el ejecutable) y es tambien lo que permite verificar
 * la app de forma automatizada sin tener que conducir un dialogo nativo.
 */
function rutaDeArgv(): string | null {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const hit = args.find((a) => a.endsWith('.vitrina'));
  return hit ?? null;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0b0d10',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', async () => {
    win?.show();
    const ruta = rutaDeArgv();
    if (!ruta) return;
    try {
      win?.webContents.send('recording:opened', await loadRecording(ruta));
    } catch (e) {
      win?.webContents.send('recording:error', e instanceof Error ? e.message : String(e));
    }
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadURL('app://vitrina/index.html');
}

app.whenReady().then(() => {
  const RENDERER = path.join(__dirname, '../renderer');

  protocol.handle('app', async (request) => {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
    if (rel.includes('..')) return new Response('no', { status: 403 });
    return net.fetch(pathToFileURL(path.join(RENDERER, rel)).toString());
  });

  // Sirve los frames de la grabacion abierta. Solo se expone la carpeta activa,
  // asi que el renderer no puede pedir un fichero arbitrario del disco.
  protocol.handle('vitrina', async (request) => {
    const url = new URL(request.url);
    // Al ser un esquema `standard`, el primer segmento de
    // `vitrina://frames/000001.jpg` se parsea como HOST, no como carpeta. Hay
    // que recomponer host + pathname o se busca el fichero en la raiz.
    //
    // Y hay que quitar la barra final: `vitrina://mic.webm` no tiene ruta, asi
    // que su pathname es "/" y sin recortarlo se pide "mic.webm/", que no
    // existe. El sintoma era un elemento <audio> mudo y un ERR_FILE_NOT_FOUND
    // sin mas contexto.
    const rel = decodeURIComponent(url.host + url.pathname)
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (!servedDir || rel.includes('..')) return new Response('no', { status: 403 });
    const res = await net.fetch(pathToFileURL(path.join(servedDir, rel)).toString());
    // El preview lee los frames con fetch desde el origen `app://`, asi que la
    // respuesta tiene que permitirlo explicitamente.
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, headers });
  });

  // Sin esto `getUserMedia` falla en Electron. Se concede unicamente 'media',
  // que es lo que cubre el microfono: Vitrina no necesita ubicacion ni
  // notificaciones, y no tiene por que poder pedirlas.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void recorder?.close().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});

// --- lectura de una grabacion ----------------------------------------------

const readJson = async <T,>(p: string): Promise<T> =>
  JSON.parse(await fsp.readFile(p, 'utf8')) as T;

interface RecordingData {
  dir: string;
  manifest: Manifest;
  events: InputEvent[];
  project: Project;
}

async function loadRecording(dir: string): Promise<RecordingData> {
  const root = path.resolve(dir);
  const [manifest, events, project] = await Promise.all([
    readJson<Manifest>(path.join(root, 'manifest.json')),
    readJson<InputEvent[]>(path.join(root, 'events.json')),
    readJson<Project>(path.join(root, 'project.json')),
  ]);
  servedDir = root;
  return { dir: root, manifest, events, project };
}

// --- IPC --------------------------------------------------------------------

ipcMain.handle('presets:capture', () => CAPTURE_PRESETS);
ipcMain.handle('presets:export', () => Object.values(EXPORT_PRESETS));
ipcMain.handle('presets:camera', () => Object.keys(CAMERA_PRESETS));

/**
 * Reserva la carpeta antes de grabar.
 *
 * Hace falta porque el audio arranca ANTES que el video y necesita un sitio
 * donde escribir. Sin este paso, o el audio empieza tarde o hay que guardarlo
 * en memoria hasta saber la ruta.
 */
ipcMain.handle('record:prepare', async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  recordingDir = path.join(RECORDINGS, `${stamp}.vitrina`);
  await fsp.mkdir(recordingDir, { recursive: true });
  return recordingDir;
});

ipcMain.handle('audio:start', (_e, startedAt: number, mimeType: string) => {
  if (!recordingDir) throw new Error('No hay carpeta de grabacion preparada');
  audioTrack = { file: 'mic.webm', startedAt, mimeType };
  audioStream = fs.createWriteStream(path.join(recordingDir, 'mic.webm'));
});

ipcMain.on('audio:chunk', (_e, chunk: Uint8Array) => {
  audioStream?.write(Buffer.from(chunk));
});

ipcMain.handle('audio:stop', async () => {
  const stream = audioStream;
  audioStream = null;
  if (stream) await new Promise<void>((resolve) => stream.end(resolve));
  return audioTrack;
});

ipcMain.handle('record:start', async (_e, opts: { url: string; presetName: string }) => {
  if (recorder) throw new Error('Ya hay una grabacion en curso');

  const preset = CAPTURE_PRESETS.find((p) => p.name === opts.presetName) ?? CAPTURE_PRESETS[1]!;
  if (!recordingDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    recordingDir = path.join(RECORDINGS, `${stamp}.vitrina`);
  }
  await fsp.mkdir(recordingDir, { recursive: true });

  recorder = new Recorder({
    url: opts.url,
    viewport: preset.capture,
    outDir: recordingDir,
    onProgress: (p) => win?.webContents.send('record:progress', p),
  });

  await recorder.launch();
  await recorder.start();
  return { dir: recordingDir, preset };
});

ipcMain.handle('record:stop', async () => {
  if (!recorder) throw new Error('No hay grabacion en curso');
  recorder.setAudioTrack(audioTrack);
  audioTrack = null;
  const result = await recorder.stop();
  await recorder.close();
  recorder = null;

  // Planificar la camara nada mas parar: el usuario no deberia tener que pedir
  // el zoom automatico, es la razon de ser de la herramienta.
  await planAndSave(recordingDir, 'normal');
  return loadRecording(recordingDir);
});

ipcMain.handle('recording:open', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Abrir grabacion',
    defaultPath: RECORDINGS,
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return loadRecording(r.filePaths[0]);
});

ipcMain.handle('recording:load', (_e, dir: string) => loadRecording(dir));

ipcMain.handle('recording:saveProject', async (_e, dir: string, project: Project) => {
  await fsp.writeFile(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
});

ipcMain.handle('camera:plan', async (_e, dir: string, cameraPreset: CameraPresetName) =>
  planAndSave(dir, cameraPreset));

/**
 * Replanifica el zoom y lo guarda.
 *
 * El techo de ampliacion sale del presupuesto de calidad, que depende del
 * tamano de salida y del marco. Por eso se recalcula aqui y no se cachea: al
 * tocar el padding en el editor, el margen cambia.
 */
async function planAndSave(dir: string, cameraPreset: CameraPresetName): Promise<Project> {
  const { manifest, events, project } = await loadRecording(dir);
  const sourceSize = manifest.capture ?? manifest.viewport;
  const budget = computeQualityBudget(sourceSize, project.export, project.frame);
  const config = cameraConfigForBudget(CAMERA_PRESETS[cameraPreset], budget.maxSharpZoom);

  const zooms = planSegments({
    events, viewport: sourceSize, startedAt: manifest.startedAt,
    durationMs: manifest.durationMs, config,
  });

  const updated: Project = { ...project, zooms };
  await fsp.writeFile(path.join(dir, 'project.json'), JSON.stringify(updated, null, 2));
  return updated;
}

ipcMain.handle('export:run', async (_e, opts: {
  dir: string; preset: string; cameraPreset: CameraPresetName; soft: boolean;
}) => {
  exportController = new AbortController();
  try {
    return await exportRecording({
      recordingDir: opts.dir,
      preset: opts.preset,
      cameraPreset: opts.cameraPreset,
      allowSoftZoom: opts.soft,
      signal: exportController.signal,
      onProgress: (p) => win?.webContents.send('export:progress', p),
    });
  } catch (e) {
    if (e instanceof ExportAbortedError) return { cancelled: true };
    throw e;
  } finally {
    exportController = null;
  }
});

ipcMain.handle('export:cancel', () => {
  exportController?.abort();
});

/**
 * Detecta los silencios de la narracion.
 *
 * Se delega en el filtro `silencedetect` de ffmpeg en vez de analizar el audio
 * a mano: es una linea de argumentos contra un algoritmo propio, y los umbrales
 * quedan a la vista para poder ajustarlos.
 *
 * Devuelve los tramos; NO los aplica. Que se recorten o no lo decide quien
 * llama, porque una deteccion automatica sobre la voz de alguien se equivoca lo
 * suficiente como para que convenga poder deshacerla.
 */
ipcMain.handle('audio:silencios', async (_e, dir: string): Promise<Cut[]> => {
  const root = path.resolve(dir);
  const manifest = await readJson<Manifest>(path.join(root, 'manifest.json'));
  if (!manifest.audio) return [];

  const ruta = path.join(root, manifest.audio.file);
  // ffmpeg escribe la deteccion en stderr y termina con codigo 0; `-f null`
  // descarta la salida porque solo interesa el informe.
  const { stderr } = await ejecutar(findFfmpeg(), [
    '-v', 'info', '-i', ruta,
    '-af', silenceFilter(),
    '-f', 'null', '-',
  ]).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? '' }));

  return parseSilenceReport(stderr, {
    adelantoMs: manifest.startedAt - manifest.audio.startedAt,
    durationMs: manifest.durationMs,
  });
});

/**
 * Elige una imagen de fondo y la COPIA dentro de la grabacion.
 *
 * Guardar solo la ruta original seria mas barato, pero rompe la propiedad que
 * sostiene el formato: una carpeta `.vitrina` es autocontenida. Con una
 * referencia externa, mover la carpeta a otro equipo —o borrar la foto— deja
 * el proyecto sin fondo y sin explicacion.
 */
ipcMain.handle('background:choose', async (_e, dir: string) => {
  const r = await dialog.showOpenDialog({
    title: 'Imagen de fondo',
    properties: ['openFile'],
    filters: [{ name: 'Imagenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  const origen = r.canceled ? null : r.filePaths[0];
  if (!origen) return null;

  const ext = path.extname(origen).toLowerCase() || '.png';
  const destino = `fondo${ext}`;
  await fsp.copyFile(origen, path.join(path.resolve(dir), destino));
  return destino;
});

ipcMain.handle('shell:reveal', (_e, target: string) => {
  shell.showItemInFolder(target);
});

ipcMain.handle('project:defaults', (_e, url: string) =>
  defaultProject({ host: hostFromUrl(url) }));
