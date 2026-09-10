/**
 * Transcripcion de la narracion: de la pista a los subtitulos.
 *
 * La guia corrige lo que se HACE; cuando ademas se oye una voz, lo que se DICE
 * tambien quiere subtitulo. Eso no se puede deducir del log: hay que transcribir
 * el audio, y se hace 100 % local con whisper.cpp —la narracion de una demo es
 * cosa de quien la grabo, y ninguna conversacion deberia tener que salir de su
 * disco para subtitularse.
 *
 * whisper-cli necesita entender el fichero: la pista es `mic.webm` (opus en
 * webm), y el motor habla wav/flac/ogg/mp3. Se convierte primero a wav mono de
 * 16 kHz con el ffmpeg que ya viaja con la app —el formato que whisper entiende
 * sin resamplear.
 *
 * La salida no es el texto escueto: los tiempos que da el motor son del FICHERO
 * de audio, y el video de salida puede empezar, cortar y acelerar. `subtitulosDeVoz`
 * —en core, probado sin navegador— los lleva al reloj de la salida.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  TimeMap, subtitulosDeVoz, srtDeVoz,
} from '@vitrina/core';
import { leerManifest, leerProyecto, leerValidado } from '@vitrina/core/persistencia';
import type { Manifest, Project, SegmentoVoz, Rotulo } from '@vitrina/core';
import { findFfmpeg } from './ffmpeg.ts';

/** Ultimas lineas de stderr que se guardan para poder explicar un fallo.
 *  Igual que en `ffmpeg.ts`: un proceso que escupe sin parar no debe llenar la
 *  memoria solo para que el mensaje de error tenga contexto. */
const STDERR_LINES = 12;

/** Binario de whisper.cpp. En Windows se llama distinto (`.exe`). */
function binName(plataforma: NodeJS.Platform): string {
  return plataforma === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
}

/**
 * Rutas del whisper-cli que viaja CON la app.
 *
 * Mismo juego que `findFfmpeg`: primero lo que la app trae empaquetado, luego
 * el node_modules de quien la ejecuta desde el codigo. Devuelve las rutas
 * SOBRANTES; la ultima es la del PATH.
 */
function rutasWhisper(plataforma: NodeJS.Platform): string[] {
  const rutas: string[] = [];
  const recursos = (process as { resourcesPath?: string }).resourcesPath;
  if (recursos) rutas.push(path.join(recursos, binName(plataforma)));

  let dir = import.meta.dirname;
  for (let i = 0; i < 6 && dir !== path.dirname(dir); i++) {
    rutas.push(path.join(dir, 'node_modules', 'whisper-cpp-static', binName(plataforma)));
    dir = path.dirname(dir);
  }
  return rutas;
}

/**
 * Nunca devuelve null: si no encuentra ruta conocida cae a `whisper-cli` y deja
 * que lo resuelva el PATH. Igual que `findFfmpeg`.
 */
export function findWhisper(
  plataforma: NodeJS.Platform = process.platform,
  existe: (p: string) => boolean = fs.existsSync,
): string {
  const candidates = [
    process.env['WHISPER_PATH'],
    ...rutasWhisper(plataforma),
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    if (existe(p)) return p;
  }
  return binName(plataforma);
}

/**
 * Rutas del modelo de lenguaje, que tambien viaja con la app.
 *
 * El modelo ES el motor: whisper sin `ggml-*.bin` no transcribe. Va empaquetado
 * junto al binario; en desarrollo se puede senalar con `WHISPER_MODEL`.
 */
