/**
 * Spike M12: ¿cuantos errores comete la transcripcion en espanol?
 *
 * Los subtitulos de la voz (no los de accion de `guia.srt`) dependen de un
 * modelo de reconocimiento de voz. Antes de empaquetarlo en la app hay que
 * saber, con numeros, cuanto se equivoca: WER sobre una narracion real en
 * espanol con transcripcion conocida.
 *
 * Se usa el prologo de «Platero y yo», leido por una persona para LibriVox
 * (CC0): el audio es publico y el texto exacto esta en Project Gutenberg.
 * Bajar los dos y comparar la transcripcion contra la referencia mide el WER
 * sin depender de la opinion de nadie.
 *
 * El binario y el modelo NO van en el repo —pesan cientos de MB—. Se pasan
 * por variable:
 *
 *   whisper-cli  WebAssembly de whisper.cpp:   WHISPER_CLI=/ruta/a/whisper-cli
 *   modelo ggml  (base, small...):             WHISPER_MODEL=/ruta/a/ggml-xxx.bin
 *
 *   node spikes/m12-stt-es.mjs
 */
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CACHE = path.join(os.tmpdir(), 'vitrina-spike-stt');
const AUDIO = 'https://archive.org/download/plateroyyo_1505_librivox/plateroyyo_00_jimenez_64kb.mp3';
const TEXTO = 'https://biblioteca.mujica.org/ebooks/books/39209-h/39209-h.htm';

const cli = process.env.WHISPER_CLI ?? process.argv[2];
const modelo = process.env.WHISPER_MODEL ?? process.argv[3];
if (!cli || !modelo) {
  console.error('Pasa el binario y el modelo:\n'
    + '  WHISPER_CLI=/ruta/whisper-cli WHISPER_MODEL=/ruta/ggml-xxx.bin node spikes/m12-stt-es.mjs');
  process.exit(1);
}

const bajar = async (url, destino) => {
  if (await fsp.stat(destino).then(() => true).catch(() => false)) return destino;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await fsp.mkdir(path.dirname(destino), { recursive: true });
  await fsp.writeFile(destino, Buffer.from(await res.arrayBuffer()));
  return destino;
};

/** Minusculas, sin acentos ni puntuacion: whisper omite acentos, no es un fallo. */
const normalizar = (s) => s.toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\u00f1 ]/g, ' ')
  .replace(/\s+/g, ' ').trim().split(' ');

/** Distancia de edicion de Levenshtein entre listas de palabras. */
function wer(ref, hyp) {
  const r = normalizar(ref);
  const h = normalizar(hyp);
  const n = r.length;
  const m = h.length;
  const d = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1),
      );
    }
  }
  return { wer: (d[n][m] / n) * 100, ed: d[n][m], refN: n, hypN: m };
}

/** El pasaje que se lee en el audio: la advertencia, del Gutenberg en latin1. */
async function textoReferencia() {
  const html = await fsp.readFile(await bajar(TEXTO, path.join(CACHE, 'platero.html')), 'latin1');
  const flujo = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/&mdash;/g, ' ');
  const inicio = flujo.indexOf('breve libro');
  const fin = flujo.indexOf('LA ELEG');
  return flujo.slice(inicio, fin);
}

const audio = await bajar(AUDIO, path.join(CACHE, 'platero00.mp3'));
const referencia = await textoReferencia();

await fsp.mkdir(CACHE, { recursive: true });
const salida = path.join(CACHE, 'transcrito.txt');
await new Promise((resolve, reject) => {
  const proc = spawn(cli, ['-m', modelo, '-l', 'es', '-f', audio, '-otxt', '-of', salida.replace(/\.txt$/, '')],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const err = [];
  proc.stderr?.on('data', (c) => err.push(c.toString()));
  proc.on('error', reject);
  proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`whisper-cli: ${err.join('').slice(-500)}`)));
});

const transcrito = await fsp.readFile(salida, 'utf8');
// El pasaje transcrito va de la advertencia al cierre del prologo.
const cortar = (t) => {
  const a = t.toLowerCase().indexOf('advertencia');
  const b = t.indexOf('Fin del prologo');
  return t.slice(a < 0 ? 0 : a, b < 0 ? t.length : b);
};

const r = wer(referencia, cortar(transcrito));
console.log(`modelo        ${path.basename(modelo)}`);
console.log(`WER           ${r.wer.toFixed(1)}%  (${r.ed} errores / ${r.refN} palabras)`);
console.log('');
console.log('REFERENCIA (primeras 120 palabras):');
console.log(normalizar(referencia).slice(0, 120).join(' '));
console.log('');
console.log('TRANSCRITO (pasaje, primeras 120):');
console.log(normalizar(cortar(transcrito)).slice(0, 120).join(' '));