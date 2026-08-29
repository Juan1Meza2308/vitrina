/**
 * Tests de la burbuja de camara, por pixeles.
 *
 * Se comprueban las tres cosas que se rompen sin dar la cara: que la burbuja
 * cae en la esquina pedida, que es redonda de verdad —y no un cuadrado con
 * aspiraciones— y que el espejo voltea alrededor de SU centro y no del lienzo,
 * que es el fallo tipico y manda la imagen al otro lado de la pantalla.
 */
import { describe, it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import type { CamaraStyle, Project } from '@vitrina/core';
import { composite } from './compositor.ts';
import { cajaDeCamara, recorteCover } from './camara.ts';
import type { Ctx, ImageLike } from './types.ts';

const SOURCE = { w: 1600, h: 900 };
const SALIDA = { w: 1280, h: 720 };
const FONDO = '#ff0000';
const IZQUIERDA = '#00ff00';
const DERECHA = '#0000ff';
const CAM = { w: 640, h: 480 };

const ESTILO: CamaraStyle = {
  esquina: 'se', tamano: 0.25, forma: 'circulo', espejo: false, borde: 0, sombra: 0,
};

function project(camara: CamaraStyle | null): Project {
  return {
    version: 1,
    background: { kind: 'solid', color: FONDO },
    // Sin ventana visible: la burbuja se mide contra el fondo, no contra el
    // contenido, y con `fill` pequeno el centro del lienzo sigue siendo fondo.
    frame: { fill: 0.1, radius: 0, shadow: 0, chrome: 'none', cursor: 'none' },
    zooms: [],
    trimStartMs: 0,
    trimEndMs: null,
    camara,
    export: { width: SALIDA.w, height: SALIDA.h, fps: 60, format: 'mp4' },
  };
}

/** Fuente de video plana: lo que importa aqui es la burbuja. */
function makeSource() {
  const c = createCanvas(SOURCE.w, SOURCE.h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#101010';
  ctx.fillRect(0, 0, SOURCE.w, SOURCE.h);
  return c;
}

/** Camara sintetica: mitad izquierda verde, mitad derecha azul. */
function makeCam() {
  const c = createCanvas(CAM.w, CAM.h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = IZQUIERDA;
  ctx.fillRect(0, 0, CAM.w / 2, CAM.h);
  ctx.fillStyle = DERECHA;
  ctx.fillRect(CAM.w / 2, 0, CAM.w / 2, CAM.h);
  return c;
}

function render(p: Project, conCamara = true) {
  const canvas = createCanvas(SALIDA.w, SALIDA.h);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  composite({
    ctx,
    source: makeSource() as unknown as ImageLike,
    sourceSize: SOURCE,
    camera: { cx: SOURCE.w / 2, cy: SOURCE.h / 2, scale: 1 },
    project: p,
    cam: conCamara
      ? { img: makeCam() as unknown as ImageLike, w: CAM.w, h: CAM.h }
      : null,
  });
  const data = canvas.getContext('2d').getImageData(0, 0, SALIDA.w, SALIDA.h).data;
  return (x: number, y: number): string => {
    const i = (Math.round(y) * SALIDA.w + Math.round(x)) * 4;
    return `#${[data[i]!, data[i + 1]!, data[i + 2]!]
      .map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };
}

describe('cajaDeCamara', () => {
  it('cada esquina cae en su lado', () => {
    const lienzo = SALIDA;
    const no = cajaDeCamara({ esquina: 'no', tamano: 0.25 }, lienzo);
    const se = cajaDeCamara({ esquina: 'se', tamano: 0.25 }, lienzo);
    expect(no.x).toBeLessThan(lienzo.w / 2);
    expect(no.y).toBeLessThan(lienzo.h / 2);
    expect(se.x + se.d).toBeGreaterThan(lienzo.w / 2);
    expect(se.y + se.d).toBeGreaterThan(lienzo.h / 2);
    // Nunca se sale del lienzo.
    expect(se.x + se.d).toBeLessThanOrEqual(lienzo.w);
    expect(se.y + se.d).toBeLessThanOrEqual(lienzo.h);
  });

  it('acota el tamano en vez de creerselo', () => {
    // Una burbuja del 90 % taparia la demo; una del 1 % no ensena una cara.
    expect(cajaDeCamara({ esquina: 'se', tamano: 9 }, SALIDA).d)
      .toBeLessThanOrEqual(SALIDA.h * 0.45);
    expect(cajaDeCamara({ esquina: 'se', tamano: 0 }, SALIDA).d)
      .toBeGreaterThan(0);
  });
});

describe('recorteCover', () => {
  it('de 4:3 saca el cuadrado central, sin deformar', () => {
    // Escalar para que quepa haria la cara mas estrecha de lo que es.
    expect(recorteCover({ w: 640, h: 480 })).toEqual({ x: 80, y: 0, w: 480, h: 480 });
  });

  it('una fuente ya cuadrada se usa entera', () => {
    expect(recorteCover({ w: 480, h: 480 })).toEqual({ x: 0, y: 0, w: 480, h: 480 });
  });
});

describe('drawCamara en el compositor', () => {
  it('se dibuja en la esquina pedida', () => {
    const px = render(project({ ...ESTILO, esquina: 'se' }));
    const { x, y, d } = cajaDeCamara(ESTILO, SALIDA);
    expect(px(x + d / 2, y + d / 2)).not.toBe(FONDO);
    // Y la esquina opuesta sigue siendo fondo.
    const no = cajaDeCamara({ esquina: 'no', tamano: 0.25 }, SALIDA);
    expect(px(no.x + no.d / 2, no.y + no.d / 2)).toBe(FONDO);
  });

  it('es redonda: la esquina de su caja sigue siendo fondo', () => {
    const px = render(project({ ...ESTILO, esquina: 'se' }));
    const { x, y, d } = cajaDeCamara(ESTILO, SALIDA);
    expect(px(x + 2, y + 2)).toBe(FONDO);
    expect(px(x + d / 2, y + d / 2)).not.toBe(FONDO);
  });

  it('sin estilo en el proyecto no se dibuja, aunque haya frame', () => {
    // Quitar la burbuja del video no debe obligar a volver a grabar.
    const px = render(project(null));
    const { x, y, d } = cajaDeCamara(ESTILO, SALIDA);
    expect(px(x + d / 2, y + d / 2)).toBe(FONDO);
  });

  it('el espejo voltea la burbuja, no la manda a la otra punta', () => {
    const { x, y, d } = cajaDeCamara(ESTILO, SALIDA);
    const izq = [x + d * 0.25, y + d / 2] as const;
    const der = [x + d * 0.75, y + d / 2] as const;

    const normal = render(project({ ...ESTILO }));
    expect(normal(...izq)).toBe(IZQUIERDA);
    expect(normal(...der)).toBe(DERECHA);

    const espejo = render(project({ ...ESTILO, espejo: true }));
    expect(espejo(...izq)).toBe(DERECHA);
    expect(espejo(...der)).toBe(IZQUIERDA);
  });
});
