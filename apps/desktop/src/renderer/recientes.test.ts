/**
 * Tests de lo unico que hay que calcular en una tarjeta de reciente: como se
 * dicen el tiempo y la duracion.
 *
 * Parece cosmetico y no lo es: "hace 47 dias" obliga a hacer la resta mental
 * que la tarjeta venia a evitar, y una duracion en segundos deja de leerse en
 * cuanto la demo pasa del minuto.
 */
import { describe, it, expect } from 'vitest';
import { hace, duracion } from './Recientes.tsx';

const AHORA = new Date('2026-08-29T12:00:00Z').getTime();
const hace_ = (ms: number) => hace(AHORA - ms, AHORA);

describe('hace', () => {
  it('lo de ahora mismo no lleva numero', () => {
    expect(hace_(5_000)).toBe('hace un momento');
  });

  it('minutos y horas', () => {
    expect(hace_(9 * 60_000)).toBe('hace 9 min');
    expect(hace_(5 * 3_600_000)).toBe('hace 5 h');
  });

  it('un dia es "ayer", no "hace 1 días"', () => {
    expect(hace_(26 * 3_600_000)).toBe('ayer');
  });

  it('pasado un mes vuelve a la fecha', () => {
    // "hace 47 dias" ya no orienta a nadie: a esa distancia se piensa en fechas.
    expect(hace_(47 * 86_400_000)).toMatch(/\d/);
    expect(hace_(47 * 86_400_000)).not.toContain('hace');
  });

  it('una fecha en el futuro no da numeros negativos', () => {
    // El reloj del sistema puede ir atrasado respecto al de la grabacion.
    expect(hace(AHORA + 60_000, AHORA)).toBe('hace un momento');
  });
});

describe('duracion', () => {
  it('por debajo del minuto, en segundos con un decimal', () => {
    expect(duracion(19_500)).toBe('19.5 s');
  });

  it('a partir del minuto, en minutos y segundos', () => {
    expect(duracion(124_000)).toBe('2:04');
    expect(duracion(60_000)).toBe('1:00');
  });
});
