/**
 * Tests de la comparacion de versiones.
 *
 * Es codigo minusculo y es exactamente donde se cuelan los fallos de un
 * actualizador: comparar como texto hace que `0.10.0` parezca anterior a
 * `0.9.0`, y entonces quien tiene la version nueva recibe un aviso para
 * "actualizar" a la vieja.
 */
import { describe, it, expect } from 'vitest';
import { partes, esMasNueva, puedeActualizarSolo } from './version.ts';

describe('partes', () => {
  it('entiende una version con y sin v delante', () => {
    expect(partes('1.2.3')).toEqual([1, 2, 3]);
    expect(partes('v1.2.3')).toEqual([1, 2, 3]);
  });

  it('se queda con los numeros de una preliberacion', () => {
    expect(partes('0.2.0-beta.3')).toEqual([0, 2, 0]);
  });

  it('lo que no es una version da null en vez de ceros', () => {
    // Devolver [0,0,0] haria que cualquier basura pareciera "la version 0",
    // y todo lo demas seria mas nuevo que ella.
    expect(partes('ultima')).toBeNull();
    expect(partes('')).toBeNull();
  });
});

describe('esMasNueva', () => {
  it('compara por numero, no por texto', () => {
    // El fallo clasico: como cadena, "0.10.0" < "0.9.0".
    expect(esMasNueva('0.10.0', '0.9.0')).toBe(true);
    expect(esMasNueva('0.9.0', '0.10.0')).toBe(false);
  });

  it('mira mayor, luego menor, luego parche', () => {
    expect(esMasNueva('1.0.0', '0.99.99')).toBe(true);
    expect(esMasNueva('1.2.4', '1.2.3')).toBe(true);
    expect(esMasNueva('1.2.3', '1.2.3')).toBe(false);
  });

  it('una preliberacion no gana a la final con los mismos numeros', () => {
    expect(esMasNueva('1.2.3-beta.1', '1.2.3')).toBe(false);
  });

  it('ante una version que no se entiende, no se avisa', () => {
    // Un tag raro en la Release no puede sacar un aviso: molestar con un aviso
    // equivocado gasta la confianza que hara falta cuando importe.
    expect(esMasNueva('la buena', '1.0.0')).toBe(false);
    expect(esMasNueva('2.0.0', 'dev')).toBe(false);
  });
});

describe('puedeActualizarSolo', () => {
  it('en Windows si, y en macOS no mientras la app no este firmada', () => {
    expect(puedeActualizarSolo('win32')).toBe(true);
    expect(puedeActualizarSolo('darwin')).toBe(false);
  });
});
