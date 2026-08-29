/**
 * Grabador: orquesta navegador, screencast y log de eventos, y deja en disco
 * una carpeta `.vitrina` autocontenida.
 *
 * Todo lo que hay aqui esta medido en M0 (ver spikes/HALLAZGOS.md). Dos
 * decisiones no son obvias y conviene no revertirlas sin volver a medir:
 *
 *  1. La resolucion se consigue con un VIEWPORT EMULADO GRANDE, no subiendo el
 *     deviceScaleFactor puesto por `Emulation`: `Page.startScreencast` lo
 *     ignora y entrega el viewport CSS a 1:1. Lo que SI funciona es forzar la
 *     escala al lanzar el navegador con `--force-device-scale-factor`, porque
 *     entonces el surface del compositor nace ya escalado (M7). Hay que
 *     ponerla en los dos sitios: solo en el navegador, la pagina cree tener
 *     dpr 1 y carga assets de baja resolucion.
 *  2. El ack del frame se envia ANTES de tocar los datos. CDP no manda el frame
 *     siguiente hasta recibirlo, asi que cualquier trabajo sincrono en el
 *     handler se convierte directamente en fps perdidos.
 */
// La declaracion ambiente se referencia explicitamente para que viaje con
// el paquete. Sin esto solo la ve quien la incluya en su propio tsconfig,
// y la app de escritorio compilaba sin los tipos de CDP.
/// <reference path="./chrome-remote-interface.d.ts" />
import CDP from 'chrome-remote-interface';
import { spawn, type ChildProcess } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {
  AudioTrack, CamTrack, CaptureSize, Cut, Frame, InputEvent, Manifest, Tapado,
} from '@vitrina/core/types';
import {
  defaultProject, hostFromUrl, planSegments, computeQualityBudget,
  cameraConfigForBudget, CAMERA_PRESETS,
} from '@vitrina/core';
import { findBrowser, launchFlags, comoInstalarNavegador, type BrowserInfo } from './browser.ts';
import { INJECT_SOURCE, BINDING_NAME } from './inject.ts';
import { fuenteDeTapado, selectoresValidos, desenfoqueValido } from './tapar.ts';
import { jpegSize } from './jpeg.ts';
import type { CdpClient } from './cdp.ts';

/**
 * Ventana fisica con la forma del viewport emulado, cabiendo en el hueco dado.
 *
 * Da igual para el fichero resultante —el screencast entrega el viewport
 * emulado a su tamano, no el de la ventana— pero no da igual para quien graba:
 * con un viewport 9:16 dentro de una ventana apaisada, el navegador encaja el
 * contenido a lo alto y la demo se hace mirando una tira diminuta en medio de
 * dos franjas vacias.
 */
export function ventanaPara(
  viewport: CaptureSize,
  hueco: { width: number; height: number } = { width: 1280, height: 780 },
): { width: number; height: number } {
  const escala = Math.min(hueco.width / viewport.w, hueco.height / viewport.h, 1);
  return {
    // Chrome tiene un ancho minimo de ventana; pedir menos no rompe nada porque
    // el emulado manda, solo deja bandas a los lados mientras se graba.
    width: Math.max(1, Math.round(viewport.w * escala)),
    height: Math.max(1, Math.round(viewport.h * escala)),
  };
}

export interface RecorderOptions {
  url: string;
  /** Viewport emulado en css px. Es tambien el tamano exacto de cada frame. */
  /**
   * Viewport emulado en px CSS. Es lo que ve la pagina y lo que decide su
   * maquetacion; con `deviceScaleFactor` > 1 los frames salen mas grandes.
   */
  viewport: CaptureSize;
  /**
   * Escala de dispositivo. Multiplica el tamano de los frames sin tocar la
   * maquetacion: es lo que permite grabar la vista de movil (430 px CSS) con
   * resolucion de publicar (1290 px). Ver M7 en spikes/HALLAZGOS.md.
   */
  deviceScaleFactor?: number;
  /** 92 por defecto: en M0 la calidad no afecta al rendimiento, asi que sale gratis. */
  quality?: number;
  outDir: string;
  port?: number;
  /** Tamano de la ventana fisica. Se ajusta para caber en la pantalla. */
  window?: { width: number; height: number };
  /**
   * Que difuminar en la pagina para que no salga en el video.
   *
   * Se aplica AL GRABAR, no al exportar: el frame que se escribe en disco ya
   * va tapado, asi que el dato en claro no llega a existir en ningun sitio.
   */
  tapado?: Tapado | null;
  onProgress?: (p: { frames: number; events: number; elapsedMs: number }) => void;
}

