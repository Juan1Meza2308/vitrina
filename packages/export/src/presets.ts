/**
 * Presets de salida.
 *
 * Cambiar el tamano de salida cambia el margen de zoom nitido, porque el margen
 * es `ancho_fuente / ancho_mostrado`. Exportar a 1080p desde una captura de
 * 1600x900 deja practicamente cero margen: la ventana se dibuja a 1536 px de un
 * material de 1600. El exportador lo detecta y avisa en vez de entregar en
 * silencio un video blando.
 */
import type { Background, ExportSettings } from '@vitrina/core';

export type ExportPresetName =
  | '720p' | '1080p' | 'gif' | 'cuadrado' | 'vertical' | 'vertical 720' | 'alpha';

export interface ExportPreset extends ExportSettings {
  name: string;
  /** Para que sirve, en una linea. Se muestra en la ayuda del CLI. */
  nota: string;
  /**
   * Fondo que impone el preset, por encima del elegido en el proyecto.
   *
   * Existe porque un preset no puede limitarse al codec: pedir WebM con alpha
   * mientras el proyecto pinta un degradado opaco produce un fichero sin
   * transparencia y sin ningun error. El formato y el fondo son la misma
   * decision y tienen que viajar juntos.
   */
  forceBackground?: Background;
}

export const EXPORT_PRESETS: Record<ExportPresetName, ExportPreset> = {
  '720p': {
    name: '720p', width: 1280, height: 720, fps: 60, format: 'mp4',
    nota: 'el punto fijado del proyecto: deja 1.56x de margen de zoom',
  },
  '1080p': {
    name: '1080p', width: 1920, height: 1080, fps: 60, format: 'mp4',
    nota: 'mas resolucion pero sin margen de zoom desde captura a 1600x900',
  },
  gif: {
    name: 'gif', width: 960, height: 540, fps: 20, format: 'gif',
    nota: 'para README y chats; pesado y sin audio por naturaleza',
  },
  cuadrado: {
    name: 'cuadrado', width: 1080, height: 1080, fps: 60, format: 'mp4',
    nota: 'recorte 1:1 para redes',
  },
  vertical: {
    name: 'vertical', width: 1080, height: 1920, fps: 60, format: 'mp4',
    nota: '9:16 para stories y shorts; nativo si grabaste en vertical',
  },
  'vertical 720': {
    name: 'vertical 720', width: 720, height: 1280, fps: 60, format: 'mp4',
    nota: '9:16 mas pequeno: lo que toca cuando 1080 dejaria el video sin margen',
  },
  alpha: {
    name: 'alpha', width: 1280, height: 720, fps: 60, format: 'mov',
    nota: 'ProRes 4444 con transparencia, para montar sobre otro material',
    forceBackground: { kind: 'none' },
  },
};

export function resolvePreset(name: string): ExportPreset | null {
  return EXPORT_PRESETS[name as ExportPresetName] ?? null;
}

/** Extension de fichero que corresponde al formato. */
export function extensionFor(format: ExportSettings['format']): string {
  switch (format) {
    case 'mp4': return '.mp4';
    case 'webm': return '.webm';
    case 'mov': return '.mov';
    case 'gif': return '.gif';
  }
}
