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
import {
  app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol, screen, session, shell,
} from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import CDP from 'chrome-remote-interface';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  Recorder, ventanaPara, guionDe, guionHasta, reproducir, listaDeSelectores,
} from '@vitrina/capture-cdp';
import {
  CAPTURE_PRESETS, CAMERA_PRESETS, cameraConfigForBudget, computeQualityBudget,
  defaultProject, FrameIndex, hostFromUrl, planSegments, parseSilenceReport, silenceFilter,
  paraOrientacion, reescalarProyecto, idiomaDe, conIdioma,
} from '@vitrina/core';
import type {
  AudioTrack, CamTrack, CameraPresetName, Cut, InputEvent, Manifest, Orientacion, Project, T,
} from '@vitrina/core';
import {
  exportRecording, exportarGuia, EXPORT_PRESETS, ExportAbortedError, findFfmpeg,
  comoInstalarFfmpeg, origenDeFfmpeg,
} from '@vitrina/export';
import { findBrowser, comoInstalarNavegador } from '@vitrina/capture-cdp';
import { normalizarAjustes, aplicarLook, type Ajustes } from './ajustes.ts';
import { esMasNueva, puedeActualizarSolo } from './version.ts';
// CommonJS con `require` dinamico dentro: importacion por defecto, y externo en
// la configuracion de electron-vite. Con importacion nombrada, el bundle
// compila y falla al arrancar.
import electronUpdater from 'electron-updater';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);

const RECORDINGS = path.join(app.getPath('videos'), 'Vitrina');

/** Un JSON en `userData`: son cinco campos, no hace falta una dependencia. */
const ficheroAjustes = () => path.join(app.getPath('userData'), 'ajustes.json');

async function leerAjustes(): Promise<Ajustes> {
  let crudo: unknown = null;
  try {
    crudo = JSON.parse(await fsp.readFile(ficheroAjustes(), 'utf8'));
  } catch {
    crudo = null;
  }
  const guardados = normalizarAjustes(crudo);
  // Sin idioma guardado manda el sistema. Se resuelve aqui y no en la
  // normalizacion porque `ajustes.ts` no puede importar Electron —es lo que lo
  // hace testeable— y `app.getLocale()` es de Electron.
  const tieneIdioma = typeof (crudo as { idioma?: unknown } | null)?.idioma === 'string';
  return tieneIdioma ? guardados : { ...guardados, idioma: idiomaDe(app.getLocale()) };
}

ipcMain.handle('settings:get', () => leerAjustes());

/**
 * Lo que la bienvenida necesita saber para poder decir la verdad.
 *
 * `detalle` lleva la version del navegador cuando lo hay, la ruta de ffmpeg
 * cuando funciona, y el texto de "como instalarlo" cuando no: un estado en rojo
 * sin decir que hacer es peor que no comprobar nada.
 */
export interface EstadoSistema {
  version: string;
  navegador: { ok: boolean; detalle: string };
  ffmpeg: { ok: boolean; origen: 'incluido' | 'sistema' | 'path'; detalle: string };
}

/**
 * Que necesita Vitrina y que hay de eso en esta maquina.
 *
 * Lo pide la pantalla de bienvenida, y es una comprobacion de verdad, no una
 * promesa: el navegador se busca en el disco y a ffmpeg se le PIDE su version.
 * Comprobar que el fichero existe no basta —una instalacion a medias, un
 * antivirus que se lleva el binario, un permiso de ejecucion que falta— y el
 * sitio donde eso tiene que aparecer es la primera pantalla, no el momento de
 * exportar, cuando ya hay una demo grabada y editada detras.
 */
async function estadoDelSistema(): Promise<EstadoSistema> {
  const nav = findBrowser();
  const ruta = findFfmpeg();
  let ffmpegOk = false;
  try {
    await ejecutar(ruta, ['-version'], { timeout: 5000 });
    ffmpegOk = true;
  } catch {
    ffmpegOk = false;
  }
  return {
    version: app.getVersion(),
    navegador: nav
      ? { ok: true, detalle: nav.label }
      : { ok: false, detalle: comoInstalarNavegador() },
    ffmpeg: {
      ok: ffmpegOk,
      // De donde salio importa para lo que se lee: "viene con la app" y "lo
      // tienes tu instalado" llevan a decisiones distintas si algo va mal.
      origen: origenDeFfmpeg(ruta),
      detalle: ffmpegOk ? ruta : comoInstalarFfmpeg(),
    },
  };
}

