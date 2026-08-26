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

describe('comoInstalarNavegador', () => {
  it('en macOS nombra Chrome y descarta Safari explicitamente', () => {
    const m = comoInstalarNavegador('darwin');
    expect(m).toContain('Chrome');
    expect(m).toContain('Safari');
  });

  it('en Windows nombra Edge', () => {
    expect(comoInstalarNavegador('win32')).toContain('Edge');
  });
});
