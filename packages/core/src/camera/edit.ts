/**
 * Edicion manual de los tramos de zoom.
 *
 * El motor propone y el usuario dispone: `planSegments` genera los tramos y
 * estas funciones los corrigen. Todas son puras y devuelven una lista nueva,
 * que es lo que permite deshacer y lo que hace que el preview se recalcule solo.
 *
 * Viven aqui y no en el componente de la linea de tiempo porque lo dificil no
 * es arrastrar: es mantener las invariantes. Una lista de tramos siempre esta
 * ordenada, sin solapes, con duracion suficiente para percibirse y dentro del
 * material. Un componente de UI que ademas tenga que garantizar eso acaba
 * teniendo la logica repartida entre el manejador del raton y el render.
 */
import type { CaptureSize, ZoomSegment } from '../types.ts';
import { clamp, clampCenter, rectCenter } from './geometry.ts';

/** Por debajo de esto un tramo es un parpadeo, no un movimiento de camara. */
export const MIN_DURACION_MS = 300;

export interface EditContext {
  durationMs: number;
  minDurationMs?: number;
}

const orden = (z: ZoomSegment[]): ZoomSegment[] =>
  [...z].sort((a, b) => a.startMs - b.startMs);

/** Marca un tramo como tocado a mano para que la replanificacion no lo pise. */
function manual(s: ZoomSegment): ZoomSegment {
  return { ...s, auto: false };
}

/**
 * Desplaza un tramo sin cambiar su duracion.
 *
 * Se frena contra los vecinos en lugar de reordenar la lista: si al arrastrar
 * los tramos se intercambiaran de sitio, el que se esta moviendo cambiaria de
 * indice a mitad del gesto y el raton se quedaria agarrado a otro.
 */
export function moveSegment(
  zooms: ZoomSegment[],
  i: number,
  nuevoInicioMs: number,
  ctx: EditContext,
): ZoomSegment[] {
  const s = zooms[i];
  if (!s) return zooms;

  const dur = s.endMs - s.startMs;
  const anterior = zooms[i - 1];
  const siguiente = zooms[i + 1];
  const min = anterior ? anterior.endMs : 0;
  const max = (siguiente ? siguiente.startMs : ctx.durationMs) - dur;

  const inicio = clamp(nuevoInicioMs, min, Math.max(min, max));
  const out = [...zooms];
  out[i] = manual({ ...s, startMs: inicio, endMs: inicio + dur });
  return out;
}

/**
 * Mueve un borde del tramo. El otro extremo se queda donde esta.
 */
export function resizeSegment(
  zooms: ZoomSegment[],
  i: number,
  borde: 'inicio' | 'fin',
  nuevoMs: number,
  ctx: EditContext,
): ZoomSegment[] {
  const s = zooms[i];
  if (!s) return zooms;

  const minDur = ctx.minDurationMs ?? MIN_DURACION_MS;
  const anterior = zooms[i - 1];
  const siguiente = zooms[i + 1];
  const out = [...zooms];

  if (borde === 'inicio') {
    const min = anterior ? anterior.endMs : 0;
    out[i] = manual({ ...s, startMs: clamp(nuevoMs, min, s.endMs - minDur) });
  } else {
    const max = siguiente ? siguiente.startMs : ctx.durationMs;
    out[i] = manual({ ...s, endMs: clamp(nuevoMs, s.startMs + minDur, max) });
  }
  return out;
}

/**
 * Desplaza el ENCUADRE de un tramo, no su posicion en el tiempo.
 *
 * El motor centra el zoom donde estaba el elemento pulsado, que casi siempre
 * acierta, pero no siempre: un tramo insertado a mano se centra donde estuviera
 * el cursor, y a veces interesa mirar un poco mas arriba o al lado. Sin esto la
 * unica salida era borrar el tramo y volver a crearlo en otro instante.
 *
 * El centro se recorta a los limites del material ANTES de guardarlo. Dejar que
 * lo recorte el compositor haria que el encuadre guardado y el que se ve
 * dejaran de coincidir, y arrastrar mas alla del borde acumularia un desfase
 * invisible que reaparece al cambiar la escala.
 */
