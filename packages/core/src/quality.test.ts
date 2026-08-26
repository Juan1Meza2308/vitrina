import { describe, it, expect } from 'vitest';
import {
  computeQualityBudget, describeBudget, clampZoom, pickPreset, CAPTURE_PRESETS,
} from './quality.ts';

const EXPORT_720 = { width: 1280, height: 720 };

describe('computeQualityBudget', () => {
  it('la configuracion fijada del proyecto da 1.56x de margen', () => {
    // 1600x900 -> 720p con la ventana al 80% del lienzo.
    const b = computeQualityBudget({ w: 1600, h: 900 }, EXPORT_720, { fill: 0.8 });
    expect(b.windowPx).toBe(1024);
    expect(b.maxSharpZoom).toBeCloseTo(1.5625, 4);
    expect(b.sharpAtRest).toBe(true);
  });

  it('menos padding = menos margen de zoom', () => {
    // Es la relacion que la UI tiene que hacer visible: apretar el marco
    // contra los bordes se paga en nitidez al ampliar.
    const holgado = computeQualityBudget({ w: 1600, h: 900 }, EXPORT_720, { fill: 0.7 });
    const apretado = computeQualityBudget({ w: 1600, h: 900 }, EXPORT_720, { fill: 1.0 });
    expect(holgado.maxSharpZoom).toBeGreaterThan(apretado.maxSharpZoom);
    expect(apretado.maxSharpZoom).toBeCloseTo(1.25, 4);
  });

  it('detecta el caso sin margen: captura igual que la ventana mostrada', () => {
    const b = computeQualityBudget({ w: 1280, h: 720 }, EXPORT_720, { fill: 1.0 });
    expect(b.maxSharpZoom).toBe(1);
    expect(b.sharpAtRest).toBe(true);
  });

  it('detecta que ya se amplia en reposo', () => {
    // Capturar 1280 y exportar a 1080p con marco al 90%: upscale antes de
    // cualquier zoom. La UI debe decirlo, no callarlo.
    const b = computeQualityBudget({ w: 1280, h: 720 }, { width: 1920, height: 1080 }, { fill: 0.9 });
    expect(b.sharpAtRest).toBe(false);
    expect(describeBudget(b)).toContain('sin margen');
  });

  it('fill fuera de rango se recorta en vez de dar infinito', () => {
    const b = computeQualityBudget({ w: 1600, h: 900 }, EXPORT_720, { fill: 0 });
    expect(Number.isFinite(b.maxSharpZoom)).toBe(true);
  });
});

describe('clampZoom', () => {
  const budget = computeQualityBudget({ w: 1600, h: 900 }, EXPORT_720, { fill: 0.8 });

  it('deja pasar lo que cabe en el margen', () => {
    expect(clampZoom(1.4, budget, false)).toEqual({ scale: 1.4, clamped: false });
  });

  it('recorta lo que se pasa y lo senala', () => {
    const r = clampZoom(2.5, budget, false);
    expect(r.clamped).toBe(true);
    expect(r.scale).toBeCloseTo(1.5625, 4);
  });

  it('permite pasarse cuando se acepta explicitamente perder nitidez', () => {
    expect(clampZoom(2.5, budget, true)).toEqual({ scale: 2.5, clamped: false });
  });
});

/**
 * Presets de laboratorio, fijos a proposito.
 *
 * Los reales los reescribe `npm run calibrar` en cada maquina, asi que afirmar
 * sobre ellos seria comprobar el hardware del que ejecuta los tests.
 */
const BANCO = [
  { name: 'fluido', capture: { w: 1280, h: 720 }, measuredFps: 99, p95DeltaMs: 13.5 },
  { name: 'medio', capture: { w: 1600, h: 900 }, measuredFps: 67, p95DeltaMs: 30.4 },
  { name: 'nitido', capture: { w: 1920, h: 1080 }, measuredFps: 45, p95DeltaMs: 51.1 },
  { name: 'maximo', capture: { w: 2560, h: 1440 }, measuredFps: 35, p95DeltaMs: 76.6 },
];

describe('pickPreset', () => {
  it('a 60fps elige el mas nitido que aguanta ese ritmo', () => {
    expect(pickPreset(60, BANCO).capture).toEqual({ w: 1600, h: 900 });
  });

  it('bajando a 30fps se permite subir de resolucion', () => {
    expect(pickPreset(30, BANCO).capture).toEqual({ w: 1920, h: 1080 });
  });

  it('descarta un preset cuya mediana pasa pero cuyo p95 da tirones', () => {
    // 35 fps > 30, pero un p95 de 76.6 ms es un hueco de 2.3 frames a 30 fps.
    // Es exactamente el caso que la seleccion por mediana dejaba pasar.
    expect(pickPreset(30, BANCO).capture).not.toEqual({ w: 2560, h: 1440 });
  });

  it('si se piden fps imposibles cae al mas fluido en vez de romper', () => {
    expect(pickPreset(500, BANCO)).toBe(BANCO[0]);
  });

  it('los presets que se envian son utilizables', () => {
    // Sobre los datos reales solo se afirma lo que debe valer en cualquier
    // maquina: que hay presets y que la seleccion devuelve uno de ellos.
    expect(CAPTURE_PRESETS.length).toBeGreaterThan(0);
    expect(CAPTURE_PRESETS).toContain(pickPreset(60));
  });
});
