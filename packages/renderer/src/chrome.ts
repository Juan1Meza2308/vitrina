/**
 * Barra de navegador sintetica, dibujada en vectorial.
 *
 * Se graba con `--app=`, que abre una ventana sin pestanas ni barra de
 * direcciones, y la barra se anade despues aqui. Es mejor que capturar la real
 * por tres razones: sale nitida a cualquier resolucion porque no se amplia con
 * el zoom, es tematizable, y no ensucia la demo con las pestanas ni los
 * marcadores de quien graba.
 */
import type { FrameStyle, Rect } from '@vitrina/core';
import type { Ctx } from './types.ts';

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

export function drawChrome(
  ctx: Ctx,
  window: Rect,
  barH: number,
  style: Pick<FrameStyle, 'chrome' | 'chromeLabel' | 'chromeTheme'>,
): void {
  if (!style.chrome || style.chrome === 'none' || barH <= 0) return;
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
