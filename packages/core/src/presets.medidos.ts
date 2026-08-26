/**
 * Rendimiento de captura MEDIDO, no estimado.
 *
 * GENERADO por `npm run calibrar`. No editar a mano: vuelve a medir.
 *
 * El techo de captura depende de la maquina, asi que unos numeros prestados
 * eligen mal el preset — o prometen fps que no llegan, o se quedan cortos en un
 * equipo que daba para mas.
 */
import type { CapturePreset } from './quality.ts';

/** De donde salen los numeros de abajo. Se muestra en la app. */
export const MEDIDO_EN = 'Intel(R) Core(TM) i5-7500 CPU @ 3.40GHz · win32';

export const PRESETS_MEDIDOS: CapturePreset[] = [
  { name: 'fluido', capture: { w: 1280, h: 720 }, measuredFps: 99, p95DeltaMs: 11 },
  { name: 'equilibrado', capture: { w: 1600, h: 900 }, measuredFps: 99, p95DeltaMs: 20.5 },
  { name: 'nitido', capture: { w: 1920, h: 1080 }, measuredFps: 62, p95DeltaMs: 33.6 },
  { name: 'maximo', capture: { w: 2560, h: 1440 }, measuredFps: 41, p95DeltaMs: 52.3 },
];
