import { describe, it, expect } from 'vitest';
import { normalizarAjustes, aplicarLook, type Look } from './ajustes.ts';
import type { Project } from '@vitrina/core';

const LOOK: Look = {
  nombre: 'marca',
  background: { kind: 'solid', color: '#123456' },
  frame: { fill: 0.6, radius: 20, shadow: 10, chrome: 'windows' },
  watermark: { path: 'marca.png', esquina: 'se', opacity: 0.5, scale: 0.12 },
};

const PROYECTO: Project = {
  version: 1,
  background: { kind: 'linear', from: '#000', to: '#fff', angle: 90 },
  frame: { fill: 0.8, radius: 14, shadow: 40, chrome: 'macos' },
  zooms: [{ startMs: 0, endMs: 1000, target: { x: 0, y: 0, w: 10, h: 10 }, scale: 2, auto: true }],
  trimStartMs: 500,
  trimEndMs: 9000,
  cuts: [{ startMs: 2000, endMs: 3000 }],
  speeds: [{ startMs: 4000, endMs: 5000, rate: 2 }],
  export: { width: 1280, height: 720, fps: 60, format: 'mp4' },
};

describe('aplicarLook', () => {
  it('cambia el aspecto', () => {
    const r = aplicarLook(PROYECTO, LOOK);
    expect(r.background).toEqual(LOOK.background);
    expect(r.frame).toEqual(LOOK.frame);
    expect(r.watermark).toEqual(LOOK.watermark);
  });

  it('no toca el trabajo de edicion', () => {
    // Un look que arrastrara los zooms o los cortes de otra grabacion seria una
    // trampa: parece que cambia el aspecto y te cambia el montaje.
    const r = aplicarLook(PROYECTO, LOOK);
    expect(r.zooms).toEqual(PROYECTO.zooms);
    expect(r.cuts).toEqual(PROYECTO.cuts);
    expect(r.speeds).toEqual(PROYECTO.speeds);
    expect(r.trimStartMs).toBe(PROYECTO.trimStartMs);
    expect(r.trimEndMs).toBe(PROYECTO.trimEndMs);
    expect(r.export).toEqual(PROYECTO.export);
  });

  it('un look sin marca la quita, no la deja puesta', () => {
    const conMarca = aplicarLook(PROYECTO, LOOK);
    const sinMarca = aplicarLook(conMarca, { ...LOOK, watermark: null });
    expect(sinMarca.watermark).toBeNull();
  });

  it('no muta el proyecto original', () => {
    const copia = structuredClone(PROYECTO);
    aplicarLook(PROYECTO, LOOK);
    expect(PROYECTO).toEqual(copia);
  });
});

describe('looks guardados', () => {
  it('sobreviven a la ida y vuelta', () => {
    const a = normalizarAjustes({ looks: [LOOK], lookPorDefecto: 'marca' });
    expect(a.looks).toEqual([LOOK]);
    expect(a.lookPorDefecto).toBe('marca');
  });

  it('un look a medias se descarta entero', () => {
    // Aplicarlo dejaria el proyecto sin fondo o sin marco, y eso revienta el
    // compositor. Mejor perder el look que la grabacion.
    const a = normalizarAjustes({
      looks: [LOOK, { nombre: 'roto' }, { background: {}, frame: {} }, null, 'texto'],
    });
    expect(a.looks).toEqual([LOOK]);
  });

  it('sin looks guardados no hay lista ni predeterminado', () => {
    const a = normalizarAjustes({});
    expect(a.looks).toEqual([]);
    expect(a.lookPorDefecto).toBeNull();
  });
});
