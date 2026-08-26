/**
 * Herramienta de desarrollo: hoja de contacto del encuadre.
 *
 * La curva ASCII de `vitrina plan` dice CUANTO amplia la camara, pero no si
 * amplia sobre lo correcto. Esto dibuja sobre frames reales el recuadro que la
 * camara esta mirando en ese instante. Si el recuadro no rodea el boton que se
 * acaba de pulsar, el motor de camara esta mal, por bonita que sea la curva.
 *
 *   node tools/contacto.ts grabaciones/demo.vitrina
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildCameraTrack, computeQualityBudget, cameraConfigForBudget,
  CAMERA_PRESETS, viewRect,
} from '@vitrina/core';
import { findFfmpeg } from '@vitrina/export';
import type { InputEvent, Manifest, Project } from '@vitrina/core';

const run = promisify(execFile);
const FFMPEG = findFfmpeg();

const dir = process.argv[2];
if (!dir) {
  console.error('uso: node tools/contacto.ts <carpeta.vitrina>');
  process.exit(1);
}

const readJson = async <T,>(p: string): Promise<T> =>
  JSON.parse(await fsp.readFile(p, 'utf8')) as T;

/** Frame cuyo timestamp esta mas cerca del instante pedido. */
function nearestFrame(manifest: Manifest, tMs: number): string | null {
  let best: string | null = null;
  let bestDelta = Infinity;
  for (const f of manifest.frames) {
    const delta = Math.abs(f.t * 1000 - (manifest.startedAt + tMs));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = f.file;
    }
  }
  return best;
}

async function main(): Promise<void> {
  const root = path.resolve(dir!);
  const manifest = await readJson<Manifest>(path.join(root, 'manifest.json'));
  const events = await readJson<InputEvent[]>(path.join(root, 'events.json'));
  const project = await readJson<Project>(path.join(root, 'project.json'));

  const viewport = manifest.capture ?? manifest.viewport;
  const budget = computeQualityBudget(viewport, project.export, project.frame);
  const config = cameraConfigForBudget(CAMERA_PRESETS.normal, budget.maxSharpZoom);
  const track = buildCameraTrack({
    events, segments: project.zooms, viewport,
    startedAt: manifest.startedAt, durationMs: manifest.durationMs, config,
  });

  // Instantes interesantes: el asentamiento y el centro de cada tramo, mas un
  // momento en reposo. Son los que revelan si el encuadre acierta.
  const marks: { tMs: number; nota: string }[] = [];
  for (const z of project.zooms) {
    marks.push({ tMs: z.startMs + config.settleMs, nota: `${z.label ?? 'tramo'} · entrada` });
    marks.push({ tMs: (z.startMs + z.endMs) / 2, nota: `${z.label ?? 'tramo'} · centro` });
  }
  if (project.zooms.length > 0) {
    const hueco = project.zooms[0]!.endMs + 800;
    if (hueco < manifest.durationMs) marks.push({ tMs: hueco, nota: 'en reposo' });
  }
  const picked = marks.slice(0, 6);
  if (picked.length === 0) {
    console.error('La grabacion no tiene tramos de zoom. Ejecuta antes vitrina-plan.');
    process.exit(1);
  }

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-contacto-'));
  const tiles: string[] = [];

  for (const [i, m] of picked.entries()) {
    const file = nearestFrame(manifest, m.tMs);
    if (!file) continue;
    const cam = track.sampleAt(m.tMs);
    const v = viewRect(cam, viewport);

    // ffmpeg exige enteros y no tolera cajas que se salgan del frame.
    const x = Math.max(0, Math.round(v.x));
    const y = Math.max(0, Math.round(v.y));
    const w = Math.min(viewport.w - x, Math.round(v.w));
    const h = Math.min(viewport.h - y, Math.round(v.h));

    const out = path.join(tmp, `tile${i}.jpg`);
    await run(FFMPEG, [
      '-y', '-loglevel', 'error',
      '-i', path.join(root, 'frames', file),
      '-vf', `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=#c3f53c@0.95:t=5,scale=640:360`,
      out,
    ]);
    tiles.push(out);
    console.log(`  ${m.tMs.toFixed(0).padStart(6)}ms  ${cam.scale.toFixed(2)}x  ${w}x${h}  ${m.nota}`);
  }

  // Renombrado secuencial: el demuxer image2 necesita numeracion continua.
  for (const [i, t] of tiles.entries()) {
    await fsp.rename(t, path.join(tmp, `seq${String(i + 1).padStart(3, '0')}.jpg`));
  }
  const cols = Math.min(2, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const sheet = path.join(root, 'contacto.png');

  await run(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-i', path.join(tmp, 'seq%03d.jpg'),
    '-filter_complex', `tile=${cols}x${rows}:margin=8:padding=8:color=#14181d`,
    '-frames:v', '1',
    sheet,
  ]);
  await fsp.rm(tmp, { recursive: true, force: true });
  console.log(`\n  hoja de contacto: ${sheet}`);
}

main().catch((e: unknown) => {
  console.error('FALLO:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
