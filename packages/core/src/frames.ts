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
import type { Manifest } from '@vitrina/core';

export class FrameIndex {
  /** Offsets en ms desde el inicio de la captura, ordenados. */
  private times: Float64Array;
  private files: string[];

  constructor(manifest: Manifest) {
    const sorted = [...manifest.frames].sort((a, b) => a.t - b.t);
    this.times = new Float64Array(sorted.length);
    this.files = sorted.map((f) => f.file);
    for (let i = 0; i < sorted.length; i++) {
      this.times[i] = sorted[i]!.t * 1000 - manifest.startedAt;
    }
  }

  get length(): number {
    return this.files.length;
  }

  /**
   * Frame vigente en ese instante: el ultimo cuyo timestamp no lo supera.
   * Antes del primero devuelve el primero, para que un recorte que empiece en 0
   * no se quede sin imagen.
   */
  at(tMs: number): string | null {
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
    return this.files[best] ?? null;
  }
}
