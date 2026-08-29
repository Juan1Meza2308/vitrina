/**
 * Tests de la guia.
 *
 * Lo que se fija aqui es lo que distingue un tutorial util de una lista de
 * eventos: que una rafaga de teclas sea UN paso y no veinte, que el ruido de
 * mover el raton no salga, que los instantes sean los del video y no los del
 * material, y que lo tapado siga tapado.
 */
import { describe, it, expect } from 'vitest';
import type { InputEvent } from './types.ts';
import { TimeMap } from './timemap.ts';
import { pasosDe, capitulosDe, srtDe, reloj, guiaMarkdown } from './guia.ts';

const T0 = 1_700_000_000_000;
const DUR = 20_000;
const mapa = (opts: Partial<ConstructorParameters<typeof TimeMap>[0]> = {}) =>
  new TimeMap({ durationMs: DUR, ...opts });

const click = (ms: number, label: string | null): InputEvent => ({
  t: T0 + ms, type: 'down', x: 10, y: 10, label,
  rect: { x: 0, y: 0, w: 100, h: 30 },
});
const tecla = (ms: number, key: string): InputEvent => ({ t: T0 + ms, type: 'key', key });
const mover = (ms: number): InputEvent => ({ t: T0 + ms, type: 'move', x: 1, y: 1 });

describe('pasosDe', () => {
  it('un click con etiqueta es un paso con su nombre', () => {
    const pasos = pasosDe({ events: [click(1000, 'Cotizar')], startedAt: T0, map: mapa() });
    expect(pasos).toHaveLength(1);
    expect(pasos[0]!.titulo).toBe('Pulsa «Cotizar»');
    expect(pasos[0]!.tSalidaMs).toBe(1000);
  });

  it('sin etiqueta no se inventa una', () => {
    // Pasa con un icono sin texto y, a proposito, con todo lo tapado: el log
    // deja la etiqueta a nulo justo para que no se escriba en otro sitio.
    const pasos = pasosDe({ events: [click(1000, null)], startedAt: T0, map: mapa() });
    expect(pasos[0]!.titulo).toBe('Pulsa aquí');
  });

  it('una rafaga de teclas es UN paso, con el campo donde se escribe', () => {
    const events = [
      click(1000, 'Email'),
      tecla(1200, 'char'), tecla(1350, 'char'), tecla(1500, 'char'), tecla(1700, 'char'),
    ];
    const pasos = pasosDe({ events, startedAt: T0, map: mapa() });
    expect(pasos.map((p) => p.titulo)).toEqual(['Pulsa «Email»', 'Escribe en «Email»']);
  });

  it('nunca reconstruye lo que se escribio', () => {
    // El log guarda "char" y jamas la tecla. La guia no puede ser la grieta.
    const pasos = pasosDe({
      events: [click(0, 'Clave'), tecla(100, 'char'), tecla(200, 'char')],
      startedAt: T0, map: mapa(),
    });
    expect(pasos.some((p) => /char/.test(p.titulo))).toBe(false);
    expect(pasos.at(-1)!.titulo).toBe('Escribe en «Clave»');
  });

  it('dos rafagas separadas son dos pasos', () => {
    const events = [tecla(1000, 'char'), tecla(1100, 'char'), tecla(9000, 'char')];
    const pasos = pasosDe({ events, startedAt: T0, map: mapa() });
    expect(pasos).toHaveLength(2);
  });

  it('mover, rodar y hacer scroll no son pasos', () => {
    const events = [
      mover(100), mover(200),
      { t: T0 + 300, type: 'wheel', x: 1, y: 1, dy: 50 } as InputEvent,
      { t: T0 + 400, type: 'scroll', sy: 50 } as InputEvent,
      { t: T0 + 500, type: 'up', x: 1, y: 1 } as InputEvent,
    ];
    expect(pasosDe({ events, startedAt: T0, map: mapa() })).toEqual([]);
  });

  it('las teclas que confirman algo si son un paso', () => {
    const pasos = pasosDe({ events: [tecla(1000, 'Enter')], startedAt: T0, map: mapa() });
    expect(pasos[0]!.titulo).toBe('Pulsa Enter');
  });

  it('un doble click no se cuenta dos veces', () => {
    const pasos = pasosDe({
      events: [click(1000, 'Abrir'), click(1200, 'Abrir')], startedAt: T0, map: mapa(),
    });
    expect(pasos).toHaveLength(1);
  });

  it('lo que se corto NO es un paso', () => {
    // El lector iria a un segundo donde no pasa nada.
    const pasos = pasosDe({
      events: [click(1000, 'Antes'), click(5000, 'Cortado'), click(9000, 'Despues')],
      startedAt: T0,
      map: mapa({ cuts: [{ startMs: 4000, endMs: 6000 }] }),
    });
    expect(pasos.map((p) => p.titulo)).toEqual(['Pulsa «Antes»', 'Pulsa «Despues»']);
  });

  it('los instantes son los del video, no los del material', () => {
    // Con dos segundos cortados por delante, el click del segundo 9 del
    // material sale en el 7 del video.
    const pasos = pasosDe({
      events: [click(9000, 'Cotizar')],
      startedAt: T0,
      map: mapa({ cuts: [{ startMs: 1000, endMs: 3000 }] }),
    });
    expect(pasos[0]!.tSalidaMs).toBe(7000);
    expect(pasos[0]!.tFuenteMs).toBe(9000);
  });

  it('una marca es un paso con su nombre', () => {
    const events = [{ t: T0 + 2000, type: 'mark', label: 'Aqui empieza el pago' } as InputEvent];
    const pasos = pasosDe({ events, startedAt: T0, map: mapa() });
    expect(pasos[0]!.titulo).toBe('Aqui empieza el pago');
    expect(pasos[0]!.tipo).toBe('marca');
  });
});