ipcMain.handle('sistema:estado', () => estadoDelSistema());

/* -------------------------------------------------------------------------
 * Actualizaciones
 *
 * La app pregunta por la ultima Release al arrancar y, si hay una mas nueva,
 * AVISA. No se descarga sola ni se instala por su cuenta: quien esta grabando
 * una demo no puede encontrarse con que la aplicacion se reinicia.
 *
 * El aviso solo aparece en la app instalada. Ejecutandola desde el codigo no
 * tiene sentido —ahi se actualiza con git— y electron-updater directamente se
 * niega a mirar.
 * ---------------------------------------------------------------------- */

const { autoUpdater } = electronUpdater;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

/** Ultima version vista, para poder responder a quien pregunte mas tarde. */
let nuevaVersion: string | null = null;

function avisarDeVersion(version: string): void {
  if (!esMasNueva(version, app.getVersion())) return;
  nuevaVersion = version;
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('update:disponible', version);
  }
}

function mirarSiHayVersionNueva(): void {
  // Modo de prueba: sin publicar nada se puede ver el aviso tal y como lo vera
  // el usuario. Es el mismo recurso que `data-cristal` para el desenfoque, y
  // sirve para que `verificar-app --actualizacion` compruebe la barra de
  // verdad, en la app de verdad.
  const fingida = process.env['VITRINA_FINGIR_ACTUALIZACION'];
  if (fingida) {
    setTimeout(() => avisarDeVersion(fingida), 800);
    return;
  }
  if (!app.isPackaged) return;

  autoUpdater.on('update-available', (info: { version: string }) => avisarDeVersion(info.version));
  autoUpdater.on('download-progress', (p: { percent: number }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('update:progreso', Math.round(p.percent));
    }
  });
  autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall());
  // Un fallo aqui no es asunto del usuario: si GitHub no responde o no hay red,
  // la app funciona igual. Se traga y se reintentara en el proximo arranque.
  autoUpdater.on('error', () => {});
  void autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.handle('update:pendiente', () => nuevaVersion);

/**
 * Instalar la version nueva.
 *
 * En Windows se descarga y la app se reinicia sola. En macOS no: Squirrel exige
 * que la app este firmada y Vitrina no lo esta, asi que se abre la pagina de
 * descargas en vez de prometer algo que no va a ocurrir.
 */
ipcMain.handle('update:instalar', async () => {
  if (!puedeActualizarSolo() || !app.isPackaged) {
    await shell.openExternal('https://github.com/Juan1Meza2308/vitrina/releases/latest');
    return 'pagina';
  }
  void autoUpdater.downloadUpdate().catch(() => {});
  return 'descargando';
});

/**
 * Abrir un enlace en el navegador del sistema.
 *
 * Con lista blanca de destinos: el renderer no puede pedir que se abra
 * cualquier cosa. Son los dos sitios a los que la bienvenida manda —descargar
 * un navegador o ffmpeg— y la documentacion del proyecto.
 */
const ENLACES: Record<string, string> = {
  navegador: 'https://www.google.com/chrome/',
  ffmpeg: 'https://ffmpeg.org/download.html',
  guia: 'https://github.com/Juan1Meza2308/vitrina#readme',
};
ipcMain.handle('sistema:abrir', async (_e, clave: string) => {
  const url = ENLACES[clave];
  if (url) await shell.openExternal(url);
});

/**
 * Senalar un ffmpeg a mano cuando el de la app no aparece.
 *
 * Se guarda en los ajustes y se pone en `FFMPEG_PATH`, que es lo primero que
 * mira `findFfmpeg()`: no hace falta ni una linea de resolucion nueva.
 */
ipcMain.handle('sistema:elegirFfmpeg', async (): Promise<EstadoSistema> => {
  const t = await traductor();
  const r = await dialog.showOpenDialog({
    title: t('Elige el ejecutable de ffmpeg'),
    properties: ['openFile'],
    filters: process.platform === 'win32'
      ? [{ name: t('Ejecutable'), extensions: ['exe'] }]
      : [{ name: t('Todos'), extensions: ['*'] }],
  });
  const elegido = r.filePaths[0];
  if (!r.canceled && elegido) {
    process.env['FFMPEG_PATH'] = elegido;
    await guardarAjustes({ ffmpegPath: elegido });
  }
  return estadoDelSistema();
});

/**
 * La funcion de traduccion del proceso principal.
 *
 * Se pide en cada uso y no se guarda en una variable de modulo porque el idioma
 * puede cambiar mientras la app esta abierta: un titulo de dialogo cacheado se
 * quedaria en el idioma que hubiera al arrancar.
 */
