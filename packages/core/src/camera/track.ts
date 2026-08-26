/**
 * De tramos de zoom a movimiento continuo.
 *
 * Tres decisiones que no son obvias:
 *
 *  1. **El muelle actua sobre log2(escala), no sobre la escala.** Ir de 1x a 2x
 *     y de 2x a 4x son el mismo salto para el ojo, pero uno recorre 1 unidad y
 *     el otro 2. Interpolando linealmente, las ampliaciones grandes arrancan de
 *     golpe y frenan de forma pastosa. En logaritmico el ritmo relativo es
 *     constante y se siente natural.
 *
 *  2. **La pista se precomputa entera a 240 Hz.** Un muelle es estado: para
 *     saber donde esta en el segundo 30 hay que haber simulado los 30 anteriores.
 *     El editor necesita acceso aleatorio para hacer scrubbing, y el exportador
 *     necesita que dos ejecuciones den exactamente lo mismo. Precomputar
 *     resuelve las dos cosas; el coste es ~170 KB por minuto.
 *
 *  3. **El recorte a los bordes se aplica tras integrar, no solo al objetivo.**
 *     Con amortiguacion por debajo de 1 hay sobreoscilacion, y sin esto se
 *     asomaria el borde del material justo en el rebote.
 */
import type { CaptureSize, InputEvent, ZoomSegment } from '../types.ts';
import type { CameraConfig } from './config.ts';
import { clamp, clampCenter, rectCenter, type CameraState, type Point } from './geometry.ts';

const HZ = 240;

export interface BuildTrackOptions {
  segments: ZoomSegment[];
  events: InputEvent[];
  viewport: CaptureSize;
  startedAt: number;
  durationMs: number;
  config: CameraConfig;
}

export class CameraTrack {
  readonly hz = HZ;
  readonly durationMs: number;
  private cx: Float32Array;
  private cy: Float32Array;
  private scale: Float32Array;

  constructor(durationMs: number, cx: Float32Array, cy: Float32Array, scale: Float32Array) {
    this.durationMs = durationMs;
    this.cx = cx;
    this.cy = cy;
    this.scale = scale;
  }

  get samples(): number {
    return this.scale.length;
  }

  /** Estado de camara en un instante, interpolado entre muestras. */
  sampleAt(tMs: number): CameraState {
    const last = this.scale.length - 1;
    if (last < 0) return { cx: 0, cy: 0, scale: 1 };

    const pos = clamp((tMs / 1000) * this.hz, 0, last);
    const i = Math.floor(pos);
    const j = Math.min(last, i + 1);
    const f = pos - i;

    return {
      cx: lerp(this.cx[i]!, this.cx[j]!, f),
      cy: lerp(this.cy[i]!, this.cy[j]!, f),
      scale: lerp(this.scale[i]!, this.scale[j]!, f),
    };
  }
}

