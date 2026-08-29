/**
 * Las dos versiones del repositorio tienen que decir lo mismo.
 *
 * `apps/desktop/package.json` es la que acaba dentro del instalador y la que
 * `app.getVersion()` devuelve —o sea, con la que se compara el aviso de
 * actualizacion—, y la de la raiz es la que se lee de un vistazo. Si se separan,
 * la publicacion sale con una etiqueta y la app instalada cree tener otra: el
 * aviso de version nueva no aparece nunca, o aparece para siempre.
 *
 * Es un descuido de un segundo al subir una version, y no se ve mirando.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const leer = (p: string) =>
  JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', p), 'utf8')) as
    { version: string };

describe('versiones del repositorio', () => {
  it('la del repositorio y la de la app coinciden', () => {
    expect(leer('apps/desktop/package.json').version).toBe(leer('package.json').version);
  });

  it('y son una version publicable, sin sufijos', () => {
    // `0.1.0-dev` como version publicada haria que el tag fuera `v0.1.0-dev` y
    // que la comparacion de versiones tratara la siguiente como preliberacion.
    expect(leer('package.json').version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
