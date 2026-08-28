/**
 * Spike M9: ¿el tamano de la ventana fisica afecta al input sintetico?
 *
 * Tras cambiar la escalera de presets, el guion de `grabar-demo` dejo de
 * producir eventos durante los primeros ~10 s. Lo que cambio con la escala es
 * la ventana: `--window-size` va en DIP, asi que a escala 1.5 el navegador se
 * abre a 768x432 DIP mientras el guion inyecta clicks en coordenadas del
 * viewport EMULADO, que mide 1152x648.
 *
 * La hipotesis es que `Input.dispatchMouseEvent` fuera del area de la ventana
 * no llega a la pagina. Se mide contando los eventos que registra el DOM.
 *
 *   node spikes/m9-input-ventana.mjs
 */
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import CDP from 'chrome-remote-interface';
import { findBrowser, launchFlags } from '../packages/capture-cdp/src/browser.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9417;
const CSS = { w: 1152, h: 648 };
const DSF = 1.5;

// Ventana fisica pedida, en px reales. La de la izquierda es la que produce la
// escalera nueva; la de la derecha, holgada.
const CASOS = [
  { que: 'ventana justa (lo que hace hoy el grabador)', fisica: { w: 1152, h: 648 } },
  { que: 'ventana holgada', fisica: { w: 1600, h: 950 } },
];

const browser = await findBrowser();
const fixture = new URL('./stress.html', import.meta.url).href;
console.log(`\n  viewport emulado ${CSS.w}x${CSS.h} a escala ${DSF}\n`);

for (const caso of CASOS) {
  const perfil = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-m9-'));
  const child = spawn(browser.path, [
    ...launchFlags({
      port: PORT, profileDir: perfil,
      windowWidth: Math.round(caso.fisica.w / DSF), windowHeight: Math.round(caso.fisica.h / DSF),
      deviceScaleFactor: DSF,
    }),
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
    client = await CDP({ port: PORT, target });
    const { Page, Runtime, Emulation, Input } = client;
    await Promise.all([Page.enable(), Runtime.enable()]);
    await Emulation.setDeviceMetricsOverride({
      width: CSS.w, height: CSS.h, deviceScaleFactor: DSF, mobile: false,
    });
    await Page.navigate({ url: fixture });
    await sleep(2000);

    await Runtime.evaluate({
      expression: `window.__vistos = []; addEventListener('pointermove',
        (e) => window.__vistos.push([Math.round(e.clientX), Math.round(e.clientY)]), true);`,
    });

    // Un barrido por alturas: si la ventana recorta, las de abajo se pierden.
    const alturas = [100, 232, 400, 500, 600];
    for (const y of alturas) {
      for (const x of [70, 400, 900]) {
        await Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
        await sleep(30);
      }
    }

    const { result } = await Runtime.evaluate({
      expression: 'JSON.stringify(window.__vistos)', returnByValue: true,
    });
    const vistos = JSON.parse(result.value);
    const porAltura = alturas.map((y) => `${y}:${vistos.filter((v) => Math.abs(v[1] - y) < 3).length}/3`);

    console.log(`  ${caso.que}`);
    console.log(`     ventana ${caso.fisica.w}x${caso.fisica.h} px`
      + `   recibidos ${vistos.length}/15   por altura ${porAltura.join(' ')}`);
  } catch (e) {
    console.log(`  ${caso.que}  FALLO: ${e.message}`);
  } finally {
    await client?.close().catch(() => {});
    child.kill();
    await sleep(1500);
    await fsp.rm(perfil, { recursive: true, force: true }).catch(() => {});
  }
}
console.log('');