async function traductor(): Promise<T> {
  return conIdioma((await leerAjustes()).idioma);
}

async function guardarAjustes(parcial: Partial<Ajustes>): Promise<Ajustes> {
  const fusion = { ...(await leerAjustes()), ...parcial };
  await fsp.writeFile(ficheroAjustes(), JSON.stringify(fusion, null, 2)).catch(() => {});
  return fusion;
}

ipcMain.handle('settings:set', (_e, parcial: Partial<Ajustes>) => guardarAjustes(parcial));

/**
 * Las ultimas grabaciones, para no tener que buscarlas en un dialogo.
 *
 * Se leen del disco cada vez en lugar de mantener una lista: si el usuario
 * borra una carpeta, una lista guardada ofreceria abrir algo que ya no existe.
 */
/**
 * Fotogramas de una grabacion, escalados y en data URL.
 *
 * Van como data URL y no por el protocolo `vitrina://`, que solo sirve la
 * grabacion ABIERTA: aqui hay varias carpetas a la vez. Reescalados a 320 px
 * porque un frame pesa cientos de kilobytes y esto es para pintar una tarjeta.
 */
async function fotogramas(
  dir: string, m: Manifest, instantes: number[], ancho = 320,
): Promise<string[]> {
  const index = new FrameIndex(m);
  const salida: string[] = [];
  for (const ms of instantes) {
    const file = index.at(ms);
    if (!file) continue;
    try {
      const img = await loadImage(path.join(dir, 'frames', file));
      const h = Math.max(1, Math.round(ancho * (img.height / img.width)));
      const c = createCanvas(ancho, h);
      c.getContext('2d').drawImage(img, 0, 0, ancho, h);
      salida.push(c.toDataURL('image/jpeg', 0.62));
    } catch {
      // Un frame ilegible no tumba la tarjeta: se queda con los que salgan.
    }
  }
  return salida;
}

/**
 * Como se llama una grabacion en la lista.
 *
 * El host de la app grabada, que es lo que distingue una demo de otra. Con un
 * fichero local no hay host —`hostFromUrl` devuelve "localhost" para todo— y se
 * usa el nombre del fichero: tres demos de tres fixtures distintos se llamarian
 * igual, que es justo lo que la lista venia a arreglar.
 */
function tituloDeGrabacion(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return decodeURIComponent(u.pathname.split('/').pop() ?? '') || 'archivo';
    return u.host || hostFromUrl(url);
  } catch {
    return hostFromUrl(url);
  }
}

/**
 * Instante de la portada: el del PRIMER CLICK.
 *
 * Al arrancar, la pagina grabada suele estar en blanco o a medio cargar, y una
 * lista de rectangulos vacios no distingue una demo de otra —que es justo para
 * lo que sirve la portada—. El primer click es el momento en que ya hay algo
 * que ver y ademas es lo que la demo venia a ensenar.
 */
async function instanteDePortada(dir: string, m: Manifest): Promise<number> {
  try {
    const events = JSON.parse(
      await fsp.readFile(path.join(dir, 'events.json'), 'utf8')) as InputEvent[];
    const click = events.find((e) => e.type === 'down');
    if (click) return click.t - m.startedAt;
  } catch {
    /* sin log: se cae al reparto de siempre */
  }
  return m.durationMs * 0.25;
}

/**
 * Tira de fotogramas de una grabacion, para animar su tarjeta.
 *
 * Se pide al posar el cursor y se cachea: generarlas todas al arrancar
 * decodificaria treinta frames grandes de golpe y la app tardaria en abrir.
 * La cache vive lo que vive la app; la carpeta de la grabacion no se ensucia.
 */
const cachePrevia = new Map<string, string[]>();

ipcMain.handle('recordings:preview', async (_e, dir: string): Promise<string[]> => {
  const carpeta = path.resolve(dir);
  const cacheada = cachePrevia.get(carpeta);
  if (cacheada) return cacheada;

  try {
    const m = JSON.parse(
      await fsp.readFile(path.join(carpeta, 'manifest.json'), 'utf8')) as Manifest;
    // Repartidos entre el 8 % y el 88 %: los extremos de una demo son la pagina
    // cargando y el cursor parado, y no cuentan nada.
    const cuantos = 6;
    const instantes = Array.from({ length: cuantos }, (_, i) =>
      m.durationMs * (0.08 + (0.8 * i) / (cuantos - 1)));
    const tira = await fotogramas(carpeta, m, instantes);
    cachePrevia.set(carpeta, tira);
    return tira;
  } catch {
    return [];
  }
});

