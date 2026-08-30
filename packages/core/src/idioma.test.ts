/**
 * Que el diccionario ingles cubra exactamente lo que la app pide.
 *
 * Este test es la contrapartida de usar la frase en espanol como clave. Ese
 * diseno tiene una ventaja grande —el codigo se lee como prosa y una traduccion
 * que falte degrada a espanol, no a `editor.stop_button`— y un fallo natural:
 * quien retoca una frase en espanol deja la traduccion huerfana sin enterarse, y
 * la app le ensena espanol a un usuario ingles en una pantalla suelta.
 *
 * A ojo no se ve nunca: habria que abrir la app en ingles y recorrer las quince
 * pantallas. Aqui se ve en dos segundos.
 *
 * Se recorre el codigo fuente, como `tools/enlaces.test.ts` recorre los `.md`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TEXTOS_EN } from './textos-en.ts';

const RAIZ = path.resolve(import.meta.dirname, '../../..');

/** Ficheros donde se piden traducciones. */
function fuentes(): string[] {
  // Todos los sitios que piden traducciones, incluidos los paquetes: la guia
  // que exporta una demo se arma en `packages/export`, y sus textos se ven
  // tanto como los de la interfaz.
  const dirs = [
    'apps/desktop/src/renderer',
    'apps/desktop/src/main',
    'packages/core/src',
    'packages/export/src',
    'packages/capture-cdp/src',
  ];
  const out: string[] = [];
  for (const d of dirs) {
    const abs = path.join(RAIZ, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!/\.tsx?$/.test(f) || f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue;
      out.push(path.join(abs, f));
    }
  }
  return out;
}

/**
 * Las claves que pide un fichero.
 *
 * Cubre las tres formas que se usan: `t('...')`, la misma partida en varias
 * lineas con `+` —los textos largos no caben en una— y `t.plural(n, 'uno',
 * 'varios')`.
 */
function clavesDe(fuente: string): string[] {
  // Fuera los comentarios: este mismo modulo explica el diseno con ejemplos
  // como `t('editor.stop_button')`, y sin quitarlos el test pediria traducir
  // los ejemplos de la documentacion.
  const src = fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const claves: string[] = [];
  const cadena = String.raw`'((?:[^'\\]|\\.)*)'`;
  const llamada = new RegExp(String.raw`\bt\(\s*${cadena}((?:\s*\+\s*${cadena})*)`, 'g');
  for (const m of src.matchAll(llamada)) {
    let entera = m[1] ?? '';
    for (const trozo of (m[2] ?? '').matchAll(new RegExp(cadena, 'g'))) {
      entera += trozo[1] ?? '';
    }
    claves.push(entera);
  }
  const plural = new RegExp(String.raw`t\.plural\([^,]+,\s*${cadena},\s*${cadena}`, 'g');
  for (const m of src.matchAll(plural)) {
    claves.push(m[1] ?? '', m[2] ?? '');
  }
  return claves;
}

const pedidas = new Set<string>();
for (const f of fuentes()) {
  for (const c of clavesDe(fs.readFileSync(f, 'utf8'))) pedidas.add(c);
}

describe('diccionario en ingles', () => {
  it('la app pide traducciones, y bastantes', () => {
    // Si esto baja de golpe, es que el extractor dejo de reconocer las llamadas
    // y el test estaria comprobando el vacio —pasando siempre—.
    expect(pedidas.size).toBeGreaterThan(150);
  });

  it('no falta ninguna', () => {
    const faltan = [...pedidas].filter((c) => !(c in TEXTOS_EN));
    expect(faltan).toEqual([]);
  });

  it('no sobra ninguna', () => {
    // Una entrada que ya nadie pide es una frase que se cambio en espanol: la
    // traduccion vieja se queda ahi y la nueva sale sin traducir.
    const sobran = Object.keys(TEXTOS_EN).filter((c) => !pedidas.has(c));
    expect(sobran).toEqual([]);
  });

  it('los huecos son los mismos en las dos frases', () => {
    // `hace {n} min` traducido como `{minutos} min ago` deja el numero fuera y
    // el texto sale con una llave literal en medio.
    const huecos = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    const descuadres = Object.entries(TEXTOS_EN)
      .filter(([es, en]) => huecos(es) !== huecos(en))
      .map(([es]) => es);
    expect(descuadres).toEqual([]);
  });
});
