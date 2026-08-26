#!/usr/bin/env node
/**
 * vitrina export - compone y codifica una grabacion.
 *
 *   node bin/vitrina-export.ts grabaciones/demo.vitrina
 *   node bin/vitrina-export.ts grabaciones/demo.vitrina --preset=vertical
 *   node bin/vitrina-export.ts grabaciones/demo.vitrina --preset=gif --out=demo.gif
 *
 * Ctrl+C cancela y borra el fichero a medias.
 */
import { exportRecording, EXPORT_PRESETS, ExportAbortedError } from '@vitrina/export';
import type { CameraPresetName } from '@vitrina/core';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const flag = (n: string, d = '') => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

if (!dir) {
  const lista = Object.values(EXPORT_PRESETS)
    .map((p) => `    ${p.name.padEnd(10)} ${p.width}x${p.height} @${p.fps} ${p.format.padEnd(5)} ${p.nota}`)
    .join('\n');
  console.error(`
vitrina export - compone y codifica una grabacion

  node bin/vitrina-export.ts <carpeta.vitrina> [opciones]

  --preset=<nombre>   preset de salida (por defecto: 720p)
${lista}

  --out=<ruta>        fichero de salida
  --camara=<nombre>   sutil | normal | marcado   (por defecto: normal)
  --soft              permite ampliar mas alla del margen nitido
`);
  process.exit(1);
}

const controller = new AbortController();
process.on('SIGINT', () => {
  process.stdout.write('\n  cancelando...\n');
  controller.abort();
});

const fmtMs = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};

async function main(): Promise<void> {
  const presetName = flag('preset', '720p');
  const preset = EXPORT_PRESETS[presetName as keyof typeof EXPORT_PRESETS];
  if (!preset) {
    console.error(`Preset desconocido: ${presetName}. Opciones: ${Object.keys(EXPORT_PRESETS).join(', ')}`);
    process.exit(1);
  }

  console.log('');
  console.log(`  preset     ${preset.name}  ${preset.width}x${preset.height} @${preset.fps}fps  ${preset.format}`);

  const result = await exportRecording({
    recordingDir: dir!,
    preset: presetName,
    outFile: flag('out') || undefined,
    cameraPreset: (flag('camara', 'normal') as CameraPresetName),
    allowSoftZoom: args.includes('--soft'),
    signal: controller.signal,
    onProgress: (p) => {
      const barra = '█'.repeat(Math.round(p.fraction * 28)).padEnd(28, '·');
      process.stdout.write(
        `\r  ${barra} ${(p.fraction * 100).toFixed(0).padStart(3)}%  `
        + `${p.fps.toFixed(0)} fps  faltan ${fmtMs(p.etaMs)}   `,
      );
    },
  });

  process.stdout.write('\r' + ' '.repeat(70) + '\r');
  console.log(`  calidad    zoom nitido hasta ${result.budget.maxSharpZoom.toFixed(2)}x`);
  console.log(`  render     ${result.frames} frames en ${fmtMs(result.elapsedMs)} (${(result.frames / (result.elapsedMs / 1000)).toFixed(1)} fps)`);
  console.log(`  salida     ${(result.bytes / 1024 / 1024).toFixed(1)} MB · ${(result.durationMs / 1000).toFixed(1)}s`);

  for (const w of result.warnings) console.log(`\n  AVISO      ${w}`);
  console.log(`\n  ${result.file}\n`);
}

main().catch((e: unknown) => {
  if (e instanceof ExportAbortedError) {
    console.log('  exportacion cancelada, sin fichero a medias\n');
    process.exit(130);
  }
  console.error('\nFALLO:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
