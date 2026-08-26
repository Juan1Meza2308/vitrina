/**
 * Script que se inyecta en la pagina grabada para capturar la entrada del
 * usuario desde el DOM.
 *
 * Por que desde el DOM y no con un hook del sistema operativo:
 *
 *  - Las coordenadas llegan en client space del viewport emulado, que mapea 1:1
 *    con el frame del screencast. Cero matematica de scroll o escala.
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
 */
export const INJECT_SOURCE = String.raw`
(() => {
  if (window.__vitrinaInstalled) return;
  window.__vitrinaInstalled = true;

  const send = (o) => { try { window.__vitrina(JSON.stringify(o)); } catch (e) {} };

  const rect = (el) => {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };

  // Si el objetivo es un icono o un span dentro de un boton, su caja es
  // demasiado pequena para encuadrar. Se sube al control real.
  const controlOf = (el) => {
    if (!el || !el.closest) return el;
    return el.closest('button, a, input, select, textarea, [role="button"], [role="tab"], label') || el;
  };

  const label = (el) => {
    if (!el) return null;
    const a = el.getAttribute ? (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title')) : null;
    const t = a || el.textContent || '';
    return t.replace(/\s+/g, ' ').trim().slice(0, 60) || null;
  };

  let lastMove = 0;
  addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - lastMove < 8) return;          // ~120 Hz basta para suavizar el trazo
    lastMove = now;
    send({ t: Date.now(), type: 'move', x: Math.round(e.clientX), y: Math.round(e.clientY) });
  }, true);

  ['pointerdown', 'pointerup'].forEach((type) => {
    addEventListener(type, (e) => {
      const el = controlOf(e.target);
      send({
        t: Date.now(),
        type: type === 'pointerdown' ? 'down' : 'up',
        x: Math.round(e.clientX), y: Math.round(e.clientY),
        rect: rect(el), tag: el && el.tagName, label: label(el),
      });
    }, true);
  });

  addEventListener('wheel', (e) => send({
    t: Date.now(), type: 'wheel',
    x: Math.round(e.clientX), y: Math.round(e.clientY), dy: Math.round(e.deltaY),
  }), true);

  // Nunca se registra la tecla pulsada si es imprimible. Grabar caracteres
  // convertiria cualquier demo con un login en una fuga de credenciales.
  addEventListener('keydown', (e) => send({
    t: Date.now(), type: 'key', key: e.key.length === 1 ? 'char' : e.key,
  }), true);

  addEventListener('scroll', () => send({
    t: Date.now(), type: 'scroll', sy: Math.round(scrollY),
  }), true);
})();
`;

export const BINDING_NAME = '__vitrina';
