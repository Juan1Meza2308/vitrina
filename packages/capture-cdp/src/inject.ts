/**
 * Script que se inyecta en la pagina grabada para capturar la entrada del
 * usuario desde el DOM.
 *
 * Por que desde el DOM y no con un hook del sistema operativo:
 *
 *  - Las coordenadas llegan en client space del viewport emulado. Se multiplican
 *    por `devicePixelRatio` para dejarlas en pixeles del FRAME, que es el
 *    espacio en el que trabajan la camara y el compositor. En horizontal el
 *    ratio es 1 y no cambia nada; grabando en vista de movil vale 2 o 3, y sin
 *    esta conversion la camara encuadraria la esquina superior izquierda.
 *  - `Date.now()` aqui y `metadata.timestamp` del screencast comparten reloj,
 *    asi que la sincronizacion sale gratis. Con un hook del SO alinear el log
 *    con los frames es un dolor permanente.
 *  - Cada click trae el `getBoundingClientRect()` del elemento pulsado. Eso
 *    permite encuadrar el boton o el formulario de verdad en lugar de adivinar
 *    un radio alrededor del cursor. Es la ventaja que un grabador de pixeles
 *    no puede tener.
 *
 * Va como texto plano porque se pasa a `Page.addScriptToEvaluateOnNewDocument`,
 * que lo ejecuta en el main world y no lo bloquea la CSP de la pagina.
 *
 * Comparte mundo con el script de tapado (`tapar.ts`) y lee su global para no
 * guardar la etiqueta de un elemento tapado: difuminar el pixel y escribir el
 * texto en `events.json` seria tapar solo lo que se ve.
 */
import { GLOBAL_TAPADO } from './tapar.ts';

export const INJECT_SOURCE = String.raw`
(() => {
  if (window.__vitrinaInstalled) return;
  window.__vitrinaInstalled = true;

  const send = (o) => { try { window.__vitrina(JSON.stringify(o)); } catch (e) {} };

  // De px CSS a px del frame. Se lee en cada evento y no una vez al instalar:
  // la emulacion puede aplicarse despues de que el script corra, y un valor
  // congelado a 1 dejaria todo el log a escala equivocada.
  const k = () => window.devicePixelRatio || 1;
  const px = (v) => Math.round(v * k());

  const rect = (el) => {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: px(r.x), y: px(r.y), w: px(r.width), h: px(r.height) };
  };

  // Si el objetivo es un icono o un span dentro de un boton, su caja es
  // demasiado pequena para encuadrar. Se sube al control real.
  const controlOf = (el) => {
    if (!el || !el.closest) return el;
    return el.closest('button, a, input, select, textarea, [role="button"], [role="tab"], label') || el;
  };

  // Lo que esta tapado tampoco deja su texto en el log.
  //
  // El tapado difumina los pixeles, pero la etiqueta del elemento pulsado se
  // guarda en events.json: sin esto, tapar el saldo del cliente lo dejaria
  // escrito en claro dentro de la propia carpeta de la grabacion. La lista de
  // selectores la publica el script de tapado en esta global.
  const tapado = (el) => {
    const sel = window.${GLOBAL_TAPADO};
    if (!sel || !el || !el.closest) return false;
    try { return !!el.closest(sel); } catch (e) { return false; }
  };

  const label = (el) => {
    if (!el || tapado(el)) return null;
    const a = el.getAttribute ? (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title')) : null;
    const t = a || el.textContent || '';
    return t.replace(/\s+/g, ' ').trim().slice(0, 60) || null;
  };

  let lastMove = 0;
  addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - lastMove < 8) return;          // ~120 Hz basta para suavizar el trazo
    lastMove = now;
    send({ t: Date.now(), type: 'move', x: px(e.clientX), y: px(e.clientY) });
  }, true);

  ['pointerdown', 'pointerup'].forEach((type) => {
    addEventListener(type, (e) => {
      const el = controlOf(e.target);
      send({
        t: Date.now(),
        type: type === 'pointerdown' ? 'down' : 'up',
        x: px(e.clientX), y: px(e.clientY),
        rect: rect(el), tag: el && el.tagName, label: label(el),
      });
    }, true);
  });

  addEventListener('wheel', (e) => send({
    t: Date.now(), type: 'wheel',
    x: px(e.clientX), y: px(e.clientY), dy: px(e.deltaY),
  }), true);

  // Nunca se registra la tecla pulsada si es imprimible. Grabar caracteres
  // convertiria cualquier demo con un login en una fuga de credenciales.
  addEventListener('keydown', (e) => send({
    t: Date.now(), type: 'key', key: e.key.length === 1 ? 'char' : e.key,
  }), true);

  addEventListener('scroll', () => send({
    t: Date.now(), type: 'scroll', sy: px(scrollY),
  }), true);
})();
`;

export const BINDING_NAME = '__vitrina';
