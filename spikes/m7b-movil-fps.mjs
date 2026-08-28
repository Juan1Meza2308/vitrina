/**
 * Spike M7b: coste y usabilidad de la vista de movil a DSF forzado.
 *
 * M7 demostro que `--force-device-scale-factor` + emulacion a la misma escala
 * da frames de cssW x dsf. Faltan las dos cosas que deciden si es usable:
 *
 *  1. fps: 430x932 a dsf 3 son 3.6 MP por frame, mas que el preset `maximo`.
 *  2. La ventana en pantalla. `--window-size` va en DIP, asi que con dsf 3 una
 *     ventana de 430 DIP mide 1290 px fisicos y no cabe en un monitor 1080p.
 *     Si el navegador la recorta, quien graba hace la demo a ciegas.
 *
 *   node spikes/m7b-movil-fps.mjs
 */
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import CDP from 'chrome-remote-interface';
import { findBrowser, launchFlags } from '../packages/capture-cdp/src/browser.ts';
import { jpegSize } from '../packages/capture-cdp/src/jpeg.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9414;
const SECS = 6;

const CASOS = [
  { css: { w: 390, h: 844 }, dsf: 2 },
  { css: { w: 430, h: 932 }, dsf: 2 },
  { css: { w: 390, h: 844 }, dsf: 3 },
  { css: { w: 430, h: 932 }, dsf: 3 },
];

const browser = await findBrowser();
const fixture = new URL('./vertical.html', import.meta.url).href;
console.log(`\n  ${SECS}s por caso sobre el fixture vertical\n`);

for (const caso of CASOS) {
  const perfil = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-m7b-'));
  // La ventana se pide en DIP para que salga de un tamano fisico manejable:
  // 560 px de ancho reales, quepa el monitor que quepa.
  const dipW = Math.round(560 / caso.dsf);
  const dipH = Math.round(1150 / caso.dsf);
  const child = spawn(browser.path, [
    ...launchFlags({ port: PORT, profileDir: perfil, windowWidth: dipW, windowHeight: dipH }),
    `--force-device-scale-factor=${caso.dsf}`,
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
    const { Page, Runtime, Emulation, Browser } = client;
    await Promise.all([Page.enable(), Runtime.enable()]);
    await Emulation.setDeviceMetricsOverride({
      width: caso.css.w, height: caso.css.h, deviceScaleFactor: caso.dsf, mobile: false,
    });
    await Page.navigate({ url: fixture });
    // Margen amplio: con 1.5s el primer caso capturo antes de que la emulacion
    // asentara y entrego el tamano de la ventana en vez del emulado.
    await sleep(2500);

    const { windowId } = await Browser.getWindowForTarget();
    const { bounds } = await Browser.getWindowBounds({ windowId });

    const tiempos = [];
    let tam = null;
    client.on('Page.screencastFrame', async (p) => {
      await Page.screencastFrameAck({ sessionId: p.sessionId }).catch(() => {});
      tiempos.push(p.metadata.timestamp * 1000);
      if (!tam) tam = jpegSize(Buffer.from(p.data, 'base64'));
    });
    // Repintado continuo con requestAnimationFrame, NO con setInterval: un
    // intervalo de 33ms limita la pagina a 30 fps y entonces se mide el driver
    // en vez del pipeline. Paso exactamente eso en la primera pasada: los
    // cuatro casos daban 30 fps clavados, 3.6 MP incluidos.
    await Runtime.evaluate({
      expression: `(() => {
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;inset:0;pointer-events:none';
        document.body.appendChild(d);
        let i = 0;
        const paso = () => {
          i++;
          d.style.background = 'rgba(' + (i % 255) + ',80,200,.35)';
          scrollTo(0, (i * 9) % 900);
          requestAnimationFrame(paso);
        };
        requestAnimationFrame(paso);
      })()`,
    });
    await Page.startScreencast({ format: 'jpeg', quality: 92, maxWidth: 4096, maxHeight: 4096, everyNthFrame: 1 });
    await sleep(SECS * 1000);
    await Page.stopScreencast().catch(() => {});

    const d = [];
    for (let i = 1; i < tiempos.length; i++) d.push(tiempos[i] - tiempos[i - 1]);
    d.sort((a, b) => a - b);
    const p50 = d[Math.floor(d.length * 0.5)] ?? 0;
    const p95 = d[Math.floor(d.length * 0.95)] ?? 0;
    const mp = tam ? (tam.w * tam.h) / 1e6 : 0;

    console.log(`  css ${caso.css.w}x${caso.css.h} dsf ${caso.dsf}`
      + `  ->  frame ${tam ? tam.w + 'x' + tam.h : '?'} (${mp.toFixed(2)} MP)`
      + `   ${p50 > 0 ? Math.round(1000 / p50) : 0} fps   p95 ${p95.toFixed(0)}ms`);
    console.log(`     ventana en pantalla ${bounds.width}x${bounds.height} px`);
  } catch (e) {
    console.log(`  css ${caso.css.w} dsf ${caso.dsf}  FALLO: ${e.message}`);
  } finally {
    await client?.close().catch(() => {});
    child.kill();
    await sleep(1500);
    await fsp.rm(perfil, { recursive: true, force: true }).catch(() => {});
  }
}
console.log('');
