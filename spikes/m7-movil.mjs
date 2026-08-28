/**
 * Spike M7: vista de movil de verdad SIN perder resolucion.
 *
 * Para que una web muestre su diseno movil el viewport tiene que medir ~430 px
 * CSS. A esa anchura el screencast entrega 430 px de ancho y el video sale
 * inservible. M0 ya midio que `Page.startScreencast` ignora el
 * `deviceScaleFactor` puesto por `Emulation.setDeviceMetricsOverride`.
 *
 * Pero M0 probo el DSF por EMULACION. Falta el otro mecanismo: forzarlo al
 * lanzar el navegador con `--force-device-scale-factor`, donde el surface del
 * compositor nace ya a 3x. Es otra ruta distinta y puede comportarse distinto.
 *
 * Mide el tamano REAL del JPEG que llega, leido de su cabecera.
 *
 *   node spikes/m7-movil.mjs
 */
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import CDP from 'chrome-remote-interface';
import { findBrowser, launchFlags } from '../packages/capture-cdp/src/browser.ts';
import { jpegSize } from '../packages/capture-cdp/src/jpeg.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9413;
const CSS = { w: 430, h: 932 };          // iPhone Pro Max en px CSS

const CASOS = [
  { id: 'A', que: 'emulado 430, dsf 1 (base)', flags: [], dsf: 1 },
  { id: 'B', que: 'emulado 430, dsf 3 (lo que midio M0)', flags: [], dsf: 3 },
  { id: 'C', que: 'navegador --force-device-scale-factor=3 + emulado 430 dsf 1',
    flags: ['--force-device-scale-factor=3'], dsf: 1 },
  { id: 'D', que: 'navegador --force-dsf=3 + emulado 430 dsf 3',
    flags: ['--force-device-scale-factor=3'], dsf: 3 },
  { id: 'E', que: 'navegador --force-dsf=3, SIN override de metricas',
    flags: ['--force-device-scale-factor=3'], dsf: null },
];

const browser = await findBrowser();
const fixture = new URL('./vertical.html', import.meta.url).href;
console.log(`\n  ${browser.path}\n  objetivo: layout de ${CSS.w} px CSS con frames de ~${CSS.w * 3} px\n`);

for (const caso of CASOS) {
  const perfil = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-m7-'));
  const child = spawn(browser.path, [
    ...launchFlags({ port: PORT, profileDir: perfil, windowWidth: CSS.w, windowHeight: CSS.h }),
    ...caso.flags,
  ], { stdio: 'ignore' });

  let client = null;
  try {
    const limite = Date.now() + 20000;
    for (;;) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; }
      catch { /* arrancando */ }
      if (Date.now() > limite) throw new Error('sin CDP');
      await sleep(150);
    }
    client = await CDP({ port: PORT });
    const { Page, Runtime, Emulation } = client;
    await Promise.all([Page.enable(), Runtime.enable()]);

    if (caso.dsf !== null) {
      await Emulation.setDeviceMetricsOverride({
        width: CSS.w, height: CSS.h, deviceScaleFactor: caso.dsf, mobile: false,
      });
    }
    await Page.navigate({ url: fixture });
    await sleep(1800);

    // Lo que la PAGINA cree medir: decide si saltan las media queries.
    const { result } = await Runtime.evaluate({
      expression: 'JSON.stringify({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })',
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
      Page.startScreencast({ format: 'jpeg', quality: 90, maxWidth: 4096, maxHeight: 4096, everyNthFrame: 1 });
    });
    const tam = jpegSize(frame);

    console.log(`  ${caso.id}  ${caso.que}`);
    console.log(`     la pagina ve ${vista.w}x${vista.h} css, dpr ${vista.dpr}`
      + `   frame real ${tam.w}x${tam.h}`
      + `   ${tam.w >= CSS.w * 2 ? '<<< RESOLUCION EXTRA' : ''}`);
  } catch (e) {
    console.log(`  ${caso.id}  ${caso.que}\n     FALLO: ${e.message}`);
  } finally {
    await client?.close().catch(() => {});
    child.kill();
    await sleep(1200);
    await fsp.rm(perfil, { recursive: true, force: true }).catch(() => {});
  }
}
console.log('');
