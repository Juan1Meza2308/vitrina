/**
 * Spike M7c: que escalas sirven para la vista de movil.
 *
 * Con dsf entero solo hay dos niveles utiles (2 y 3), y la app tiene cuatro
 * presets. Si las escalas fraccionarias entregan exactamente cssW x dsf, la
 * escalera sale completa sin tocar el ancho CSS, que es el que decide que la
 * web muestre su diseno movil y por tanto no se puede mover.
 *
 * Se conecta al target de la PAGINA explicitamente: en M7b conectar al primero
 * que hubiera hizo que dos casos midieran un navegador anterior a medio cerrar
 * y devolvieran el tamano de la ventana en vez del emulado.
 *
 *   node spikes/m7c-escalas.mjs
 */
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import CDP from 'chrome-remote-interface';
import { findBrowser, launchFlags } from '../packages/capture-cdp/src/browser.ts';
import { jpegSize } from '../packages/capture-cdp/src/jpeg.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9415;
const CSS = { w: 430, h: 932 };
const ESCALAS = [1.5, 2, 2.5, 3];

const browser = await findBrowser();
const fixture = new URL('./vertical.html', import.meta.url).href;
console.log(`\n  viewport CSS fijo en ${CSS.w}x${CSS.h}; solo cambia la escala\n`);

for (const dsf of ESCALAS) {
  const perfil = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-m7c-'));
  const child = spawn(browser.path, [
    ...launchFlags({
      port: PORT, profileDir: perfil,
      windowWidth: Math.round(520 / dsf), windowHeight: Math.round(1000 / dsf),
    }),
    `--force-device-scale-factor=${dsf}`,
  ], { stdio: 'ignore' });

  let client = null;
  try {
    let target = '';
    const limite = Date.now() + 20000;
    while (!target && Date.now() < limite) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        if (r.ok) target = (await r.json()).find((t) => t.type === 'page')?.id ?? '';
      } catch { /* arrancando */ }
      if (!target) await sleep(150);
    }
    if (!target) throw new Error('sin target de pagina');

    client = await CDP({ port: PORT, target });
    const { Page, Runtime, Emulation } = client;
    await Promise.all([Page.enable(), Runtime.enable()]);
    await Emulation.setDeviceMetricsOverride({
      width: CSS.w, height: CSS.h, deviceScaleFactor: dsf, mobile: false,
    });
    await Page.navigate({ url: fixture });
    await sleep(2200);

    const { result } = await Runtime.evaluate({
      expression: 'JSON.stringify({ w: innerWidth, dpr: devicePixelRatio })',
      returnByValue: true,
    });
    const vista = JSON.parse(result.value);

    const frame = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sin frames')), 8000);
      client.on('Page.screencastFrame', async (p) => {
        clearTimeout(t);
        await Page.screencastFrameAck({ sessionId: p.sessionId }).catch(() => {});
        resolve(Buffer.from(p.data, 'base64'));
      });
      Page.startScreencast({ format: 'jpeg', quality: 92, maxWidth: 4096, maxHeight: 4096, everyNthFrame: 1 });
    });
    const tam = jpegSize(frame);
    const esperado = { w: Math.round(CSS.w * dsf), h: Math.round(CSS.h * dsf) };
    const exacto = tam.w === esperado.w && tam.h === esperado.h;

    console.log(`  dsf ${String(dsf).padEnd(4)} pagina ve ${vista.w} css, dpr ${vista.dpr}`
      + `   frame ${tam.w}x${tam.h} (${((tam.w * tam.h) / 1e6).toFixed(2)} MP)`
      + `   ${exacto ? 'exacto' : 'ESPERABA ' + esperado.w + 'x' + esperado.h}`);
  } catch (e) {
    console.log(`  dsf ${dsf}  FALLO: ${e.message}`);
  } finally {
    await client?.close().catch(() => {});
    child.kill();
    await sleep(1800);
    await fsp.rm(perfil, { recursive: true, force: true }).catch(() => {});
  }
}
console.log('');
