/**
 * La luz que sigue al cursor sobre el cristal.
 *
 * Es el detalle que separa "material" de "rectangulo translucido": una
 * superficie de cristal tiene un brillo que se mueve con quien la mira.
 *
 * UN SOLO OYENTE para toda la app, y no uno por panel. Con `onPointerMove` en
 * cada tarjeta serian decenas de manejadores de React disparando por cada pixel
 * de movimiento; aqui hay uno en la ventana que busca el cristal mas cercano al
 * objetivo y le escribe dos variables. El trabajo por evento es un `closest` y
 * dos escrituras de estilo.
 *
 * Ademas se acumula en `requestAnimationFrame`: el raton puede emitir cientos
 * de eventos por segundo y la pantalla solo se dibuja sesenta veces.
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
  /** El ultimo cristal tocado, para poder apagarlo al salir de el. */
  let ultimo: HTMLElement | null = null;

  const pintar = () => {
    raf = 0;
    const e = pendiente;
    pendiente = null;
    if (!e) return;

    const destino = (e.target as HTMLElement | null)?.closest?.('.cristal') as HTMLElement | null;
    if (destino !== ultimo && ultimo) {
      // Se limpian las variables al salir: si se quedaran puestas, la proxima
      // vez que el cursor entrara el brillo aparecería donde estuvo la ultima
      // vez y saltaria a su sitio.
      ultimo.style.removeProperty('--mx');
      ultimo.style.removeProperty('--my');
    }
    ultimo = destino;
    if (!destino) return;

    const r = destino.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    destino.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    destino.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
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
