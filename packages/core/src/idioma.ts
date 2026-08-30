/**
 * Los textos de la app, en dos idiomas.
 *
 * LA CLAVE ES LA FRASE EN ESPANOL, no un identificador inventado. Es una
 * decision con contrapartida, asi que conviene tenerla escrita:
 *
 *  - El codigo se sigue leyendo como prosa. `t('Parar y editar')` dice lo que
 *    hace el boton; `t('editor.stop_button')` obliga a ir a buscarlo a otro
 *    fichero para saber que pone.
 *  - Si falta una traduccion sale el espanol, que es una frase de verdad, en
 *    vez de `editor.stop_button` en mitad de un boton.
 *  - No hay que inventar doscientos cincuenta nombres, que es donde se va la
 *    mitad del tiempo de un trabajo asi.
 *
 * La contrapartida es que retocar la frase en espanol deja la traduccion
 * huerfana sin avisar. Eso no se ve mirando, asi que lo caza un test:
 * `idioma.test.ts` recorre el codigo, saca todas las llamadas a `t('...')` y
 * comprueba que cada una tiene entrada en ingles —y que no sobra ninguna—.
 *
 * Este modulo no importa Electron ni React a proposito: lo usan la interfaz, el
 * proceso principal y la guia que exporta una demo.
 */
import { TEXTOS_EN } from './textos-en.ts';

export type Idioma = 'es' | 'en';

/** Valores que se pueden meter en los huecos `{...}` de una frase. */
export type Datos = Record<string, string | number>;

/**
 * El idioma de un codigo de sistema (`es-ES`, `en-GB`, `pt-BR`).
 *
 * Todo lo que no sea espanol cae en ingles y no al reves: quien tiene el
 * sistema en aleman entiende antes «Record» que «Grabar», y quien lo tiene en
 * espanol es el unico caso que sabemos seguro.
 */
export function idiomaDe(locale: string | undefined | null): Idioma {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/** Rellena los huecos `{nombre}` de una frase. */
function rellenar(texto: string, datos?: Datos): string {
  if (!datos) return texto;
  return texto.replace(/\{(\w+)\}/g, (entero, clave: string) =>
    clave in datos ? String(datos[clave]) : entero);
}

/**
 * Traduce una frase.
 *
 * En espanol devuelve la propia clave: el original ES el texto, asi que no hay
 * diccionario que mantener para el idioma en el que esta escrita la app.
 */
export function traducir(texto: string, idioma: Idioma, datos?: Datos): string {
  const frase = idioma === 'es' ? texto : (TEXTOS_EN[texto] ?? texto);
  return rellenar(frase, datos);
}

/**
 * Singular o plural, con las dos formas traducidas.
 *
 * Solo hace falta en un punado de sitios («3 selectores tapados», «1 silencio»)
 * y para dos idiomas que pluralizan igual. El dia que entre uno que no —el
 * polaco tiene tres formas—, esto se cambia; adelantarlo hoy seria construir
 * para un problema que no existe.
 */
export function plural(n: number, uno: string, varios: string, idioma: Idioma): string {
  return traducir(n === 1 ? uno : varios, idioma, { n });
}

/**
 * Una funcion `t` ya atada a un idioma, que es como se usa en la practica.
 *
 *     const t = conIdioma('en');
 *     t('Grabar')                        // 'Record'
 *     t('hace {n} min', { n: 9 })        // '9 min ago'
 */
export function conIdioma(idioma: Idioma) {
  const t = (texto: string, datos?: Datos) => traducir(texto, idioma, datos);
  t.plural = (n: number, uno: string, varios: string) => plural(n, uno, varios, idioma);
  t.idioma = idioma;
  return t;
}

export type T = ReturnType<typeof conIdioma>;
