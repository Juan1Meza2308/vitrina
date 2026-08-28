/**
 * Herramienta de desarrollo: compone frames de una grabacion.
 *
 *   node tools/render.ts grabaciones/demo.vitrina
 *
 * Saca una hoja de stills compuestos, util para revisar encuadre y estilo de un
 * vistazo sin esperar a un render completo. Para producir video esta
 * `bin/vitrina-export.ts`, que es el exportador de verdad.
 */
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildCameraTrack, cameraConfigForBudget, computeQualityBudget, CAMERA_PRESETS, FrameIndex,
} from '@vitrina/core';
import type { InputEvent, Manifest, Project } from '@vitrina/core';
import { composite, CursorSource, OverlaySource } from '@vitrina/renderer';
import type { Ctx, ImageLike } from '@vitrina/renderer';
import { findFfmpeg } from '@vitrina/export';

// La resolucion de ffmpeg vive en @vitrina/export y ya conoce las rutas de
// cada sistema. Repetirla aqui es como se colaron rutas de Windows en una
// herramienta que deberia dar igual donde corra.
const FFMPEG = findFfmpeg();

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('uso: node tools/render.ts <carpeta.vitrina>');
  process.exit(1);
}

const readJson = async <T,>(p: string): Promise<T> =>
  JSON.parse(await fsp.readFile(p, 'utf8')) as T;

async function main(): Promise<void> {
  const root = path.resolve(dir!);
  const manifest = await readJson<Manifest>(path.join(root, 'manifest.json'));
  const events = await readJson<InputEvent[]>(path.join(root, 'events.json'));
  const project = await readJson<Project>(path.join(root, 'project.json'));

  const sourceSize = manifest.capture ?? manifest.viewport;
  const budget = computeQualityBudget(sourceSize, project.export, project.frame);
  const config = cameraConfigForBudget(CAMERA_PRESETS.normal, budget.maxSharpZoom);
  const track = buildCameraTrack({
    events, segments: project.zooms, viewport: sourceSize,
    startedAt: manifest.startedAt, durationMs: manifest.durationMs, config,
  });
  const cursor = new CursorSource(events, manifest.startedAt);
const overlay = new OverlaySource(events, manifest.startedAt);
  const index = new FrameIndex(manifest);

  // El mismo fondo que usa el exportador. Sin esto la hoja de contacto mostraba
  // el color de respaldo y no lo que sale en el video, que es justo la clase de
  // divergencia que esta herramienta existe para detectar.
  let fondo: Awaited<ReturnType<typeof loadImage>> | null = null;
  if (project.background.kind === 'image') {
    fondo = await loadImage(path.resolve(root, project.background.path)).catch(() => null);
  }

  const W = project.export.width;
  const H = project.export.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as Ctx;

  // Cache de un frame: a 60 fps de salida sobre captura VFR, varios instantes
  // consecutivos caen en el mismo frame de origen y decodificarlo de nuevo es
  // el gasto dominante del render.
  let cachedFile = '';
  let cachedImg: Awaited<ReturnType<typeof loadImage>> | null = null;

  const drawAt = async (tMs: number): Promise<void> => {
    const file = index.at(tMs);
    if (!file) return;
    if (file !== cachedFile || !cachedImg) {
      cachedImg = await loadImage(path.join(root, 'frames', file));
      cachedFile = file;
    }
    const img = cachedImg;
    composite({
      ctx,
      source: img as unknown as ImageLike,
      sourceSize,
      camera: track.sampleAt(tMs),
      project,
      cursor: cursor.sample(tMs),
  overlay: overlay.sample(tMs),
      backgroundImage: fondo as unknown as ImageLike | null,
    });
  };

  await renderStills(root, manifest, project, drawAt, canvas, W, H);
}

async function renderStills(
  root: string, manifest: Manifest, project: Project,
  drawAt: (t: number) => Promise<void>,
  canvas: Canvas, W: number, H: number,
): Promise<void> {
  const marks: number[] = [];
  for (const z of project.zooms) {
    marks.push(z.startMs + 250, (z.startMs + z.endMs) / 2);
  }
  if (marks.length === 0) marks.push(manifest.durationMs * 0.3, manifest.durationMs * 0.6);
  const picked = marks.slice(0, 6);

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-render-'));
  for (const [i, t] of picked.entries()) {
    await drawAt(t);
    await fsp.writeFile(path.join(tmp, `seq${String(i + 1).padStart(3, '0')}.png`), canvas.toBuffer('image/png'));
    console.log(`  ${t.toFixed(0).padStart(6)}ms  compuesto`);
  }

  const cols = Math.min(2, picked.length);
  const rows = Math.ceil(picked.length / cols);
  const out = path.join(root, 'compuesto.png');
  await runFfmpeg([
    '-y', '-loglevel', 'error',
    '-i', path.join(tmp, 'seq%03d.png'),
    '-filter_complex', `tile=${cols}x${rows}:margin=10:padding=10:color=#0b0d10`,
    '-frames:v', '1', out,
  ]);
  await fsp.rm(tmp, { recursive: true, force: true });
  console.log(`\n  hoja compuesta (${W}x${H} cada una): ${out}`);
}

function runFfmpeg(argv: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, argv, { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg salio con ${code}`))));
  });
}

main().catch((e: unknown) => {
  console.error('\nFALLO:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
