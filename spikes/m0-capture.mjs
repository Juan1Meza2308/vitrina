/**
 * M0 - Spike de viabilidad de Vitrina.
 *
 * Pregunta que responde: puede esta maquina (i5-7500 + HD 630, monitor 1080p)
 * sostener un screencast CDP a 2x/3x con eventos de DOM sincronizados?
 *
 * No construye producto. Mide y emite un veredicto go/no-go con numeros.
 */
import CDP from 'chrome-remote-interface';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};

const DSF     = Number(arg('dsf', 1));
// Viewport emulado. Medido en M0b: el screencast ignora deviceScaleFactor y
// entrega siempre el viewport CSS a 1:1, asi que la resolucion de captura se
// consigue emulando un viewport MAS GRANDE que la ventana fisica, no subiendo
// el DSF. 0 = usar el tamano natural de la ventana.
const VW      = Number(arg('vw', 0));
const VH      = Number(arg('vh', 0));
// zoom del elemento raiz: compensa que un viewport de 2560 css px maquete la
// app como si tuviera 2560 px de ancho. Con zoom 2 vuelve a maquetar a 1280.
const ZOOM    = Number(arg('zoom', 0));
const SECS    = Number(arg('secs', 20));
const QUALITY = Number(arg('quality', 92));
const PORT    = Number(arg('port', 9222));
const KEEP    = process.argv.includes('--keep-frames');
const URL_ARG = arg('url', pathToFileURL(path.join(HERE, 'stress.html')).href);
const TAG     = VW ? VW + 'x' + VH + (ZOOM ? '-zoom' + ZOOM : '') : 'dsf' + DSF;
const OUT     = path.join(HERE, 'out', TAG + '-q' + QUALITY);

/**
 * Resuelve un binario Chromium utilizable.
 *
 * Edge va primero a proposito: viene preinstalado en Windows, asi que el
 * usuario final de Vitrina no tiene que instalar nada. EdgeCore es el runtime
 * de WebView2 y expone CDP completo igual que Edge normal.
 */
function findBrowser() {
  const fixed = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
  ];
  // EdgeCore guarda una carpeta por version: coger la mas alta.
  for (const root of ['C:/Program Files (x86)/Microsoft/EdgeCore', 'C:/Program Files/Microsoft/EdgeCore']) {
    if (!fs.existsSync(root)) continue;
    const versions = fs.readdirSync(root)
      .filter((d) => /^\d+\./.test(d))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) fixed.push(root + '/' + v + '/msedge.exe');
  }
  for (const p of fixed) {
    if (!p || !fs.existsSync(p)) continue;
    // Un exe puede existir y aun asi no poder ejecutarse (politica, AV, descarga
    // parcial). El Chromium de Playwright de esta maquina falla justo asi.
    try {
      const probe = spawn(p, ['--no-startup-window'], { stdio: 'ignore' });
      probe.on('error', () => {});
      probe.kill();
      return p;
    } catch (e) { /* probar el siguiente */ }
  }
  return null;
}

/** Lee ancho/alto del marcador SOF de un JPEG, sin dependencias. */
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

const INJECT = [
  '(() => {',
  '  if (window.__vitrinaInstalled) return;',
  '  window.__vitrinaInstalled = true;',
  '  const send = (o) => { try { window.__vitrina(JSON.stringify(o)); } catch (e) {} };',
  '  const rect = (el) => {',
  '    if (!el || !el.getBoundingClientRect) return null;',
  '    const r = el.getBoundingClientRect();',
  '    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };',
  '  };',
  '  const label = (el) => {',
  '    if (!el) return null;',
  '    const a = el.getAttribute ? (el.getAttribute("aria-label") || el.getAttribute("placeholder")) : null;',
  '    const t = a || el.textContent || "";',
  '    return t.trim().slice(0, 60) || null;',
  '  };',
  '  let lastMove = 0;',
  '  addEventListener("pointermove", (e) => {',
  '    const now = performance.now();',
  '    if (now - lastMove < 8) return;',
  '    lastMove = now;',
  '    send({ t: Date.now(), type: "move", x: Math.round(e.clientX), y: Math.round(e.clientY) });',
  '  }, true);',
  '  ["pointerdown", "pointerup"].forEach((type) => {',
  '    addEventListener(type, (e) => {',
  '      const el = e.target;',
  '      send({ t: Date.now(), type: type === "pointerdown" ? "down" : "up",',
  '             x: Math.round(e.clientX), y: Math.round(e.clientY),',
  '             rect: rect(el), tag: el && el.tagName, label: label(el) });',
  '    }, true);',
  '  });',
  '  addEventListener("wheel", (e) => send({ t: Date.now(), type: "wheel",',
  '    x: Math.round(e.clientX), y: Math.round(e.clientY), dy: Math.round(e.deltaY) }), true);',
  '  // Nunca se registra el caracter tecleado, solo que hubo escritura.',
  '  addEventListener("keydown", (e) => send({ t: Date.now(), type: "key",',
  '    key: e.key.length === 1 ? "char" : e.key }), true);',
  '  addEventListener("scroll", () => send({ t: Date.now(), type: "scroll", sy: Math.round(scrollY) }), true);',
  '})();',
].join('\n');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (r.ok) return await r.json();
    } catch (e) { /* aun arrancando */ }
    await sleep(150);
  }
  throw new Error('El puerto de depuracion ' + port + ' no respondio en ' + timeoutMs + 'ms');
}

