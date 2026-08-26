import { describe, it, expect } from 'vitest';
import { TimeMap } from './timemap.ts';

const DUR = 10_000;

describe('TimeMap sin cortes', () => {
  it('la salida es el original tal cual', () => {
    const m = new TimeMap({ durationMs: DUR });
    expect(m.outputDurationMs).toBe(DUR);
    expect(m.sourceAt(0)).toBe(0);
    expect(m.sourceAt(4000)).toBe(4000);
  });

  it('el recorte desplaza el origen', () => {
    const m = new TimeMap({ durationMs: DUR, trimStartMs: 2000, trimEndMs: 8000 });
    expect(m.outputDurationMs).toBe(6000);
    expect(m.sourceAt(0)).toBe(2000);
    expect(m.sourceAt(1000)).toBe(3000);
  });
});

describe('TimeMap con cortes', () => {
  it('acorta la salida por la duracion de lo quitado', () => {
    const m = new TimeMap({ durationMs: DUR, cuts: [{ startMs: 3000, endMs: 5000 }] });
    expect(m.outputDurationMs).toBe(8000);
  });

  it('salta el corte al mapear', () => {
    // Todo lo que hay tras el silencio se adelanta 2 s.
    const m = new TimeMap({ durationMs: DUR, cuts: [{ startMs: 3000, endMs: 5000 }] });
    expect(m.sourceAt(2999)).toBe(2999);
    expect(m.sourceAt(3000)).toBe(5000);
    expect(m.sourceAt(4000)).toBe(6000);
  });

  it('varios cortes se acumulan', () => {
    const m = new TimeMap({
      durationMs: DUR,
      cuts: [{ startMs: 1000, endMs: 2000 }, { startMs: 6000, endMs: 8000 }],
    });
    expect(m.outputDurationMs).toBe(7000);
    expect(m.sourceAt(1000)).toBe(2000);
    expect(m.sourceAt(5000)).toBe(8000);
  });

  it('cortes solapados no descuentan dos veces', () => {
    // Detectar silencios puede producir tramos que se pisan; contarlos por
    // separado dejaria la salida mas corta de lo que realmente se quito.
    const m = new TimeMap({
      durationMs: DUR,
      cuts: [{ startMs: 2000, endMs: 5000 }, { startMs: 4000, endMs: 6000 }],
    });
    expect(m.outputDurationMs).toBe(6000);
    expect(m.keeps).toHaveLength(2);
  });

  it('los cortes desordenados o invertidos se normalizan', () => {
    const m = new TimeMap({
      durationMs: DUR,
      cuts: [{ startMs: 8000, endMs: 9000 }, { startMs: 2000, endMs: 1000 }],
    });
    expect(m.outputDurationMs).toBe(8000);
    expect(m.keeps[0]!.start).toBe(0);
  });

  it('lo que cae fuera del recorte no cuenta', () => {
    const m = new TimeMap({
      durationMs: DUR, trimStartMs: 4000, trimEndMs: 8000,
      cuts: [{ startMs: 0, endMs: 1000 }, { startMs: 5000, endMs: 6000 }],
    });
    expect(m.outputDurationMs).toBe(3000);
  });

  it('un corte a caballo del recorte se recorta al borde', () => {
    const m = new TimeMap({
      durationMs: DUR, trimStartMs: 4000, cuts: [{ startMs: 3000, endMs: 5000 }],
    });
    expect(m.outputDurationMs).toBe(5000);
    expect(m.sourceAt(0)).toBe(5000);
  });

  it('cortarlo todo no produce un video vacio', () => {
    // Silencio de punta a punta es mucho mas probable que sea un microfono
    // mudo que una demo sin nada que ensenar. Borrar el material entero seria
    // una respuesta desproporcionada a una deteccion.
    const m = new TimeMap({ durationMs: DUR, cuts: [{ startMs: 0, endMs: DUR }] });
    expect(m.outputDurationMs).toBe(DUR);
  });
});

describe('TimeMap · consultas fuera de rango', () => {
  const m = new TimeMap({ durationMs: DUR, cuts: [{ startMs: 3000, endMs: 5000 }] });

  it('antes del principio devuelve el primer instante util', () => {
    expect(m.sourceAt(-500)).toBe(0);
  });

  it('mas alla del final se satura en vez de extrapolar', () => {
    expect(m.sourceAt(99_999)).toBe(DUR);
  });
});

describe('TimeMap.skip', () => {
  const m = new TimeMap({ durationMs: DUR, cuts: [{ startMs: 3000, endMs: 5000 }] });

  it('deja pasar lo que no esta cortado', () => {
    expect(m.skip(1000)).toBe(1000);
    expect(m.skip(7000)).toBe(7000);
  });

  it('empuja hacia delante lo que cae dentro de un corte', () => {
    // Sin esto, el preview reproduciria el silencio que el export quita, y lo
    // que se ve dejaria de ser lo que sale.
    expect(m.skip(4000)).toBe(5000);
  });

  it('en el borde exacto no salta', () => {
    expect(m.skip(3000)).toBe(3000);
    expect(m.skip(5000)).toBe(5000);
  });
});