export interface RecordingResult {
  manifest: Manifest;
  events: InputEvent[];
  outDir: string;
  /** Frames que llegaron con un tamano distinto al esperado. Deberia ser 0. */
  sizeMismatches: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** No se pisa un project.json existente: contiene ediciones del usuario. */
async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export class Recorder {
  private opts: Required<Pick<RecorderOptions, 'quality' | 'port'>> & RecorderOptions;
  private child: ChildProcess | null = null;
  private client: CdpClient | null = null;
  private browser: BrowserInfo | null = null;
  private profileDir = '';

  private frames: Frame[] = [];
  private events: InputEvent[] = [];
  private pendingWrites = 0;
  private seq = 0;
  private startedAt = 0;
  private expected: CaptureSize | null = null;
  private sizeMismatches = 0;
  private recording = false;
  private audio: AudioTrack | null = null;
  private camara: CamTrack | null = null;
  /** Tramos con el screencast parado, en offsets desde `startedAt`. */
  private pausas: Cut[] = [];
  /** Instante en que empezo la pausa en curso. 0 si no hay ninguna. */
  private pausadaEn = 0;

  constructor(options: RecorderOptions) {
    this.opts = { quality: 92, port: 9222, ...options };
  }

  /** Arranca el navegador, inyecta la captura de eventos y navega a la url. */
  async launch(): Promise<BrowserInfo> {
    const browser = findBrowser();
    if (!browser) {
      throw new Error(comoInstalarNavegador());
    }
    this.browser = browser;

    await fsp.mkdir(path.join(this.opts.outDir, 'frames'), { recursive: true });
    this.profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-'));

    // La ventana fisica no tiene que coincidir con el viewport emulado: puede
    // ser mas pequena y el navegador reescala para mostrarla. Eso es lo que
    // permite grabar a 1600x900 en un monitor de 1080p.
    const dsf = this.opts.deviceScaleFactor ?? 1;
    const win = this.opts.window ?? ventanaPara(this.marco());
    this.child = spawn(
      browser.path,
      launchFlags({
        port: this.opts.port,
        profileDir: this.profileDir,
        // `--window-size` va en DIP, asi que con escala 3 hay que pedir un
        // tercio o la ventana sale tres veces mas grande que la pantalla y
        // quien graba hace la demo a ciegas.
        windowWidth: Math.max(200, Math.round(win.width / dsf)),
        windowHeight: Math.max(200, Math.round(win.height / dsf)),
        deviceScaleFactor: dsf,
      }),
      { stdio: 'ignore' },
    );

    await this.waitForPort();
    this.client = (await CDP({ port: this.opts.port })) as unknown as CdpClient;
    const { Page, Runtime, Emulation } = this.client;
    await Promise.all([Page.enable(), Runtime.enable()]);

    await Runtime.addBinding({ name: BINDING_NAME });
    this.client.on('Runtime.bindingCalled', (p: { name: string; payload: string }) => {
      if (p.name !== BINDING_NAME) return;
      if (!this.recording) return;      // ignorar lo que pase antes de grabar
      try {
        this.events.push(JSON.parse(p.payload) as InputEvent);
      } catch {
        /* payload corrupto: un evento perdido no justifica tirar la grabacion */
      }
    });
    // El tapado, antes que la captura de eventos y antes de navegar: los dos
    // scripts corren al crear cada documento, y el orden entre ellos da igual
    // —el de entrada lee la global cuando llega un click, no al instalarse—,
    // pero llegar antes que la primera pintura de la pagina no da igual.
    const tapadoSource = fuenteDeTapado(this.opts.tapado);
    if (tapadoSource) await Page.addScriptToEvaluateOnNewDocument({ source: tapadoSource });
    await Page.addScriptToEvaluateOnNewDocument({ source: INJECT_SOURCE });
    // El binding no sobrevive a una navegacion. Sin esto, la demo deja de
    // registrar eventos en cuanto se cambia de pagina.
    this.client.on('Runtime.executionContextCreated', () => {
      void Runtime.addBinding({ name: BINDING_NAME }).catch(() => {});
    });

    const loaded = new Promise<void>((resolve) => {
      this.client!.on('Page.loadEventFired', () => resolve());
    });
    await Page.navigate({ url: this.opts.url });
    await Promise.race([loaded, sleep(15000)]);

    // La escala se pone TAMBIEN aqui, no solo al lanzar: forzada solo en el
    // navegador, los frames salen grandes pero la pagina cree tener dpr 1 y
    // carga los assets de baja resolucion, con lo que se ve blanda pese al
    // tamano. Medido en M7, caso C.
    await Emulation.setDeviceMetricsOverride({
      width: this.opts.viewport.w,
      height: this.opts.viewport.h,
      deviceScaleFactor: this.opts.deviceScaleFactor ?? 1,
      mobile: false,
    });
    // Un movil no ensena barra de scroll de escritorio, y con el viewport
    // emulado a 430 px asomaba una en el borde derecho de la "pantalla". Es
    // experimental, asi que si el navegador no la tiene se sigue: una barra de
    // mas es un defecto estetico, no un motivo para no poder grabar.
    if ((this.opts.deviceScaleFactor ?? 1) !== 1) {
      await Emulation.setScrollbarsHidden({ hidden: true }).catch(() => {});
    }
    await sleep(400);
    return browser;
  }

  /**
   * Registra la pista de microfono en el manifest.
   *
   * El audio lo captura el renderer de Electron, no el grabador, pero el
   * manifest lo escribe el grabador. Se le pasa antes de `stop()` para que la
   * carpeta salga completa de una vez, en lugar de parchear el JSON despues.
   */
  setAudioTrack(track: AudioTrack | null): void {
    this.audio = track;
  }

  /**
   * Registra la pista de camara web en el manifest.
   *
   * Mismo reparto que el audio: la captura el renderer de Electron, que es
   * quien tiene acceso a `getUserMedia`, y el manifest lo escribe el grabador.
   */
  setCamTrack(track: CamTrack | null): void {
    this.camara = track;
  }

  /** Empieza a recibir frames. Todo lo anterior no se graba. */
  async start(): Promise<void> {
    if (!this.client) throw new Error('launch() antes de start()');
    const { Page } = this.client;
    this.expected = this.marco();

    this.client.on(
      'Page.screencastFrame',
      (p: { data: string; sessionId: number; metadata: { timestamp: number } }) => {
        // Ack primero, siempre: el frame siguiente no sale hasta que llega.
        void Page.screencastFrameAck({ sessionId: p.sessionId }).catch(() => {});
        this.handleFrame(p.data, p.metadata.timestamp);
      },
    );

    this.recording = true;
    this.startedAt = Date.now();
    await Page.startScreencast({
      format: 'jpeg',
      quality: this.opts.quality,
      maxWidth: 4096,
      maxHeight: 2560,
      everyNthFrame: 1,
    });
  }

  get pausada(): boolean {
    return this.pausadaEn !== 0;
  }

  /**
   * Pausa la captura de VIDEO. El microfono y la camara siguen grabando.
   *
   * No es un descuido: el reloj del audio tiene que seguir coincidiendo con el
   * de pared, que es de lo que vive `audioTimeFor`. Parar el micro obligaria a
   * reescribir el mapeo de la narracion entera para ahorrar unos segundos de
   * ruido de sala que el corte se lleva igualmente.
   *
   * El hueco queda en la linea de tiempo y se guarda como un corte, asi que el
   * video sale sin el y se puede recuperar quitando el corte.
   */
  async pausar(): Promise<void> {
    if (!this.client || !this.recording || this.pausadaEn) return;
    this.pausadaEn = Date.now();
    await this.client.Page.stopScreencast().catch(() => {});
  }

  async reanudar(): Promise<void> {
    if (!this.client || !this.recording || !this.pausadaEn) return;
    this.cerrarPausa();
    await this.client.Page.startScreencast({
      format: 'jpeg',
      quality: this.opts.quality,
      maxWidth: 4096,
      maxHeight: 2560,
      everyNthFrame: 1,
    });
  }

  /** Anota la pausa en curso. Se llama al reanudar y tambien al parar, porque
   *  parar en pausa es lo normal si el usuario se ha ido. */
  private cerrarPausa(): void {
    if (!this.pausadaEn) return;
    this.pausas.push({
      startMs: this.pausadaEn - this.startedAt,
      endMs: Date.now() - this.startedAt,
    });
    this.pausadaEn = 0;
  }

  private handleFrame(data: string, timestamp: number): void {
    const buf = Buffer.from(data, 'base64');
    const size = jpegSize(buf);
    if (size && this.expected && (size.w !== this.expected.w || size.h !== this.expected.h)) {
      this.sizeMismatches++;
    }

    const file = String(++this.seq).padStart(6, '0') + '.jpg';
    this.frames.push({ file, t: timestamp, bytes: buf.length });

    this.pendingWrites++;
    void fsp
      .writeFile(path.join(this.opts.outDir, 'frames', file), buf)
      .catch(() => {})
      .finally(() => {
        this.pendingWrites--;
      });

    this.opts.onProgress?.({
      frames: this.frames.length,
      events: this.events.length,
      elapsedMs: Date.now() - this.startedAt,
    });
  }

  /** Para la captura, vacia la cola de escritura y escribe manifest y eventos. */
  async stop(): Promise<RecordingResult> {
    if (!this.client) throw new Error('launch() antes de stop()');
    const { Page } = this.client;
    this.cerrarPausa();
    this.recording = false;
    await Page.stopScreencast().catch(() => {});
    const durationMs = Date.now() - this.startedAt;

    // No cerrar hasta que el ultimo frame este en disco, o el manifest
    // referenciaria ficheros que no existen.
    while (this.pendingWrites > 0) await sleep(50);

    const manifest: Manifest = {
      version: 1,
      browser: this.browser?.label ?? 'desconocido',
      url: this.opts.url,
      viewport: this.opts.viewport,
      deviceScaleFactor: this.opts.deviceScaleFactor ?? 1,
      capture: this.frames.length ? this.expected : null,
      quality: this.opts.quality,
      startedAt: this.startedAt,
      durationMs,
      frames: this.frames,
      audio: this.audio,
      camara: this.camara,
      tapado: this.tapadoAplicado(),
    };

    await fsp.writeFile(
      path.join(this.opts.outDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
    await fsp.writeFile(
      path.join(this.opts.outDir, 'events.json'),
      JSON.stringify(this.events, null, 2),
    );

    // Una carpeta .vitrina sin project.json no se puede abrir en el editor, y
    // una con project.json pero sin tramos de zoom se abre sin nada que ver.
    // El zoom automatico es la razon de ser de la herramienta y se deduce de
    // los eventos, asi que se calcula aqui: la carpeta sale util de una vez,
    // la grabe el CLI, la app o una herramienta.
    const projectPath = path.join(this.opts.outDir, 'project.json');
    if (!(await exists(projectPath))) {
      const viewport = manifest.capture ?? manifest.viewport;
      // `capture` decide la forma de la salida y el tipo de marco: una grabacion
      // vertical tiene que abrirse ya en 9:16 y con marco de movil.
      const project = defaultProject({ host: hostFromUrl(this.opts.url), capture: viewport });
      // Si se grabo camara, la burbuja viene puesta. Grabarse la cara y abrir el
      // editor sin verla se leeria como que no funciono; quitarla es un click y
      // no obliga a volver a grabar.
      if (this.camara) {
        project.camara = {
          esquina: 'se', tamano: 0.22, forma: 'circulo',
          espejo: false, borde: 3, sombra: 24,
        };
      }
      const budget = computeQualityBudget(viewport, project.export, project.frame);
      project.zooms = planSegments({
        events: this.events,
        viewport,
        startedAt: this.startedAt,
        durationMs,
        config: cameraConfigForBudget(CAMERA_PRESETS.normal, budget.maxSharpZoom),
      });
      // Las pausas se guardan como cortes: son exactamente eso, trozos del
      // material que no llegan al video. Como dato y no aplicados, asi que
      // quitar el corte devuelve el tramo por si alguien lo quiere.
      if (this.pausas.length > 0) project.cuts = this.pausas;
      await fsp.writeFile(projectPath, JSON.stringify(project, null, 2));
    }

    return {
      manifest,
      events: this.events,
      outDir: this.opts.outDir,
      sizeMismatches: this.sizeMismatches,
    };
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => {});
    this.child?.kill();
    await sleep(300);
    if (this.profileDir) {
      await fsp.rm(this.profileDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Lo que se tapo DE VERDAD, no lo que se pidio.
   *
   * Se guardan los selectores ya validados y el radio ya acotado, porque el
   * manifest describe la grabacion que hay en disco: apuntar un selector que se
   * descarto haria creer que un dato esta tapado cuando se ve entero.
   */
  private tapadoAplicado(): Tapado | null {
    const selectores = selectoresValidos(this.opts.tapado?.selectores ?? []);
    if (selectores.length === 0) return null;
    return { selectores, desenfoque: desenfoqueValido(this.opts.tapado?.desenfoque) };
  }

  /**
   * Tamano real de cada frame: viewport CSS por la escala.
   *
   * Con escala 1 coincide con el viewport, que es el caso apaisado de siempre.
   */
  private marco(): CaptureSize {
    const dsf = this.opts.deviceScaleFactor ?? 1;
    return {
      w: Math.round(this.opts.viewport.w * dsf),
      h: Math.round(this.opts.viewport.h * dsf),
    };
  }

  private async waitForPort(timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${this.opts.port}/json/version`);
        if (r.ok) return;
      } catch {
        /* el navegador todavia esta arrancando */
      }
      await sleep(150);
    }
    throw new Error(`El navegador no expuso CDP en el puerto ${this.opts.port}`);
  }
}
