import { describe, it, expect } from 'vitest';
import { tramosSinActividad, ahorroDe, IDLE_MARGEN_MS } from './idle.ts';
import { TimeMap, RATE_MAX } from './timemap.ts';
import type { InputEvent } from './types.ts';

const T0 = 1_700_000_000_000;
const DUR = 20_000;
const mover = (atMs: number): InputEvent => ({ t: T0 + atMs, type: 'move', x: 1, y: 1 });

/** Actividad continua salvo en los huecos indicados. */
function conHuecos(huecos: [number, number][]): InputEvent[] {
  const ev: InputEvent[] = [];
  for (let t = 0; t <= DUR; t += 100) {
    if (huecos.some(([a, b]) => t > a && t < b)) continue;
    ev.push(mover(t));
  }
  return ev;
}

describe('tramosSinActividad', () => {
  it('encuentra la espera y la deja dentro de ella', () => {
    const s = tramosSinActividad(conHuecos([[3000, 9000]]), T0, DUR);
    expect(s).toHaveLength(1);
    expect(s[0]!.startMs).toBeGreaterThanOrEqual(3000);
    expect(s[0]!.endMs).toBeLessThanOrEqual(9000);
  });

  it('respeta el margen a los dos lados', () => {
    // Sin el, la aceleracion empieza en el instante del ultimo gesto y ese
    // gesto se ve a camara rapida, que es lo que se quiere evitar.
    const s = tramosSinActividad(conHuecos([[3000, 9000]]), T0, DUR)[0]!;
    expect(s.startMs).toBeCloseTo(3000 + IDLE_MARGEN_MS, -1);
    expect(s.endMs).toBeCloseTo(9000 - IDLE_MARGEN_MS, -1);
  });

  it('ignora los huecos cortos', () => {
    // Acelerar medio segundo no se lee como fluidez, se lee como un tiron.
    expect(tramosSinActividad(conHuecos([[3000, 3600]]), T0, DUR)).toEqual([]);
  });

  it('una espera larga se acelera mas que una corta', () => {
    const corta = tramosSinActividad(conHuecos([[2000, 5000]]), T0, DUR)[0]!;
    const larga = tramosSinActividad(conHuecos([[8000, 18_000]]), T0, DUR)[0]!;
    expect(larga.rate).toBeGreaterThan(corta.rate);
  });

  it('todas las esperas acaban durando algo parecido', () => {
    // Es la razon de que la velocidad no sea fija: lo que molesta no es la
    // espera, es su duracion.
    const s = tramosSinActividad(conHuecos([[2000, 5000], [8000, 16_000]]), T0, DUR);
    const duraciones = s.map((v) => (v.endMs - v.startMs) / v.rate);
    expect(Math.abs(duraciones[0]! - duraciones[1]!)).toBeLessThan(200);
  });

  it('no se pasa del tope de velocidad', () => {
    const s = tramosSinActividad([mover(0), mover(DUR)], T0, DUR);
    for (const v of s) expect(v.rate).toBeLessThanOrEqual(RATE_MAX);
  });

  it('sin eventos trata la grabacion entera como espera', () => {
    const s = tramosSinActividad([], T0, DUR);
    expect(s).toHaveLength(1);
    expect(s[0]!.rate).toBeGreaterThan(1);
  });

  it('con actividad continua no propone nada', () => {
    expect(tramosSinActividad(conHuecos([]), T0, DUR)).toEqual([]);
  });

  it('el ahorro que anuncia es el que aplica el mapa', () => {
    // Si no coincidieran, la app prometeria un recorte que el export no da.
    const s = tramosSinActividad(conHuecos([[3000, 9000], [12_000, 17_000]]), T0, DUR);
    const m = new TimeMap({ durationMs: DUR, speeds: s });
    expect(DUR - m.outputDurationMs).toBeCloseTo(ahorroDe(s), 6);
  });
});
