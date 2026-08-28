/**
 * Graba una demo vertical corta para trabajar sobre el marco de movil.
 *
 * El editor solo se puede ajustar a ojo con material de la forma correcta, y
 * volver a grabar a mano cada vez que se toca el marco es lento. Deja la
 * grabacion en `grabaciones/vertical.vitrina`, que esta fuera de git.
 *
 *   node tools/grabar-vertical.ts [--secs=5]
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Recorder } from '@vitrina/capture-cdp';
import { paraOrientacion, CAPTURE_PRESETS } from '@vitrina/core';

const flag = (n: string, d: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const SECS = Number(flag('secs', '5'));
const destino = path.resolve('grabaciones/vertical.vitrina');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Entrada {
  Input: {
    dispatchMouseEvent(p: {
      type: string; x: number; y: number; button?: string; clickCount?: number;
    }): Promise<void>;
  };
  Runtime: {
    enable(): Promise<void>;
    evaluate(p: { expression: string; returnByValue?: boolean }):
      Promise<{ result: { value?: unknown } }>;
  };
  close(): Promise<void>;
}

async function pulsar(selectores: string[]): Promise<void> {
  const CDP = (await import('chrome-remote-interface')).default;
  const lista = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as
    { type: string; id: string }[];
  const page = lista.find((t) => t.type === 'page');
  if (!page) return;
  const input = (await CDP({ port: 9222, target: page.id })) as unknown as Entrada;
  await input.Runtime.enable();
  const { result } = await input.Runtime.evaluate({
    expression: `JSON.stringify(${JSON.stringify(selectores)}.map(s => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }))`,
    returnByValue: true,
  });
  for (const { x, y } of JSON.parse(String(result.value)) as { x: number; y: number }[]) {
    await input.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
    await sleep(150);
    await input.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
    await input.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(600);
  }
  await input.close();
}

const fixture = pathToFileURL(path.resolve('spikes/vertical.html')).href;
await fsp.rm(destino, { recursive: true, force: true });

// El mismo camino que la app: preset por defecto reencuadrado a vertical.
const preset = paraOrientacion(
  CAPTURE_PRESETS.find((p) => p.name === 'equilibrado') ?? CAPTURE_PRESETS[1]!, 'vertical');
const rec = new Recorder({
  url: fixture,
  viewport: preset.css ?? preset.capture,
  deviceScaleFactor: preset.dsf ?? 1,
  outDir: destino,
});
await rec.launch();
await rec.start();
await pulsar(['#b2', '#b3']);
await sleep(SECS * 1000);
await rec.stop();
await rec.close();

console.log(`\n  grabado en ${path.relative(process.cwd(), destino)}\n`);
