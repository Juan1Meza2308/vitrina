/**
 * Spike M10: ¿aplica un estilo inyectado por CDP en una pagina con CSP?
 *
 * El tapado de datos sensibles mete una hoja de estilos en la pagina grabada
 * antes de que se pinte. Funcionaba en el fixture, y la duda era la pagina que
 * de verdad importa: una app con datos sensibles suele traer CSP estricta, y la
 * CSP habla precisamente de estilos.
 *
 * Se miden los dos mecanismos posibles, en una pagina sin CSP y en otra con
 * `style-src 'self'`:
 *
 *   1. `<style>` creado con `document.createElement` y colgado de la cabecera.
 *   2. Hoja construida: `new CSSStyleSheet()` + `document.adoptedStyleSheets`.
 *
 * El script inyectado corre en el main world por CDP, que la CSP no filtra. La
 * pregunta no es si el script CORRE —eso ya se sabe— sino si lo que hace APLICA.
 *
 *   node spikes/m10-csp-estilo.mjs
 */
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import CDP from 'chrome-remote-interface';
import { findBrowser, launchFlags } from '../packages/capture-cdp/src/browser.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9418;

const CASOS = [
  { que: 'sin CSP', csp: '' },
  { que: "con style-src 'self'", csp: "default-src 'self'; style-src 'self'" },
];

const pagina = (csp) => `<!doctype html>
<meta charset="utf-8">
${csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ''}
<title>m10</title>
<div id="por-elemento">dato</div>
<div id="por-hoja">dato</div>
`;

// Las dos vias, cada una sobre su propio elemento, para poder distinguirlas.
const INYECTADO = `
(() => {
  const poner = () => {
    try {
      const raiz = document.head || document.documentElement;
      if (raiz && !document.getElementById('m10')) {
        const e = document.createElement('style');
        e.id = 'm10';
        e.textContent = '#por-elemento { filter: blur(9px) !important; }';
        raiz.appendChild(e);
      }
    } catch (e) { /* se vera en la medida */ }
    try {
      if (!window.__m10) {
        window.__m10 = new CSSStyleSheet();
        window.__m10.replaceSync('#por-hoja { filter: blur(9px) !important; }');
      }
      if (document.adoptedStyleSheets.indexOf(window.__m10) === -1) {
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, window.__m10];
      }
    } catch (e) { /* idem */ }
  };
  new MutationObserver(poner).observe(document, { childList: true });
  document.addEventListener('readystatechange', poner, true);
  poner();
})();`;

const browser = findBrowser();
if (!browser) throw new Error('No se encontro navegador');

const perfil = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-m10-'));
const hijo = spawn(browser.path, launchFlags({
  port: PORT, profileDir: perfil, windowWidth: 900, windowHeight: 600,
}), { stdio: 'ignore' });

for (let i = 0; i < 120; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* arrancando */ }
  await sleep(150);
}

const client = await CDP({ port: PORT });
const { Page, Runtime } = client;
await Promise.all([Page.enable(), Runtime.enable()]);
await Page.addScriptToEvaluateOnNewDocument({ source: INYECTADO });

console.log(`\n  navegador  ${browser.label}\n`);
console.log('  caso                     <style>        hoja construida');
console.log('  ---------------------------------------------------------');

for (const caso of CASOS) {
  const fichero = path.join(perfil, `m10-${caso.csp ? 'csp' : 'libre'}.html`);
  await fsp.writeFile(fichero, pagina(caso.csp));
  const cargada = new Promise((r) => client.on('Page.loadEventFired', r));
  await Page.navigate({ url: pathToFileURL(fichero).href });
  await Promise.race([cargada, sleep(8000)]);
  await sleep(250);

  const r = await Runtime.evaluate({
    returnByValue: true,
    expression: `JSON.stringify({
      elemento: getComputedStyle(document.querySelector('#por-elemento')).filter,
      hoja: getComputedStyle(document.querySelector('#por-hoja')).filter,
      enDom: !!document.getElementById('m10'),
    })`,
  });
  const { elemento, hoja, enDom } = JSON.parse(r.result.value);
  const marca = (v) => (v === 'blur(9px)' ? 'aplica    ' : `NO (${v})`);
  console.log(`  ${caso.que.padEnd(24)} ${marca(elemento).padEnd(14)} ${marca(hoja)}`
    + `${enDom ? '' : '   (el <style> ni llego al DOM)'}`);
}

console.log('');
await client.close();
hijo.kill();
await sleep(300);
await fsp.rm(perfil, { recursive: true, force: true }).catch(() => {});
