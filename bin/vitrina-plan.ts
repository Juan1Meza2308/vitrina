#!/usr/bin/env node
/**
 * vitrina plan - calcula el zoom automatico de una grabacion.
 *
 *   node bin/vitrina-plan.ts grabaciones/demo.vitrina
 *   node bin/vitrina-plan.ts grabaciones/demo.vitrina --preset=marcado --dry
 *
 * Escribe los tramos en `project.json` y dibuja la curva de la camara en la
 * terminal. Ver la curva antes de tener compositor evita perseguir un problema
 * de encuadre creyendo que es un problema de render.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  planSegments, buildCameraTrack, computeQualityBudget, describeBudget,
  cameraConfigForBudget, CAMERA_PRESETS,
} from '@vitrina/core';
import type { CameraPresetName, InputEvent, Manifest, Project } from '@vitrina/core';

const args = process.argv.slice(2);
const flag = (n: string, d = '') => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const dir = args.find((a) => !a.startsWith('--'));

if (!dir) {
  console.error(`
vitrina plan - calcula el zoom automatico de una grabacion

  node bin/vitrina-plan.ts <carpeta.vitrina> [opciones]

  --preset=<nombre>   sutil | normal | marcado   (por defecto: normal)
  --soft              permite ampliar mas alla del margen nitido
  --dry               no escribe project.json, solo muestra el resultado
`);
  process.exit(1);
}

const presetName = (flag('preset', 'normal') as CameraPresetName);
if (!CAMERA_PRESETS[presetName]) {
  console.error(`Preset desconocido: ${presetName}. Opciones: ${Object.keys(CAMERA_PRESETS).join(', ')}`);
  process.exit(1);
}
const allowSoft = args.includes('--soft');
const dry = args.includes('--dry');

const readJson = async <T,>(p: string): Promise<T> =>
  JSON.parse(await fsp.readFile(p, 'utf8')) as T;

async function main(): Promise<void> {
  const root = path.resolve(dir!);
  const manifest = await readJson<Manifest>(path.join(root, 'manifest.json'));
  const events = await readJson<InputEvent[]>(path.join(root, 'events.json'));
  const project = await readJson<Project>(path.join(root, 'project.json'));

  const capture = manifest.capture ?? manifest.viewport;
  const budget = computeQualityBudget(capture, project.export, project.frame);
  const config = cameraConfigForBudget(CAMERA_PRESETS[presetName], budget.maxSharpZoom, allowSoft);

  const segments = planSegments({
    events, viewport: capture, startedAt: manifest.startedAt,
    durationMs: manifest.durationMs, config,
  });
  const track = buildCameraTrack({
    events, segments, viewport: capture, startedAt: manifest.startedAt,
    durationMs: manifest.durationMs, config,
  });

  const clicks = events.filter((e) => e.type === 'down').length;
  console.log('');
  console.log(`  material   ${capture.w}x${capture.h} · ${(manifest.durationMs / 1000).toFixed(1)}s · ${manifest.frames.length} frames`);
  console.log(`  entrada    ${events.length} eventos, ${clicks} clicks`);
  console.log(`  calidad    ${describeBudget(budget)}${allowSoft ? '  (--soft: se permite pasarse)' : ''}`);
  console.log(`  preset     ${presetName}  ·  ampliacion maxima ${config.maxScale.toFixed(2)}x`);
  console.log('');

  if (segments.length === 0) {
    console.log('  Sin tramos de zoom. Causas habituales:');
    console.log('    · no hubo clicks durante la grabacion');
    console.log('    · los elementos pulsados ocupan casi toda la pantalla');
    console.log(`    · todos los tramos duraban menos de ${config.minDurationMs}ms\n`);
  } else {
    console.log(`  ${segments.length} tramos\n`);
    console.log('    #   inicio     fin    dur   zoom   elemento');
    console.log('    ─────────────────────────────────────────────────────');
    segments.forEach((s, i) => {
      const dur = (s.endMs - s.startMs) / 1000;
      console.log(
        `    ${String(i + 1).padStart(2)}  ${fmt(s.startMs)}  ${fmt(s.endMs)}  ${dur.toFixed(1)}s  ${s.scale.toFixed(2)}x   ${s.label ?? '—'}`,
      );
    });
    console.log('');
  }

  drawTrack(track, manifest.durationMs, config.maxScale);

  if (!dry) {
    const updated: Project = { ...project, zooms: segments };
    await fsp.writeFile(path.join(root, 'project.json'), JSON.stringify(updated, null, 2));
    console.log(`  escrito en ${path.join(dir!, 'project.json')}\n`);
  }
}

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`.padStart(6);

/**
 * Dibuja la escala a lo largo del tiempo. Un zoom sano sube rapido, se mantiene
 * plano y baja; sierra continua significa yo-yo, y escalones significan que el
 * muelle no llega a asentarse antes del siguiente tramo.
 */
function drawTrack(
  track: { sampleAt(t: number): { scale: number } },
  durationMs: number,
  maxScale: number,
): void {
  const COLS = 78;
  const ROWS = 8;
  const blocks = ' ▁▂▃▄▅▆▇█';

  const top = Math.max(maxScale, 1.05);
  const samples: number[] = [];
  for (let c = 0; c < COLS; c++) {
    samples.push(track.sampleAt((c / (COLS - 1)) * durationMs).scale);
  }

  console.log(`  curva de la camara   1.00x ─ ${top.toFixed(2)}x`);
  console.log('  ┌' + '─'.repeat(COLS) + '┐');
  for (let r = ROWS - 1; r >= 0; r--) {
    let line = '  │';
    for (const s of samples) {
      const norm = (s - 1) / (top - 1);            // 0 en reposo, 1 al maximo
      const level = norm * ROWS - r;
      const idx = Math.max(0, Math.min(blocks.length - 1, Math.round(level * (blocks.length - 1))));
      line += blocks[idx];
    }
    console.log(line + '│');
  }
  console.log('  └' + '─'.repeat(COLS) + '┘');
  console.log(`   0s${' '.repeat(COLS - 10)}${(durationMs / 1000).toFixed(1)}s\n`);
}

main().catch((e: unknown) => {
  console.error('\nFALLO:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