ipcMain.handle('recordings:recent', async (_e, limite = 5) => {
  try {
    const nombres = await fsp.readdir(RECORDINGS);
    const info = await Promise.all(nombres
      .filter((n) => n.endsWith('.vitrina'))
      .map(async (nombre) => {
        const dir = path.join(RECORDINGS, nombre);
        try {
          const m = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
          const [portada] = await fotogramas(dir, m, [await instanteDePortada(dir, m)]);
          return {
            dir,
            nombre,
            // El host identifica la demo mucho mejor que la hora de la carpeta.
            host: tituloDeGrabacion(m.url),
            durationMs: m.durationMs,
            startedAt: m.startedAt,
            portada: portada ?? null,
          };
        } catch {
          return null;   // carpeta a medias: una grabacion interrumpida
        }
      }));
    return info
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limite);
  } catch {
    return [];
  }
});

let win: BrowserWindow | null = null;
let recorder: Recorder | null = null;
/**
 * Tamano de frame que se pidio al grabar, para contrastarlo con el que salio.
 *
 * Desde que la captura usa escala esto importa: si la emulacion no se aplica,
 * se piden 2560 px y se graban 1073 sin que nada falle. Todo aguas abajo lee
 * `manifest.capture`, asi que el video sale coherente pero mucho menos nitido
 * de lo prometido, y en silencio.
 */
let marcoPedido: { w: number; h: number } | null = null;
let recordingDir = '';
/**
 * Atajos que funcionan con la ventana de Vitrina detras.
 *
 * Son la diferencia entre parar la grabacion y GRABARSE parando la grabacion:
 * la demo pasa en otra ventana, asi que volver aqui a pulsar un boton sale en
 * el video. Se registran solo mientras se graba y se liberan al parar: un atajo
 * global que sobreviva a la grabacion se dispararia dentro de otra app.
 */
const ATAJOS = {
  parar: 'CommandOrControl+Shift+S',
  pausa: 'CommandOrControl+Shift+P',
  marca: 'CommandOrControl+Shift+M',
} as const;

/** Devuelve los que no se pudieron registrar, para poder DECIRLO. Un atajo mudo
 *  es peor que no tenerlo: se pulsa y no pasa nada. */
function registrarAtajos(): string[] {
  const fallidos: string[] = [];
  const reg = (combo: string, fn: () => void) => {
    try {
      if (!globalShortcut.register(combo, fn)) fallidos.push(combo);
    } catch {
      fallidos.push(combo);
    }
  };
  // Parar pasa por el renderer y no por el grabador: el microfono lo lleva el
  // renderer y hay que cerrarlo ANTES de que se escriba el manifest.
  reg(ATAJOS.parar, () => win?.webContents.send('record:atajo', 'parar'));
  reg(ATAJOS.pausa, () => void alternarPausa());
  reg(ATAJOS.marca, () => recorder?.marcar());
  return fallidos;
}

function liberarAtajos(): void {
  globalShortcut.unregisterAll();
}

async function alternarPausa(): Promise<boolean> {
  if (!recorder) return false;
  if (recorder.pausada) await recorder.reanudar();
  else await recorder.pausar();
  win?.webContents.send('record:pausa', recorder.pausada);
  return recorder.pausada;
}

/** Carpeta que sirve el protocolo `vitrina://`. */
let servedDir = '';
let exportController: AbortController | null = null;
/** Escritura en curso de la pista de microfono. */
let audioStream: fs.WriteStream | null = null;
let audioTrack: AudioTrack | null = null;
let camStream: fs.WriteStream | null = null;
/** Escritura en curso de la voz doblada. */
let vozStream: fs.WriteStream | null = null;
/**
 * Regrabacion en curso, si la hay.
 *
 * Hace falta al PARAR: la cabeza conserva los zooms de la grabacion vieja y la
 * cola se planifica de cero, y para eso hay que recordar de donde venia.
 */
let regrabando: { origen: string; desdeMs: number } | null = null;
let camTrack: CamTrack | null = null;

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

  // Un ffmpeg elegido a mano manda sobre el que trae la app. Se aplica ANTES de
  // abrir la ventana: si se hiciera al primer export, la bienvenida estaria
  // informando de un ffmpeg distinto del que se va a usar.
  void leerAjustes().then((a) => {
    if (a.ffmpegPath) process.env['FFMPEG_PATH'] = a.ffmpegPath;
  });

  createWindow();
  mirarSiHayVersionNueva();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Un atajo global que sobreviva a la app se dispararia dentro de otra: Electron
