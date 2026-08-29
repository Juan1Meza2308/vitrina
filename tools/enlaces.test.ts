/**
 * Que ningun enlace de la documentacion apunte a un fichero que no existe.
 *
 * La portada se reescribio moviendo 900 lineas a `docs/`, y ese es exactamente
 * el momento en que un enlace se queda apuntando a donde el texto ya no esta.
 * Un README con enlaces rotos es peor que uno largo: el largo al menos cumple lo
 * que promete.
 *
 * Solo se miran los enlaces LOCALES. Los externos se caen con el tiempo y
 * comprobarlos aqui haria que la bateria dependiera de que haya red, que es la
 * clase de test que ensena a ignorar los fallos.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');

/** Los .md de la raiz y de docs/, que son los que lee alguien de fuera. */
const documentos = [
  ...fs.readdirSync(RAIZ).filter((f) => f.endsWith('.md')).map((f) => f),
  ...fs.readdirSync(path.join(RAIZ, 'docs'))
    .filter((f) => f.endsWith('.md')).map((f) => path.join('docs', f)),
];

/** `[texto](destino)` y `src="destino"`, que es como van las imagenes. */
function enlacesDe(texto: string): string[] {
  const salida: string[] = [];
  for (const m of texto.matchAll(/\]\(([^)\s]+)\)/g)) salida.push(m[1]!);
  for (const m of texto.matchAll(/src="([^"]+)"/g)) salida.push(m[1]!);
  return salida;
}

describe('enlaces de la documentacion', () => {
  it.each(documentos)('%s no apunta a nada que falte', (doc) => {
    const texto = fs.readFileSync(path.join(RAIZ, doc), 'utf8');
    const rotos = enlacesDe(texto)
      .filter((d) => !/^(https?:|mailto:|#)/.test(d))
      .map((d) => d.split('#')[0]!)
      .filter((d) => d.length > 0)
      .filter((d) => !fs.existsSync(path.resolve(RAIZ, path.dirname(doc), d)));
    expect(rotos).toEqual([]);
  });
});
