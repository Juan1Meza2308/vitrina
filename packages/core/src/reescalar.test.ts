import { describe, it, expect } from 'vitest';
import { reescalarProyecto } from './reescalar.ts';
import type { Project } from './types.ts';

const P: Project = {
  version: 1,
  background: { kind: 'solid', color: '#000' },
  frame: { fill: 0.8, radius: 14, shadow: 40, chrome: 'macos' },
  zooms: [{
    startMs: 1000, endMs: 2000, scale: 2, auto: true,
    target: { x: 100, y: 200, w: 300, h: 150 },
  }],
  trimStartMs: 500,
  trimEndMs: 9000,
  cuts: [{ startMs: 2000, endMs: 3000 }],
  speeds: [{ startMs: 4000, endMs: 5000, rate: 2 }],
  export: { width: 1280, height: 720, fps: 60, format: 'mp4' },
};

describe('reescalarProyecto', () => {
  it('el encuadre sigue apuntando a la misma parte de la imagen', () => {
    // Es lo unico que importa: en proporcion del ancho, el objetivo no se mueve.
    const r = reescalarProyecto(P, { w: 1728, h: 972 }, { w: 2560, h: 1440 });
    const antes = (P.zooms[0]!.target.x + P.zooms[0]!.target.w / 2) / 1728;
    const ahora = (r.zooms[0]!.target.x + r.zooms[0]!.target.w / 2) / 2560;
    expect(ahora).toBeCloseTo(antes, 3);
  });

  it('conserva la proporcion del recuadro', () => {
    const r = reescalarProyecto(P, { w: 1000, h: 500 }, { w: 2000, h: 1000 });
    expect(r.zooms[0]!.target).toEqual({ x: 200, y: 400, w: 600, h: 300 });
  });

  it('no toca los tiempos ni el aspecto', () => {
    // Los cortes, las velocidades y el look no dependen del tamano de captura.
    const r = reescalarProyecto(P, { w: 1728, h: 972 }, { w: 2560, h: 1440 });
    expect(r.cuts).toEqual(P.cuts);
    expect(r.speeds).toEqual(P.speeds);
    expect(r.trimStartMs).toBe(P.trimStartMs);
    expect(r.background).toEqual(P.background);
    expect(r.frame).toEqual(P.frame);
    expect(r.export).toEqual(P.export);
  });

  it('con el mismo tamano devuelve el proyecto tal cual', () => {
    expect(reescalarProyecto(P, { w: 1728, h: 972 }, { w: 1728, h: 972 })).toBe(P);
  });

  it('aguanta un origen invalido en vez de dividir por cero', () => {
    expect(reescalarProyecto(P, { w: 0, h: 0 }, { w: 100, h: 100 })).toBe(P);
  });

  it('no muta el proyecto que recibe', () => {
    const copia = structuredClone(P);
    reescalarProyecto(P, { w: 1000, h: 500 }, { w: 2000, h: 1000 });
    expect(P).toEqual(copia);
  });
});
