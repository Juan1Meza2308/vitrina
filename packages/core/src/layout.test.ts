import { describe, it, expect } from 'vitest';
import { layoutFrame } from './layout.ts';
import { computeQualityBudget } from './quality.ts';

const SOURCE = { w: 1600, h: 900 };
const EXPORT = { width: 1280, height: 720 };

describe('layoutFrame', () => {
  it('centra la ventana en el lienzo', () => {
    const l = layoutFrame(SOURCE, EXPORT, { fill: 0.8 });
    expect(l.window.x).toBeCloseTo((1280 - l.window.w) / 2, 6);
    expect(l.window.y).toBeCloseTo((720 - l.window.h) / 2, 6);
  });

  it('conserva la proporcion del material', () => {
    // Deformar el contenido para encajarlo seria el peor fallo posible aqui.
    const l = layoutFrame(SOURCE, EXPORT, { fill: 0.8 });
    expect(l.content.w / l.content.h).toBeCloseTo(SOURCE.w / SOURCE.h, 6);
  });

  it('la barra de navegador anade alto y desplaza el contenido', () => {
    const sin = layoutFrame(SOURCE, EXPORT, { fill: 0.8, chrome: 'none' });
    const con = layoutFrame(SOURCE, EXPORT, { fill: 0.8, chrome: 'macos' });
    expect(con.barH).toBeGreaterThan(0);
    expect(con.window.h).toBeCloseTo(sin.window.h + con.barH, 6);
    expect(con.content.y).toBeCloseTo(con.window.y + con.barH, 6);
    expect(con.content.w).toBeCloseTo(sin.content.w, 6);
  });

  it('con fill 1 y misma proporcion ocupa el lienzo exacto', () => {
    const l = layoutFrame(SOURCE, EXPORT, { fill: 1, chrome: 'none' });
    expect(l.content.w).toBeCloseTo(1280, 6);
    expect(l.content.h).toBeCloseTo(720, 6);
  });

  it('encoge el ancho cuando el alto no cabe', () => {
    // Material vertical: con fill 1 el alto se saldria del lienzo.
    const l = layoutFrame({ w: 900, h: 1600 }, EXPORT, { fill: 1, chrome: 'none' });
    expect(l.window.h).toBeLessThanOrEqual(720 + 1e-6);
    expect(l.content.w).toBeLessThan(1280);
    expect(l.content.w / l.content.h).toBeCloseTo(900 / 1600, 6);
  });

  it('la barra tambien cuenta para el limite de alto', () => {
    const l = layoutFrame(SOURCE, EXPORT, { fill: 1, chrome: 'macos' });
    expect(l.window.h).toBeLessThanOrEqual(720 + 1e-6);
  });

  it('recorta el radio para que no exceda la mitad del lado menor', () => {
    const l = layoutFrame(SOURCE, EXPORT, { fill: 0.8, radius: 9999 });
    expect(l.radius).toBeLessThanOrEqual(Math.min(l.window.w, l.window.h) / 2 + 1e-6);
  });
});

describe('layout y presupuesto de calidad no divergen', () => {
  it('el margen de zoom se calcula sobre el ancho realmente dibujado', () => {
    const frame = { fill: 0.8, chrome: 'macos' as const };
    const l = layoutFrame(SOURCE, EXPORT, frame);
    const b = computeQualityBudget(SOURCE, EXPORT, frame);
    expect(b.windowPx).toBeCloseTo(l.content.w, 6);
    expect(b.maxSharpZoom).toBeCloseTo(SOURCE.w / l.content.w, 6);
  });

  it('si el alto obliga a encoger, el margen sube en consecuencia', () => {
    // Una ventana mas estrecha muestra el material a menos px, asi que hay MAS
    // margen de zoom. Si el presupuesto no lo reflejara, estaria mintiendo.
    const frame = { fill: 1, chrome: 'macos' as const };
    const b = computeQualityBudget({ w: 900, h: 1600 }, EXPORT, frame);
    const l = layoutFrame({ w: 900, h: 1600 }, EXPORT, frame);
    expect(b.windowPx).toBeCloseTo(l.content.w, 6);
    expect(b.maxSharpZoom).toBeGreaterThan(1);
  });
});
