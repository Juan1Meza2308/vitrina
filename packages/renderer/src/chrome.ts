/**
 * Marcos sinteticos, dibujados en vectorial.
 *
 * Se graba con `--app=`, que abre una ventana sin pestanas ni barra de
 * direcciones, y el marco se anade despues aqui. Es mejor que capturar el real
 * por tres razones: sale nitido a cualquier resolucion porque no se amplia con
 * el zoom, es tematizable, y no ensucia la demo con las pestanas ni los
 * marcadores de quien graba.
 *
 * Hay dos familias: `macos` / `windows` (barra de navegador) y `phone` (bisel
 * alrededor). La carcasa y la barra van DEBAJO del contenido, pero la muesca
 * del movil va ENCIMA: cuelga dentro de la pantalla, que es lo que la hace
 * leerse como muesca y no como una banda negra pegada arriba. De ahi que sean
 * dos funciones y no una.
 */
import { notchRect } from '@vitrina/core';
import type { FrameStyle, FrameLayout, Rect } from '@vitrina/core';
import type { Ctx } from './types.ts';

type ChromeStyle = Pick<FrameStyle, 'chrome' | 'chromeLabel' | 'chromeTheme'>;

interface Theme {
  bar: string;
  border: string;
  pill: string;
  text: string;
  control: string;
}

const THEMES: Record<'light' | 'dark', Theme> = {
  dark: { bar: '#1c2128', border: 'rgba(255,255,255,.07)', pill: '#0f1318', text: 'rgba(230,237,243,.72)', control: 'rgba(230,237,243,.55)' },
  light: { bar: '#e9ecef', border: 'rgba(0,0,0,.09)', pill: '#f8f9fa', text: 'rgba(28,33,40,.72)', control: 'rgba(28,33,40,.55)' },
};

const SEMAFORO = ['#ff5f57', '#febc2e', '#28c840'];

/** Carcasa del movil. Casi negra, para que el bisel no compita con la app. */
const MOVIL_CUERPO = '#0a0c10';
/** Filo metalico del borde exterior: sin el, la carcasa se lee como un hueco. */
const MOVIL_FILO = 'rgba(255,255,255,.22)';

/**
 * Dibuja el marco: la barra de navegador, o la carcasa del movil con su isla.
 *
 * El llamante ya ha recortado al cuerpo de la ventana, asi que aqui se puede
 * pintar sin preocuparse de las esquinas redondeadas.
 */
export function drawFrame(ctx: Ctx, layout: FrameLayout, style: ChromeStyle): void {
  const chrome = style.chrome;
  if (!chrome || chrome === 'none') return;

  if (chrome === 'phone') {
    drawPhoneBody(ctx, layout);
    return;
  }
  if (layout.barH > 0) drawBrowserBar(ctx, layout.window, layout.barH, style);
}

/**
 * La muesca, encima del contenido.
 *
 * Va despues del video a proposito: en un telefono real la muesca se come un
 * trozo de pantalla. Ocupa menos de la mitad del ancho, asi que la app se
 * sigue viendo a los dos lados.
 */
