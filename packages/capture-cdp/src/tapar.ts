/**
 * Tapar lo que no debe salir en el video.
 *
 * Una demo de una app real ensena datos reales: el saldo de un cliente, un
 * correo, una clave de API en un panel de ajustes. La solucion habitual es
 * difuminarlo DESPUES, en el editor, y es una solucion falsa: el dato sigue
 * dentro de los frames guardados en disco, y quien reciba la carpeta `.vitrina`
 * lo tiene entero. Aqui se tapa AL GRABAR, asi que el pixel sin difuminar no
 * llega a existir.
 *
 * Tres decisiones que no son evidentes:
 *
 *  - **Se tapa con CSS, no recorriendo el DOM.** Una hoja de estilos cubre
 *    tambien lo que aparezca despues —una fila que carga por fetch, un modal
 *    que se abre a mitad de demo— sin volver a mirar. Un script que recorriera
 *    el DOM tendria que reaccionar a cada mutacion y llegaria tarde justo
 *    cuando importa.
 *  - **Se difumina, no se oculta.** `display:none` mueve la maqueta y la demo
 *    deja de ser la demo: los botones cambian de sitio y el zoom automatico
 *    encuadra otra cosa. Un desenfoque deja el hueco donde estaba y se lee como
 *    lo que es, "aqui habia un dato".
 *  - **Una regla por selector.** Un selector mal escrito solo se pierde a si
 *    mismo; metidos todos en una regla, uno malo tumbaria el tapado entero y
 *    sin sintoma visible hasta ver el video.
 *
 * El desenfoque no es criptografia: es tapar. Con el radio por defecto un texto
 * de interfaz queda ilegible en el video, pero lo que no quieras ensenar de
 * ninguna manera es mejor no tenerlo en pantalla.
 */

import type { Tapado } from '@vitrina/core/types';

export type { Tapado };

/** Id del `<style>` inyectado. Fijo, para poder reponerlo sin duplicarlo. */
export const ESTILO_ID = 'vitrina-tapado';

/**
 * Global con los selectores, leida por el script de captura de eventos.
 *
 * Los dos scripts se inyectan por separado y no se conocen, pero comparten
 * mundo: el de entrada la consulta para no guardar la etiqueta de un elemento
 * tapado. Sin eso, tapar los pixeles dejaria el texto en `events.json`.
 */
export const GLOBAL_TAPADO = '__vitrinaTapado';

export const DESENFOQUE_POR_DEFECTO = 12;
const DESENFOQUE_MINIMO = 2;
const DESENFOQUE_MAXIMO = 80;

/**
 * De lo que teclea una persona a una lista de selectores.
 *
 * Se parte por lineas y por comas, que es como se escribe una lista en un campo
 * de texto. Las dos formas valen y se pueden mezclar.
 */
export function listaDeSelectores(texto: string): string[] {
  return selectoresValidos(texto.split(/[\n,]/));
}

/**
 * Descarta lo que no puede ser un selector.
 *
 * `{` y `}` no aparecen en ningun selector valido, y colados en la hoja
 * cerrarian la regla y dejarian entrar CSS arbitrario: el usuario escribe estas
 * reglas, asi que no es un problema de seguridad, pero si de diagnostico —el
 * fallo saldria como "el tapado no hace nada"—.
 */
export function selectoresValidos(brutos: readonly string[]): string[] {
  const vistos = new Set<string>();
  for (const bruto of brutos) {
    const s = bruto.trim();
    // `>` no se filtra: es un combinador legitimo (`.fila > .saldo`).
    if (!s || /[{};<]/.test(s)) continue;
    vistos.add(s);
  }
  return [...vistos];
}

/** Radio util: ni tan bajo que se lea, ni tan alto que borre media pantalla. */
export function desenfoqueValido(px: number | undefined): number {
  if (typeof px !== 'number' || !Number.isFinite(px)) return DESENFOQUE_POR_DEFECTO;
  return Math.min(DESENFOQUE_MAXIMO, Math.max(DESENFOQUE_MINIMO, Math.round(px)));
}

/** Los selectores en una sola cadena, para `closest()`. Vacia si no hay. */
export function selectorUnico(tapado: Tapado | null | undefined): string {
  return (tapado ? selectoresValidos(tapado.selectores) : []).join(', ');
}

