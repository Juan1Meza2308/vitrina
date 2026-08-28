/**
 * Rotulos y teclas dibujados sobre el video.
 *
 * Es lo que un grabador de pixeles no puede hacer. Vitrina captura desde el DOM,
 * asi que de cada click sabe el TEXTO del elemento pulsado —"Cotizar", "Email"—
 * y de cada pulsacion la tecla. Esos datos ya estaban en el log desde el primer
 * dia; esto es solo enseñarlos.
 *
 * Restriccion que no se negocia: `InputEvent.key` guarda `"char"` para
 * cualquier tecla imprimible, a proposito, para que una demo con un login no
 * filtre credenciales. Aqui los `"char"` se dibujan como un punto generico y
 * NUNCA se reconstruye texto. Si alguien "arregla" eso, rompe la garantia.
 */
import type { InputEvent } from '@vitrina/core';
import type { Ctx } from './types.ts';

/** Cuanto se queda en pantalla un rotulo antes de desvanecerse. */
const ROTULO_MS = 1400;
const ROTULO_FADE_MS = 350;
/** Ventana en la que varias teclas seguidas se agrupan en una sola fila. */
const TECLAS_MS = 1100;
const TECLAS_FADE_MS = 300;

export interface OverlaySample {
  /** Texto del elemento pulsado, en coordenadas de la FUENTE. */
  label: { text: string; x: number; y: number; opacity: number } | null;
  /** Teclas recientes, ya saneadas. */
  keys: { teclas: string[]; opacity: number } | null;
}

/** Nombre presentable de una tecla. Los caracteres nunca se muestran. */
export function nombreTecla(key: string): string {
  if (key === 'char') return '•';
  switch (key) {
    case ' ': return 'Space';
    case 'Enter': return '⏎';
    case 'Backspace': return '⌫';
    case 'Tab': return '⇥';
    case 'Escape': return 'Esc';
    case 'ArrowUp': return '↑';
    case 'ArrowDown': return '↓';
    case 'ArrowLeft': return '←';
    case 'ArrowRight': return '→';
    default: return key.length > 12 ? key.slice(0, 12) : key;
  }
}

export class OverlaySource {
  private clicks: { t: number; x: number; y: number; text: string }[] = [];
  private teclas: { t: number; nombre: string }[] = [];

  constructor(events: InputEvent[], startedAt: number) {
    for (const e of events) {
      const t = e.t - startedAt;
      if (e.type === 'down' && e.label && e.x !== undefined && e.y !== undefined) {
        const text = e.label.trim();
        if (text) this.clicks.push({ t, x: e.x, y: e.y, text });
      } else if (e.type === 'key' && e.key) {
        this.teclas.push({ t, nombre: nombreTecla(e.key) });
      }
    }
    this.clicks.sort((a, b) => a.t - b.t);
    this.teclas.sort((a, b) => a.t - b.t);
  }

  sample(tMs: number): OverlaySample {
    return { label: this.labelAt(tMs), keys: this.keysAt(tMs) };
  }

  private labelAt(tMs: number): OverlaySample['label'] {
    for (let i = this.clicks.length - 1; i >= 0; i--) {
      const c = this.clicks[i]!;
      const edad = tMs - c.t;
      if (edad < 0) continue;
      if (edad > ROTULO_MS) return null;
      const restante = ROTULO_MS - edad;
      const opacity = Math.min(1, restante / ROTULO_FADE_MS);
      return { text: c.text, x: c.x, y: c.y, opacity };
    }
    return null;
  }

  private keysAt(tMs: number): OverlaySample['keys'] {
    // Se agrupan las pulsaciones seguidas: teclear una palabra son diez eventos
    // y diez insignias parpadeando serian ruido, no informacion.
    const recientes: string[] = [];
    let ultima = -Infinity;
    for (let i = this.teclas.length - 1; i >= 0; i--) {
      const k = this.teclas[i]!;
      const edad = tMs - k.t;
      if (edad < 0) continue;
      if (edad > TECLAS_MS) break;
      recientes.unshift(k.nombre);
      ultima = Math.max(ultima, k.t);
      if (recientes.length >= 8) break;
    }
    if (recientes.length === 0) return null;
    const restante = TECLAS_MS - (tMs - ultima);
    return { teclas: recientes, opacity: Math.max(0, Math.min(1, restante / TECLAS_FADE_MS)) };
  }
}

/**
 * Rotulo del elemento pulsado, junto al punto del click.
 *
 * Junto al click y no en una posicion fija porque señala: puesto abajo del todo
 * seria un subtitulo y habria que buscar a que se refiere.
 */
export function drawLabel(
  ctx: Ctx,
  texto: string,
  at: { x: number; y: number },
  opacity: number,
  content: { x: number; y: number; w: number; h: number },
): void {
  if (opacity <= 0 || !texto) return;

  const alto = Math.max(20, content.w * 0.032);
  const fuente = Math.round(alto * 0.52);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = `500 ${fuente}px system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const pad = alto * 0.42;
  const ancho = Math.min(content.w * 0.6, ctx.measureText(texto).width + pad * 2);

  // Debajo y a la derecha del puntero, para no quedar bajo la propia flecha.
  let x = at.x + alto * 0.7;
  let y = at.y + alto * 1.1;
  // Dentro de la pantalla: pegado al borde se leeria a medias.
  x = Math.min(x, content.x + content.w - ancho - pad);
  x = Math.max(x, content.x + pad);
  y = Math.min(y, content.y + content.h - alto - pad);
  y = Math.max(y, content.y + pad);

  ctx.beginPath();
  ctx.roundRect(x, y, ancho, alto, alto / 2);
  ctx.fillStyle = 'rgba(12,15,20,.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.14)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#e9eef5';
  ctx.fillText(texto, x + pad, y + alto / 2 + 0.5);
  ctx.restore();
}

/** Insignias de teclas, centradas en la parte baja de la pantalla. */
export function drawKeys(
  ctx: Ctx,
  teclas: string[],
  opacity: number,
  content: { x: number; y: number; w: number; h: number },
): void {
  if (opacity <= 0 || teclas.length === 0) return;

  const alto = Math.max(22, content.w * 0.038);
  const fuente = Math.round(alto * 0.5);
  const hueco = alto * 0.22;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = `600 ${fuente}px system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const anchos = teclas.map((k) => Math.max(alto, ctx.measureText(k).width + alto * 0.7));
  const total = anchos.reduce((a, b) => a + b, 0) + hueco * (teclas.length - 1);
  let x = content.x + (content.w - total) / 2;
  const y = content.y + content.h - alto * 1.9;

  for (let i = 0; i < teclas.length; i++) {
    const w = anchos[i]!;
    ctx.beginPath();
    ctx.roundRect(x, y, w, alto, alto * 0.26);
    ctx.fillStyle = 'rgba(12,15,20,.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e9eef5';
    ctx.fillText(teclas[i]!, x + w / 2, y + alto / 2 + 0.5);
    x += w + hueco;
  }
  ctx.restore();
}