export function moveSegmentTarget(
  zooms: ZoomSegment[],
  i: number,
  deltaX: number,
  deltaY: number,
  viewport: CaptureSize,
): ZoomSegment[] {
  const s = zooms[i];
  if (!s) return zooms;

  const centro = rectCenter(s.target);
  const seguro = clampCenter(centro.x + deltaX, centro.y + deltaY, s.scale, viewport);

  const out = [...zooms];
  out[i] = manual({
    ...s,
    target: {
      ...s.target,
      x: seguro.x - s.target.w / 2,
      y: seguro.y - s.target.h / 2,
    },
  });
  return out;
}

export function deleteSegment(zooms: ZoomSegment[], i: number): ZoomSegment[] {
  if (i < 0 || i >= zooms.length) return zooms;
  return zooms.filter((_, j) => j !== i);
}

export function setSegmentScale(
  zooms: ZoomSegment[],
  i: number,
  escala: number,
): ZoomSegment[] {
  const s = zooms[i];
  if (!s) return zooms;
  const out = [...zooms];
  out[i] = manual({ ...s, scale: escala });
  return out;
}

export interface InsertOptions extends EditContext {
  /** Centro del encuadre, en coordenadas de la fuente. */
  center: { x: number; y: number };
  viewport: { w: number; h: number };
  scale: number;
  duracionMs?: number;
  label?: string | null;
}

/**
 * Inserta un tramo en el instante dado.
 *
 * Devuelve la lista sin tocar si no cabe: es preferible que el boton no haga
 * nada visible a que aparezca un tramo de 40 ms metido a presion entre otros
 * dos, que el usuario no podria ni agarrar para borrarlo.
 */
export function insertSegment(
  zooms: ZoomSegment[],
  atMs: number,
  opts: InsertOptions,
): ZoomSegment[] {
  const minDur = opts.minDurationMs ?? MIN_DURACION_MS;
  const ordenados = orden(zooms);

  const anterior = [...ordenados].reverse().find((s) => s.endMs <= atMs);
  const siguiente = ordenados.find((s) => s.startMs >= atMs);
  // Un instante que cae DENTRO de un tramo existente no admite otro encima.
  if (ordenados.some((s) => atMs > s.startMs && atMs < s.endMs)) return zooms;

  const hueco = {
    min: anterior ? anterior.endMs : 0,
    max: siguiente ? siguiente.startMs : opts.durationMs,
  };
  if (hueco.max - hueco.min < minDur) return zooms;

  const deseada = opts.duracionMs ?? 1800;
  const startMs = clamp(atMs, hueco.min, hueco.max - minDur);
  const endMs = Math.min(hueco.max, startMs + deseada);
  if (endMs - startMs < minDur) return zooms;

  const w = opts.viewport.w / opts.scale;
  const h = opts.viewport.h / opts.scale;
  const nuevo: ZoomSegment = {
    startMs,
    endMs,
    target: { x: opts.center.x - w / 2, y: opts.center.y - h / 2, w, h },
    scale: opts.scale,
    auto: false,
    label: opts.label ?? null,
  };
  return orden([...zooms, nuevo]);
}

/** Hay algo que se perderia al volver al zoom automatico. */
export function hasManualEdits(zooms: ZoomSegment[]): boolean {
  return zooms.some((s) => !s.auto);
}

/**
 * Recorte del material. `null` en el final significa "hasta donde llegue".
 * Se exige un resto minimo para que no se pueda dejar la grabacion en nada.
 */
export function clampTrim(
  startMs: number,
  endMs: number | null,
  durationMs: number,
  minRestoMs = 500,
): { trimStartMs: number; trimEndMs: number | null } {
  const fin = endMs ?? durationMs;
  const inicio = clamp(startMs, 0, Math.max(0, durationMs - minRestoMs));
  const finReal = clamp(fin, inicio + minRestoMs, durationMs);
  return {
    trimStartMs: inicio,
    trimEndMs: finReal >= durationMs ? null : finReal,
  };
}