export function findModeloWhisper(): string | null {
  const recursos = (process as { resourcesPath?: string }).resourcesPath ?? '';
  const candidatos = [
    process.env['WHISPER_MODEL'],
    recursos ? path.join(recursos, 'ggml-base.bin') : undefined,
  ].filter((p): p is string => Boolean(p));
  for (const p of candidatos) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export interface OpcionesTranscripcion {
  recordingDir: string;
  /** Idioma del habla. Hasta que el segundo idioma este probado, el espanol. */
  idioma?: 'es';
  whisper?: string;
  modelo?: string;
}

export interface ResultadoTranscripcion {
  rotulos: Rotulo[];
  /** Ficheros escritos, relativos a la carpeta. */
  ficheros: string[];
}

/**
 * Convierte la pista a wav mono 16 kHz, que es lo que whisper entiende sin
 * resamplear. Devuelve la ruta del wav temporal (ya borrado por el proceso).
 */
async function aWav16k(entrada: string, ffmpeg: string, tmp: string): Promise<string> {
  const wav = path.join(tmp, 'narracion.wav');
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      '-y', '-loglevel', 'error', '-i', entrada,
      '-ac', '1', '-ar', '16000',
      '-f', 'wav', wav,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const err: string[] = [];
    proc.stderr?.on('data', (c: Buffer) => {
      for (const linea of c.toString().split('\n')) {
        if (!linea.trim()) continue;
        err.push(linea.trim());
        if (err.length > STDERR_LINES) err.shift();
      }
    });
    proc.on('error', (e) => reject(new Error(`No se pudo ejecutar ffmpeg: ${e.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('ffmpeg no pudo convertir la narracion a wav. '
        + err.join(' ').trim()));
    });
  });
  return wav;
}

/** El JSON que vuelca whisper-cli: la transcripcion con los tiempos crudos. */
const schemaTranscripcion = z.object({
  transcription: z.array(z.object({
    offsets: z.object({ from: z.number(), to: z.number() }),
    text: z.string(),
  })).optional(),
});

/** Transcribe el fichero y devuelve los segmentos en ms del fichero. */
async function segmentosWhisper(
  whisper: string, modelo: string, idioma: string, entrada: string, tmp: string,
): Promise<SegmentoVoz[]> {
  const json = path.join(tmp, 'narracion.json');
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(whisper, [
      '-m', modelo, '-l', idioma, '-f', entrada,
      '-oj', '-of', path.join(tmp, 'narracion'),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const err: string[] = [];
    proc.stderr?.on('data', (c: Buffer) => {
      for (const linea of c.toString().split('\n')) {
        if (!linea.trim()) continue;
        err.push(linea.trim());
        if (err.length > STDERR_LINES) err.shift();
      }
    });
    proc.on('error', (e) => reject(new Error(`No se pudo ejecutar whisper: ${e.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('whisper-cli no transcribio (codigo ' + code + '). '
        + err.join(' ').slice(-300)));
    });
  });
  const data = await leerValidado(json, schemaTranscripcion);
  return (data.transcription ?? []).map((s) => ({
    desdeMs: s.offsets.from,
    hastaMs: s.offsets.to,
    texto: s.text.trim(),
  })).filter((s) => s.texto.length > 0);
}

/**
 * Transcribe la narracion de una grabacion y escribe `narracion.srt`.
 *
 * Devuelve rotulos vacios si la grabacion no tiene pista de voz; lanza si no
 * hay whisper o modelo, para que quien la pruebe en desarrollo sep qui lo falta.
 */
export async function transcribirNarracion(opts: OpcionesTranscripcion): Promise<ResultadoTranscripcion> {
  const root = path.resolve(opts.recordingDir);
  const manifest = await leerManifest(path.join(root, 'manifest.json'));
  const project = await leerProyecto(path.join(root, 'project.json'));
  if (!manifest.audio) return { rotulos: [], ficheros: [] };

  const whisper = opts.whisper ?? findWhisper();
  const modelo = opts.modelo ?? findModeloWhisper();
  if (!modelo) {
    throw new Error('No hay modelo de voz (ggml-*.bin). Activa el STT en la '
      + 'configuracion o senala uno con WHISPER_MODEL.');
  }

  const pista = manifest.audio;
  const pistaPath = path.join(root, pista.file);
  if (!fs.existsSync(pistaPath)) {
    throw new Error(`El manifest declara narracion (${pista.file}) pero el fichero no esta.`);
  }

  const map = new TimeMap({
    durationMs: manifest.durationMs,
    trimStartMs: project.trimStartMs,
    trimEndMs: project.trimEndMs,
    cuts: project.cuts,
    speeds: project.speeds,
  });

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-stt-'));
  try {
    const wav = await aWav16k(pistaPath, findFfmpeg(), tmp);
    const segmentos = await segmentosWhisper(whisper, modelo, opts.idioma ?? 'es', wav, tmp);
    const rotulos = subtitulosDeVoz(segmentos, pista, manifest.startedAt, map);
    await fsp.writeFile(path.join(root, 'narracion.srt'), srtDeVoz(rotulos));
    return { rotulos, ficheros: ['narracion.srt'] };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}