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

describe('layoutFrame con marco de movil', () => {
  // Material y salida verticales: el caso real de una grabacion 9:16.
  const V = { w: 1080, h: 1920 };
  const SALIDA_V = { width: 1080, height: 1920 };

  it('deja bisel por los cuatro lados', () => {
    const l = layoutFrame(V, SALIDA_V, { fill: 0.8, chrome: 'phone' });
    expect(l.insets.top).toBeGreaterThan(0);
    expect(l.insets.bottom).toBeGreaterThan(0);
    expect(l.insets.left).toBeGreaterThan(0);
    expect(l.insets.right).toBeGreaterThan(0);
    // El contenido queda dentro del cuerpo por todos los lados.
    expect(l.content.x).toBeGreaterThan(l.window.x);
    expect(l.content.y).toBeGreaterThan(l.window.y);
    expect(l.content.x + l.content.w).toBeLessThan(l.window.x + l.window.w);
    expect(l.content.y + l.content.h).toBeLessThan(l.window.y + l.window.h);
  });

  it('no deforma el material ni se sale del lienzo', () => {
    const l = layoutFrame(V, SALIDA_V, { fill: 0.8, chrome: 'phone' });
    expect(l.content.w / l.content.h).toBeCloseTo(V.w / V.h, 6);
    expect(l.window.x).toBeGreaterThanOrEqual(-1e-6);
    expect(l.window.y).toBeGreaterThanOrEqual(-1e-6);
    expect(l.window.x + l.window.w).toBeLessThanOrEqual(1080 + 1e-6);
    expect(l.window.y + l.window.h).toBeLessThanOrEqual(1920 + 1e-6);
  });

  it('sigue centrado', () => {
    const l = layoutFrame(V, SALIDA_V, { fill: 0.8, chrome: 'phone' });
    expect(l.window.x).toBeCloseTo((1080 - l.window.w) / 2, 6);
    expect(l.window.y).toBeCloseTo((1920 - l.window.h) / 2, 6);
  });

  it('el bisel come ancho util y el presupuesto de calidad lo refleja', () => {
    // Si el presupuesto no bajara con el bisel, la UI prometeria un margen de
    // zoom que el compositor no puede dar: dibuja en menos px de los contados.
    const sin = computeQualityBudget(V, SALIDA_V, { fill: 0.8, chrome: 'none' });
    const con = computeQualityBudget(V, SALIDA_V, { fill: 0.8, chrome: 'phone' });
    expect(con.windowPx).toBeLessThan(sin.windowPx);
    expect(con.maxSharpZoom).toBeGreaterThan(sin.maxSharpZoom);
  });

  it('redondea la pantalla por dentro de la carcasa', () => {
    const l = layoutFrame(V, SALIDA_V, { fill: 0.8, chrome: 'phone' });
    expect(l.contentRadius).toBeGreaterThan(0);
    expect(l.contentRadius).toBeLessThan(l.radius);
  });

  it('el radio no depende de que el proyecto pida uno pequeno', () => {
    // Un movil con esquinas de 14 px no se lee como un movil.
    const l = layoutFrame(V, SALIDA_V, { fill: 0.8, radius: 14, chrome: 'phone' });
    expect(l.radius).toBeGreaterThan(40);
  });

  it('con barra de navegador no hay redondeo interior que pagar', () => {
    const l = layoutFrame(SOURCE, EXPORT, { fill: 0.8, chrome: 'macos' });
    expect(l.contentRadius).toBe(0);
    expect(l.insets.left).toBe(0);
    expect(l.insets.right).toBe(0);
    expect(l.insets.bottom).toBe(0);
  });
});

describe('layoutFrame en cualquier combinacion', () => {
  // El ajuste al alto es iterativo: los insets dependen del ancho y el ancho
  // del alto disponible. Con un numero fijo de pasadas hay que demostrar que
  // converge, y no comprobarlo solo en el caso que se tuvo delante al
  // escribirlo. Un desborde aqui saca la ventana del lienzo y se ve recortada.
  const fuentes = [
    { w: 1600, h: 900 }, { w: 1080, h: 1920 }, { w: 1080, h: 1080 },
    { w: 400, h: 2000 }, { w: 2000, h: 400 },
  ];
  const salidas = [
    { width: 1280, height: 720 }, { width: 1080, height: 1920 },
    { width: 1080, height: 1080 }, { width: 180, height: 320 },
  ];
  const chromes = ['none', 'macos', 'windows', 'phone'] as const;

  it('la ventana nunca se sale del lienzo ni deforma el material', () => {
    for (const s of fuentes) {
      for (const o of salidas) {
        for (const c of chromes) {
          for (const fill of [0.05, 0.4, 0.8, 1]) {
            const l = layoutFrame(s, o, { fill, radius: 14, chrome: c });
            const caso = `${s.w}x${s.h} -> ${o.width}x${o.height} ${c} fill ${fill}`;
            expect(l.window.x, caso).toBeGreaterThanOrEqual(-1e-6);
            expect(l.window.y, caso).toBeGreaterThanOrEqual(-1e-6);
            expect(l.window.x + l.window.w, caso).toBeLessThanOrEqual(o.width + 1e-6);
            expect(l.window.y + l.window.h, caso).toBeLessThanOrEqual(o.height + 1e-6);
            expect(l.content.w / l.content.h, caso).toBeCloseTo(s.w / s.h, 6);
          }
        }
      }
    }
  });
});
