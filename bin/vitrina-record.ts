#!/usr/bin/env node
/**
 * vitrina record - graba una demo de una app web.
 *
 *   node bin/vitrina-record.ts http://localhost:3000
 *   node bin/vitrina-record.ts http://localhost:5173 --preset=nitido --secs=30
 *
 * Deja una carpeta `<nombre>.vitrina` con los frames, el log de eventos, el
 * manifest y un project.json con los ajustes de composicion por defecto.
 */
import path from 'node:path';
import { Recorder } from '@vitrina/capture-cdp';
import {
  CAPTURE_PRESETS, computeQualityBudget, describeBudget, defaultProject, hostFromUrl,
} from '@vitrina/core';

const args = process.argv.slice(2);
const flag = (name: string, dflt = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const url = args.find((a) => !a.startsWith('--'));
if (!url) {
  console.error(`
vitrina record - graba una demo de una app web

  node bin/vitrina-record.ts <url> [opciones]

  --preset=<nombre>   ${CAPTURE_PRESETS.map((p) => p.name).join(' | ')}   (por defecto: equilibrado)
  --out=<ruta>        carpeta de salida (por defecto: ./grabaciones/<fecha>.vitrina)
  --secs=<n>          parar solo tras n segundos (por defecto: parar con Enter)
  --quality=<n>       calidad JPEG 1-100 (por defecto: 92; no afecta al rendimiento)
`);
  process.exit(1);
}

const presetName = flag('preset', 'equilibrado');
const preset = CAPTURE_PRESETS.find((p) => p.name === presetName);
if (!preset) {
  console.error(`Preset desconocido: ${presetName}. Opciones: ${CAPTURE_PRESETS.map((p) => p.name).join(', ')}`);
  process.exit(1);
}

const secs = Number(flag('secs', '0'));
const quality = Number(flag('quality', '92'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(flag('out', path.join('grabaciones', `${stamp}.vitrina`)));

async function main(): Promise<void> {
  const project = defaultProject({ host: hostFromUrl(url!) });
  const budget = computeQualityBudget(preset!.capture, project.export, project.frame);

  console.log('');
  console.log(`  url        ${url}`);
  console.log(`  preset     ${preset!.name}  ${preset!.capture.w}x${preset!.capture.h}  (~${preset!.measuredFps} fps medidos)`);
  console.log(`  salida     ${project.export.width}x${project.export.height} @ ${project.export.fps}fps`);
  console.log(`  calidad    ${describeBudget(budget)}`);
  console.log(`  carpeta    ${outDir}`);
  console.log('');

  const rec = new Recorder({
    url: url!,
    viewport: preset!.capture,
    quality,
    outDir,
    onProgress: ({ frames, elapsedMs }) => {
      if (frames % 15 !== 0) return;
      const fps = frames / Math.max(0.001, elapsedMs / 1000);
      process.stdout.write(
        `\r  grabando   ${(elapsedMs / 1000).toFixed(1)}s  ${frames} frames  ${fps.toFixed(0)} fps   `,
      );
    },
  });

  const browser = await rec.launch();
  console.log(`  navegador  ${browser.label}`);

  for (let i = 3; i > 0; i--) {
    process.stdout.write(`\r  empieza en ${i}...   `);
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write('\r                      \r');

  await rec.start();
  await waitForStop(secs);

  const result = await rec.stop();   // escribe manifest, events y project
  await rec.close();

  const { manifest } = result;
  const dur = manifest.durationMs / 1000;
  const clicks = result.events.filter((e) => e.type === 'down');
  const withRect = clicks.filter((e) => e.rect);

  console.log('\n');
  console.log(`  duracion   ${dur.toFixed(1)}s`);
  console.log(`  frames     ${manifest.frames.length}  (${(manifest.frames.length / dur).toFixed(1)} fps medios)`);
  console.log(`  eventos    ${result.events.length}  ·  ${clicks.length} clicks, ${withRect.length} con caja de elemento`);
  if (result.sizeMismatches > 0) {
    console.log(`  AVISO      ${result.sizeMismatches} frames con tamano inesperado: el margen de zoom puede no ser el calculado`);
  }
  console.log(`\n  guardado en ${outDir}\n`);
}

/** Para con Enter, o sola si se paso --secs. */
function waitForStop(seconds: number): Promise<void> {
  if (seconds > 0) return new Promise((r) => setTimeout(r, seconds * 1000));
  console.log('  (pulsa Enter para parar)');
  return new Promise((resolve) => {
    const onData = () => {
      process.stdin.off('data', onData);
      process.stdin.pause();
      resolve();
    };
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

main().catch((e: unknown) => {
  console.error('\nFALLO:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
