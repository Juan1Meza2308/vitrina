/**
 * Tests del canal por el que viaja el instante actual.
 *
 * Es codigo minusculo del que cuelga que la aguja se mueva: si un fallo aqui
 * dejara de avisar, la aguja se quedaria clavada y el editor pareceria colgado
 * aunque todo lo demas funcionara.
 */
import { describe, it, expect, vi } from 'vitest';
import { Reloj } from './reloj.ts';

describe('Reloj', () => {
  it('avisa al suscribirse, para pintar donde ya esta', () => {
    const r = new Reloj();
    r.set(1200);
    const f = vi.fn();
    r.sub(f);
    expect(f).toHaveBeenCalledWith(1200);
  });

  it('avisa a todos los oyentes de cada cambio', () => {
    const r = new Reloj();
    const a = vi.fn();
    const b = vi.fn();
    r.sub(a);
    r.sub(b);
    r.set(500);
    expect(a).toHaveBeenLastCalledWith(500);
    expect(b).toHaveBeenLastCalledWith(500);
    expect(r.valor).toBe(500);
  });

  it('no avisa si el valor no cambia', () => {
    // El bucle de reproduccion puede reenviar el mismo ms al pausar; repintar
    // por eso seria trabajo por nada.
    const r = new Reloj();
    const f = vi.fn();
    r.sub(f);
    f.mockClear();
    r.set(0);
    expect(f).not.toHaveBeenCalled();
  });

  it('darse de baja deja de recibir', () => {
    const r = new Reloj();
    const f = vi.fn();
    const baja = r.sub(f);
    baja();
    r.set(900);
    expect(f).not.toHaveBeenLastCalledWith(900);
  });
});
