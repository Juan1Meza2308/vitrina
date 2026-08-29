#!/usr/bin/env node
/**
 * Genera el icono de la app.
 *
 *   node tools/icono.ts
 *
 * Se dibuja con codigo y no se guarda solo el PNG por la misma razon por la que
 * los fondos del compositor se dibujan y no se importan: asi se puede cambiar un
 * color y regenerar todos los tamanos, en vez de reeditar una imagen a mano.
 *
 * electron-builder saca el .ico de Windows y el .icns de macOS de este mismo
 * PNG, con tal de que sea de 1024 y cuadrado.
 *
 * El diseno tiene una sola regla: que se reconozca a 16 px, que es el tamano al
 * que la gente lo va a ver de verdad en la barra de tareas. Por eso son tres
 * formas grandes y ningun detalle: el degradado de la marca, la ventana —la
 * vitrina— y el triangulo de reproducir. Un icono con la interfaz dibujada
 * dentro se convierte en una mancha gris a ese tamano.
 */
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs/promises';
import path from 'node:path';

const LADO = 1024;
/** Los mismos colores de la interfaz (`styles.css`), no unos parecidos. */
const VIOLETA = '#6d5efc';
const VERDE = '#c3f53c';
const TINTA = '#12151b';

/** Rectangulo redondeado, que es la forma de todo icono moderno. */
function caja(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function dibujarIcono(lado = LADO): Buffer {
  const cv = createCanvas(lado, lado);
  const ctx = cv.getContext('2d');
  const u = lado / 1024;   // todo en unidades de 1024, escalado al final

  // Fondo: el degradado de la marca, en diagonal como en la app.
  const g = ctx.createLinearGradient(0, 0, lado, lado);
  g.addColorStop(0, VIOLETA);
  g.addColorStop(1, VERDE);
  ctx.fillStyle = g;
  caja(ctx, 0, 0, lado, lado, 224 * u);
  ctx.fill();

  // La vitrina: una ventana oscura, con la proporcion de un video (16:9) para
  // que se lea como pantalla y no como tarjeta.
  const w = 640 * u;
  const h = 360 * u;
  ctx.fillStyle = TINTA;
  caja(ctx, (lado - w) / 2, (lado - h) / 2, w, h, 48 * u);
  ctx.fill();

  // El triangulo de reproducir, centrado en la ventana.
  const r = 92 * u;
  ctx.fillStyle = VERDE;
  ctx.beginPath();
  ctx.moveTo(lado / 2 - r * 0.52, lado / 2 - r * 0.86);
  ctx.lineTo(lado / 2 + r * 0.92, lado / 2);
  ctx.lineTo(lado / 2 - r * 0.52, lado / 2 + r * 0.86);
  ctx.closePath();
  ctx.fill();

  return cv.toBuffer('image/png');
}

const destino = path.resolve('apps/desktop/build/icon.png');
await fs.mkdir(path.dirname(destino), { recursive: true });
await fs.writeFile(destino, dibujarIcono());
console.log(`  icono   ${destino}  ${LADO}x${LADO}`);
