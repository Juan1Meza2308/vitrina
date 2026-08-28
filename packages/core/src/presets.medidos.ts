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
  {
    name: 'fluido',
    css: { w: 960, h: 540 }, dsf: 1.5,
    capture: { w: 1440, h: 810 },
    measuredFps: 101, p95DeltaMs: 12.4,
  },
  {
    name: 'equilibrado',
    css: { w: 1152, h: 648 }, dsf: 1.5,
    capture: { w: 1728, h: 972 },
    measuredFps: 92, p95DeltaMs: 23.6,
  },
  {
    name: 'nitido',
    css: { w: 1280, h: 720 }, dsf: 1.5,
    capture: { w: 1920, h: 1080 },
    measuredFps: 61, p95DeltaMs: 32.8,
  },
  {
    name: 'maximo',
    css: { w: 1280, h: 720 }, dsf: 2,
    capture: { w: 2560, h: 1440 },
    measuredFps: 45, p95DeltaMs: 55.5,
  },
];
