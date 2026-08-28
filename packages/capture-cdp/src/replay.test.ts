import { describe, it, expect } from 'vitest';
import { guionDe, duracionDeGuion } from './replay.ts';
import type { InputEvent } from '@vitrina/core/types';

const T0 = 1_700_000_000_000;
const ev = (at: number, e: Partial<InputEvent>): InputEvent =>
  ({ t: T0 + at, type: 'move', ...e } as InputEvent);

describe('guionDe', () => {
  it('no reproduce los scroll', () => {
    // `scroll` es la CONSECUENCIA de un `wheel`, no una accion del usuario.
    // Reproducir los dos desplazaria la pagina el doble.
    const g = guionDe([
      ev(0, { type: 'wheel', x: 100, y: 100, dy: 120 }),
      ev(10, { type: 'scroll', sy: 120 }),
    ], T0);
    expect(g).toHaveLength(1);
    expect(g[0]!.tipo).toBe('rueda');
  });

  it('pasa de pixeles de frame a pixeles CSS', () => {
    // El log va en px de frame desde que existe la vista de movil; CDP los
    // quiere en CSS. Sin dividir, un click a 1290 se iria fuera de la pagina.
    const g = guionDe([ev(0, { type: 'down', x: 1290, y: 900 })], T0,
      { deviceScaleFactor: 3 });
    expect(g[0]).toMatchObject({ tipo: 'abajo', x: 430, y: 300 });
  });

  it('sin escala deja las coordenadas como estan', () => {
    const g = guionDe([ev(0, { type: 'down', x: 700, y: 400 })], T0);
    expect(g[0]).toMatchObject({ x: 700, y: 400 });
  });

  it('sale en orden aunque el log venga desordenado', () => {
    const g = guionDe([
      ev(500, { type: 'down', x: 1, y: 1 }),
      ev(100, { type: 'move', x: 2, y: 2 }),
      ev(300, { type: 'up', x: 3, y: 3 }),
    ], T0);
    expect(g.map((a) => a.tMs)).toEqual([100, 300, 500]);
  });

  it('descarta lo anterior al arranque', () => {
    // El log puede traer eventos de antes de empezar a grabar; reproducirlos
    // adelantaria todo lo demas.
    expect(guionDe([ev(-500, { type: 'down', x: 1, y: 1 })], T0)).toEqual([]);
  });

  it('conserva las teclas con nombre y las imprimibles como char', () => {
    const g = guionDe([
      ev(0, { type: 'key', key: 'Enter' }),
      ev(10, { type: 'key', key: 'char' }),
    ], T0);
    expect(g.map((a) => (a.tipo === 'tecla' ? a.key : null))).toEqual(['Enter', 'char']);
  });

  it('ignora los eventos sin coordenadas', () => {
    expect(guionDe([ev(0, { type: 'down' })], T0)).toEqual([]);
  });

  it('la duracion es la del ultimo instante', () => {
    const g = guionDe([ev(0, { x: 1, y: 1 }), ev(4200, { x: 2, y: 2 })], T0);
    expect(duracionDeGuion(g)).toBe(4200);
    expect(duracionDeGuion([])).toBe(0);
  });

  it('un log real produce los mismos clicks', () => {
    // La invariante que importa: si el guion no reprodujera los clicks, la
    // repeticion no pulsaria nada y el video saldria vacio.
    const log = [
      ev(0, { type: 'move', x: 300, y: 300 }),
      ev(100, { type: 'down', x: 300, y: 300, label: 'Cotizar' }),
      ev(160, { type: 'up', x: 300, y: 300 }),
    ];
    const g = guionDe(log, T0);
    expect(g.map((a) => a.tipo)).toEqual(['mover', 'abajo', 'arriba']);
  });
});