export function buildCameraTrack(opts: BuildTrackOptions): CameraTrack {
  const { segments, viewport, durationMs, config } = opts;

  const n = Math.max(1, Math.ceil((durationMs / 1000) * HZ) + 1);
  const cxs = new Float32Array(n);
  const cys = new Float32Array(n);
  const scales = new Float32Array(n);

  // Muelle: omega se deriva del tiempo de asentamiento pedido, para que el
  // ajuste sea en milisegundos y no en constantes de resorte sin significado.
  const settleSec = Math.max(0.05, config.settleMs / 1000);
  const omega = 4 / (config.damping * settleSec);
  const k = omega * omega;
  const c = 2 * config.damping * omega;
  const dt = 1 / HZ;

  const cursor = new CursorPath(opts.events, opts.startedAt);

  const home: Point = { x: viewport.w / 2, y: viewport.h / 2 };
  let cx = home.x;
  let cy = home.y;
  let logS = 0;
  let vx = 0;
  let vy = 0;
  let vs = 0;
  let segIndex = 0;

  for (let i = 0; i < n; i++) {
    const tMs = (i / HZ) * 1000;

    while (segIndex < segments.length && segments[segIndex]!.endMs < tMs) segIndex++;
    const seg = segments[segIndex];
    const active = seg && tMs >= seg.startMs && tMs <= seg.endMs ? seg : null;

    let targetScale = 1;
    let target: Point = home;

    if (active) {
      targetScale = active.scale;
      target = rectCenter(active.target);
      if (config.followCursor) {
        target = followCursor(target, cursor.at(tMs), targetScale, viewport, config.deadZone);
      }
    }

    const clampedTarget = clampCenter(target.x, target.y, targetScale, viewport);
    const targetLog = Math.log2(targetScale);

    // Euler semi-implicito: estable de sobra a 240 Hz para estos omega.
    vx += (-k * (cx - clampedTarget.x) - c * vx) * dt;
    vy += (-k * (cy - clampedTarget.y) - c * vy) * dt;
    vs += (-k * (logS - targetLog) - c * vs) * dt;
    cx += vx * dt;
    cy += vy * dt;
    logS += vs * dt;

    // Tope duro en 1x. La amortiguacion por debajo de 1 sobreoscila, y al
    // volver del zoom la escala se pasaria de largo: una vista mas grande que
    // la fuente se compone con bordes negros. Se para el muelle en el tope en
    // lugar de recortar solo la salida, o el integrador acumularia velocidad
    // contra la pared y el rebote saldria disparado.
    if (logS < 0) {
      logS = 0;
      vs = 0;
    }

    const scale = Math.pow(2, logS);
    const safe = clampCenter(cx, cy, scale, viewport);
    // Misma razon en los bordes: sin anular la velocidad al chocar, el muelle
    // sigue empujando contra el limite y arranca de golpe al soltarse.
    if (safe.x !== cx) vx = 0;
    if (safe.y !== cy) vy = 0;
    cx = safe.x;
    cy = safe.y;

    cxs[i] = cx;
    cys[i] = cy;
    scales[i] = scale;
  }

  return new CameraTrack(durationMs, cxs, cys, scales);
}

/**
 * Zona muerta: la camara solo se mueve cuando el cursor sale del centro de la
 * vista. Siguiendolo siempre, la imagen tiembla con cada temblor del raton; sin
 * seguirlo nunca, el cursor se sale del encuadre al arrastrar o al recorrer un
 * menu. Se empuja el objetivo solo por el exceso, no hasta el cursor.
 */
function followCursor(
  target: Point,
  cursor: Point | null,
  scale: number,
  viewport: CaptureSize,
  deadZone: number,
): Point {
  if (!cursor) return target;

  const halfDeadW = (viewport.w / scale) * deadZone / 2;
  const halfDeadH = (viewport.h / scale) * deadZone / 2;

  let { x, y } = target;
  const dx = cursor.x - x;
  const dy = cursor.y - y;

  if (Math.abs(dx) > halfDeadW) x += dx - Math.sign(dx) * halfDeadW;
  if (Math.abs(dy) > halfDeadH) y += dy - Math.sign(dy) * halfDeadH;

  return { x, y };
}

/** Posicion del cursor en cualquier instante, interpolada entre eventos de movimiento. */
export class CursorPath {
  private ts: Float64Array;
  private xs: Float32Array;
  private ys: Float32Array;

  constructor(events: InputEvent[], startedAt: number) {
    const moves = events
      .filter((e) => e.x !== undefined && e.y !== undefined && e.type !== 'scroll')
      .map((e) => ({ rt: e.t - startedAt, x: e.x!, y: e.y! }))
      .sort((a, b) => a.rt - b.rt);

    this.ts = new Float64Array(moves.length);
    this.xs = new Float32Array(moves.length);
    this.ys = new Float32Array(moves.length);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i]!;
      this.ts[i] = m.rt;
      this.xs[i] = m.x;
      this.ys[i] = m.y;
    }
  }

  at(tMs: number): Point | null {
    const n = this.ts.length;
    if (n === 0) return null;
    if (tMs <= this.ts[0]!) return { x: this.xs[0]!, y: this.ys[0]! };
    if (tMs >= this.ts[n - 1]!) return { x: this.xs[n - 1]!, y: this.ys[n - 1]! };

    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.ts[mid]! <= tMs) lo = mid;
      else hi = mid;
    }
    const span = this.ts[hi]! - this.ts[lo]!;
    const f = span > 0 ? (tMs - this.ts[lo]!) / span : 0;
    return {
      x: lerp(this.xs[lo]!, this.xs[hi]!, f),
      y: lerp(this.ys[lo]!, this.ys[hi]!, f),
    };
  }
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}