/**
 * La hoja de estilos.
 *
 * `!important` porque la pagina puede traer su propio `filter` en el mismo
 * elemento, y perder por especificidad significaria ensenar el dato.
 */
export function cssDeTapado(tapado: Tapado | null | undefined): string {
  const selectores = tapado ? selectoresValidos(tapado.selectores) : [];
  if (selectores.length === 0) return '';
  const radio = desenfoqueValido(tapado?.desenfoque);
  return selectores
    .map((s) => `${s} { filter: blur(${radio}px) !important; }`)
    .join('\n');
}

/**
 * El script que instala la hoja y la REPONE.
 *
 * Aqui estan las dos trampas del fichero, y las dos fallan igual: el script
 * corre, no lanza, y el dato sale entero.
 *
 * **1. El parser se lleva el `<style>` por delante.** El script corre por
 * `Page.addScriptToEvaluateOnNewDocument`, o sea ANTES de que el parser
 * construya el documento —que es justo lo que hace falta para que el dato no se
 * pinte nunca sin tapar—, y a esa altura el documento esta vacio. Lo que se
 * anada ahi desaparece al construirse el documento de verdad. Por eso la hoja se
 * repone:
 *
 *  - Un `MutationObserver` sobre `document` avisa en cuanto aparece
 *    `documentElement`, y su callback es una microtarea: la hoja vuelve antes
 *    del primer pintado, sin un frame con el dato al aire.
 *  - Se observa tambien `documentElement` y `head` —solo `childList`, sin
 *    subarbol— para sobrevivir a una app que reemplace la cabecera al hidratar.
 *    Es barato: el callback compara un nodo y termina.
 *  - `readystatechange` cubre el caso raro en que el observer no llegue.
 *
 * **2. La CSP de la pagina bloquea el `<style>`.** Medido: con
 * `style-src 'self'` el elemento entra en el DOM y no aplica nada
 * —`getComputedStyle` devuelve `filter: none`— sin excepcion ni aviso. Y una app
 * con datos sensibles es justo la que trae CSP estricta. La hoja construida
 * (`new CSSStyleSheet` + `adoptedStyleSheets`) no pasa por esa comprobacion y si
 * aplica, asi que es el mecanismo principal.
 *
 * El `<style>` se pone igualmente, de respaldo: cuesta nada, cubre un motor sin
 * hojas construidas, y si la CSP lo anula solo queda un nodo inerte.
 */
export function fuenteDeTapado(tapado: Tapado | null | undefined): string {
  const css = cssDeTapado(tapado);
  if (!css) return '';
  return `(() => {
  const CSS = ${JSON.stringify(css)};
  const SELECTOR = ${JSON.stringify(selectorUnico(tapado))};
  window.${GLOBAL_TAPADO} = SELECTOR;

  const ob = new MutationObserver(() => instalar());
  const observar = (n) => { if (n) { try { ob.observe(n, { childList: true }); } catch (e) {} } };

  let hoja = null;
  let estilo = null;

  // Principal: la CSP de la pagina no la mira.
  const porHojaAdoptada = () => {
    try {
      if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in document)) return;
      if (!hoja) { hoja = new CSSStyleSheet(); hoja.replaceSync(CSS); }
      if (document.adoptedStyleSheets.indexOf(hoja) === -1) {
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, hoja];
      }
    } catch (e) { hoja = null; }
  };

  // Respaldo: un motor sin hojas construidas. Si la CSP lo anula, queda inerte.
  const porElemento = () => {
    const raiz = document.head || document.documentElement;
    if (!raiz) return;                       // documento aun vacio: ya volvera
    if (!estilo) {
      estilo = document.createElement('style');
      estilo.id = ${JSON.stringify(ESTILO_ID)};
      estilo.textContent = CSS;
    }
    // Reponer solo si hace falta: appendChild de lo que ya esta en su sitio
    // mueve el nodo, y moverlo en cada mutacion de la cabecera seria un bucle
    // de trabajo durante toda la grabacion.
    if (estilo.parentNode !== raiz || !estilo.isConnected) raiz.appendChild(estilo);
  };

  const instalar = () => {
    observar(document.documentElement);
    observar(document.head);
    porHojaAdoptada();
    porElemento();
  };

  observar(document);
  document.addEventListener('readystatechange', instalar, true);
  document.addEventListener('DOMContentLoaded', instalar, true);
  instalar();
})();
`;
}
