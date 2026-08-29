/**
 * La luz que sigue al cursor sobre el cristal.
 *
 * Es el detalle que separa "material" de "rectangulo translucido": una
 * superficie de cristal tiene un brillo que se mueve con quien la mira.
 *
 * DOS decisiones aqui son de rendimiento, y las dos estan medidas (M13):
 *
 * 1. UN SOLO OYENTE para toda la app, no uno por panel, acumulado en
 *    `requestAnimationFrame`: el raton emite cientos de eventos por segundo y la
 *    pantalla se dibuja sesenta veces.
 *
 * 2. La luz es UNA CAJA QUE SE MUEVE, no un degradado en el fondo del panel.
 *    Cuando era una capa de fondo posicionada con variables CSS, cada
 *    movimiento del raton repintaba el panel entero: arrastrar la aguja bajaba
 *    de 60 a 20 fps y el hover sobre la linea de tiempo a 31. Moviendo una caja
 *    con `transform`, el compositor la recoloca sin repintar nada: 61 fps
 *    haciendo lo mismo.
 *
 * La caja se crea la primera vez que el cursor entra en cada cristal. Un panel
 * que nadie toca no paga ni el nodo.
 *
 * Con `prefers-reduced-motion` no se registra nada. No es una concesion a
 * medias: sin luz que persiga, el cristal se queda quieto y todo lo demas
 * —translucidez, filo, sombra— sigue igual.
 */
export function instalarReflejo(): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return () => {};
  }

  let pendiente: PointerEvent | null = null;
  let raf = 0;

  /**
   * La caja de luz de un cristal, creandola si es la primera vez.
   *
   * Va en un `<span>` y no en un `<div>` a proposito: hay reglas en la hoja que
   * seleccionan `> div` (la barra de progreso, el medidor de nivel) y un div
   * suelto dentro de un cristal se colaria en ellas.
   */
  const luzDe = (cristal: HTMLElement): HTMLElement | null => {
    const previa = cristal.querySelector<HTMLElement>(':scope > .luz > i');
    if (previa) return previa;
    const caja = document.createElement('span');
    caja.className = 'luz';
    const punto = document.createElement('i');
    caja.append(punto);
    cristal.append(caja);
    return punto;
  };

  const pintar = () => {
    raf = 0;
    const e = pendiente;
    pendiente = null;
    if (!e) return;

    const destino = (e.target as HTMLElement | null)?.closest?.('.cristal') as HTMLElement | null;
    if (!destino) return;

    const r = destino.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const punto = luzDe(destino);
    // Sin unidades relativas ni porcentajes: pixeles desde la esquina, que es
    // lo unico que `transform` necesita para no tocar el diseno.
    if (punto) {
      punto.style.transform = `translate3d(${e.clientX - r.left}px, ${e.clientY - r.top}px, 0)`;
    }
  };

  const alMover = (e: PointerEvent) => {
    pendiente = e;
    if (!raf) raf = requestAnimationFrame(pintar);
  };

  window.addEventListener('pointermove', alMover, { passive: true });
  return () => {
    window.removeEventListener('pointermove', alMover);
    if (raf) cancelAnimationFrame(raf);
  };
}
