import { describe, it, expect } from 'vitest';
import { normalizarAjustes, AJUSTES_POR_DEFECTO } from './ajustes.ts';

describe('normalizarAjustes', () => {
  it('conserva lo que llega bien', () => {
    const guardado = {
      url: 'http://localhost:4321', presetName: 'nitido',
      orientacion: 'vertical' as const, micOn: false, micDeviceId: 'abc',
      looks: [], lookPorDefecto: null,
    };
    expect(normalizarAjustes(guardado)).toEqual(guardado);
  });

  it('un fichero corrupto o vacio da los valores de fabrica', () => {
    // Que la app no arranque porque un JSON quedo mal escrito seria un desastre
    // desproporcionado para lo que guarda.
    for (const basura of [null, undefined, 42, 'texto', [], {}]) {
      expect(normalizarAjustes(basura)).toEqual(AJUSTES_POR_DEFECTO);
    }
  });

  it('un campo malo no arrastra a los demas', () => {
    const r = normalizarAjustes({ url: 'http://x.test', presetName: 123, micOn: 'si' });
    expect(r.url).toBe('http://x.test');            // el bueno se conserva
    expect(r.presetName).toBe(AJUSTES_POR_DEFECTO.presetName);
    expect(r.micOn).toBe(AJUSTES_POR_DEFECTO.micOn);
  });

  it('una orientacion desconocida cae en horizontal', () => {
    expect(normalizarAjustes({ orientacion: 'diagonal' }).orientacion).toBe('horizontal');
  });

  it('una url vacia no se guarda: dejaria la pantalla sin destino', () => {
    expect(normalizarAjustes({ url: '   ' }).url).toBe(AJUSTES_POR_DEFECTO.url);
  });

  it('el id de microfono vacio es valido: significa "el predeterminado"', () => {
    expect(normalizarAjustes({ micDeviceId: '' }).micDeviceId).toBe('');
  });
});
