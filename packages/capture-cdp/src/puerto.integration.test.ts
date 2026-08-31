/**
 * Test de integracion del puerto: que Vitrina no se enganche al navegador de
 * otro.
 *
 * El grabador lanzaba su navegador con `--remote-debugging-port=9222` y se
 * conectaba ahi. 9222 es EL puerto: el de los tutoriales, el de Puppeteer, el
 * que deja abierto medio mundo del desarrollo web. Con un Chrome ya escuchando
 * en el, Vitrina se conectaba a ESE —pestanas reales, sesiones iniciadas— y
 * grababa el navegador de quien la abriera, sin decir nada, porque desde fuera
 * responde igual.
 *
 * Aqui se monta justo esa situacion: un navegador senuelo en 9222 con una
 * pagina reconocible, y una grabacion normal al lado. Lo que se comprueba no es
 * que el grabador diga que uso otro puerto —eso ya lo sabe—, sino que el
 * senuelo SIGUE en su pagina. Con el puerto fijo termina en la del fixture: es
 * el propio grabador quien lo navego.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { Recorder } from './recorder.ts';
import { findBrowser } from './browser.ts';

const FIXTURE = pathToFileURL(
  path.resolve(import.meta.dirname, '../../../spikes/tapado.html'),
).href;
const TITULO = 'EL NAVEGADOR DE OTRO';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sobras: string[] = [];
let senuelo: ChildProcess | null = null;
afterAll(async () => {
  senuelo?.kill();
  await sleep(300);
  for (const d of sobras) await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
});

/** Titulos de las pestanas del senuelo, preguntandoselo a el por HTTP. */
async function pestanas(): Promise<string[]> {
  const r = await fetch('http://127.0.0.1:9222/json/list');
  return ((await r.json()) as { type: string; title: string }[])
    .filter((t) => t.type === 'page').map((t) => t.title);
}

describe('el puerto de depuracion', () => {
  it('no toca el navegador que ya estaba en el 9222', async () => {
    const navegador = findBrowser();
    if (!navegador) return;                     // sin navegador no hay nada que probar

    const perfil = await fsp.mkdtemp(path.join(os.tmpdir(), 'senuelo-'));
    sobras.push(perfil);
    senuelo = spawn(navegador.path, [
      '--remote-debugging-port=9222',
      `--user-data-dir=${perfil}`,
      '--no-first-run', '--no-default-browser-check',
      `data:text/html,<title>${TITULO}</title>`,
    ], { stdio: 'ignore' });

    let arrancado = false;
    for (let i = 0; i < 60 && !arrancado; i++) {
      arrancado = await pestanas().then((p) => p.includes(TITULO)).catch(() => false);
      if (!arrancado) await sleep(250);
    }
    expect(arrancado, 'el senuelo no llego a escuchar en 9222').toBe(true);

    // Una grabacion normal: sin `port`, que es como la lanza la aplicacion.
    const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-puerto-'));
    sobras.push(outDir);
    const rec = new Recorder({ url: FIXTURE, viewport: { w: 800, h: 600 }, outDir });
    await rec.launch();
    await sleep(1000);

    const usado = rec.puerto;
    const despues = await pestanas();
    await rec.close();

    expect(usado).toBeGreaterThan(0);
    expect(usado).not.toBe(9222);
    // Lo que de verdad importa: el navegador de al lado sigue donde estaba.
    expect(despues).toEqual([TITULO]);
  }, 90_000);
});
