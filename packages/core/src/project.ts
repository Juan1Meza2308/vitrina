/**
 * Valores por defecto de un proyecto de composicion.
 *
 * Viven aqui y no en el CLI a proposito: cualquier cosa que produzca una
 * grabacion (el CLI, la app de escritorio, una herramienta de desarrollo) tiene
 * que escribir una carpeta `.vitrina` completa. Si cada productor inventa sus
 * defaults, unas grabaciones se pueden abrir en el editor y otras no.
 */
import type { CaptureSize, Project } from './types.ts';

export interface ProjectDefaults {
  /** Se muestra en la barra de navegador sintetica. */
  host?: string;
  /** Lienzo de salida. Por defecto 720p, el punto fijado del proyecto. */
  exportSize?: CaptureSize;
  fps?: number;
}

export function defaultProject(opts: ProjectDefaults = {}): Project {
  const size = opts.exportSize ?? { w: 1280, h: 720 };
  return {
    version: 1,
    background: { kind: 'linear', from: '#6d5efc', to: '#c3f53c', angle: 135 },
    // fill 0.8 no es una eleccion estetica caprichosa: es lo que deja 1.56x de
    // margen de zoom nitido capturando a 1600x900 y exportando a 720p. Cambiarlo
    // mueve el techo de ampliacion, y por eso la UI lo recalcula en vivo.
    frame: {
      fill: 0.8,
      radius: 14,
      shadow: 40,
      chrome: 'macos',
      chromeLabel: opts.host ?? 'localhost',
    },
    zooms: [],
    trimStartMs: 0,
    trimEndMs: null,
    export: { width: size.w, height: size.h, fps: opts.fps ?? 60, format: 'mp4' },
  };
}

/** Dominio legible para la barra sintetica, tolerante a urls raras. */
export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host || 'localhost';
  } catch {
    return 'localhost';
  }
}
