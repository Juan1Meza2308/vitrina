/**
 * Herramienta de desarrollo: graba una demo con interaccion sintetica.
 *
 * Existe porque el motor de camara hay que probarlo contra logs de entrada
 * REALES, no fabricados en un test. Los tests fijan el comportamiento; esto
 * comprueba que la realidad se parece a lo que los tests asumen.
 *
 *   node tools/grabar-demo.ts [--secs=12] [--out=...]
 */
import CDP from 'chrome-remote-interface';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Recorder } from '@vitrina/capture-cdp';
import { CAPTURE_PRESETS } from '@vitrina/core';

const PORT = 9333;
const flag = (n: string, d = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const secs = Number(flag('secs', '12'));
const outDir = path.resolve(flag('out', 'grabaciones/demo.vitrina'));
const fixture = pathToFileURL(path.resolve('spikes/stress.html')).href;

interface InputClient {
  Input: {
    dispatchMouseEvent(p: {
      type: string; x: number; y: number;
      button?: string; clickCount?: number; deltaX?: number; deltaY?: number;
    }): Promise<void>;
  };
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Guion de una demo plausible: mirar, elegir opciones, rellenar un campo,
 * bajar a leer y volver. Es la forma que tiene el material real y la que el
 * motor de camara tiene que manejar bien.
 */
async function guion(input: InputClient, endAt: number): Promise<void> {
  const botones = [
    { x: 70, y: 232 }, { x: 190, y: 232 }, { x: 320, y: 232 }, { x: 450, y: 232 },
  ];
  const campos = [{ x: 100, y: 290 }, { x: 330, y: 290 }];
  let cur = { x: 700, y: 500 };

  const moverA = async (to: { x: number; y: number }, pasos = 12) => {
    for (let s = 1; s <= pasos && Date.now() < endAt; s++) {
      await input.Input.dispatchMouseEvent({
        type: 'mouseMoved',
        x: cur.x + (to.x - cur.x) * (s / pasos),
        y: cur.y + (to.y - cur.y) * (s / pasos),
      });
      await sleep(16);
    }
    cur = to;
  };
  const clicar = async () => {
    await input.Input.dispatchMouseEvent({ type: 'mousePressed', x: cur.x, y: cur.y, button: 'left', clickCount: 1 });
    await sleep(50);
    await input.Input.dispatchMouseEvent({ type: 'mouseReleased', x: cur.x, y: cur.y, button: 'left', clickCount: 1 });
  };

  // 1. Elegir dos opciones seguidas: deberia salir UN tramo, no dos.
  for (const b of botones.slice(0, 2)) {
    if (Date.now() >= endAt) return;
    await moverA(b);
    await clicar();
    await sleep(500);
  }
  // 2. Irse a los campos y "escribir": el tramo debe mantenerse vivo.
  await sleep(600);
  for (const c of campos) {
    if (Date.now() >= endAt) return;
    await moverA(c);
    await clicar();
    await sleep(700);
  }
  // 3. Scroll rapido: la camara debe alejarse en vez de marear.
  for (let i = 0; i < 14 && Date.now() < endAt; i++) {
    await input.Input.dispatchMouseEvent({ type: 'mouseWheel', x: 700, y: 500, deltaX: 0, deltaY: 240 });
    await sleep(40);
  }
  await sleep(700);
  // 4. Volver arriba y cerrar con un click lejano.
  for (let i = 0; i < 14 && Date.now() < endAt; i++) {
    await input.Input.dispatchMouseEvent({ type: 'mouseWheel', x: 700, y: 500, deltaX: 0, deltaY: -240 });
    await sleep(40);
  }
  if (Date.now() >= endAt) return;
  await moverA(botones[3]!);
  await clicar();
  await sleep(900);
}

async function main(): Promise<void> {
  // `--si-falta` la salta si ya existe. La usa `npm run app:check`, que
  // necesita una grabacion para verificarse pero no puede traerla en el repo:
  // son cientos de MB de frames y estan en .gitignore. Sin esto, el primer
  // comando que ejecuta quien clona el proyecto falla con un ENOENT.
  if (process.argv.includes('--si-falta')) {
    const yaEsta = await fsp.access(path.join(outDir, 'manifest.json'))
      .then(() => true).catch(() => false);
    if (yaEsta) {
      console.log(`grabacion de prueba ya presente en ${outDir}`);
      return;
    }
  }

  const preset = CAPTURE_PRESETS.find((p) => p.name === 'equilibrado')!;
  const rec = new Recorder({
    url: fixture,
    viewport: preset.capture,
    quality: 92,
    outDir,
    port: PORT,
  });

  const browser = await rec.launch();
  console.log(`navegador  ${browser.label}`);
  await rec.start();
  console.log(`grabando   ${secs}s con guion sintetico...`);

  const input = (await CDP({ port: PORT })) as unknown as InputClient;
  const endAt = Date.now() + secs * 1000;
  while (Date.now() < endAt) await guion(input, endAt);
  await input.close();

  const result = await rec.stop();
  await rec.close();

  const clicks = result.events.filter((e) => e.type === 'down');
  console.log(`frames     ${result.manifest.frames.length}`);
  console.log(`eventos    ${result.events.length} (${clicks.length} clicks)`);
  console.log(`guardado   ${outDir}`);
}

main().catch((e: unknown) => {
  console.error('FALLO:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
