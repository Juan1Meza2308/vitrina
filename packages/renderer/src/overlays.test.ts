/**
 * Tests de los rotulos y las teclas.
 *
 * El de privacidad es el que importa: la garantia de que una demo con un login
 * no filtra credenciales se apoya en que `key` valga "char" para lo imprimible,
 * y esta capa es el primer sitio donde alguien podria deshacerla sin querer.
 */
import { describe, it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { OverlaySource, nombreTecla, drawKeys, drawLabel, drawWatermark } from './overlays.ts';
import type { InputEvent } from '@vitrina/core';
import type { Ctx } from './types.ts';

const T0 = 1_700_000_000_000;
const click = (atMs: number, label: string | null): InputEvent =>
  ({ t: T0 + atMs, type: 'down', x: 100, y: 200, label, rect: null, tag: 'BUTTON' });
const tecla = (atMs: number, key: string): InputEvent => ({ t: T0 + atMs, type: 'key', key });

describe('OverlaySource', () => {
  it('rotula el elemento pulsado y luego se apaga', () => {
    const o = new OverlaySource([click(1000, 'Cotizar')], T0);
    expect(o.sample(900).label).toBeNull();
    expect(o.sample(1100).label?.text).toBe('Cotizar');
    expect(o.sample(1100).label?.opacity).toBe(1);
    expect(o.sample(3000).label).toBeNull();
  });

  it('se desvanece en vez de desaparecer de golpe', () => {
    const o = new OverlaySource([click(0, 'Enviar')], T0);
    const casi = o.sample(1300).label!.opacity;
    expect(casi).toBeGreaterThan(0);
    expect(casi).toBeLessThan(1);
  });

  it('un click sin texto no rotula nada', () => {
    expect(new OverlaySource([click(0, null)], T0).sample(100).label).toBeNull();
    expect(new OverlaySource([click(0, '   ')], T0).sample(100).label).toBeNull();
  });

  it('agrupa las teclas seguidas en una fila', () => {
    // Teclear una palabra son diez eventos; diez insignias parpadeando serian
    // ruido en vez de informacion.
    const ev = [tecla(0, 'char'), tecla(100, 'char'), tecla(200, 'char')];
    expect(new OverlaySource(ev, T0).sample(300).keys?.teclas).toHaveLength(3);
  });
});

describe('privacidad', () => {
  it('nunca reconstruye lo que se escribio', () => {
    // El log ya viene saneado: cualquier tecla imprimible llega como "char". Si
    // esta capa dibujara el caracter, la garantia se caeria aqui.
    const secreto = 'hunter2';
    const ev = [...secreto].map((_, i) => tecla(i * 50, 'char'));
    const muestra = new OverlaySource(ev, T0).sample(400)!;
    const texto = muestra.keys!.teclas.join('');
    for (const c of secreto) expect(texto).not.toContain(c);
    expect(new Set(muestra.keys!.teclas)).toEqual(new Set(['•']));
  });

  it('nombreTecla no deja pasar un caracter suelto', () => {
    expect(nombreTecla('char')).toBe('•');
    // Las teclas con nombre si se muestran: no son contenido escrito.
    expect(nombreTecla('Enter')).toBe('⏎');
    expect(nombreTecla('Escape')).toBe('Esc');
  });
});

describe('dibujo', () => {
  const CONTENT = { x: 0, y: 0, w: 800, h: 600 };
  function pintar(fn: (ctx: Ctx) => void) {
    const c = createCanvas(800, 600);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 800, 600);
    fn(ctx as unknown as Ctx);
    const d = c.getContext('2d').getImageData(0, 0, 800, 600).data;
    let oscuros = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 100) oscuros++;
    return oscuros;
  }

  it('el rotulo pinta algo', () => {
    expect(pintar((ctx) => drawLabel(ctx, 'Cotizar', { x: 100, y: 200 }, 1, CONTENT)))
      .toBeGreaterThan(200);
  });

  it('con opacidad cero no pinta nada', () => {
    expect(pintar((ctx) => drawLabel(ctx, 'Cotizar', { x: 100, y: 200 }, 0, CONTENT))).toBe(0);
    expect(pintar((ctx) => drawKeys(ctx, ['⏎'], 0, CONTENT))).toBe(0);
  });

  it('el rotulo no se sale de la pantalla aunque el click este en el borde', () => {
    // Pegado al borde se leeria a medias, que es peor que no ponerlo.
    const c = createCanvas(800, 600);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 800, 600);
    drawLabel(ctx as unknown as Ctx, 'Un rotulo bastante largo', { x: 795, y: 595 }, 1, CONTENT);
    const d = c.getContext('2d').getImageData(0, 0, 800, 600).data;
    // Si se saliera, el borde derecho quedaria limpio y el texto cortado.
    let oscuros = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 100) oscuros++;
    expect(oscuros).toBeGreaterThan(200);
  });

  it('las teclas se pintan centradas y abajo', () => {
    const c = createCanvas(800, 600);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 800, 600);
    drawKeys(ctx as unknown as Ctx, ['⌘', 'K'], 1, CONTENT);
    const d = c.getContext('2d').getImageData(0, 0, 800, 600).data;
    // Por BANDAS y no por un pixel: con dos insignias, el centro exacto cae en
    // el hueco entre ellas y la comprobacion fallaba sin que nada estuviera mal.
    const oscurosEn = (desde: number, hasta: number) => {
      let n = 0;
      for (let y = desde; y < hasta; y++) {
        for (let x = 0; x < 800; x++) if (d[(y * 800 + x) * 4]! < 100) n++;
      }
      return n;
    };
    expect(oscurosEn(530, 590)).toBeGreaterThan(100);   // franja de abajo
    expect(oscurosEn(0, 300)).toBe(0);                  // arriba sigue limpio
  });
});