// los libera al salir, pero mas vale decirlo aqui que confiar en ello.
app.on('will-quit', liberarAtajos);

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

// La camara, igual que el audio y en la misma carpeta reservada de antemano.
ipcMain.handle('cam:start', (_e, startedAt: number, mimeType: string, w: number, h: number) => {
  if (!recordingDir) throw new Error('No hay carpeta de grabacion preparada');
  camTrack = { file: 'camara.webm', startedAt, mimeType, w, h };
  camStream = fs.createWriteStream(path.join(recordingDir, 'camara.webm'));
});

ipcMain.on('cam:chunk', (_e, chunk: Uint8Array) => {
  camStream?.write(Buffer.from(chunk));
});

ipcMain.handle('cam:stop', async () => {
  const stream = camStream;
  camStream = null;
  if (stream) await new Promise<void>((resolve) => stream.end(resolve));
  return camTrack;
});

ipcMain.handle('record:start', async (
  _e,
  opts: { url: string; presetName: string; orientacion?: Orientacion; tapar?: string },
) => {
  if (recorder) throw new Error('Ya hay una grabacion en curso');

  const elegido = CAPTURE_PRESETS.find((p) => p.name === opts.presetName) ?? CAPTURE_PRESETS[1]!;
  // Mismos pixeles con otra forma: los fps medidos para el preset siguen
  // valiendo, y el encuadre sale con proporcion de movil.
  const preset = paraOrientacion(elegido, opts.orientacion ?? 'horizontal');
  if (!recordingDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    recordingDir = path.join(RECORDINGS, `${stamp}.vitrina`);
  }
  await fsp.mkdir(recordingDir, { recursive: true });

  const selectores = listaDeSelectores(opts.tapar ?? '');

  // La ventana la decide quien conoce la pantalla. El grabador tiene un
  // respaldo razonable, pero en un portatil bajo o con un viewport vertical
  // ese respaldo se sale del area util y la demo se graba a ciegas.
  const hueco = screen.getPrimaryDisplay().workAreaSize;
  recorder = new Recorder({
    url: opts.url,
    // El viewport es el CSS, no el tamano del frame: en vista de movil son
    // 430x932 y los frames salen a 1290x2796 por la escala.
    viewport: preset.css ?? preset.capture,
    deviceScaleFactor: preset.dsf ?? 1,
    window: ventanaPara(preset.capture, {
      width: Math.round(hueco.width * 0.92),
      height: Math.round(hueco.height * 0.92),
    }),
    outDir: recordingDir,
    // Lo que no debe salir se difumina AL GRABAR: el frame que se escribe en
    // disco ya va tapado, asi que el dato en claro no llega a existir. Taparlo
    // en el editor dejaria la carpeta `.vitrina` con el dato entero dentro.
    tapado: selectores.length ? { selectores } : null,
    onProgress: (p) => win?.webContents.send('record:progress', p),
  });

  marcoPedido = preset.capture;
  await recorder.launch();
  await recorder.start();
  return { dir: recordingDir, preset, atajos: ATAJOS, atajosFallidos: registrarAtajos() };
});

/**
 * Repite una grabacion: vuelve a ejecutar su log de entrada y guarda otra nueva.
 *
 * Es lo que evita la dolencia de siempre —un fallo a los tres minutos obliga a
 * repetir los tres minutos y ademas se pierde lo editado—. La original no se
 * toca: sale una grabacion aparte.
 */
