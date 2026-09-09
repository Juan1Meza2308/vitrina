/**
 * Indice de frames por tiempo.
 *
 * La captura es de framerate VARIABLE por naturaleza: el screencast solo emite
 * un frame cuando la pagina cambia, asi que un segundo estatico puede tener
 * tres frames y uno con animacion noventa. Eso NO es un fallo, es lo eficiente.
 *
 * El export si es de framerate constante, asi que para cada instante de salida
 * hay que buscar el frame vigente y sostenerlo. Asumir aqui que la captura era
 * constante desplazaria el video respecto al log de eventos, y el zoom llegaria
 * tarde o pronto sin que nada lo explique.
 */
import type { Frame, Manifest } from '@vitrina/core';

/**
 * Clave estable para cachear un frame, da igual el formato de la carpeta.
 *
 * El nome de fichero de las grabaciones viejas (`frames/000001.jpg`) y el
 * offset de las nuevas (`frames.bin` + `offset`) no se parecen, pero la cache
 * del preview y del exportador tiene que poder usar UNA sola tabla sin saber
 * con que formato esta grabando el momento. Este es el identificador comun.
 */
export function frameKey(f: Frame): string {
  return f.offset != null ? `f${f.offset}` : f.file ?? '';
}

/**
 * Como se pide un frame por el protocolo `vitrina://`.
 *
 * Las nuevas grabaciones piden el segmento dentro de `frames.bin`; las viejas,
 * el JPEG de `frames/`. El que sirve el protocolo (el proceso principal) asi
 * sabe si leer posicionado o un fichero entero. Es una funcion pura: la usa el
 * renderer, que no toca disco.
 */
export function frameURL(f: Frame): string {
  return f.offset != null && f.bytes > 0
    ? `frames.bin?offset=${f.offset}&bytes=${f.bytes}`
    : `frames/${f.file}`;
}

export class FrameIndex {
  /** Offsets en ms desde el inicio de la captura, ordenados. */
  private times: Float64Array;
  private frames: Frame[];

  constructor(manifest: Manifest) {
    const sorted = [...manifest.frames].sort((a, b) => a.t - b.t);
    this.times = new Float64Array(sorted.length);
    this.frames = sorted;
    for (let i = 0; i < sorted.length; i++) {
      this.times[i] = sorted[i]!.t * 1000 - manifest.startedAt;
    }
  }

  get length(): number {
    return this.frames.length;
  }

  /**
   * Frame vigente en ese instante: el ultimo cuyo timestamp no lo supera.
   * Antes del primero devuelve el primero, para que un recorte que empiece en 0
   * no se quede sin imagen.
   */
  at(tMs: number): Frame | null {
    const n = this.times.length;
    if (n === 0) return null;

    let lo = 0;
    let hi = n - 1;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid]! <= tMs) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return this.frames[best] ?? null;
  }
}