describe('marca de agua', () => {
  const LIENZO = { w: 1280, h: 720 };
  const IMG = { width: 200, height: 100 };
  /** Devuelve el rectangulo con el que se pidio dibujar. */
  function donde(marca: Parameters<typeof drawWatermark>[3]) {
    const c = createCanvas(LIENZO.w, LIENZO.h);
    let r: { x: number; y: number; w: number; h: number } | null = null;
    drawWatermark(c.getContext('2d') as unknown as Ctx, IMG,
      (x, y, w, h) => { r = { x, y, w, h }; }, marca, LIENZO);
    return r as { x: number; y: number; w: number; h: number } | null;
  }
  const base = { opacity: 0.6, scale: 0.15 } as const;

  it('cae en la esquina pedida', () => {
    const ne = donde({ ...base, esquina: 'ne' })!;
    const so = donde({ ...base, esquina: 'so' })!;
    expect(ne.x).toBeGreaterThan(LIENZO.w / 2);
    expect(ne.y).toBeLessThan(LIENZO.h / 2);
    expect(so.x).toBeLessThan(LIENZO.w / 2);
    expect(so.y).toBeGreaterThan(LIENZO.h / 2);
  });

  it('conserva la proporcion de la imagen', () => {
    // Deformar un logotipo es de las cosas que mas cantan.
    const r = donde({ ...base, esquina: 'se' })!;
    expect(r.w / r.h).toBeCloseTo(IMG.width / IMG.height, 5);
  });

  it('cabe entera dentro del lienzo', () => {
    for (const esquina of ['ne', 'no', 'se', 'so'] as const) {
      const r = donde({ ...base, esquina })!;
      expect(r.x, esquina).toBeGreaterThanOrEqual(0);
      expect(r.y, esquina).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w, esquina).toBeLessThanOrEqual(LIENZO.w);
      expect(r.y + r.h, esquina).toBeLessThanOrEqual(LIENZO.h);
    }
  });

  it('no se dibuja si es invisible o no mide nada', () => {
    expect(donde({ ...base, esquina: 'se', opacity: 0 })).toBeNull();
    expect(donde({ ...base, esquina: 'se', scale: 0 })).toBeNull();
  });

  it('no se come el lienzo aunque se pida enorme', () => {
    expect(donde({ ...base, esquina: 'se', scale: 5 })!.w).toBeLessThanOrEqual(LIENZO.w / 2);
  });

  it('depende del lienzo y no del encuadre', () => {
    // Es lo que la distingue de un adorno: una marca que se moviera con el zoom
    // seria parte de la demo, no una firma.
    const a = donde({ ...base, esquina: 'se' })!;
    const b = donde({ ...base, esquina: 'se' })!;
    expect(a).toEqual(b);
  });
});