ipcMain.handle('record:repeat', async (
  _e,
  opts: { dir: string; presetName?: string; texto?: string },
) => {
  if (recorder) throw new Error('Ya hay una grabacion en curso');

  const origen = path.resolve(opts.dir);
  const manifest = JSON.parse(
    await fsp.readFile(path.join(origen, 'manifest.json'), 'utf8')) as Manifest;
  const events = JSON.parse(
    await fsp.readFile(path.join(origen, 'events.json'), 'utf8')) as InputEvent[];

  const fuenteVieja = manifest.capture ?? manifest.viewport;
  const elegido = opts.presetName
    ? CAPTURE_PRESETS.find((p) => p.name === opts.presetName)
    : undefined;
  const preset = elegido
    ? paraOrientacion(elegido, fuenteVieja.h > fuenteVieja.w ? 'vertical' : 'horizontal')
    : null;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destino = path.join(RECORDINGS, `${stamp}-repetida.vitrina`);
  await fsp.mkdir(destino, { recursive: true });

  const guion = guionDe(events, manifest.startedAt, {
    deviceScaleFactor: manifest.deviceScaleFactor ?? 1,
    relleno: opts.texto ?? '',
  });

  const hueco = screen.getPrimaryDisplay().workAreaSize;
  const viewport = preset?.css ?? preset?.capture ?? manifest.viewport;
  const dsf = preset ? (preset.dsf ?? 1) : (manifest.deviceScaleFactor ?? 1);
  recorder = new Recorder({
    url: manifest.url,
    viewport,
    deviceScaleFactor: dsf,
    window: ventanaPara(
      { w: Math.round(viewport.w * dsf), h: Math.round(viewport.h * dsf) },
      { width: Math.round(hueco.width * 0.92), height: Math.round(hueco.height * 0.92) },
    ),
    outDir: destino,
    // Se repite tambien lo que se tapo: una repeticion sin esto publicaria en
    // la segunda toma el dato que se tapo en la primera, y sin avisar.
    tapado: manifest.tapado ?? null,
    onProgress: (p) => win?.webContents.send('record:progress', p),
  });

  try {
    await recorder.launch();
    await recorder.start();

    // Al target de la pagina y con `local: true`: conectar en medio del
    // screencast sin eso se come mas de quince segundos, y aqui esos segundos
    // desplazarian el guion entero respecto a la grabacion.
    const objetivos = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as
      { type: string; id: string }[];
    const pagina = objetivos.find((t) => t.type === 'page');
    if (!pagina) throw new Error('El navegador de repeticion no expuso una pagina');
    const input = (await CDP({
      port: 9222, target: pagina.id, local: true,
    })) as unknown as Parameters<typeof reproducir>[0] & { close(): Promise<void> };

    await reproducir(input, guion, { relleno: opts.texto ?? '' });
    await input.close();

    const resultado = await recorder.stop();
    await recorder.close();
    recorder = null;

    // El proyecto se copia REESCALADO: los tramos de zoom guardan su objetivo
    // en pixeles de la fuente, asi que copiarlos tal cual a una captura de otro
    // tamano deja la camara encuadrando otro sitio, y sin sintoma visible.
    try {
      const viejo = JSON.parse(
        await fsp.readFile(path.join(origen, 'project.json'), 'utf8')) as Project;
      const fuenteNueva = resultado.manifest.capture ?? resultado.manifest.viewport;
      // La repeticion vuelve a ejecutar el guion en un navegador nuevo, pero no
      // vuelve a grabar a la persona: sin pista, un estilo de burbuja copiado
      // seria un ajuste que no dibuja nada y que nadie sabria por que esta.
      const copiado = reescalarProyecto(viejo, fuenteVieja, fuenteNueva);
      await fsp.writeFile(
        path.join(destino, 'project.json'),
        JSON.stringify({ ...copiado, camara: null }, null, 2),
      );
    } catch {
      await planAndSave(destino, 'normal');
    }

    recordingDir = destino;
    return loadRecording(destino);
  } catch (e) {
    liberarAtajos();
    await recorder?.close().catch(() => {});
    recorder = null;
    throw e;
  }
});

/*
 * La voz doblada: mismo camino que la narracion, otro fichero.
 *
 * Se escribe en la carpeta de la grabacion ABIERTA, que llega como parametro:
 * doblar pasa en el editor, mucho despues de grabar, y `recordingDir` puede
 * apuntar a otra cosa o a nada.
 */
ipcMain.handle('voz:start', async (_e, dir: string) => {
  const carpeta = path.resolve(dir);
  await fsp.access(path.join(carpeta, 'manifest.json'));   // que sea una grabacion
  vozStream = fs.createWriteStream(path.join(carpeta, 'voz.webm'));
});

ipcMain.on('voz:chunk', (_e, chunk: Uint8Array) => {
  vozStream?.write(Buffer.from(chunk));
});

ipcMain.handle('voz:stop', async () => {
  const stream = vozStream;
  vozStream = null;
  if (stream) await new Promise<void>((resolve) => stream.end(resolve));
});

ipcMain.handle('record:pausa', () => alternarPausa());

// El atajo global no siempre esta disponible —otra app puede tenerlo cogido— y
// ademas hay quien prefiere un boton. La marca tiene que poder ponerse igual.
ipcMain.handle('record:marcar', () => { recorder?.marcar(); });