describe('capitulosDe', () => {
  it('mandan las marcas si las hay', () => {
    const pasos = pasosDe({
      events: [
        click(1000, 'Uno'),
        { t: T0 + 5000, type: 'mark', label: 'El pago' } as InputEvent,
      ],
      startedAt: T0, map: mapa(),
    });
    expect(capitulosDe(pasos).map((c) => c.titulo)).toEqual(['Inicio', 'El pago']);
  });

  it('sin marcas, reparte los clicks dejando aire', () => {
    const pasos = pasosDe({
      events: [click(0, 'A'), click(2000, 'B'), click(30_000, 'C')],
      startedAt: T0, map: new TimeMap({ durationMs: 60_000 }),
    });
    // B cae dentro de los 20 s del anterior: no abre capitulo.
    expect(capitulosDe(pasos).map((c) => c.titulo)).toEqual(['Pulsa «A»', 'Pulsa «C»']);
  });

  it('el primero siempre esta en 0:00', () => {
    // YouTube no acepta la lista si no empieza ahi.
    const pasos = pasosDe({ events: [click(9000, 'Tarde')], startedAt: T0, map: mapa() });
    expect(capitulosDe(pasos)[0]).toEqual({ tMs: 0, titulo: 'Inicio' });
  });

  it('si el primer paso ya esta casi en cero, se mueve al cero', () => {
    // Antes salian dos entradas seguidas en 0:00 —"Inicio" y el primer
    // click—, que es un indice roto y no un indice con portada.
    const pasos = pasosDe({ events: [click(455, 'One page')], startedAt: T0, map: mapa() });
    const caps = capitulosDe(pasos);
    expect(caps).toHaveLength(1);
    expect(caps[0]).toEqual({ tMs: 0, titulo: 'Pulsa «One page»' });
  });
});

describe('srtDe', () => {
  it('cada rotulo dura hasta el siguiente, con tope', () => {
    const pasos = pasosDe({
      events: [click(1000, 'Uno'), click(1800, 'Dos')], startedAt: T0, map: mapa(),
    });
    const srt = srtDe(pasos, DUR);
    expect(srt).toContain('00:00:01,000 --> 00:00:01,800');
    // El segundo llega al tope de 3 s, no al final del video.
    expect(srt).toContain('00:00:01,800 --> 00:00:04,800');
  });
});

describe('reloj', () => {
  it('pasa a horas cuando hace falta', () => {
    expect(reloj(64_000)).toBe('1:04');
    expect(reloj(3_723_000)).toBe('1:02:03');
  });
});

describe('guiaMarkdown', () => {
  it('numera los pasos y enlaza su captura', () => {
    const pasos = pasosDe({ events: [click(1000, 'Cotizar')], startedAt: T0, map: mapa() });
    const md = guiaMarkdown({
      titulo: 'Demo', url: 'http://localhost:3000', pasos, capturas: ['guia/paso-01.png'],
    });
    expect(md).toContain('## 1. Pulsa «Cotizar»');
    expect(md).toContain('`0:01` del vídeo');
    expect(md).toContain('![Paso 1](guia/paso-01.png)');
  });
});
