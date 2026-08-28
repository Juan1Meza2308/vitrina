/**
 * Spike M8: que escalas sirven en apaisado.
 *
 * M7c midio que la escala 1.5 no entrega el tamano pedido, pero ese mismo
 * spike tuvo casos que fallaron por conectarse a un target viejo. La escala 1.5
 * decide la escalera de presets apaisados entera: con ella, css 1280 x1.5 da
 * 1920x1080 (2.07 MP) manteniendo la maquetacion a 1280; sin ella, el escalon
 * mas barato con maquetacion normal cuesta 3.69 MP.
 *
 * Prueba las mismas escalas con dos anchos CSS para separar "la escala no
 * sirve" de "ese ancho concreto no sirve".
 *
 *   node spikes/m8-escalas-apaisado.mjs
 */
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import CDP from 'chrome-remote-interface';
import { findBrowser, launchFlags } from '../packages/capture-cdp/src/browser.ts';
import { jpegSize } from '../packages/capture-cdp/src/jpeg.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9416;

const CASOS = [];
for (const css of [{ w: 1280, h: 720 }, { w: 960, h: 540 }]) {
  for (const dsf of [1.25, 1.5, 1.75, 2]) CASOS.push({ css, dsf });
}

const browser = await findBrowser();
const fixture = new URL('./stress.html', import.meta.url).href;
console.log(`\n  ${browser.path}\n`);

for (const { css, dsf } of CASOS) {
  const perfil = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-m8-'));
  const child = spawn(browser.path, [
    ...launchFlags({
      port: PORT, profileDir: perfil,
      // En DIP: la ventana fisica sale de ~1100 px de ancho sea cual sea la escala.
      windowWidth: Math.round(1100 / dsf), windowHeight: Math.round(700 / dsf),
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
      width: css.w, height: css.h, deviceScaleFactor: dsf, mobile: false,
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
    const esperado = { w: Math.round(css.w * dsf), h: Math.round(css.h * dsf) };
    const exacto = tam.w === esperado.w && tam.h === esperado.h;

    console.log(`  css ${String(css.w).padStart(4)} x${String(dsf).padEnd(4)}`
      + `  pagina ve ${vista.w} css dpr ${vista.dpr}`
      + `   frame ${tam.w}x${tam.h}`
      + `   ${exacto ? 'exacto' : 'NO — esperaba ' + esperado.w + 'x' + esperado.h}`);
  } catch (e) {
    console.log(`  css ${css.w} x${dsf}  FALLO: ${e.message}`);
  } finally {
    await client?.close().catch(() => {});
    child.kill();
    await sleep(1600);
    await fsp.rm(perfil, { recursive: true, force: true }).catch(() => {});
  }
}
console.log('');