async function main() {
  const chromePath = findBrowser();
  if (!chromePath) throw new Error('No se encontro un navegador Chromium ejecutable');

  await fsp.rm(OUT, { recursive: true, force: true });
  await fsp.mkdir(path.join(OUT, 'frames'), { recursive: true });
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-profile-'));

  console.log('navegador  ' + path.basename(chromePath) + ' (' + path.basename(path.dirname(chromePath)) + ')');
  console.log('dsf        ' + DSF + '   quality ' + QUALITY + '   duracion ' + SECS + 's');
  console.log('salida     ' + OUT + '\n');

  const chrome = spawn(chromePath, [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--app=about:blank',
    '--window-size=1280,780',
    '--window-position=40,40',
    '--no-first-run', '--no-default-browser-check', '--disable-infobars',
    '--hide-crash-restore-bubble', '--force-color-profile=srgb',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=Translate,AutofillServerCommunication,MediaRouter,OptimizationHints',
  ], { stdio: 'ignore' });

  const version = await waitForPort(PORT);
  console.log('conectado  ' + version.Browser + '\n');

  const client = await CDP({ port: PORT });
  const { Page, Runtime, Emulation, Input } = client;
  await Promise.all([Page.enable(), Runtime.enable()]);

  // --- captura de eventos de entrada desde el DOM -------------------------
  const events = [];
  await Runtime.addBinding({ name: '__vitrina' });
  Runtime.bindingCalled(({ name, payload }) => {
    if (name === '__vitrina') {
      try { events.push(JSON.parse(payload)); } catch (e) { /* payload corrupto */ }
    }
  });
  await Page.addScriptToEvaluateOnNewDocument({ source: INJECT });
  // El binding se pierde en cada navegacion: hay que re-registrarlo.
  Runtime.executionContextCreated(() => {
    Runtime.addBinding({ name: '__vitrina' }).catch(() => {});
  });

  const loaded = new Promise((r) => Page.loadEventFired(r));
  await Page.navigate({ url: URL_ARG });
  await loaded;
  await sleep(400);

  await Emulation.setDeviceMetricsOverride({
    width: VW, height: VH, deviceScaleFactor: DSF, mobile: false,
  });
  await sleep(300);

  if (ZOOM) {
    // Se aplica como estilo persistente para que sobreviva a re-renders del framework.
    await Runtime.evaluate({
      expression: 'document.documentElement.style.setProperty("zoom", "' + ZOOM + '")',
    });
    await sleep(300);
  }

  const { result: vp } = await Runtime.evaluate({
    expression: 'JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio,'
      + 'mq1400:matchMedia("(min-width:1400px)").matches,'
      + 'mq2000:matchMedia("(min-width:2000px)").matches,'
      + 'bodyW:Math.round(document.body.getBoundingClientRect().width)})',
    returnByValue: true,
  });
  const viewport = JSON.parse(vp.value);
  console.log('viewport   ' + viewport.w + 'x' + viewport.h + ' css - dpr ' + viewport.dpr
    + (ZOOM ? ' - zoom ' + ZOOM : ''));
  console.log('media qs   min-1400px:' + viewport.mq1400 + '  min-2000px:' + viewport.mq2000
    + '  body ' + viewport.bodyW + 'px');
  console.log('esperado   ' + (viewport.w * DSF) + 'x' + (viewport.h * DSF) + ' px de captura\n');

  // --- screencast ---------------------------------------------------------
  const frames = [];
  let pendingWrites = 0, maxPending = 0, bytes = 0, ackLagTotal = 0, seq = 0;
  let firstResolution = null, resolutionMismatch = 0;

  Page.screencastFrame(({ data, metadata, sessionId }) => {
    const gotAt = performance.now();
    Page.screencastFrameAck({ sessionId }).catch(() => {});   // ack primero, siempre
    ackLagTotal += performance.now() - gotAt;

    const buf = Buffer.from(data, 'base64');
    bytes += buf.length;
    const size = jpegSize(buf);
    if (!firstResolution) firstResolution = size;
    else if (size && (size.w !== firstResolution.w || size.h !== firstResolution.h)) resolutionMismatch++;

    const file = String(++seq).padStart(6, '0') + '.jpg';
    frames.push({ file, t: metadata.timestamp, bytes: buf.length });

    pendingWrites++;
    maxPending = Math.max(maxPending, pendingWrites);
    fsp.writeFile(path.join(OUT, 'frames', file), buf)
      .catch(() => {})
      .finally(() => { pendingWrites--; });
  });

  await Page.startScreencast({
    format: 'jpeg', quality: QUALITY,
    maxWidth: 4096, maxHeight: 2560, everyNthFrame: 1,
  });
  const t0 = Date.now();
  console.log('grabando   ' + SECS + 's con interaccion sintetica...');

  await drive(Input, SECS * 1000, ZOOM || 1);

  await Page.stopScreencast();
  const wallMs = Date.now() - t0;
  while (pendingWrites > 0) await sleep(50);   // drenar cola de escritura

  // --- informe ------------------------------------------------------------
  const stats = report({ frames, events, wallMs, bytes, maxPending, ackLagTotal,
                         firstResolution, resolutionMismatch, viewport });

  await fsp.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify({
    version: 1, dsf: DSF, quality: QUALITY, url: URL_ARG,
    viewport, capture: firstResolution, startedAt: t0, durationMs: wallMs, frames,
  }, null, 2));
  await fsp.writeFile(path.join(OUT, 'events.json'), JSON.stringify(events, null, 2));
  await fsp.writeFile(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2));

  if (!KEEP) await fsp.rm(path.join(OUT, 'frames'), { recursive: true, force: true });

  await client.close();
  chrome.kill();
  await sleep(300);
  await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
}

