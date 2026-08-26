/**
 * Tests de edicion de tramos.
 *
 * Lo que se fija aqui son las invariantes que la linea de tiempo no puede
 * romper por mucho que se arrastre: orden, ausencia de solapes, duracion
 * minima y limites del material. Son justo las que una implementacion hecha
 * solo con manejadores de raton rompe en cuanto dos tramos se acercan.
 */
import { describe, it, expect } from 'vitest';
import type { ZoomSegment } from '../types.ts';
import {
  moveSegment, moveSegmentTarget, resizeSegment, deleteSegment, setSegmentScale, insertSegment,
  hasManualEdits, clampTrim, MIN_DURACION_MS,
} from './edit.ts';

const CTX = { durationMs: 10_000 };
const VIEWPORT = { w: 1600, h: 900 };

const seg = (startMs: number, endMs: number, auto = true): ZoomSegment => ({
  startMs, endMs,
  target: { x: 100, y: 100, w: 400, h: 225 },
  scale: 1.5, auto,
});

const tramos = () => [seg(1000, 3000), seg(5000, 7000)];

describe('moveSegment', () => {
  it('desplaza conservando la duracion', () => {
    const out = moveSegment(tramos(), 0, 1500, CTX);
    expect(out[0]!.startMs).toBe(1500);
    expect(out[0]!.endMs).toBe(3500);
  });

  it('frena contra el tramo siguiente en vez de solaparlo', () => {
    const out = moveSegment(tramos(), 0, 9000, CTX);
    expect(out[0]!.endMs).toBeLessThanOrEqual(5000);
    expect(out[0]!.endMs - out[0]!.startMs).toBe(2000);
  });

  it('frena contra el tramo anterior', () => {
    const out = moveSegment(tramos(), 1, 0, CTX);
    expect(out[1]!.startMs).toBeGreaterThanOrEqual(3000);
  });

  it('no se sale del material', () => {
    const out = moveSegment([seg(1000, 3000)], 0, 99_000, CTX);
    expect(out[0]!.endMs).toBeLessThanOrEqual(CTX.durationMs);
  });

  it('mover marca el tramo como manual', () => {
    // Si no, la siguiente replanificacion automatica se lo llevaria por delante.
    expect(moveSegment(tramos(), 0, 1500, CTX)[0]!.auto).toBe(false);
  });

  it('un indice inexistente no rompe la lista', () => {
    const t = tramos();
    expect(moveSegment(t, 9, 100, CTX)).toEqual(t);
  });
});

describe('resizeSegment', () => {
  it('mueve solo el borde tocado', () => {
    const out = resizeSegment(tramos(), 0, 'inicio', 2000, CTX);
    expect(out[0]!.startMs).toBe(2000);
    expect(out[0]!.endMs).toBe(3000);
  });

  it('respeta la duracion minima al encoger', () => {
    const out = resizeSegment(tramos(), 0, 'inicio', 2999, CTX);
    expect(out[0]!.endMs - out[0]!.startMs).toBeGreaterThanOrEqual(MIN_DURACION_MS);
  });

  it('no invade el tramo vecino al estirar', () => {
    const out = resizeSegment(tramos(), 0, 'fin', 9000, CTX);
    expect(out[0]!.endMs).toBeLessThanOrEqual(5000);
  });

  it('el primer tramo puede estirarse hasta el origen', () => {
    const out = resizeSegment(tramos(), 0, 'inicio', -500, CTX);
    expect(out[0]!.startMs).toBe(0);
  });

  it('el ultimo puede estirarse hasta el final del material', () => {
    const out = resizeSegment(tramos(), 1, 'fin', 99_000, CTX);
    expect(out[1]!.endMs).toBe(CTX.durationMs);
  });
});

