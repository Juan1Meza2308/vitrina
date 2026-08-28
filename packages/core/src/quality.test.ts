import { describe, it, expect } from 'vitest';
import { defaultExportFor, defaultProject } from './project.ts';
import {
  computeQualityBudget, describeBudget, clampZoom, pickPreset, CAPTURE_PRESETS, paraOrientacion } from './quality.ts';

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

describe('paraOrientacion', () => {
  const P = { name: 'x', capture: { w: 1920, h: 1080 }, measuredFps: 60, p95DeltaMs: 20 };
  // Escalones fijos: probar la REGLA, no la lista vigente. Con la de verdad los
  // tests afirmarian una eleccion de producto que puede cambiar.
  const BANCO = [
    { css: { w: 390, h: 844 }, dsf: 2 },
    { css: { w: 430, h: 932 }, dsf: 3 },
  ];

  it('en vertical emula un viewport de movil de verdad', () => {
    // Es la razon de todo esto: por debajo del punto de ruptura tipico, la web
    // muestra su diseno movil. Un viewport de 800 o 900 px no lo consigue.
    const v = paraOrientacion(P, 'vertical', BANCO);
    expect(v.css).toBeDefined();
    expect(v.css!.w).toBeLessThanOrEqual(430);
  });

  it('la resolucion sale de la escala, no del ancho CSS', () => {
    const v = paraOrientacion(P, 'vertical', BANCO);
    expect(v.capture.w).toBe(Math.round(v.css!.w * v.dsf!));
    expect(v.capture.h).toBe(Math.round(v.css!.h * v.dsf!));
    // Y da resolucion de publicar pese al viewport pequeno.
    expect(v.capture.w).toBeGreaterThanOrEqual(720);
  });

  it('el escalon sigue a la posicion del preset en la escalera', () => {
    const primero = paraOrientacion({ ...P, name: 'fluido' }, 'vertical', BANCO);
    const ultimo = paraOrientacion({ ...P, name: 'maximo' }, 'vertical', BANCO);
    expect(primero.capture.w).toBeLessThan(ultimo.capture.w);
  });

  it('proporcion de movil, no 9:16', () => {
    // Girar el preset apaisado daba 16:9 de alto y el marco salia rechoncho:
    // 0.57 de proporcion frente al 0.47 de un telefono real.
    const v = paraOrientacion(P, 'vertical', BANCO);
    expect(v.capture.w / v.capture.h).toBeLessThan(0.5);
    expect(v.capture.h).toBeGreaterThan(v.capture.w);
  });

  it('conserva los fps medidos y el nombre', () => {
    const v = paraOrientacion(P, 'vertical', BANCO);
    expect(v.measuredFps).toBe(P.measuredFps);
    expect(v.p95DeltaMs).toBe(P.p95DeltaMs);
    expect(v.name).toBe(P.name);
  });

  it('no toca el preset si ya esta en esa orientacion', () => {
    expect(paraOrientacion(P, 'horizontal', BANCO)).toBe(P);
  });

  it('un preset cuadrado cuenta como horizontal y no se toca', () => {
    const c = { ...P, capture: { w: 1080, h: 1080 } };
    expect(paraOrientacion(c, 'horizontal', BANCO)).toBe(c);
  });
});

describe('defaultExportFor', () => {
  it('sigue la forma de la captura', () => {
    expect(defaultExportFor({ w: 1600, h: 900 })).toEqual({ w: 1280, h: 720 });
    expect(defaultExportFor({ w: 1080, h: 1920 })).toEqual({ w: 1080, h: 1920 });
  });

  it('la salida vertical no deja bandas: misma forma que la fuente', () => {
    const cap = { w: 1080, h: 1920 };
    const out = defaultExportFor(cap);
    expect(out.w / out.h).toBeCloseTo(cap.w / cap.h, 6);
  });

  it('deja margen de zoom real en todas las capturas de movil', () => {
    // Es la razon de ser de la regla: sin margen la camara no se mueve, y el
    // zoom automatico es el sentido de la herramienta.
    for (const cap of [{ w: 780, h: 1688 }, { w: 860, h: 1864 },
                       { w: 1075, h: 2330 }, { w: 1290, h: 2796 }]) {
      const o = defaultExportFor(cap);
      const b = computeQualityBudget(cap, { width: o.w, height: o.h },
        { fill: 0.8, chrome: 'phone' });
      expect(b.sharpAtRest, `${cap.w}x${cap.h}`).toBe(true);
      expect(b.maxSharpZoom, `${cap.w}x${cap.h}`).toBeGreaterThan(1.15);
    }
  });

  it('elige el vertical mas grande que conserve el margen', () => {
    // Con 1290 de ancho cabe el lienzo grande; con 860 no, y baja al pequeno en
    // vez de entregar un 1080x1920 blando.
    expect(defaultExportFor({ w: 1290, h: 2796 })).toEqual({ w: 1080, h: 1920 });
    expect(defaultExportFor({ w: 860, h: 1864 })).toEqual({ w: 720, h: 1280 });
    // Por debajo del mas pequeno se queda en el mas pequeno: encogerlo sin
    // limite daria salidas ridiculas.
    expect(defaultExportFor({ w: 400, h: 866 })).toEqual({ w: 720, h: 1280 });
  });
});

describe('defaultProject segun la captura', () => {
  it('una captura vertical abre en 9:16 y con marco de movil', () => {
    const p = defaultProject({ capture: { w: 1080, h: 1920 } });
    expect(p.export.width).toBe(1080);
    expect(p.export.height).toBe(1920);
    expect(p.frame.chrome).toBe('phone');
  });

  it('una captura apaisada mantiene 720p y barra de navegador', () => {
    const p = defaultProject({ capture: { w: 1600, h: 900 } });
    expect(p.export.width).toBe(1280);
    expect(p.frame.chrome).toBe('macos');
  });

  it('un exportSize explicito manda sobre la captura', () => {
    const p = defaultProject({ capture: { w: 1080, h: 1920 }, exportSize: { w: 1280, h: 720 } });
    expect(p.export.width).toBe(1280);
    expect(p.frame.chrome).toBe('macos');
  });
});
