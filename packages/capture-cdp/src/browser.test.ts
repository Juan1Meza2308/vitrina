/**
 * Tests de resolucion de navegador.
 *
 * Es lo unico del port a macOS que se puede comprobar sin un Mac: que las
 * listas tengan la forma correcta y el orden correcto. Que el binario arranque
 * de verdad solo se sabe alli, y por eso `candidates()` recibe la plataforma
 * como parametro en vez de leer `process.platform`.
 */
import { describe, it, expect } from 'vitest';
import { candidates, comoInstalarNavegador } from './browser.ts';

describe('candidates · macOS', () => {
  // Home explicito: si no, se colaria el del anfitrion, que aqui es Windows.
  const mac = candidates('darwin', '/Users/prueba');

  it('prefiere Chrome, porque en macOS no hay ningun Chromium preinstalado', () => {
    // Safari no sirve: no expone screencast por CDP. Asi que se apuesta por lo
    // que la mayoria ya tiene instalado.
    expect(mac[0]).toContain('Google Chrome');
  });

  it('apunta al ejecutable dentro del bundle, no al .app', () => {
    // `spawn` sobre un .app no arranca nada: hay que llegar a Contents/MacOS.
    for (const p of mac) expect(p).toContain('/Contents/MacOS/');
  });

  it('incluye los Chromium alternativos habituales', () => {
    const todos = mac.join(' ');
    for (const nombre of ['Google Chrome', 'Microsoft Edge', 'Brave', 'Chromium']) {
      expect(todos).toContain(nombre);
    }
  });

  it('mira antes en /Applications que en la carpeta del usuario', () => {
    const sistema = mac.findIndex((p) => p.startsWith('/Applications/'));
    const usuario = mac.findIndex((p) => !p.startsWith('/Applications/'));
    expect(sistema).toBeLessThan(usuario);
  });

  it('no cuela ninguna ruta de Windows', () => {
    for (const p of mac) {
      expect(p).not.toMatch(/^[A-Z]:/);
      expect(p).not.toContain('.exe');
    }
  });
});

describe('candidates · Windows', () => {
  const win = candidates('win32');

  it('sigue prefiriendo Edge, que viene preinstalado', () => {
    // El orden se invierte respecto a macOS a proposito: aqui Edge esta seguro
    // y no obliga a instalar nada.
    expect(win[0]?.toLowerCase()).toContain('msedge');
  });

  it('todas las rutas son ejecutables de Windows', () => {
    for (const p of win) expect(p.toLowerCase()).toContain('.exe');
  });
});

describe('candidates en Linux', () => {
  it('busca navegadores de Linux, no rutas de Windows', () => {
    // Esto empezo siendo un fallo de verdad: en Linux la funcion devolvia la
    // lista de Windows, asi que respondia "no hay navegador" con Chrome
    // instalado al lado. Se vio cuando la integracion continua —que corre en
    // Linux— no pudo ejecutar los tests que graban.
    const l = candidates('linux');
    expect(l.some((p) => p.includes('google-chrome'))).toBe(true);
    expect(l.some((p) => p.includes('chromium'))).toBe(true);
    expect(l.every((p) => !p.includes('C:/'))).toBe(true);
  });

  it('VITRINA_BROWSER manda sobre todo lo demas', () => {
    const l = candidates('linux', '/home/x', { VITRINA_BROWSER: '/opt/mi/chrome' });
    expect(l[0]).toBe('/opt/mi/chrome');
    expect(l.length).toBeGreaterThan(1);
  });

  it('y sin la variable, la lista no cambia', () => {
    expect(candidates('linux', '/home/x', {})).toEqual(candidates('linux', '/home/x', {}));
    expect(candidates('linux', '/home/x', {})[0]).toBe('/usr/bin/google-chrome');
  });
});

describe('comoInstalarNavegador', () => {
  it('en macOS nombra Chrome y descarta Safari explicitamente', () => {
    const m = comoInstalarNavegador('darwin');
    expect(m).toContain('Chrome');
    expect(m).toContain('Safari');
  });

  it('en Windows nombra Edge', () => {
    expect(comoInstalarNavegador('win32')).toContain('Edge');
    // En Linux se dice como salir del paso, que es lo unico util cuando el
    // navegador esta instalado en un sitio que la lista no cubre.
    expect(comoInstalarNavegador('linux')).toContain('VITRINA_BROWSER');
  });
});
