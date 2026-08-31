/**
 * La configuracion de seguridad de la ventana, leida del fuente.
 *
 * Son cuatro lineas repartidas entre `index.ts` y `index.html`, y cualquiera de
 * ellas se puede perder en una refactorizacion sin que nada falle: la
 * aplicacion arranca igual, la interfaz se ve igual, y los tests pasan igual.
 * Lo que cambia es que el renderer vuelve a tener los permisos del sistema, o
 * que la ventana puede irse a otro dominio con el puente IPC colgando.
 *
 * `verificar-app.ts --seguridad` comprueba lo que la ventana HACE, que es mejor
 * medida; esto es lo que falla en `npm test`, en segundos y sin navegador, para
 * que nadie llegue a subirlo. Los dos hacen falta.
 *
 * Se lee el texto del fichero a proposito: importar `index.ts` arrancaria
 * Electron entero.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const main = fs.readFileSync(path.join(import.meta.dirname, 'index.ts'), 'utf8');
const html = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'renderer', 'index.html'), 'utf8');

/** La CSP del documento, tal cual esta escrita. */
const csp = /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]+)"/.exec(html)?.[1] ?? '';

describe('la ventana de la aplicacion', () => {
  it('corre en el sandbox del sistema', () => {
    expect(main).toMatch(/sandbox:\s*true/);
  });

  it('aisla el contexto y no da Node al renderer', () => {
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
  });

  it('no deja navegar fuera ni abrir ventanas nuevas', () => {
    expect(main).toContain("'will-navigate'");
    expect(main).toContain('setWindowOpenHandler');
    expect(main).toMatch(/action:\s*'deny'/);
  });

  it('solo concede el permiso de camara y microfono', () => {
    // El resto —geolocalizacion, notificaciones, portapapeles— se niega. Una
    // pagina grabada que los pida no debe poder conseguirlos a traves de la app.
    expect(main).toContain('setPermissionRequestHandler');
    expect(main).toMatch(/permission === 'media'/);
  });
});

describe('la politica de contenido', () => {
  it('esta puesta', () => {
    expect(csp).not.toBe('');
  });

  it('no deja ejecutar codigo que no venga de la app', () => {
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    // `unsafe-inline` solo se admite en los estilos: React inyecta estilos en
    // linea. En los scripts seria dejar entrar cualquier XSS.
    const scripts = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';
    expect(scripts).not.toContain('unsafe-inline');
  });

  it('no permite cargar nada de fuera por defecto', () => {
    expect(csp).toContain("default-src 'self'");
  });
});
