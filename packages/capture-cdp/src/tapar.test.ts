/**
 * Lo que se puede comprobar del tapado sin navegador: la hoja de estilos y el
 * script que la instala.
 *
 * Que la hoja SOBREVIVA al parser no se puede probar aqui —hace falta un
 * documento de verdad— y lo comprueba `recorder.integration.test.ts` sobre los
 * pixeles del frame, que es donde el fallo tenia sintoma.
 */
import { describe, it, expect } from 'vitest';
import {
  cssDeTapado, fuenteDeTapado, listaDeSelectores, selectoresValidos, selectorUnico,
  desenfoqueValido, DESENFOQUE_POR_DEFECTO, GLOBAL_TAPADO,
} from './tapar.ts';

describe('selectores', () => {
  it('acepta comas y saltos de linea, que es como se escribe una lista', () => {
    expect(listaDeSelectores('#saldo, .email\n[data-privado]')).toEqual(
      ['#saldo', '.email', '[data-privado]'],
    );
  });

  it('no repite un selector escrito dos veces', () => {
    expect(listaDeSelectores('#saldo, #saldo')).toEqual(['#saldo']);
  });

  it('conserva el combinador hijo', () => {
    // `>` es un selector legitimo y filtrarlo dejaria fuera el caso mas comun:
    // tapar una celda concreta dentro de una fila.
    expect(selectoresValidos(['.fila > .saldo'])).toEqual(['.fila > .saldo']);
  });

  it('descarta lo que romperia la hoja entera', () => {
    expect(selectoresValidos(['#a {', 'b }', 'c;', '  ', '#bueno'])).toEqual(['#bueno']);
  });
});

describe('cssDeTapado', () => {
  it('sin selectores no genera hoja', () => {
    // Devolver una hoja vacia haria que el grabador inyectara un script inutil
    // en todas las grabaciones.
    expect(cssDeTapado({ selectores: [] })).toBe('');
    expect(cssDeTapado(null)).toBe('');
  });

  it('una regla por selector', () => {
    // Aisladas: un selector mal escrito solo se pierde a si mismo.
    const css = cssDeTapado({ selectores: ['#saldo', '.email'], desenfoque: 10 });
    expect(css.split('\n')).toEqual([
      '#saldo { filter: blur(10px) !important; }',
      '.email { filter: blur(10px) !important; }',
    ]);
  });

  it('gana a un filtro de la pagina', () => {
    // Perder por especificidad significaria ensenar el dato.
    expect(cssDeTapado({ selectores: ['#saldo'] })).toContain('!important');
  });

  it('el radio por defecto deja el texto ilegible', () => {
    expect(cssDeTapado({ selectores: ['#saldo'] }))
      .toContain(`blur(${DESENFOQUE_POR_DEFECTO}px)`);
  });

  it('acota el radio en vez de creerselo', () => {
    expect(desenfoqueValido(0)).toBeGreaterThan(0);
    expect(desenfoqueValido(5000)).toBeLessThanOrEqual(80);
    expect(desenfoqueValido(undefined)).toBe(DESENFOQUE_POR_DEFECTO);
    expect(desenfoqueValido(Number.NaN)).toBe(DESENFOQUE_POR_DEFECTO);
  });
});

describe('fuenteDeTapado', () => {
  it('sin selectores no hay script', () => {
    expect(fuenteDeTapado({ selectores: [] })).toBe('');
    expect(fuenteDeTapado(undefined)).toBe('');
  });

  it('es JavaScript valido incluso con comillas en el selector', () => {
    // El script viaja como texto plano a `addScriptToEvaluateOnNewDocument`: un
    // escape mal hecho no falla al generarlo, falla en la pagina y en silencio.
    const fuente = fuenteDeTapado({ selectores: ['[data-campo="clave secreta"]', "#a'b"] });
    expect(() => new Function(fuente)).not.toThrow();
  });

  it('repone la hoja en vez de instalarla una vez', () => {
    // El fallo que motivo esto: el script corre antes del parseo, el parser
    // reemplaza el documento y se lleva el <style> por delante.
    const fuente = fuenteDeTapado({ selectores: ['#saldo'] });
    expect(fuente).toContain('MutationObserver');
    expect(fuente).toContain('readystatechange');
  });

  it('publica los selectores para el log de entrada', () => {
    // Tapar los pixeles y dejar el texto del elemento en events.json seria
    // tapar solo lo que se ve.
    const fuente = fuenteDeTapado({ selectores: ['#saldo', '.email'] });
    expect(fuente).toContain(GLOBAL_TAPADO);
    expect(selectorUnico({ selectores: ['#saldo', '.email'] })).toBe('#saldo, .email');
  });
});
