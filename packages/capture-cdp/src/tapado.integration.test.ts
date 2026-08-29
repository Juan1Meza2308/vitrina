/**
 * Test de integracion del tapado: graba de verdad una pagina con un dato
 * sensible y comprueba EL FRAME QUE QUEDA EN DISCO.
 *
 * Se mide por pixeles y no por `getComputedStyle` a proposito. Los dos fallos
 * que motivan este fichero pasan las comprobaciones baratas —el script se
 * genera, se ejecuta, y el estilo esta puesto— y aun asi el dato sale entero:
 * el parser reemplaza el documento y se lleva la hoja, y la CSP de la pagina
 * anula un `<style>` inyectado sin decir nada. Lo unico que delata las dos
 * cosas es el pixel.
 *
 * Por eso se graba dos veces, con CSP y sin ella: la variante con
 * `style-src 'self'` es la que de verdad importa, porque una app con datos
 * sensibles suele traer CSP estricta.
 *
 * El umbral no se inventa: el fixture trae dos filas identicas, una tapada y
 * otra no, y se comparan entre si. Un umbral absoluto mediria la fuente del
 * sistema y el antialiasing de la maquina.
 */
import { describe, it, expect, afterAll } from 'vitest';
import CDP from 'chrome-remote-interface';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { Recorder, type RecordingResult } from './recorder.ts';

const fixture = (nombre: string) => pathToFileURL(
  path.resolve(import.meta.dirname, '../../../spikes', nombre),
).href;

/** Las cajas del fixture, en px CSS. Van fijas porque su maqueta lo es. */
const FILA = { x: 52, ancho: 496, alto: 20 };
const SECRETO_Y = 132;
const CONTROL_Y = 232;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface InputClient {
  Input: {
    dispatchMouseEvent(p: {
      type: string; x: number; y: number; button?: string; clickCount?: number;
    }): Promise<void>;
  };
  close(): Promise<void>;
}

/**
 * Contraste horizontal medio del rectangulo.
 *
 * Un texto nitido lo tiene alto —cada letra es un salto de luminancia— y
 * difuminado lo tiene bajo. Es la medida mas simple que distingue las dos
 * cosas sin depender de que diga la fuente.
 */
async function contraste(
  file: string, x: number, y: number, w: number, h: number,
): Promise<number> {
  const img = await loadImage(await fsp.readFile(file));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(x, y, w, h).data;
  const luma = (i: number) => 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  let suma = 0;
  let n = 0;
  for (let fila = 0; fila < h; fila++) {
    for (let col = 1; col < w; col++) {
      const i = (fila * w + col) * 4;
      suma += Math.abs(luma(i) - luma(i - 4));
      n++;
    }
  }
  return n === 0 ? 0 : suma / n;
}

const sucias: string[] = [];

afterAll(async () => {
  for (const d of sucias) await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
});

// La variante con CSP no es un extra: es el caso que de verdad importa. Se
// comprueba entera, no solo los pixeles, porque el log tambien tiene que callar.
describe.each([
  ['sin CSP', 'sensible.html', 9412],
  ['con CSP estricta', 'sensible-csp.html', 9413],
])('tapado %s', (_nombre, fichero, PORT) => {
  let result: RecordingResult;
  let outDir = '';

  it(
    'graba la pagina con el dato ya difuminado',
    async () => {
      outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-tapado-'));
      sucias.push(outDir);
      const rec = new Recorder({
        url: fixture(fichero),
        viewport: { w: 1200, h: 700 },
        quality: 92,
        outDir,
        port: PORT,
        tapado: { selectores: ['#secreto'], desenfoque: 12 },
      });

      await rec.launch();
      await rec.start();

      // Un click en cada fila: la tapada y la de control. Sirve para la
      // comprobacion del log, mas abajo.
      const objetivos = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as
        { type: string; id: string; url: string }[];
      const pagina = objetivos.find((t) => t.type === 'page' && t.url.includes(fichero))
        ?? objetivos.find((t) => t.type === 'page');
      const input = (await CDP({
        port: PORT, target: pagina?.id, local: true,
      })) as unknown as InputClient;
      for (const y of [142, 242]) {
        await input.Input.dispatchMouseEvent({ type: 'mouseMoved', x: 300, y });
        await sleep(60);
        await input.Input.dispatchMouseEvent({ type: 'mousePressed', x: 300, y, button: 'left', clickCount: 1 });
        await sleep(40);
        await input.Input.dispatchMouseEvent({ type: 'mouseReleased', x: 300, y, button: 'left', clickCount: 1 });
        await sleep(400);
      }
      await input.close();
      await sleep(600);

      result = await rec.stop();
      await rec.close();

      expect(result.manifest.frames.length).toBeGreaterThan(5);
    },
    60_000,
  );

  it('el frame en disco no tiene el dato', async () => {
    // La prueba de que se tapa AL GRABAR: lo que hay en la carpeta ya va
    // difuminado, sin pasar por el editor ni por el exportador.
    const ultimo = result.manifest.frames.at(-1)!;
    const file = path.join(outDir, 'frames', ultimo.file);
    const tapado = await contraste(file, FILA.x, SECRETO_Y, FILA.ancho, FILA.alto);
    const control = await contraste(file, FILA.x, CONTROL_Y, FILA.ancho, FILA.alto);

    // El control asegura que se esta midiendo texto y no una region vacia: sin
    // esto, un fixture que no cargara daria "tapado" con las dos filas a cero.
    expect(control).toBeGreaterThan(5);
    expect(tapado).toBeLessThan(control * 0.25);
  });

  it('el manifest dice que se tapo', () => {
    expect(result.manifest.tapado).toEqual({ selectores: ['#secreto'], desenfoque: 12 });
  });

  it('el log no guarda la etiqueta del elemento tapado', () => {
    // Tapar el pixel y dejar el texto en events.json seria tapar solo lo que se
    // ve: la carpeta de la grabacion lo llevaria en claro.
    const clicks = result.events.filter((e) => e.type === 'down');
    expect(clicks.length).toBeGreaterThanOrEqual(2);
    const textos = clicks.map((c) => c.label ?? '');
    expect(textos.some((t) => t.includes('cliente@ejemplo.com'))).toBe(true); // el control
    expect(clicks.filter((c) => c.label === null).length).toBeGreaterThanOrEqual(1);
  });

  it('el elemento tapado sigue trayendo su caja', () => {
    // La camara tiene que poder encuadrarlo: se tapa el contenido, no la
    // geometria. Sin la caja, un click sobre un dato tapado dejaria de generar
    // zoom y la demo cambiaria de ritmo por tapar algo.
    const clicks = result.events.filter((e) => e.type === 'down');
    for (const c of clicks) expect(c.rect?.w).toBeGreaterThan(0);
  });
});
