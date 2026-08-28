import { describe, it, expect } from 'vitest';
import {
  inicial, empujar, deshacer, rehacer, puedeDeshacer, puedeRehacer, FUSION_MS, TOPE,
} from './historial.ts';

/** Empuja una secuencia con instantes explicitos, como haria la interfaz. */
function secuencia(valores: [string, number][]) {
  let h = inicial('a');
  for (const [v, t] of valores) h = empujar(h, v, t);
  return h;
}

describe('historial', () => {
  it('deshacer devuelve el estado anterior y rehacer lo trae de vuelta', () => {
    let h = secuencia([['b', 1000], ['c', 5000]]);
    expect(h.presente).toBe('c');
    h = deshacer(h);
    expect(h.presente).toBe('b');
    h = deshacer(h);
    expect(h.presente).toBe('a');
    h = rehacer(h);
    expect(h.presente).toBe('b');
  });

  it('un gesto entero ocupa una sola entrada', () => {
    // Es la razon de ser del modulo: arrastrar un tramo dispara decenas de
    // cambios, y sin fusion habria que pulsar deshacer cuarenta veces.
    let h = inicial('inicio');
    h = empujar(h, 'suelto', 1000);
    for (let i = 0; i < 40; i++) h = empujar(h, `arrastre${i}`, 5000 + i * 16);
    expect(h.presente).toBe('arrastre39');
    h = deshacer(h);
    expect(h.presente).toBe('suelto');   // el gesto entero, de una vez
  });

  it('dos cambios separados no se fusionan', () => {
    let h = secuencia([['b', 1000], ['c', 1000 + FUSION_MS + 1]]);
    h = deshacer(h);
    expect(h.presente).toBe('b');
  });

  it('justo en el limite de la fusion aun se considera el mismo gesto', () => {
    let h = secuencia([['b', 1000], ['c', 1000 + FUSION_MS - 1]]);
    h = deshacer(h);
    expect(h.presente).toBe('a');
  });

  it('tras deshacer, el cambio siguiente no se fusiona con lo anterior', () => {
    // Deshacer y seguir tocando es una decision nueva, no la continuacion del
    // gesto: fusionarlos se comeria el estado al que se acaba de volver.
    let h = secuencia([['b', 1000], ['c', 5000]]);
    h = deshacer(h);            // presente = 'b'
    h = empujar(h, 'd', 5010);  // dentro de la ventana, pero tras deshacer
    h = deshacer(h);
    expect(h.presente).toBe('b');
  });

  it('un cambio nuevo invalida lo rehacible', () => {
    let h = secuencia([['b', 1000], ['c', 5000]]);
    h = deshacer(h);
    expect(puedeRehacer(h)).toBe(true);
    h = empujar(h, 'otro', 9000);
    expect(puedeRehacer(h)).toBe(false);
  });

  it('empujar el mismo estado no ensucia el historial', () => {
    const h = empujar(secuencia([['b', 1000]]), 'b', 9000);
    expect(h.pasado).toHaveLength(1);
  });

  it('la pila no crece sin limite', () => {
    let h = inicial(0);
    for (let i = 1; i <= TOPE + 30; i++) h = empujar(h, i, i * 10_000);
    expect(h.pasado.length).toBeLessThanOrEqual(TOPE);
    // Y lo que se tira es lo mas viejo: deshacer sigue funcionando.
    expect(puedeDeshacer(h)).toBe(true);
    expect(deshacer(h).presente).toBe(TOPE + 29);
  });

  it('deshacer o rehacer de mas no rompe ni cambia nada', () => {
    const vacio = inicial('a');
    expect(deshacer(vacio)).toBe(vacio);
    expect(rehacer(vacio)).toBe(vacio);
    expect(puedeDeshacer(vacio)).toBe(false);
  });

  it('no muta el historial que recibe', () => {
    const h = secuencia([['b', 1000]]);
    const copia = { ...h, pasado: [...h.pasado], futuro: [...h.futuro] };
    empujar(h, 'c', 9000);
    deshacer(h);
    expect(h).toEqual(copia);
  });
});
