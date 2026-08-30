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
import type { Background, FrameStyle, Idioma, Orientacion, Project, Watermark } from '@vitrina/core';

/** Aspecto de la app. No toca el video: el compositor pinta lo suyo. */
export type Tema = 'oscuro' | 'claro';

/**
 * Un "look" guardado: el aspecto, sin nada de una grabacion concreta.
 *
 * Se guarda con los ajustes y no dentro de la grabacion porque es del usuario,
 * no de la demo: la gracia es aplicar el mismo a la siguiente.
 */
export interface Look {
  nombre: string;
  background: Background;
  frame: FrameStyle;
  watermark?: Watermark | null;
}

export interface Ajustes {
  url: string;
  presetName: string;
  orientacion: Orientacion;
  micOn: boolean;
  micDeviceId: string;
  /**
   * Selectores CSS que se difuminan al grabar, tal y como se escribieron.
   *
   * Se guardan con los ajustes y no dentro de la grabacion, igual que los
   * looks: `#saldo` o `.email` son de TU app, no de una demo concreta, y lo
   * normal es querer taparlos tambien en la siguiente.
   */
  tapar: string;
  /** Grabar la camara web. Como el microfono: es una preferencia tuya, no de
   *  una demo concreta. */
  camOn: boolean;
  camDeviceId: string;
  tema: Tema;
  /**
   * Idioma de la interfaz.
   *
   * Vacio no es un valor: cuando no hay nada guardado, quien decide es el
   * sistema (`idiomaDe(app.getLocale())` en el proceso principal). Aqui se
   * guarda solo lo que el usuario ha elegido a mano.
   */
  idioma: Idioma;
  looks: Look[];
  /** Nombre del look que se aplica solo a las grabaciones nuevas. */
  lookPorDefecto: string | null;
  /**
   * Version de la app cuya bienvenida ya se leyo. Vacio = no se ha visto nunca.
   *
   * Se guarda la VERSION y no un booleano para poder volver a saludar cuando
   * una version traiga algo que haya que contar. Un booleano obligaria a
   * inventarse otro ajuste el dia que haga falta.
   */
  bienvenidaVista: string;
  /**
   * Ruta a un ffmpeg elegido a mano. Vacio = el que trae la app.
   *
   * Solo hace falta si el empaquetado no aparece —una instalacion a medias, un
   * antivirus que se lo lleva— y el usuario senala otro desde la bienvenida.
   */
  ffmpegPath: string;
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  url: 'http://localhost:3000',
  presetName: 'equilibrado',
  orientacion: 'horizontal',
  micOn: true,
  micDeviceId: '',
  tapar: '',
  camOn: false,
  camDeviceId: '',
  tema: 'oscuro',
  idioma: 'es',
  looks: [],
  lookPorDefecto: null,
  bienvenidaVista: '',
  ffmpegPath: '',
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
    tapar: typeof o.tapar === 'string' ? o.tapar : AJUSTES_POR_DEFECTO.tapar,
    camOn: typeof o.camOn === 'boolean' ? o.camOn : AJUSTES_POR_DEFECTO.camOn,
    camDeviceId: typeof o.camDeviceId === 'string'
      ? o.camDeviceId : AJUSTES_POR_DEFECTO.camDeviceId,
    tema: o.tema === 'claro' ? 'claro' : 'oscuro',
    // Cualquier cosa que no sea 'en' cae en espanol, que es el idioma en el que
    // esta escrita la app: ante unos ajustes corruptos, el original.
    idioma: o.idioma === 'en' ? 'en' : 'es',
    looks: Array.isArray(o.looks) ? o.looks.filter(esLook) : [],
    lookPorDefecto: typeof o.lookPorDefecto === 'string' ? o.lookPorDefecto : null,
    bienvenidaVista: typeof o.bienvenidaVista === 'string' ? o.bienvenidaVista : '',
    ffmpegPath: typeof o.ffmpegPath === 'string' ? o.ffmpegPath : '',
  };
}

/** Un look a medias se descarta entero: aplicarlo dejaria el proyecto invalido. */
function esLook(x: unknown): x is Look {
  const l = x as Partial<Look>;
  return typeof l?.nombre === 'string' && l.nombre.length > 0
    && typeof l.background === 'object' && l.background !== null
    && typeof l.frame === 'object' && l.frame !== null;
}

/**
 * Aplica un look a un proyecto.
 *
 * Toca el ASPECTO y nada mas: zooms, cortes, velocidades, recorte y salida se
 * quedan como estaban. Un look que arrastrara el trabajo de edicion de otra
 * grabacion seria una trampa.
 */
export function aplicarLook(project: Project, look: Look): Project {
  return {
    ...project,
    background: look.background,
    frame: look.frame,
    watermark: look.watermark ?? null,
  };
}