/**
 * Regraba una demo desde un instante.
 *
 * Vitrina ejecuta sola la cabeza —con los mismos tiempos que la original, que
 * es lo que deja la app en el mismo estado— y devuelve el control. La promesa
 * se resuelve justo en el relevo, para que el renderer arranque el microfono
 * ahi: durante la cabeza no estabas hablando.
 *
 * La grabacion original no se toca: sale una carpeta nueva.
 */
ipcMain.handle('record:retake', async (_e, opts: { dir: string; desdeMs: number }) => {
  if (recorder) throw new Error('Ya hay una grabacion en curso');

  const origen = path.resolve(opts.dir);
  const manifest = JSON.parse(
    await fsp.readFile(path.join(origen, 'manifest.json'), 'utf8')) as Manifest;
  const events = JSON.parse(
    await fsp.readFile(path.join(origen, 'events.json'), 'utf8')) as InputEvent[];

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destino = path.join(RECORDINGS, `${stamp}-regrabada.vitrina`);
  await fsp.mkdir(destino, { recursive: true });

  const guion = guionDe(events, manifest.startedAt, {
    deviceScaleFactor: manifest.deviceScaleFactor ?? 1,
  });
  const cabeza = guionHasta(guion, opts.desdeMs);

  const hueco = screen.getPrimaryDisplay().workAreaSize;
  const viewport = manifest.viewport;
  const dsf = manifest.deviceScaleFactor ?? 1;
  recorder = new Recorder({
    url: manifest.url,
    viewport,
    deviceScaleFactor: dsf,
    window: ventanaPara(
      { w: Math.round(viewport.w * dsf), h: Math.round(viewport.h * dsf) },
      { width: Math.round(hueco.width * 0.92), height: Math.round(hueco.height * 0.92) },
    ),
    outDir: destino,
    // Lo que se tapo se sigue tapando: la toma nueva no puede publicar lo que
    // la vieja escondia.
    tapado: manifest.tapado ?? null,
    onProgress: (p) => win?.webContents.send('record:progress', p),
  });

  try {
    await recorder.launch();
    await recorder.start();
    const arranque = Date.now();

    const objetivos = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as
      { type: string; id: string }[];
    const pagina = objetivos.find((t) => t.type === 'page');
    if (!pagina) throw new Error('El navegador de regrabacion no expuso una pagina');
    const input = (await CDP({
      port: 9222, target: pagina.id, local: true,
    })) as unknown as Parameters<typeof reproducir>[0] & { close(): Promise<void> };

    await reproducir(input, cabeza);
    await input.close();

    /*
     * Se espera hasta el instante del relevo, aunque la ultima accion cayera
     * antes.
     *
     * Sin esto la cabeza dura MENOS que la original —entre el ultimo click y el
     * punto elegido no pasa nada, pero ese hueco existe— y los zooms que se
     * conservan, que van por instante, apuntarian un poco antes de donde toca.
     * Lo caza `verificar-app --regrabar`, que vio la cola metida en la cabeza.
     */
    const restante = opts.desdeMs - (Date.now() - arranque);
    if (restante > 0) await new Promise((r) => setTimeout(r, restante));

    recordingDir = destino;
    regrabando = { origen, desdeMs: opts.desdeMs };
    marcoPedido = manifest.capture ?? viewport;
    return { dir: destino, acciones: cabeza.length, atajosFallidos: registrarAtajos() };
  } catch (e) {
    liberarAtajos();
    await recorder?.close().catch(() => {});
    recorder = null;
    throw e;
  }
});