export function drawNotch(ctx: Ctx, layout: FrameLayout, style: ChromeStyle): void {
  if (style.chrome !== 'phone') return;
  const n = notchRect(layout.content);
  if (n.w < 24 || n.h < 6) return;      // pantalla demasiado pequena

  const rCon = n.h * 0.42;   // rebaje concavo donde la pantalla entra en la muesca
  const rBaj = n.h * 0.58;   // esquinas de abajo
  const xL = n.x;
  const xR = n.x + n.w;
  const yT = n.y;
  const yB = n.y + n.h;

  // Los rebajes de arriba son CONCAVOS: la pantalla se curva hacia dentro de la
  // muesca. Con esquinas normales el resultado es un rectangulo negro pegado al
  // borde, que es exactamente lo que no se quiere. Se consiguen poniendo el
  // punto de control de la curva en la esquina: la forma se ensancha al llegar
  // arriba en vez de redondearse hacia dentro.
  ctx.beginPath();
  ctx.moveTo(xL - rCon, yT);
  ctx.quadraticCurveTo(xL, yT, xL, yT + rCon);
  ctx.lineTo(xL, yB - rBaj);
  ctx.quadraticCurveTo(xL, yB, xL + rBaj, yB);
  ctx.lineTo(xR - rBaj, yB);
  ctx.quadraticCurveTo(xR, yB, xR, yB - rBaj);
  ctx.lineTo(xR, yT + rCon);
  ctx.quadraticCurveTo(xR, yT, xR + rCon, yT);
  ctx.closePath();
  ctx.fillStyle = '#000000';
  ctx.fill();

  const cy = yT + n.h * 0.47;

  // Auricular: una ranura apenas mas clara que el negro. Subirle el contraste
  // la convierte en una raya gris que canta, y en el telefono real casi no se
  // distingue.
  const ranuraW = n.w * 0.26;
  const ranuraH = Math.max(2, n.h * 0.09);
  ctx.beginPath();
  ctx.roundRect(n.x + n.w * 0.46 - ranuraW / 2, cy - ranuraH / 2, ranuraW, ranuraH, ranuraH / 2);
  ctx.fillStyle = '#161920';
  ctx.fill();

  // Camara: oscura, con un reflejo azulado pequeno y apagado dentro. Un punto
  // azul saturado se lee como un LED, no como una lente.
  const r = Math.max(1.5, n.h * 0.115);
  const camX = n.x + n.w * 0.68;
  ctx.beginPath();
  ctx.arc(camX, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#10141c';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(camX, cy, r * 0.52, 0, Math.PI * 2);
  ctx.fillStyle = '#1d2c4e';
  ctx.fill();
}

/** Carcasa: cuerpo y filo. El hueco de la pantalla lo tapa el video. */
function drawPhoneBody(ctx: Ctx, layout: FrameLayout): void {
  const { window: win, radius } = layout;

  ctx.fillStyle = MOVIL_CUERPO;
  ctx.beginPath();
  ctx.roundRect(win.x, win.y, win.w, win.h, radius);
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = MOVIL_FILO;
  ctx.lineWidth = Math.max(1, layout.insets.left * 0.16);
  ctx.beginPath();
  const o = ctx.lineWidth / 2;
  ctx.roundRect(win.x + o, win.y + o, win.w - ctx.lineWidth, win.h - ctx.lineWidth, Math.max(0, radius - o));
  ctx.stroke();
  ctx.restore();
}

function drawBrowserBar(ctx: Ctx, window: Rect, barH: number, style: ChromeStyle): void {
  const theme = THEMES[style.chromeTheme ?? 'dark'];

  ctx.fillStyle = theme.bar;
  ctx.fillRect(window.x, window.y, window.w, barH);

  // Linea de separacion con el contenido: sin ella la barra y una app oscura
  // se funden y la ventana pierde la lectura de "navegador".
  ctx.fillStyle = theme.border;
  ctx.fillRect(window.x, window.y + barH - 1, window.w, 1);

  const cy = window.y + barH / 2;
  const unit = barH / 28;   // todo escala con la altura de la barra

  if (style.chrome === 'macos') {
    const r = 6 * unit;
    let x = window.x + 16 * unit + r;
    for (const color of SEMAFORO) {
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      x += r * 2 + 8 * unit;
    }
  } else {
    // Controles de Windows a la derecha: minimizar, maximizar, cerrar.
    const s = 5 * unit;
    let x = window.x + window.w - 22 * unit;
    ctx.strokeStyle = theme.control;
    ctx.lineWidth = Math.max(1, 1.4 * unit);
    for (const kind of ['close', 'max', 'min'] as const) {
      ctx.beginPath();
      if (kind === 'close') {
        ctx.moveTo(x - s, cy - s); ctx.lineTo(x + s, cy + s);
        ctx.moveTo(x + s, cy - s); ctx.lineTo(x - s, cy + s);
      } else if (kind === 'max') {
        ctx.rect(x - s, cy - s, s * 2, s * 2);
      } else {
        ctx.moveTo(x - s, cy); ctx.lineTo(x + s, cy);
      }
      ctx.stroke();
      x -= 26 * unit;
    }
  }

  drawUrlPill(ctx, window, barH, unit, theme, style);
}

/** Pastilla central con el dominio. Da el contexto de "esto es una web". */
function drawUrlPill(
  ctx: Ctx,
  window: Rect,
  barH: number,
  unit: number,
  theme: Theme,
  style: Pick<FrameStyle, 'chrome' | 'chromeLabel'>,
): void {
  const label = style.chromeLabel;
  if (!label) return;

  const pillH = barH * 0.56;
  const pillW = Math.min(window.w * 0.44, Math.max(140 * unit, label.length * 8 * unit + 60 * unit));
  const px = window.x + (window.w - pillW) / 2;
  const py = window.y + (barH - pillH) / 2;

  ctx.beginPath();
  ctx.roundRect(px, py, pillW, pillH, pillH / 2);
  ctx.fillStyle = theme.pill;
  ctx.fill();

  // Candado: dos trazos, mas legible a tamano pequeno que un icono detallado.
  const lockX = px + 14 * unit;
  const lockY = window.y + barH / 2;
  const ls = 3.2 * unit;
  ctx.strokeStyle = theme.control;
  ctx.lineWidth = Math.max(1, 1.3 * unit);
  ctx.beginPath();
  ctx.arc(lockX, lockY - ls * 0.5, ls * 0.62, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = theme.control;
  ctx.fillRect(lockX - ls * 0.85, lockY - ls * 0.4, ls * 1.7, ls * 1.5);

  ctx.fillStyle = theme.text;
  ctx.font = `${Math.round(pillH * 0.46)}px system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, lockX + 12 * unit, lockY + 0.5);
}
