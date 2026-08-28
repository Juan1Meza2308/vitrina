/**
 * Ajustes que sobreviven al cierre de la app.
 *
 * La NORMALIZACION vive aqui, separada del fichero, por dos razones: es lo
 * unico que tiene logica, y este modulo no importa Electron, asi que se puede
 * probar. `main/index.ts` se queda con el `readFile` y el `writeFile`.
 *
 * Nunca lanza. Unos ajustes corruptos, a medias o de una version anterior tienen
 * que dar los valores de fabrica: que la app no arranque porque un JSON quedo
 * mal escrito seria un desastre desproporcionado para lo que guarda.
 */
import type { Orientacion } from '@vitrina/core';

export interface Ajustes {
  url: string;
  presetName: string;
  orientacion: Orientacion;
  micOn: boolean;
  micDeviceId: string;
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  url: 'http://localhost:3000',
  presetName: 'equilibrado',
  orientacion: 'horizontal',
  micOn: true,
  micDeviceId: '',
};

/** Campo a campo: uno malo no debe arrastrar a los demas. */
export function normalizarAjustes(crudo: unknown): Ajustes {
  const o = (typeof crudo === 'object' && crudo !== null ? crudo : {}) as Partial<Ajustes>;
  return {
    url: typeof o.url === 'string' && o.url.trim() ? o.url : AJUSTES_POR_DEFECTO.url,
    presetName: typeof o.presetName === 'string' && o.presetName
      ? o.presetName : AJUSTES_POR_DEFECTO.presetName,
    orientacion: o.orientacion === 'vertical' ? 'vertical' : 'horizontal',
    micOn: typeof o.micOn === 'boolean' ? o.micOn : AJUSTES_POR_DEFECTO.micOn,
    micDeviceId: typeof o.micDeviceId === 'string'
      ? o.micDeviceId : AJUSTES_POR_DEFECTO.micDeviceId,
  };
}
