/**
 * M0b - De donde sale la resolucion del screencast?
 *
 * El primer spike revelo que setDeviceMetricsOverride({width:0,height:0,dsf:3})
 * sube devicePixelRatio dentro de la pagina pero NO agranda los frames del
 * screencast: siguen saliendo al tamano fisico de la ventana.
 *
 * Este script prueba cada estrategia y reporta el tamano REAL del JPEG,
 * leido de la cabecera. Es la medicion que decide la arquitectura de captura.
 */
import CDP from 'chrome-remote-interface';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL_ARG = pathToFileURL(path.join(HERE, 'stress.html')).href;
const HEADLESS = process.argv.includes('--headless');
const PORT = HEADLESS ? 9245 : 9244;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function findBrowser() {
  const fixed = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  for (const root of ['C:/Program Files (x86)/Microsoft/EdgeCore', 'C:/Program Files/Microsoft/EdgeCore']) {
    if (!fs.existsSync(root)) continue;
    for (const v of fs.readdirSync(root).filter((d) => /^\d+\./.test(d))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      fixed.push(root + '/' + v + '/msedge.exe');
    }
  }
  return fixed.find((p) => fs.existsSync(p)) || null;
}

async function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (r.ok) return await r.json();
    } catch (e) { /* arrancando */ }
    await sleep(150);
  }
  throw new Error('sin CDP en el puerto ' + port);
}

/** Arranca el screencast, se queda con el primer frame estable y para. */
async function grabOneFrame(client, Page, maxW, maxH) {
  const result = await new Promise((resolve) => {
    let done = false, seen = 0;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const handler = ({ data, metadata, sessionId }) => {
      Page.screencastFrameAck({ sessionId }).catch(() => {});
      seen++;
      // El primer frame a veces sale con el tamano anterior; el 4o ya es estable.
      if (seen < 4 || done) return;
      const buf = Buffer.from(data, 'base64');
      finish({ size: jpegSize(buf), bytes: buf.length, metadata });
    };
    client.on('Page.screencastFrame', handler);
    Page.startScreencast({ format: 'jpeg', quality: 80, maxWidth: maxW, maxHeight: maxH, everyNthFrame: 1 })
      .catch(() => finish(null));
    setTimeout(() => {
      finish(null);
      client.removeListener('Page.screencastFrame', handler);
    }, 2500);
  });
  await Page.stopScreencast().catch(() => {});
  await sleep(150);
  return result;
}

const STRATEGIES = [
  { name: 'sin override (baseline)',      override: null },
  { name: 'dsf2, w/h = 0',                override: { w: 0, h: 0, dsf: 2 } },
  { name: 'dsf3, w/h = 0',                override: { w: 0, h: 0, dsf: 3 } },
  { name: 'dsf2, w/h explicitos',         override: { w: 'auto', h: 'auto', dsf: 2 } },
  { name: 'dsf3, w/h explicitos',         override: { w: 'auto', h: 'auto', dsf: 3 } },
  { name: 'dsf2, w/h 1280x720 fijos',     override: { w: 1280, h: 720, dsf: 2 } },
  { name: 'dsf3, w/h 1280x720 fijos',     override: { w: 1280, h: 720, dsf: 3 } },
  { name: 'dsf1, w/h 2560x1440 fijos',    override: { w: 2560, h: 1440, dsf: 1 } },
  { name: 'dsf2, w/h 1920x1080 fijos',    override: { w: 1920, h: 1080, dsf: 2 } },
];

async function main() {
  const browser = findBrowser();
  if (!browser) throw new Error('sin navegador');
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-res-'));

  const flags = [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb',
  ];
  if (HEADLESS) flags.push('--headless=new', '--window-size=1256,688');
  else flags.push('--app=about:blank', '--window-size=1280,780', '--window-position=40,40');

  const child = spawn(browser, flags, { stdio: 'ignore' });
  const v = await waitForPort(PORT);
  console.log('modo       ' + (HEADLESS ? 'HEADLESS' : 'HEADED') + '   ' + v.Browser + '\n');

  const client = await CDP({ port: PORT });
  const { Page, Runtime, Emulation } = client;
  await Promise.all([Page.enable(), Runtime.enable()]);
  const loaded = new Promise((r) => Page.loadEventFired(r));
  await Page.navigate({ url: URL_ARG });
  await loaded;
  await sleep(500);

  const read = async () => {
    const { result } = await Runtime.evaluate({
      expression: 'JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})',
      returnByValue: true,
    });
    return JSON.parse(result.value);
  };
  const natural = await read();
  console.log('ventana natural: ' + natural.w + 'x' + natural.h + ' css, dpr ' + natural.dpr + '\n');

  const head = ['estrategia', 'viewport css', 'dpr', 'screencast', 'screenshot', 'veredicto'];
  const rows = [];

  for (const s of STRATEGIES) {
    await Emulation.clearDeviceMetricsOverride().catch(() => {});
    await sleep(250);

    let want = null;
    if (s.override) {
      const w = s.override.w === 'auto' ? natural.w : s.override.w;
      const h = s.override.h === 'auto' ? natural.h : s.override.h;
      await Emulation.setDeviceMetricsOverride({ width: w, height: h, deviceScaleFactor: s.override.dsf, mobile: false });
      await sleep(400);
      want = { w: (w || natural.w) * s.override.dsf, h: (h || natural.h) * s.override.dsf };
    }

    const vp = await read();
    const cast = await grabOneFrame(client, Page, 4096, 2560);

    // Comparacion de control: captureScreenshot si honra el DSF?
    let shotSize = null;
    try {
      const shot = await Page.captureScreenshot({ format: 'jpeg', quality: 80, captureBeyondViewport: false });
      shotSize = jpegSize(Buffer.from(shot.data, 'base64'));
    } catch (e) { /* puede fallar con overrides raros */ }

    const castStr = cast && cast.size ? cast.size.w + 'x' + cast.size.h : 'sin frame';
    const shotStr = shotSize ? shotSize.w + 'x' + shotSize.h : '-';
    const hit = cast && cast.size && want && cast.size.w >= want.w * 0.98;
    const verdict = !s.override ? 'baseline' : (hit ? 'SI escala' : 'no escala');

    rows.push([s.name, vp.w + 'x' + vp.h, String(vp.dpr), castStr, shotStr, verdict]);
    console.log('  ' + s.name.padEnd(28) + castStr.padEnd(12) + ' shot ' + shotStr.padEnd(12) + ' ' + verdict);
  }

  console.log('\n| ' + head.join(' | ') + ' |');
  console.log('|' + head.map(() => '---').join('|') + '|');
  for (const r of rows) console.log('| ' + r.join(' | ') + ' |');

  await fsp.mkdir(path.join(HERE, 'out'), { recursive: true });
  await fsp.writeFile(path.join(HERE, 'out', 'resolution-' + (HEADLESS ? 'headless' : 'headed') + '.json'),
    JSON.stringify({ mode: HEADLESS ? 'headless' : 'headed', browser: v.Browser, natural, rows }, null, 2));

  await client.close();
  child.kill();
  await sleep(300);
  await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
}

main().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