describe('moveSegmentTarget', () => {
  const VP = { w: 1600, h: 900 };
  // A escala 1.5 la vista mide 1066x600, asi que el centro puede moverse entre
  // 533 y 1066 en X, y entre 300 y 600 en Y.
  const conCentro = (x: number, y: number): ZoomSegment[] => ([{
    startMs: 0, endMs: 2000, scale: 1.5, auto: true,
    target: { x: x - 533, y: y - 300, w: 1066, h: 600 },
  }]);

  it('desplaza el encuadre sin tocar los tiempos', () => {
    const out = moveSegmentTarget(conCentro(800, 450), 0, 100, -50, VP);
    const t = out[0]!.target;
    expect(t.x + t.w / 2).toBeCloseTo(900, 0);
    expect(t.y + t.h / 2).toBeCloseTo(400, 0);
    expect(out[0]!.startMs).toBe(0);
    expect(out[0]!.endMs).toBe(2000);
  });

  it('conserva el tamano del encuadre, o sea la ampliacion', () => {
    const antes = conCentro(800, 450);
    const out = moveSegmentTarget(antes, 0, 300, 200, VP);
    expect(out[0]!.target.w).toBeCloseTo(antes[0]!.target.w, 6);
    expect(out[0]!.target.h).toBeCloseTo(antes[0]!.target.h, 6);
    expect(out[0]!.scale).toBe(1.5);
  });

  it('no deja que el encuadre se salga del material', () => {
    // Arrastrar hasta el infinito tiene que topar contra el borde, no seguir.
    const out = moveSegmentTarget(conCentro(800, 450), 0, 99_999, 99_999, VP);
    const t = out[0]!.target;
    expect(t.x).toBeGreaterThanOrEqual(-0.5);
    expect(t.y).toBeGreaterThanOrEqual(-0.5);
    expect(t.x + t.w).toBeLessThanOrEqual(VP.w + 0.5);
    expect(t.y + t.h).toBeLessThanOrEqual(VP.h + 0.5);
  });

  it('el recorte se guarda, no se aplica solo al pintar', () => {
    // Si el limite lo pusiera el compositor, arrastrar mas alla del borde
    // acumularia un desfase invisible que reaparece al cambiar la escala.
    const unaVez = moveSegmentTarget(conCentro(800, 450), 0, 99_999, 0, VP);
    const dosVeces = moveSegmentTarget(unaVez, 0, 99_999, 0, VP);
    expect(dosVeces[0]!.target.x).toBeCloseTo(unaVez[0]!.target.x, 6);
  });

  it('mover el encuadre marca el tramo como manual', () => {
    expect(moveSegmentTarget(conCentro(800, 450), 0, 10, 10, VP)[0]!.auto).toBe(false);
  });
});

describe('deleteSegment', () => {
  it('quita el tramo indicado', () => {
    const out = deleteSegment(tramos(), 0);
    expect(out).toHaveLength(1);
    expect(out[0]!.startMs).toBe(5000);
  });

  it('un indice fuera de rango no cambia nada', () => {
    expect(deleteSegment(tramos(), 5)).toHaveLength(2);
  });
});

describe('setSegmentScale', () => {
  it('cambia la ampliacion y marca el tramo como manual', () => {
    const out = setSegmentScale(tramos(), 1, 1.2);
    expect(out[1]!.scale).toBe(1.2);
    expect(out[1]!.auto).toBe(false);
    expect(out[0]!.auto).toBe(true);
  });
});

describe('insertSegment', () => {
  const opts = { ...CTX, center: { x: 800, y: 450 }, viewport: VIEWPORT, scale: 1.5 };

  it('inserta en un hueco y mantiene el orden', () => {
    const out = insertSegment(tramos(), 3500, opts);
    expect(out).toHaveLength(3);
    expect(out.map((s) => s.startMs)).toEqual([...out.map((s) => s.startMs)].sort((a, b) => a - b));
    expect(out[1]!.startMs).toBe(3500);
  });

  it('el encuadre queda centrado donde se pidio', () => {
    const out = insertSegment(tramos(), 3500, opts);
    const t = out[1]!.target;
    expect(t.x + t.w / 2).toBeCloseTo(800, 6);
    expect(t.y + t.h / 2).toBeCloseTo(450, 6);
    expect(VIEWPORT.w / t.w).toBeCloseTo(1.5, 6);
  });

  it('no inserta dentro de un tramo existente', () => {
    expect(insertSegment(tramos(), 2000, opts)).toHaveLength(2);
  });

  it('recorta la duracion al hueco disponible', () => {
    const out = insertSegment(tramos(), 3100, { ...opts, duracionMs: 5000 });
    expect(out[1]!.endMs).toBeLessThanOrEqual(5000);
  });

  it('no inserta si el hueco no da para la duracion minima', () => {
    // Entre 3000 y 3100 solo caben 100 ms: meterlo a presion crearia un tramo
    // imposible de agarrar para borrarlo.
    const juntos = [seg(1000, 3000), seg(3100, 7000)];
    expect(insertSegment(juntos, 3050, opts)).toHaveLength(2);
  });

  it('lo insertado nace como manual', () => {
    expect(insertSegment(tramos(), 3500, opts)[1]!.auto).toBe(false);
  });
});

describe('hasManualEdits', () => {
  it('distingue una lista intacta de una tocada', () => {
    expect(hasManualEdits(tramos())).toBe(false);
    expect(hasManualEdits(moveSegment(tramos(), 0, 1200, CTX))).toBe(true);
  });
});

describe('clampTrim', () => {
  it('deja pasar un recorte valido', () => {
    expect(clampTrim(1000, 8000, 10_000)).toEqual({ trimStartMs: 1000, trimEndMs: 8000 });
  });

  it('un final igual al total se normaliza a null', () => {
    // `null` significa "hasta donde llegue", y guardar el valor exacto haria
    // que alargar la grabacion no se reflejara.
    expect(clampTrim(0, 10_000, 10_000).trimEndMs).toBeNull();
  });

  it('no permite dejar la grabacion vacia', () => {
    const r = clampTrim(9900, 9950, 10_000);
    expect((r.trimEndMs ?? 10_000) - r.trimStartMs).toBeGreaterThanOrEqual(500);
  });

  it('valores negativos se recortan al origen', () => {
    expect(clampTrim(-500, null, 10_000).trimStartMs).toBe(0);
  });
});
