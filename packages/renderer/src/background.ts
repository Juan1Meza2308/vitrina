/**
 * Fondos. Es la capa que da el look caracteristico y la unica que el
 * espectador ve completa, asi que cualquier banda o corte se nota.
 */
import type { Background } from '@vitrina/core';
import type { Ctx, ImageLike } from './types.ts';

/**
 * @param imagen Fondo ya decodificado. El compositor no carga ficheros: en Node
 *   la imagen viene de `loadImage` y en el navegador de `createImageBitmap`, y
 *   meter esa diferencia aqui obligaria a tener dos compositores.
 */
export function paintBackground(
  ctx: Ctx, bg: Background, w: number, h: number, imagen?: ImageLike | null,
): void {
  switch (bg.kind) {
    case 'none':
      return;   // el lienzo se queda transparente

    case 'solid':
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, w, h);
      return;

    case 'linear': {
      // El angulo se interpreta como en CSS: 0 = hacia arriba, 90 = a la derecha.
      const rad = ((bg.angle - 90) * Math.PI) / 180;
      const cx = w / 2;
      const cy = h / 2;
      const half = Math.abs(w * Math.cos(rad)) / 2 + Math.abs(h * Math.sin(rad)) / 2;
      const g = ctx.createLinearGradient(
        cx - Math.cos(rad) * half, cy - Math.sin(rad) * half,
        cx + Math.cos(rad) * half, cy + Math.sin(rad) * half,
      );
      g.addColorStop(0, bg.from);
      g.addColorStop(1, bg.to);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      return;
    }

    case 'mesh':
      paintMesh(ctx, bg.colors, w, h);
      return;

    case 'image':
      // Color de respaldo debajo: si la imagen aun no cargo o falta, el frame
      // sale con fondo sobrio en vez de transparente.
      ctx.fillStyle = '#14181d';
      ctx.fillRect(0, 0, w, h);
      if (imagen) paintCover(ctx, imagen, w, h, bg.blur);
      return;
  }
}

/**
 * Dibuja la imagen cubriendo el lienzo, recortando por el lado que sobre.
 *
 * Con desenfoque se dibuja mas grande que el lienzo a proposito: `filter: blur`
 * difumina tambien contra el exterior del dibujo, asi que a tamano justo
 * apareceria una orla clara en los cuatro bordes.
 */
function paintCover(ctx: Ctx, img: ImageLike, w: number, h: number, blur: number): void {
  const iw = anchoDe(img);
  const ih = altoDe(img);
  if (!iw || !ih) return;

  const margen = blur > 0 ? blur * 2 : 0;
  const destW = w + margen * 2;
  const destH = h + margen * 2;
  const escala = Math.max(destW / iw, destH / ih);
  const dw = iw * escala;
  const dh = ih * escala;

  ctx.save();
  if (blur > 0) ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(img, -margen + (destW - dw) / 2, -margen + (destH - dh) / 2, dw, dh);
  ctx.restore();
}

/** `ImageBitmap` expone width/height; `Image` de napi tambien, pero el tipo
 *  union de la DOM incluye variantes que no, asi que se leen con cuidado. */
function anchoDe(img: ImageLike): number {
  const v = img as { width?: number; naturalWidth?: number };
  return v.naturalWidth || v.width || 0;
}
function altoDe(img: ImageLike): number {
  const v = img as { height?: number; naturalHeight?: number };
  return v.naturalHeight || v.height || 0;
}

/**
 * Malla de gradientes: varias manchas radiales grandes superpuestas.
 *
 * Las posiciones son fijas y no aleatorias a proposito. El export tiene que
 * poder reproducir exactamente el fondo del preview, y un fondo con ruido
 * aleatorio parpadearia entre frames.
 */
const BLOBS: { x: number; y: number; r: number }[] = [
  { x: 0.18, y: 0.22, r: 0.75 },
  { x: 0.85, y: 0.15, r: 0.65 },
  { x: 0.72, y: 0.88, r: 0.8 },
  { x: 0.1, y: 0.9, r: 0.6 },
  { x: 0.5, y: 0.5, r: 0.5 },
];

function paintMesh(ctx: Ctx, colors: string[], w: number, h: number): void {
  const palette = colors.length > 0 ? colors : ['#6d5efc', '#c3f53c'];
  ctx.fillStyle = palette[0]!;
  ctx.fillRect(0, 0, w, h);

  const diag = Math.hypot(w, h);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (const [i, blob] of BLOBS.entries()) {
    const color = palette[(i + 1) % palette.length]!;
    const cx = blob.x * w;
    const cy = blob.y * h;
    const r = blob.r * diag * 0.5;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(color, 0.85));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** Acepta #rgb, #rrggbb y deja pasar cualquier otra notacion sin tocarla. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  if (!hex.startsWith('#')) return color;
  const body = hex.slice(1);
  const full =
    body.length === 3 ? body.split('').map((c) => c + c).join('')
    : body.length === 6 ? body
    : null;
  if (!full) return color;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
