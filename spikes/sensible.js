// Movimiento continuo para que el screencast siga entregando frames: solo emite
// cuando la pagina cambia, y sobre una pagina quieta no habria nada que medir.
const m = document.getElementById('mov');
function loop(ts) {
  m.style.transform = 'translateX(' + (Math.sin(ts / 500) * 300 + 300).toFixed(1) + 'px)';
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
