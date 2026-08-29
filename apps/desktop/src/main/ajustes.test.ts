import { describe, it, expect } from 'vitest';
import { normalizarAjustes, AJUSTES_POR_DEFECTO } from './ajustes.ts';

describe('normalizarAjustes', () => {
  it('conserva lo que llega bien', () => {
    const guardado = {
      url: 'http://localhost:4321', presetName: 'nitido',
      orientacion: 'vertical' as const, micOn: false, micDeviceId: 'abc',
      tapar: '#saldo, .email', camOn: true, camDeviceId: 'cam-1',
      tema: 'claro' as const, looks: [], lookPorDefecto: null,
    };
    // Y los campos que no estaban —estos ajustes son de una version anterior—
    // salen con su valor de fabrica en vez de romper el resto. Es el caso que
    // vive cualquiera que actualice la app.
    expect(normalizarAjustes(guardado)).toEqual({
      ...guardado, bienvenidaVista: '', ffmpegPath: '',
    });
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

  it('un tema desconocido cae en oscuro', () => {
    // Es el aspecto de siempre: una app que arranca en claro porque el JSON
    // trae basura asusta mas que cualquier otro campo mal leido.
    expect(normalizarAjustes({ tema: 'neon' }).tema).toBe('oscuro');
    expect(normalizarAjustes({ tema: 'claro' }).tema).toBe('claro');
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

  it('sin marca de bienvenida, la bienvenida se ensena', () => {
    // Es el caso de la primera vez y tambien el de unos ajustes corruptos: ante
    // la duda, saludar. Ensenar la bienvenida de mas cuesta un clic; saltarsela
    // deja a alguien sin saber que Vitrina graba paginas web y no la pantalla.
    expect(normalizarAjustes({}).bienvenidaVista).toBe('');
    expect(normalizarAjustes({ bienvenidaVista: 42 }).bienvenidaVista).toBe('');
  });

  it('la version vista se guarda tal cual, para poder volver a saludar', () => {
    expect(normalizarAjustes({ bienvenidaVista: '0.1.0' }).bienvenidaVista).toBe('0.1.0');
  });

  it('la ruta de ffmpeg elegida a mano sobrevive, y una basura no', () => {
    expect(normalizarAjustes({ ffmpegPath: 'D:/tools/ffmpeg.exe' }).ffmpegPath)
      .toBe('D:/tools/ffmpeg.exe');
    expect(normalizarAjustes({ ffmpegPath: { a: 1 } }).ffmpegPath).toBe('');
  });

  it('los selectores a tapar se guardan tal cual se escribieron', () => {
    // Sin normalizar aqui: el campo es texto libre y lo que se teclea tiene que
    // volver igual al reabrir la app. Validarlos es cosa del grabador.
    expect(normalizarAjustes({ tapar: ' #saldo,\n.email ' }).tapar).toBe(' #saldo,\n.email ');
    expect(normalizarAjustes({ tapar: 7 }).tapar).toBe('');
  });
});
