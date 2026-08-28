/**
 * Test de integracion del grabador: arranca un navegador de verdad, graba la
 * pagina de prueba y comprueba las tres cosas de las que depende todo lo demas.
 *
 * No es un test unitario y no pretende serlo. Es la red de seguridad de la
 * unica parte del sistema que no se puede simular: si Edge cambia el
 * comportamiento del screencast, esto se entera antes que el usuario.
 */
import { describe, it, expect, afterAll } from 'vitest';
import CDP from 'chrome-remote-interface';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { Recorder } from './recorder.ts';
import type { RecordingResult } from './recorder.ts';

const PORT = 9411;
const FIXTURE = pathToFileURL(
  path.resolve(import.meta.dirname, '../../../spikes/stress.html'),
).href;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cliente aparte para inyectar entrada sintetica sin ensuciar la API publica. */
interface InputClient {
  Input: {
    dispatchMouseEvent(p: {
      type: string;
      x: number;
      y: number;
      button?: string;
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
    }): Promise<void>;
  };
  close(): Promise<void>;
}

let outDir = '';

afterAll(async () => {
  if (outDir) await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {});
});

describe('Recorder', () => {
  let result: RecordingResult;

  it(
    'graba frames y eventos de una pagina real',
    async () => {
      outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-test-'));
      const rec = new Recorder({
        url: FIXTURE,
        viewport: { w: 1600, h: 900 },
        quality: 80,
        outDir,
        port: PORT,
      });

      await rec.launch();
      await rec.start();

      // Entrada sintetica sobre los botones reales del fixture.
      const input = (await CDP({ port: PORT })) as unknown as InputClient;
      for (const x of [70, 190, 320]) {
        await input.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y: 232 });
        await sleep(50);
        await input.Input.dispatchMouseEvent({ type: 'mousePressed', x, y: 232, button: 'left', clickCount: 1 });
        await sleep(40);
        await input.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y: 232, button: 'left', clickCount: 1 });
        await sleep(350);
      }
      await input.close();

      result = await rec.stop();
      await rec.close();

      expect(result.manifest.frames.length).toBeGreaterThan(20);
      expect(result.events.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it('entrega frames exactamente al viewport pedido', () => {
    // Si esto falla, el margen de zoom calculado por @vitrina/core es ficticio.
    expect(result.manifest.capture).toEqual({ w: 1600, h: 900 });
    expect(result.sizeMismatches).toBe(0);
  });

  it('cada click trae la caja del elemento pulsado', () => {
    const clicks = result.events.filter((e) => e.type === 'down');
    expect(clicks.length).toBeGreaterThanOrEqual(3);
    for (const c of clicks) {
      expect(c.rect).toBeTruthy();
      expect(c.rect!.w).toBeGreaterThan(0);
      expect(c.rect!.h).toBeGreaterThan(0);
    }
  });

  it('identifica el control pulsado, no el nodo de texto interno', () => {
    const clicks = result.events.filter((e) => e.type === 'down');
    expect(clicks.some((c) => c.tag === 'BUTTON')).toBe(true);
    expect(clicks.some((c) => (c.label ?? '').length > 0)).toBe(true);
  });

  it('nunca registra la tecla pulsada si es imprimible', () => {
    // Garantia de privacidad: una demo con login no puede filtrar credenciales.
    const keys = result.events.filter((e) => e.type === 'key');
    for (const k of keys) expect(k.key === 'char' || (k.key ?? '').length > 1).toBe(true);
  });

  it('eventos y frames comparten reloj', () => {
    // El evento va en ms epoch y el frame en segundos epoch. Lo que se comprueba
    // es que NO hay desfase sistematico entre ambos relojes.
    //
    // No se exige que todos los clicks esten cerca de un frame: el screencast
    // solo emite cuando la pagina cambia, y con la maquina cargada un hueco de
    // 150ms es normal. Un umbral duro por click mediria la carga de la CPU, no
    // la sincronizacion. La mediana si delata un desfase, y el maximo delata un
    // desajuste de reloj de verdad, que se manifestaria en segundos.
    const clicks = result.events.filter((e) => e.type === 'down');
    const frameTimesMs = result.manifest.frames.map((f) => f.t * 1000);

    // Se mide el desfase CON SIGNO al frame mas cercano, no la distancia. La
    // distancia mezcla dos cosas: el desfase de reloj, que es lo que se quiere
    // comprobar, y lo dispersos que vengan los frames, que depende de la carga
    // de la maquina. Con la distancia el test flaqueaba en verde y en rojo sin
    // que nada cambiara: 177 ms de mediana no delatan un reloj mal, delatan que
    // el screencast emitio poco durante esos clicks.
    const desfases = clicks.map((c) => {
      let mejor = Infinity;
      for (const t of frameTimesMs) if (Math.abs(t - c.t) < Math.abs(mejor)) mejor = t - c.t;
      return mejor;
    }).sort((a, b) => a - b);

    // El margen sale del propio material: un hueco entre frames es el error
    // maximo que puede tener "el frame mas cercano" sin que nada este roto.
    const huecos: number[] = [];
    for (let i = 1; i < frameTimesMs.length; i++) huecos.push(frameTimesMs[i]! - frameTimesMs[i - 1]!);
    huecos.sort((a, b) => a - b);
    const hueco = huecos[Math.floor(huecos.length * 0.9)] ?? 100;

    const mediana = desfases[Math.floor(desfases.length / 2)]!;
    expect(Math.abs(mediana)).toBeLessThan(Math.max(150, hueco * 1.5));
    // Un desajuste de reloj de verdad se manifiesta en segundos, no en frames.
    expect(Math.abs(desfases.at(-1)!)).toBeLessThan(2000);
  });

  it('el log empieza en el arranque de la captura, no antes', () => {
    // Los eventos de preparacion (mover el raton hasta la ventana) no deben
    // acabar en la grabacion ni generar zooms fantasma.
    for (const e of result.events) {
      expect(e.t).toBeGreaterThanOrEqual(result.manifest.startedAt - 50);
    }
  });
});
