/**
 * Sonda: abre la app sobre una grabacion y evalua una expresion en el editor.
 *
 * Para diagnosticar sin montar una verificacion entera. Lo que se pasa por
 * `--eval` se ejecuta en el renderer y se imprime.
 *
 *   node tools/sonda.ts grabaciones/demo.vitrina --eval="document.title"
 */
import CDP from 'chrome-remote-interface';
import { spawn } from 'node:child_process';
import path from 'node:path';

const PORT = 9504;
const APP = path.resolve('apps/desktop');
const grabacion = path.resolve(
  process.argv[2]?.startsWith('--') ? 'grabaciones/demo.vitrina' : process.argv[2] ?? 'grabaciones/demo.vitrina');
const expr = process.argv.find((a) => a.startsWith('--eval='))?.slice(7) ?? '1';
const ELECTRON = path.resolve(process.platform === 'darwin'
  ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
  : 'node_modules/electron/dist/electron.exe');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Cliente {
  Page: { enable(): Promise<void> };
  Runtime: {
    enable(): Promise<void>;
    evaluate(p: { expression: string; returnByValue?: boolean }): Promise<{ result: { value?: unknown } }>;
  };
  close(): Promise<void>;
}

const child = spawn(ELECTRON, [APP, grabacion, `--remote-debugging-port=${PORT}`],
  { stdio: ['ignore', 'ignore', 'inherit'] });

let target = '';
const limite = Date.now() + 30_000;
while (Date.now() < limite && !target) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    if (r.ok) target = ((await r.json()) as { type: string; id: string }[])
      .find((t) => t.type === 'page')?.id ?? '';
  } catch { /* arrancando */ }
  if (!target) await sleep(300);
}

const client = (await CDP({ port: PORT, target })) as unknown as Cliente;
await Promise.all([client.Page.enable(), client.Runtime.enable()]);
await sleep(4500);

if (process.argv.includes('--captura')) {
  const tiro = await (client as unknown as {
    Page: { captureScreenshot(p: { format?: string }): Promise<{ data: string }> };
  }).Page.captureScreenshot({ format: 'png' });
  const fsp = await import('node:fs/promises');
  await fsp.writeFile('apps/desktop/captura-ui.png', Buffer.from(tiro.data, 'base64'));
  console.log('captura: apps/desktop/captura-ui.png');
}

const { result } = await client.Runtime.evaluate({ expression: expr, returnByValue: true });
console.log(typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 1));

await client.close();
child.kill();