ipcMain.handle('record:stop', async () => {
  if (!recorder) throw new Error('No hay grabacion en curso');
  liberarAtajos();
  recorder.setAudioTrack(audioTrack);
  recorder.setCamTrack(camTrack);
  audioTrack = null;
  camTrack = null;
  const result = await recorder.stop();
  await recorder.close();
  recorder = null;

  const real = result.manifest.capture;
  if (marcoPedido && real && (real.w !== marcoPedido.w || real.h !== marcoPedido.h)) {
    win?.webContents.send('recording:error',
      `La captura salio a ${real.w}×${real.h} en vez de ${marcoPedido.w}×${marcoPedido.h}: `
      + 'el navegador no aplico la escala. El video se puede editar igual, pero '
      + 'sera menos nitido de lo previsto.');
  }
  marcoPedido = null;

  // Planificar la camara nada mas parar: el usuario no deberia tener que pedir
  // el zoom automatico, es la razon de ser de la herramienta.
  await planAndSave(recordingDir, 'normal');

  /*
   * Si esto era una regrabacion, se cose el proyecto.
   *
   * Los zooms de la cabeza siguen valiendo —incluidos los que el usuario movio
   * a mano, que es justo lo que no puede perderse— porque la cabeza se ejecuto
   * con los mismos tiempos. Los de la cola no: ahi hay material nuevo, y
   * copiarlos dejaria la camara encuadrando lo que ya no esta.
   *
   * Los cortes y las velocidades tampoco se copian: sus instantes eran del
   * material viejo y en la toma nueva no significan nada.
   */
  if (regrabando) {
    const { origen, desdeMs } = regrabando;
    regrabando = null;
    try {
      const viejo = JSON.parse(
        await fsp.readFile(path.join(origen, 'project.json'), 'utf8')) as Project;
      const viejoManifest = JSON.parse(
        await fsp.readFile(path.join(origen, 'manifest.json'), 'utf8')) as Manifest;
      const ruta = path.join(recordingDir, 'project.json');
      const nuevo = JSON.parse(await fsp.readFile(ruta, 'utf8')) as Project;

      const copiado = reescalarProyecto(
        viejo,
        viejoManifest.capture ?? viejoManifest.viewport,
        result.manifest.capture ?? result.manifest.viewport,
      );
      await fsp.writeFile(ruta, JSON.stringify({
        ...copiado,
        zooms: [
          ...copiado.zooms.filter((z) => z.endMs <= desdeMs),
          ...nuevo.zooms.filter((z) => z.startMs >= desdeMs),
        ],
        camara: null,
        voz: null,
        pista: undefined,
        cuts: [],
        speeds: [],
        export: nuevo.export,
      }, null, 2));
    } catch {
      // Sin proyecto viejo que copiar, el plan automatico ya es correcto.
    }
  }

  // Y aplicar el look por defecto, si lo hay. Va aqui y no en `defaultProject`
  // porque ese vive en la libreria de captura, que no sabe nada de ajustes de
  // usuario y no debe saberlo.
  const ajustes = await leerAjustes();
  const look = ajustes.looks.find((l) => l.nombre === ajustes.lookPorDefecto);
  if (look) {
    const ruta = path.join(recordingDir, 'project.json');
    try {
      const p = JSON.parse(await fsp.readFile(ruta, 'utf8')) as Project;
      await fsp.writeFile(ruta, JSON.stringify(aplicarLook(p, look), null, 2));
    } catch { /* sin look: la grabacion sigue siendo valida */ }
  }
  return loadRecording(recordingDir);
});

ipcMain.handle('recording:open', async () => {
  const t = await traductor();
  const r = await dialog.showOpenDialog({
    title: t('Abrir grabación'),
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

/**
 * Escribe la guia de la grabacion abierta.
 *
 * Va por el proceso principal como el export: escribe ficheros en la carpeta y
 * decodifica frames, dos cosas que el renderer no deberia hacer.
 */
ipcMain.handle('guia:run', async (_e, dir: string) => {
  // En el idioma de la app: la guia se comparte con quien no estuvo en la demo,
  // y quien la exporta en ingles espera entregarla en ingles.
  const { idioma } = await leerAjustes();
  const r = await exportarGuia({ recordingDir: path.resolve(dir), idioma });
  return { pasos: r.pasos.length, ficheros: r.ficheros };
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
  const t = await traductor();
  const r = await dialog.showOpenDialog({
    title: t('Imagen de fondo'),
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

/**
 * Copia la imagen de la marca DENTRO de la carpeta, igual que el fondo.
 *
 * La grabacion tiene que poder moverse de maquina y seguir exportando: si se
 * guardara la ruta original, el export fallaria en cuanto se moviera el fichero.
 */
ipcMain.handle('watermark:choose', async (_e, dir: string) => {
  const t = await traductor();
  const r = await dialog.showOpenDialog({
    title: t('Marca de agua'),
    properties: ['openFile'],
    filters: [{ name: 'Imagenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  const origen = r.canceled ? null : r.filePaths[0];
  if (!origen) return null;

  const ext = path.extname(origen).toLowerCase() || '.png';
  const destino = `marca${ext}`;
  await fsp.copyFile(origen, path.join(path.resolve(dir), destino));
  return destino;
});

ipcMain.handle('shell:reveal', (_e, target: string) => {
  shell.showItemInFolder(target);
});

ipcMain.handle('project:defaults', (_e, url: string) =>
  defaultProject({ host: hostFromUrl(url) }));
