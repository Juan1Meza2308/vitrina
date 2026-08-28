/**
 * Adapta un proyecto a una fuente de otro tamano.
 *
 * Hace falta al repetir una grabacion con otra calidad: los tramos de zoom
 * guardan su objetivo en PIXELES DE LA FUENTE, asi que copiarlos tal cual a una
 * captura mas grande deja la camara encuadrando otro sitio. Y en silencio: el
 * video sale, se ve bien, y simplemente amplia donde no toca.
 *
 * Medido en una repeticion real: un tramo que encuadraba el 6% del ancho pasaba
 * a apuntar al 4%.
 *
 * Solo se toca lo que vive en coordenadas de la fuente. Los tiempos —cortes,
 * velocidades, recorte— y el aspecto —fondo, marco, salida— no dependen del
 * tamano de la captura.
 */
import type { CaptureSize, Project } from './types.ts';

export function reescalarProyecto(
  project: Project,
  de: CaptureSize,
  a: CaptureSize,
): Project {
  if (!(de.w > 0) || !(de.h > 0)) return project;
  const kx = a.w / de.w;
  const ky = a.h / de.h;
  if (kx === 1 && ky === 1) return project;

  return {
    ...project,
    zooms: project.zooms.map((z) => ({
      ...z,
      target: {
        x: Math.round(z.target.x * kx),
        y: Math.round(z.target.y * ky),
        w: Math.round(z.target.w * kx),
        h: Math.round(z.target.h * ky),
      },
    })),
  };
}
