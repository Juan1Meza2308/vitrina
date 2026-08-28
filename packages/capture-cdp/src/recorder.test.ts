/**
 * Tests de la parte pura del grabador. Lo demas vive en
 * `recorder.integration.test.ts`, que lanza un navegador de verdad.
 */
import { describe, it, expect } from 'vitest';
import { ventanaPara } from './recorder.ts';

describe('ventanaPara', () => {
  const HUECO = { width: 1280, height: 780 };

  it('conserva la forma del viewport', () => {
    const v = ventanaPara({ w: 1080, h: 1920 }, HUECO);
    expect(v.width / v.height).toBeCloseTo(1080 / 1920, 2);
  });

  it('cabe en el hueco disponible', () => {
    for (const vp of [{ w: 1920, h: 1080 }, { w: 1080, h: 1920 }, { w: 1080, h: 1080 }]) {
      const v = ventanaPara(vp, HUECO);
      expect(v.width).toBeLessThanOrEqual(HUECO.width);
      expect(v.height).toBeLessThanOrEqual(HUECO.height);
    }
  });

  it('un viewport vertical da una ventana vertical, no una apaisada', () => {
    // Es el fallo que se quiere evitar: dentro de una ventana apaisada, un
    // viewport 9:16 se encoge hasta una tira y la demo se hace a ciegas.
    const v = ventanaPara({ w: 1080, h: 1920 }, HUECO);
    expect(v.height).toBeGreaterThan(v.width);
  });

  it('no amplia un viewport que ya cabe', () => {
    expect(ventanaPara({ w: 800, h: 600 }, HUECO)).toEqual({ width: 800, height: 600 });
  });

  it('en una pantalla baja encoge por el alto', () => {
    const v = ventanaPara({ w: 1600, h: 900 }, { width: 1920, height: 500 });
    expect(v.height).toBeLessThanOrEqual(500);
    expect(v.width / v.height).toBeCloseTo(1600 / 900, 2);
  });
});
