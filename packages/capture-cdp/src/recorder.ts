/**
 * Grabador: orquesta navegador, screencast y log de eventos, y deja en disco
 * una carpeta `.vitrina` autocontenida.
 *
 * Todo lo que hay aqui esta medido en M0 (ver spikes/HALLAZGOS.md). Dos
 * decisiones no son obvias y conviene no revertirlas sin volver a medir:
 *
 *  1. La resolucion se consigue con un VIEWPORT EMULADO GRANDE, no subiendo el
 *     deviceScaleFactor. `Page.startScreencast` ignora por completo el DSF y
 *     entrega siempre el viewport CSS a 1:1, en headed y en headless.
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
import type { AudioTrack, CaptureSize, Frame, InputEvent, Manifest } from '@vitrina/core/types';
import { defaultProject, hostFromUrl } from '@vitrina/core';
import { findBrowser, launchFlags, comoInstalarNavegador, type BrowserInfo } from './browser.ts';
import { INJECT_SOURCE, BINDING_NAME } from './inject.ts';
import { jpegSize } from './jpeg.ts';
import type { CdpClient } from './cdp.ts';

export interface RecorderOptions {
  url: string;
  /** Viewport emulado en css px. Es tambien el tamano exacto de cada frame. */
  viewport: CaptureSize;
  /** 92 por defecto: en M0 la calidad no afecta al rendimiento, asi que sale gratis. */
  quality?: number;
  outDir: string;
  port?: number;
  /** Tamano de la ventana fisica. Se ajusta para caber en la pantalla. */
  window?: { width: number; height: number };
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
    const win = this.opts.window ?? { width: 1280, height: 780 };
    this.child = spawn(
      browser.path,
      launchFlags({
        port: this.opts.port,
        profileDir: this.profileDir,
        windowWidth: win.width,
        windowHeight: win.height,
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

    await Emulation.setDeviceMetricsOverride({
      width: this.opts.viewport.w,
      height: this.opts.viewport.h,
      deviceScaleFactor: 1,
      mobile: false,
    });
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

  /** Empieza a recibir frames. Todo lo anterior no se graba. */
  async start(): Promise<void> {
    if (!this.client) throw new Error('launch() antes de start()');
    const { Page } = this.client;
    this.expected = this.opts.viewport;

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
      capture: this.frames.length ? this.expected : null,
      quality: this.opts.quality,
      startedAt: this.startedAt,
      durationMs,
      frames: this.frames,
      audio: this.audio,
    };

    await fsp.writeFile(
      path.join(this.opts.outDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
    await fsp.writeFile(
      path.join(this.opts.outDir, 'events.json'),
      JSON.stringify(this.events, null, 2),
    );

    // Una carpeta .vitrina sin project.json no se puede abrir en el editor.
    // Lo escribe el grabador para que cualquier productor genere carpetas
    // completas, no solo el CLI.
    const projectPath = path.join(this.opts.outDir, 'project.json');
    if (!(await exists(projectPath))) {
      await fsp.writeFile(
        projectPath,
        JSON.stringify(defaultProject({ host: hostFromUrl(this.opts.url) }), null, 2),
      );
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