/** Interaccion sintetica: mueve, clica botones reales y hace scroll. */
async function drive(Input, durationMs, scale) {
  const targets = [
    { x: 70,  y: 232 }, { x: 190, y: 232 }, { x: 320, y: 232 }, { x: 450, y: 232 },
    { x: 100, y: 290 }, { x: 330, y: 290 },
  ];
  const T = targets.map((t) => ({ x: t.x * scale, y: t.y * scale }));
  const end = Date.now() + durationMs;
  let cur = { x: 640 * scale, y: 400 * scale }, i = 0;

  while (Date.now() < end) {
    const to = T[i++ % T.length];
    for (let s = 1; s <= 14 && Date.now() < end; s++) {
      const x = cur.x + (to.x - cur.x) * (s / 14);
      const y = cur.y + (to.y - cur.y) * (s / 14);
      await Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
      await sleep(16);
    }
    cur = to;
    if (Date.now() >= end) break;
    await Input.dispatchMouseEvent({ type: 'mousePressed', x: cur.x, y: cur.y, button: 'left', clickCount: 1 });
    await sleep(60);
    await Input.dispatchMouseEvent({ type: 'mouseReleased', x: cur.x, y: cur.y, button: 'left', clickCount: 1 });
    await sleep(700);

    if (i % 3 === 0 && Date.now() < end) {      // rafaga de scroll
      for (let s = 0; s < 10 && Date.now() < end; s++) {
        await Input.dispatchMouseEvent({ type: 'mouseWheel', x: 640 * scale, y: 400 * scale, deltaX: 0, deltaY: 120 });
        await sleep(40);
      }
      await sleep(400);
      for (let s = 0; s < 10 && Date.now() < end; s++) {
        await Input.dispatchMouseEvent({ type: 'mouseWheel', x: 640 * scale, y: 400 * scale, deltaX: 0, deltaY: -120 });
        await sleep(40);
      }
    }
  }
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function report(d) {
  const { frames, events, wallMs, bytes, maxPending, ackLagTotal,
          firstResolution, resolutionMismatch, viewport } = d;
  const secs = wallMs / 1000;
  const avgFps = frames.length / secs;

  // deltas entre frames, en ms, desde el reloj del propio screencast
  const deltas = [];
  for (let i = 1; i < frames.length; i++) deltas.push((frames[i].t - frames[i - 1].t) * 1000);
  const sorted = deltas.slice().sort((a, b) => a - b);

  // fps sostenido = peor segundo completo, que es lo que se nota al ver el video
  const buckets = new Map();
  if (frames.length) {
    const base = frames[0].t;
    for (const f of frames) {
      const b = Math.floor(f.t - base);
      buckets.set(b, (buckets.get(b) || 0) + 1);
    }
  }
  const perSec = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map((e) => e[1]).slice(0, -1);
  const sustained = perSec.length ? Math.min.apply(null, perSec) : 0;
  const medianSec = perSec.length ? perSec.slice().sort((a, b) => a - b)[Math.floor(perSec.length / 2)] : 0;

  const clicks = events.filter((e) => e.type === 'down');
  const withRect = clicks.filter((e) => e.rect && e.rect.w > 0);

  const verdict =
    sustained >= 50 ? 'GO - 60fps viable en esta configuracion'
    : sustained >= 26 ? 'GO PARCIAL - 30fps viable; 60fps no'
    : 'NO-GO - bajar resolucion o pasar a modo replay';

  const worst = sorted.length ? sorted[sorted.length - 1] : 0;
  const line = (k, v) => console.log('  ' + k.padEnd(23) + v);
  console.log('\n-------- resultados --------');
  line('resolucion captura', firstResolution ? firstResolution.w + 'x' + firstResolution.h : 'desconocida');
  line('coincide con dsf', firstResolution && firstResolution.w === viewport.w * DSF ? 'si' : 'NO (mismatch ' + resolutionMismatch + ')');
  line('frames', frames.length + ' en ' + secs.toFixed(1) + 's');
  line('fps medio', avgFps.toFixed(1));
  line('fps sostenido (peor s)', String(sustained));
  line('fps mediano por s', String(medianSec));
  line('delta p50 / p95', pct(sorted, 0.5).toFixed(1) + 'ms / ' + pct(sorted, 0.95).toFixed(1) + 'ms');
  line('peor delta', worst.toFixed(1) + 'ms');
  line('bitrate', (bytes / 1024 / 1024 / secs).toFixed(1) + ' MB/s');
  line('peso medio frame', (bytes / Math.max(1, frames.length) / 1024).toFixed(0) + ' KB');
  line('ack lag medio', (ackLagTotal / Math.max(1, frames.length)).toFixed(2) + 'ms');
  line('cola escritura max', String(maxPending));
  line('eventos capturados', String(events.length));
  line('clicks con rect DOM', withRect.length + '/' + clicks.length);
  console.log('\n  VEREDICTO: ' + verdict + '\n');

  return {
    resolution: firstResolution, viewport, dsf: DSF, quality: QUALITY,
    frames: frames.length, seconds: +secs.toFixed(2), avgFps: +avgFps.toFixed(2),
    sustainedFps: sustained, medianFps: medianSec,
    deltaP50: +pct(sorted, 0.5).toFixed(1), deltaP95: +pct(sorted, 0.95).toFixed(1),
    worstDelta: +worst.toFixed(1),
    mbPerSec: +(bytes / 1024 / 1024 / secs).toFixed(2),
    avgFrameKb: +(bytes / Math.max(1, frames.length) / 1024).toFixed(0),
    ackLagMs: +(ackLagTotal / Math.max(1, frames.length)).toFixed(2),
    maxWriteQueue: maxPending, events: events.length,
    clicks: clicks.length, clicksWithRect: withRect.length, verdict,
  };
}

main().catch((e) => { console.error('\nFALLO:', e.message); process.exit(1); });
