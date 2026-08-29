/**
 * Burbuja de camara web.
 *
 * Tres decisiones que no son evidentes:
 *
 *  - **Va anclada al LIENZO, no al contenido.** Es el mismo argumento que la
 *    marca de agua: una burbuja que se moviera con el zoom seria parte de la
 *    demo, y no lo es —es quien la cuenta—. Quieta en una esquina se lee como
 *    lo que es.
 *  - **La imagen se recorta, nunca se deforma.** La camara entrega 4:3 y la
 *    burbuja es cuadrada. Escalar para que quepa haria una cara mas estrecha
 *    de lo que es, que es exactamente el defecto que nadie perdona en su propia
 *    imagen. Se recorta al centro, como un `object-fit: cover`.
 *  - **El espejo es opcional y por defecto va apagado.** Quien se graba se ve
 *    en espejo y le resulta natural; quien mira el video espera el texto de la
 *    camiseta al derecho.
 *
 * El aro se dibuja DESPUES de quitar el recorte y con `stroke`, no como un
 * circulo relleno debajo: un aro pintado debajo asoma por el antialiasing del
 * borde y se ve un halo sucio a un pixel del contenido.
 */
import type { CamaraStyle } from '@vitrina/core';
import { anclarEnEsquina } from './overlays.ts';
import type { Ctx, ImageLike } from './types.ts';

/** Ni tan pequena que no se vea una cara, ni tanta que tape la demo. */
const TAMANO_MINIMO = 0.06;
const TAMANO_MAXIMO = 0.45;

/** Caja de la burbuja en el lienzo. Publica para poder comprobarla sin pintar. */
export function cajaDeCamara(
  estilo: Pick<CamaraStyle, 'esquina' | 'tamano'>,
  lienzo: { w: number; h: number },
): { x: number; y: number; d: number } {
  const d = Math.round(
    lienzo.h * Math.min(TAMANO_MAXIMO, Math.max(TAMANO_MINIMO, estilo.tamano)),
  );
  const { x, y } = anclarEnEsquina(estilo.esquina, { w: d, h: d }, lienzo);
  return { x: Math.round(x), y: Math.round(y), d };
}

/**
 * Recorte centrado de la fuente para llenar un cuadrado sin deformar.
 *
 * Devuelve el rectangulo de la IMAGEN que se dibuja, no el del lienzo.
 */
export function recorteCover(
  fuente: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  if (fuente.w <= 0 || fuente.h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const lado = Math.min(fuente.w, fuente.h);
  return {
    x: Math.round((fuente.w - lado) / 2),
    y: Math.round((fuente.h - lado) / 2),
    w: lado,
    h: lado,
  };
}

/**
 * Dibuja la burbuja.
 *
 * @param img Frame de la camara. En el navegador un `<video>`, en Node una
 *            imagen decodificada: los dos valen como `CanvasImageSource`, que es
 *            justo lo que permite que preview y export compartan esta funcion.
 */
export function drawCamara(
  ctx: Ctx,
  img: ImageLike,
  fuente: { w: number; h: number },
  estilo: CamaraStyle,
  lienzo: { w: number; h: number },
): void {
  if (estilo.tamano <= 0 || fuente.w <= 0 || fuente.h <= 0) return;

  const { x, y, d } = cajaDeCamara(estilo, lienzo);
  const radio = estilo.forma === 'circulo' ? d / 2 : Math.round(d * 0.18);
  const src = recorteCover(fuente);

  // La sombra va en una silueta opaca aparte, antes del recorte: `clip()` con
  // una forma redondeada anula `shadowBlur`. Es el mismo tropiezo que ya tiene
  // fijado el compositor con la ventana, y por eso se resuelve igual.
  if (estilo.sombra > 0) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = estilo.sombra;
    ctx.shadowOffsetY = estilo.sombra * 0.3;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.roundRect(x, y, d, d, radio);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, d, d, radio);
  ctx.clip();
  if (estilo.espejo) {
    // Se voltea alrededor del centro de la burbuja, no del lienzo: sin la
    // traslacion la imagen se iria al otro lado de la pantalla.
    ctx.translate(x + d / 2, y);
    ctx.scale(-1, 1);
    ctx.translate(-(x + d / 2), -y);
  }
  ctx.drawImage(img, src.x, src.y, src.w, src.h, x, y, d, d);
  ctx.restore();

  if (estilo.borde > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(
      x + estilo.borde / 2, y + estilo.borde / 2,
      d - estilo.borde, d - estilo.borde,
      Math.max(0, radio - estilo.borde / 2),
    );
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = estilo.borde;
    ctx.stroke();
    ctx.restore();
  }
}
