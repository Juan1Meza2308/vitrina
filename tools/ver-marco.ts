/**
 * Compone un frame de una grabacion y lo deja en PNG, para mirar el marco.
 *
 * Ajustar un marco a ojo requiere verlo sobre material real, y abrir la app
 * entera para cada iteracion es lento. Usa el MISMO `composite()` que el
 * exportador, asi que lo que sale aqui es lo que saldra en el video.
 *
 *   node tools/ver-marco.ts [grabaciones/vertical.vitrina] [--t=2000]
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { FrameIndex, buildCameraTrack, CAMERA_PRESETS } from '@vitrina/core';
import type { InputEvent, Manifest, Project } from '@vitrina/core';
import { composite, CursorSource, OverlaySource } from '@vitrina/renderer';

const flag = (n: string, d: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const dir = path.resolve(process.argv[2]?.startsWith('--') ? 'grabaciones/vertical.vitrina'
  : process.argv[2] ?? 'grabaciones/vertical.vitrina');
const tMs = Number(flag('t', '2000'));
const salida = path.resolve(flag('out', 'apps/desktop/marco.png'));

const leer = async <T>(f: string): Promise<T> =>
  JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')) as T;

const manifest = await leer<Manifest>('manifest.json');
const project = await leer<Project>('project.json');
const events = await leer<InputEvent[]>('events.json');
const source = manifest.capture ?? manifest.viewport;

const indice = new FrameIndex(manifest);
const fichero = indice.at(tMs);
if (!fichero) throw new Error(`No hay frame en t=${tMs}ms`);

const img = await loadImage(path.join(dir, 'frames', fichero));
const canvas = createCanvas(project.export.width, project.export.height);

const track = buildCameraTrack({
  segments: project.zooms, durationMs: manifest.durationMs, viewport: source,
  events, startedAt: manifest.startedAt, config: CAMERA_PRESETS.normal,
});
const cursor = new CursorSource(events, manifest.startedAt);
const overlay = new OverlaySource(events, manifest.startedAt);
const marca = project.watermark?.path
  ? await loadImage(path.join(dir, project.watermark.path)).catch(() => null)
  : null;

composite({
  ctx: canvas.getContext('2d') as never,
  source: img as never,
  sourceSize: source,
  camera: track.sampleAt(tMs),
  project,
  cursor: cursor.sample(tMs),
  overlay: overlay.sample(tMs),
  watermarkImage: marca as never,
});

await fsp.writeFile(salida, canvas.toBuffer('image/png'));
console.log(`\n  ${path.relative(process.cwd(), salida)}`);
console.log(`  fuente ${source.w}x${source.h}  salida ${project.export.width}x${project.export.height}`
  + `  marco ${project.frame.chrome}  fill ${project.frame.fill}\n`);
