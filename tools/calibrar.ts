/**
 * Mide el rendimiento de captura de ESTA maquina y reescribe los presets.
 *
 *   node tools/calibrar.ts [--secs=8]
 *
 * Los presets de serie estan medidos en un i5-7500 con HD 630. En una maquina
 * mas rapida son muy conservadores: `pickPreset(60)` elegiria 1600x900 cuando
 * el equipo daria de sobra para 2560x1440. Y al reves, en una mas lenta
 * prometerian fps que no llegan.
 *
 * Se usa la clase `Recorder` de produccion, no un spike aparte: si la captura
 * cambia, la calibracion cambia con ella. Medir con otro codigo del que graba
 * es medir otra cosa.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Recorder } from '@vitrina/capture-cdp';
import type { CaptureSize, Frame } from '@vitrina/core';

const RESOLUCIONES: { name: string; capture: CaptureSize }[] = [
  { name: 'fluido', capture: { w: 1280, h: 720 } },
  { name: 'equilibrado', capture: { w: 1600, h: 900 } },
  { name: 'nitido', capture: { w: 1920, h: 1080 } },
  { name: 'maximo', capture: { w: 2560, h: 1440 } },
];

const flag = (n: string, d: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const SECS = Number(flag('secs', '8'));
const DESTINO = path.resolve('packages/core/src/presets.medidos.ts');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Medida {
  name: string;
  capture: CaptureSize;
  measuredFps: number;
  p95DeltaMs: number;
}

/**
 * fps mediano y p95 del hueco entre frames.
 *
 * Se usa la mediana y NO la media porque un tramo estatico —donde el screencast
 * legitimamente no emite— hundiria la media sin que nada vaya mal. Y el p95
 * porque la mediana sola miente: puede dar 35 fps con huecos de 76 ms que se
 * ven como tirones.
 */
function medir(frames: Frame[], startedAt: number): { fps: number; p95: number } {
  if (frames.length < 3) return { fps: 0, p95: 9999 };

  const ordenados = [...frames].sort((a, b) => a.t - b.t);
  const deltas: number[] = [];
  for (let i = 1; i < ordenados.length; i++) {
    deltas.push((ordenados[i]!.t - ordenados[i - 1]!.t) * 1000);
  }
  deltas.sort((a, b) => a - b);

  const p50 = deltas[Math.floor(deltas.length * 0.5)] ?? 0;
  const p95 = deltas[Math.floor(deltas.length * 0.95)] ?? 0;
  void startedAt;
  return { fps: p50 > 0 ? Math.round(1000 / p50) : 0, p95: Number(p95.toFixed(1)) };
}

async function main(): Promise<void> {
  const fixture = pathToFileURL(path.resolve('spikes/stress.html')).href;
  console.log(`\n  calibrando en ${os.cpus()[0]?.model.trim() ?? 'esta maquina'}`);
  console.log(`  ${SECS}s por resolucion sobre el fixture de estres\n`);

  const medidas: Medida[] = [];
  for (const r of RESOLUCIONES) {
    const salida = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-cal-'));
    const rec = new Recorder({
      url: fixture, viewport: r.capture, quality: 92, outDir: salida, port: 9411,
    });
    try {
      await rec.launch();
      await rec.start();
      await sleep(SECS * 1000);
      const { manifest } = await rec.stop();
      const m = medir(manifest.frames, manifest.startedAt);
      medidas.push({ name: r.name, capture: r.capture, measuredFps: m.fps, p95DeltaMs: m.p95 });
      console.log(`  ${r.name.padEnd(12)} ${r.capture.w}x${r.capture.h}`
        + `   ${String(m.fps).padStart(3)} fps   p95 ${m.p95.toFixed(1)}ms`);
    } finally {
      await rec.close().catch(() => {});
      await fsp.rm(salida, { recursive: true, force: true }).catch(() => {});
    }
    await sleep(700);
  }

  const maquina = `${os.cpus()[0]?.model.trim() ?? 'desconocida'} · ${process.platform}`;
  await fsp.writeFile(DESTINO, plantilla(maquina, medidas));
  console.log(`\n  escrito en ${path.relative(process.cwd(), DESTINO)}`);
  console.log('  Revisa el diff: si algun numero salio en 0, la captura fallo en esa resolucion.\n');
}

function plantilla(maquina: string, medidas: Medida[]): string {
  const filas = medidas.map((m) =>
    `  { name: '${m.name}', capture: { w: ${m.capture.w}, h: ${m.capture.h} },`
    + ` measuredFps: ${m.measuredFps}, p95DeltaMs: ${m.p95DeltaMs} },`).join('\n');

  return `/**
 * Rendimiento de captura MEDIDO, no estimado.
 *
 * GENERADO por \`npm run calibrar\`. No editar a mano: vuelve a medir.
 *
 * El techo de captura depende de la maquina, asi que unos numeros prestados
 * eligen mal el preset — o prometen fps que no llegan, o se quedan cortos en un
 * equipo que daba para mas.
 */
import type { CapturePreset } from './quality.ts';

/** De donde salen los numeros de abajo. Se muestra en la app. */
export const MEDIDO_EN = '${maquina.replace(/'/g, "\\'")}';

export const PRESETS_MEDIDOS: CapturePreset[] = [
${filas}
];
`;
}

main().catch((e: unknown) => {
  console.error('\nFALLO:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
