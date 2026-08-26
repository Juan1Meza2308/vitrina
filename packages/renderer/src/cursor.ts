/**
 * Cursor sintetico.
 *
 * Los frames del screencast NO llevan cursor del sistema: la pagina se renderiza
 * sin el. Lo que en un grabador de escritorio es una pelea (hay que capturar sin
 * cursor para poder redibujarlo) aqui sale gratis, y permite tres cosas que un
 * cursor incrustado no permite:
 *
 *  - **Tamano constante en pantalla.** Al ampliar 1.5x, un cursor incrustado se
 *    ampliaria con la imagen y quedaria enorme. Este se dibuja siempre al mismo
 *    tamano de salida.
 *  - **Trazo suavizado**, sin los saltos del muestreo del raton.
 *  - **Ondas de click**, que hacen legible que ha pasado algo. Sin ellas, en un
 *    video mudo el espectador no sabe si el cambio lo provoco un click o solo
 *    ocurrio.
 */
import { CursorPath } from '@vitrina/core';
import type { InputEvent } from '@vitrina/core';
import type { Ctx, CursorSample } from './types.ts';

const RIPPLE_MS = 550;
/** Tras este tiempo sin mover el raton, el cursor se desvanece. */
const IDLE_MS = 2500;
const FADE_MS = 400;
/** Alto del cursor en px de salida, referido a un lienzo de 720p. */
const CURSOR_H_AT_720 = 26;

export class CursorSource {
  private path: CursorPath;
  private downs: number[] = [];
  private ups: number[] = [];
  private activity: number[] = [];

  constructor(events: InputEvent[], startedAt: number) {
    this.path = new CursorPath(events, startedAt);
    for (const e of events) {
      const rt = e.t - startedAt;
      if (e.type === 'down') this.downs.push(rt);
      else if (e.type === 'up') this.ups.push(rt);
      if (e.type === 'move' || e.type === 'down' || e.type === 'up') this.activity.push(rt);
    }
    this.downs.sort((a, b) => a - b);
    this.ups.sort((a, b) => a - b);
    this.activity.sort((a, b) => a - b);
  }

  sample(tMs: number): CursorSample | null {
    const p = this.path.at(tMs);
    if (!p) return null;

    const lastDown = lastBefore(this.downs, tMs);
    const lastUp = lastBefore(this.ups, tMs);
    const pressed = lastDown !== null && (lastUp === null || lastDown > lastUp);

    const ripples: number[] = [];
    for (let i = this.downs.length - 1; i >= 0; i--) {
      const age = tMs - this.downs[i]!;
      if (age < 0) continue;
      if (age > RIPPLE_MS) break;
      ripples.push(age / RIPPLE_MS);
    }

    const lastActivity = lastBefore(this.activity, tMs);
    let opacity = 1;
    if (lastActivity === null) {
      opacity = 0;
    } else {
      const idle = tMs - lastActivity - IDLE_MS;
      if (idle > 0) opacity = Math.max(0, 1 - idle / FADE_MS);
    }

    return { x: p.x, y: p.y, pressed, opacity, ripples };
  }
}

function lastBefore(sorted: number[], t: number): number | null {
  let lo = 0;
  let hi = sorted.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= t) {
      found = sorted[mid]!;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Puntero estilo macOS. El punto activo es (0,0), la punta. */
const ARROW: [number, number][] = [
  [0, 0], [0, 18.2], [4.6, 13.9], [7.6, 20.4], [10.6, 19], [7.6, 12.7], [13, 12.3],
];
const ARROW_H = 20.4;

/**
 * @param at Posicion YA convertida a coordenadas de salida.
 * @param outputH Alto del lienzo, para que el cursor mida igual a 720p y a 1080p.
 */
export function drawCursor(
  ctx: Ctx,
  sample: CursorSample,
  at: { x: number; y: number },
  outputH: number,
): void {
  if (sample.opacity <= 0.01) return;

  const px = (CURSOR_H_AT_720 * outputH) / 720;
  const unit = px / ARROW_H;

  ctx.save();
  ctx.globalAlpha = sample.opacity;

  // Las ondas van debajo del puntero para no taparlo.
  for (const p of sample.ripples) {
    const r = px * (0.5 + p * 1.9);
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${(1 - p) * 0.55 * sample.opacity})`;
    ctx.lineWidth = Math.max(1, px * 0.1 * (1 - p));
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${(1 - p) * 0.12 * sample.opacity})`;
    ctx.fill();
  }

  ctx.translate(at.x, at.y);
  // Encogerlo al pulsar da la sensacion tactil del click.
  const squeeze = sample.pressed ? 0.88 : 1;
  ctx.scale(unit * squeeze, unit * squeeze);

  ctx.beginPath();
  ctx.moveTo(ARROW[0]![0], ARROW[0]![1]);
  for (const [x, y] of ARROW.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();

  // Sombra + contorno oscuro: sin esto el cursor blanco desaparece sobre
  // fondos claros de la propia app.
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 6 / unit;
  ctx.shadowOffsetY = 1.5 / unit;
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(20,24,29,.55)';
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.restore();
}
