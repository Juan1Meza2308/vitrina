/**
 * Spike M11: ¿cuanto le cuesta al screencast grabar la camara a la vez?
 *
 * La camara la captura el renderer de Electron con MediaRecorder mientras otro
 * Chromium entrega el screencast. Son dos procesos peleandose por la misma CPU,
 * y el que no puede perder frames es el screencast: el video de la demo es el
 * producto, la cara es el adorno.
 *
 * Este proyecto promete fps MEDIDOS en la pantalla de inicio, asi que anadir una
 * captura que compite por CPU obliga a volver a medir en vez de suponer.
 *
 * Se compara la misma grabacion en dos condiciones:
 *
 *   1. sola —la linea base de siempre—,
 *   2. con una captura de camara en marcha en OTRO navegador, que es como corre
 *      en la app: MediaRecorder sobre el dispositivo falso de Chromium, a
 *      640x480 y 30 fps, exactamente lo que pide `camara.ts`.
 *
 *   node spikes/m11-camara-fps.mjs [--secs=8]
 */
import { spawn } from 'node:child_process';
import CDP from 'chrome-remote-interface';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Recorder } from '../packages/capture-cdp/src/recorder.ts';
import { findBrowser, launchFlags } from '../packages/capture-cdp/src/browser.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (n, d) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d);
const SECS = arg('secs', 8);
const FIXTURE = pathToFileURL(path.resolve('spikes/stress.html')).href;
const PUERTO_CAM = 9424;
const PUERTO_REC = 9425;

/** Página que captura la cámara igual que lo hace el renderer de la app. */
const PAGINA_CAM = `<!doctype html><meta charset="utf-8"><title>carga de camara</title>
<script>
  navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 } })
    .then((s) => {
      const rec = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 1500000 });
      // Los trozos se tiran: aqui interesa el coste de codificar, no el fichero.
      rec.ondataavailable = () => {};
      rec.start(1000);
      document.title = 'grabando';
    })
    .catch((e) => { document.title = 'ERROR ' + e.message; });
</script>`;

async function conCamara() {
  const navegador = findBrowser();
  const perfil = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-m11-'));
  const fichero = path.join(perfil, 'cam.html');
  await fsp.writeFile(fichero, PAGINA_CAM);

  const hijo = spawn(navegador.path, [
    ...launchFlags({ port: PUERTO_CAM, profileDir: perfil, windowWidth: 400, windowHeight: 300 }),
    // Sin camara fisica no hay spike: el dispositivo falso da un patron en
    // movimiento y concede el permiso solo, igual que en `verificar-app`.
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ], { stdio: 'ignore' });

  // Se navega por CDP en vez de pasar la url en la linea de comandos: `--app=`
  // ya ocupa ese hueco en los flags del proyecto.
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PUERTO_CAM}/json/version`)).ok) break; } catch { /* arrancando */ }
    await sleep(150);
  }
  const objetivos = await (await fetch(`http://127.0.0.1:${PUERTO_CAM}/json/list`)).json();
  const pagina = objetivos.find((t) => t.type === 'page');
  const cliente = await CDP({ port: PUERTO_CAM, target: pagina.id, local: true });
  await Promise.all([cliente.Page.enable(), cliente.Runtime.enable()]);
  await cliente.Page.navigate({ url: pathToFileURL(fichero).href });
  await sleep(2500);

  // Se COMPRUEBA que la camara esta capturando de verdad. Sin esto el spike
  // mediria "grabar sola" dos veces y daria una caida del 0 % con cara de
  // buena noticia. Es la leccion de M8: cuando el resultado no depende de lo
  // que se esta variando, lo que falla es el banco de pruebas.
  const { result } = await cliente.Runtime.evaluate({
    expression: 'document.title', returnByValue: true,
  });
  if (result.value !== 'grabando') {
    throw new Error(`La carga de camara no arranco: document.title = ${JSON.stringify(result.value)}`);
  }
  console.log('  carga    camara capturando de verdad (640x480 @30, vp8)\n');

  return {
    async parar() {
      await cliente.close().catch(() => {});
      hijo.kill();
      await sleep(300);
      await fsp.rm(perfil, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** Graba el fixture y devuelve los fps medios que entrego el screencast. */
async function medir(etiqueta) {
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-m11-rec-'));
  const rec = new Recorder({
    url: FIXTURE,
    viewport: { w: 1600, h: 900 },
    quality: 92,
    outDir,
    port: PUERTO_REC,
  });
  await rec.launch();
  await rec.start();
  await sleep(SECS * 1000);
  const r = await rec.stop();
  await rec.close();
  await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {});

  const fps = r.manifest.frames.length / (r.manifest.durationMs / 1000);
  console.log(`  ${etiqueta.padEnd(28)} ${r.manifest.frames.length} frames  ${fps.toFixed(1)} fps`);
  return fps;
}

console.log(`\n  fixture  ${FIXTURE}`);
console.log(`  medida   ${SECS}s por caso, 1600x900\n`);

const solo = await medir('grabando sola');
const carga = await conCamara();
const conCam = await medir('con la camara capturando');
await carga.parar();

const caida = ((solo - conCam) / solo) * 100;
console.log(`\n  caida    ${caida.toFixed(1)} %`);
console.log(caida > 20
  ? '  La camara cuesta cara: conviene decirlo en la pantalla de inicio.\n'
  : '  El coste cabe en el margen: la camara se puede ofrecer sin advertencia.\n');
