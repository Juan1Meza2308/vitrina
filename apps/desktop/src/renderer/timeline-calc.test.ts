import { describe, it, expect } from 'vitest';
import { marcasDeRegla, picos, etiquetaTiempo } from './timeline-calc.ts';

describe('marcasDeRegla', () => {
  it('usa pasos redondos, no fracciones', () => {
    // Una regla con marcas cada 1.37 s no la lee nadie.
    const m = marcasDeRegla(60_000, 900);
    const paso = m[1]!.ms - m[0]!.ms;
    expect([100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000]).toContain(paso);
  });

  it('nunca amontona las marcas', () => {
    // Es la razon de elegir el paso por la anchura: amontonadas son ilegibles,
    // y eso es peor que tener menos.
    for (const [dur, ancho] of [[5_000, 400], [60_000, 900], [600_000, 700], [3_600_000, 500]]) {
      const m = marcasDeRegla(dur!, ancho!);
      if (m.length < 2) continue;
      const px = (m[1]!.f - m[0]!.f) * ancho!;
      expect(px, `${dur}ms en ${ancho}px`).toBeGreaterThanOrEqual(69);
    }
  });

  it('al ampliar aparecen mas marcas', () => {
    // El paso sale de la anchura y no de la duracion: la misma grabacion al
    // doble de ancho tiene que ensenar mas detalle.
    const normal = marcasDeRegla(60_000, 900).length;
    const ampliada = marcasDeRegla(60_000, 3600).length;
    expect(ampliada).toBeGreaterThan(normal);
  });

  it('empieza en cero y no se pasa del final', () => {
    const m = marcasDeRegla(30_000, 800);
    expect(m[0]!.ms).toBe(0);
    expect(m.at(-1)!.f).toBeLessThanOrEqual(1.001);
  });

  it('aguanta una duracion o anchura de cero', () => {
    expect(marcasDeRegla(0, 800)).toEqual([]);
    expect(marcasDeRegla(30_000, 0)).toEqual([]);
  });

  it('etiqueta en m:ss, y en decimas cuando el paso baja del segundo', () => {
    expect(etiquetaTiempo(95_000, 5000)).toBe('1:35');
    expect(etiquetaTiempo(1500, 500)).toBe('1.5s');
  });
});

describe('picos', () => {
  const seno = (n: number, amp = 1) =>
    Float32Array.from({ length: n }, (_, i) => Math.sin(i / 3) * amp);

  it('devuelve exactamente las columnas pedidas', () => {
    // La onda tiene que ocupar el ancho de la pista, mida lo que mida el audio.
    for (const n of [1, 10, 300, 1000]) {
      expect(picos(seno(44_100), n)).toHaveLength(n);
    }
  });

  it('no cambia de forma segun lo largo que sea el audio', () => {
    const corto = picos(seno(10_000), 50);
    const largo = picos(seno(200_000), 50);
    for (let i = 5; i < 45; i++) {
      expect(Math.abs(corto[i]! - largo[i]!), `columna ${i}`).toBeLessThan(0.1);
    }
  });

  it('el silencio da ceros', () => {
    expect([...picos(new Float32Array(5000), 20)].every((v) => v === 0)).toBe(true);
  });

  it('toma el pico y no la media', () => {
    // Con la media, una voz normal ronda 0.02 y la onda sale plana: no diria
    // donde se hablo, que es justo para lo que sirve.
    const m = new Float32Array(1000);
    m[500] = 0.9;
    const p = picos(m, 10);
    expect(Math.max(...p)).toBeCloseTo(0.9, 5);
  });

  it('un audio vacio no revienta', () => {
    expect([...picos(new Float32Array(0), 8)]).toEqual(new Array(8).fill(0));
  });

  it('acota a 1 aunque el audio venga saturado', () => {
    const m = Float32Array.from({ length: 100 }, () => 3);
    expect(Math.max(...picos(m, 10))).toBe(1);
  });
});
