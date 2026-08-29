/**
 * Tests de lo que se deduce de un proyecto.
 *
 * `colorDominante` alimenta el tinte del cristal de la app: el material toma un
 * poco del color de lo que hay detras, y en el editor eso es el fondo de la
 * demo abierta.
 */
import { describe, it, expect } from 'vitest';
import { colorDominante } from './project.ts';

describe('colorDominante', () => {
  it('de un fondo solido, su color', () => {
    expect(colorDominante({ kind: 'solid', color: '#101418' })).toBe('#101418');
  });

  it('de un degradado, el primero y no una media', () => {
    // Es el que ocupa la esquina de arriba a la izquierda, que es de donde cae
    // la luz del material.
    expect(colorDominante({ kind: 'linear', from: '#2b5876', to: '#4e4376', angle: 45 }))
      .toBe('#2b5876');
  });

  it('de una malla, el primero de la lista', () => {
    expect(colorDominante({ kind: 'mesh', colors: ['#1b2735', '#4e4376'] })).toBe('#1b2735');
  });

  it('con imagen o sin fondo no se inventa un color', () => {
    // Habria que decodificar y muestrear la imagen, y un tinte equivocado es
    // peor que ninguno.
    expect(colorDominante({ kind: 'image', path: 'f.png', blur: 0 })).toBeNull();
    expect(colorDominante({ kind: 'none' })).toBeNull();
  });

  it('una malla vacia no revienta', () => {
    expect(colorDominante({ kind: 'mesh', colors: [] })).toBeNull();
  });
});
