/**
 * Subtitulos de la VOZ: la transcripcion de lo que se oye.
 *
 * `guia.srt` cuenta lo que se hace —clics, teclas—, que es justo lo que un
 * video mudo no dice. Cuando ademas hay narracion, lo que se dice tambien
 * quiere subtitulo, y eso no se inventa: lo transcribe un modelo de voz.
 *
 * El motor da sus segmentos en SEGUNDOS DEL FICHERO DE AUDIO, y el audio no
 * siempre empieza cuando el video (el microfono se arranca antes a proposito),
 * asi que los tiempos brutos no valen. Hay que llevarlos del reloj del fichero
 * al reloj de la SALIDA, donde ya se descontaron los cortes y las velocidades —
 * el instante 5 s de la salida no es el instante 5 s del fichero.
 *
 * Este fichero no sabe de motores ni de ficheros: recibe los segmentos y
 * devuelve los rotulos ya en tiempo de salida. Quien transcribe (el exportador
 * con whisper-cli) decide de donde salen los segmentos.
 */

import { audioTimeFor } from './audio.ts';
import type { TimeMap } from './timemap.ts';
import { tiempoSrt } from './guia.ts';

/** Un trozo de lo que se dijo, medido en ms del FICHERO de audio. */
export interface SegmentoVoz {
  desdeMs: number;
  hastaMs: number;
  texto: string;
}

/** Un trozo de lo que se dijo, listo para subtitular en tiempo de SALIDA. */
export interface Rotulo {
  desdeMs: number;
  hastaMs: number;
  texto: string;
}

/**
 * Lleva los segmentos del fichero de audio al tiempo de salida.
 *
 * Cada tramo conservado del material se traduce a su ventana dentro del
 * fichero (con `audioTimeFor`, la misma funcion que usa el exportador para
 * recortar la pista), y todo segmento que pise esa ventana se recorta a ella.
 * Un subtitulo que cruce un corte se parte en dos: casi siempre es mejor un
 * rotulo cortado que uno que salta un hueco que no existe.
 */
export function subtitulosDeVoz(
  segmentos: SegmentoVoz[],
  pista: { startedAt: number },
  videoStartedAt: number,
  map: TimeMap,
): Rotulo[] {
  // Ventanas del fichero de audio que SI llegan al video. El audio se arranca
  // antes que el video, asi que la primera puede empezar antes que el fichero.
  const ventanas = map.keeps.map((k) => ({
    desdeMs: audioTimeFor(pista, videoStartedAt, k.start) * 1000,
    hastaMs: audioTimeFor(pista, videoStartedAt, k.end) * 1000,
  }));

  // Inversa de `audioTimeFor`: ms del fichero -> ms de material. Se hace aqui
  // porque el reloj de referencia es el mismo en los dos sentidos.
  //
  // audioTimeFor resuelve `(videoStartedAt - pista.startedAt + sourceMs)/1000`;
  // despejar sourceMs cambia sumas por restas y cambia el signo del desfase.
  const aMaterial = (fileMs: number) =>
    fileMs + (pista.startedAt - videoStartedAt);

  const rotulos: Rotulo[] = [];
  for (const s of segmentos) {
    for (const v of ventanas) {
      const desde = Math.max(s.desdeMs, v.desdeMs);
      const hasta = Math.min(s.hastaMs, v.hastaMs);
      if (hasta <= desde) continue;
      const salidaDesde = map.outputAt(aMaterial(desde));
      const salidaHasta = map.outputAt(aMaterial(hasta));
      if (salidaDesde === null || salidaHasta === null) continue;
      rotulos.push({ desdeMs: salidaDesde, hastaMs: salidaHasta, texto: s.texto });
    }
  }
  return rotulos;
}

/** Subtitulos de voz en formato SRT. */
export function srtDeVoz(rotulos: Rotulo[]): string {
  return rotulos.map((r, i) => (
    `${i + 1}\n${tiempoSrt(r.desdeMs)} --> ${tiempoSrt(r.hastaMs)}\n${r.texto}\n`
  )).join('\n');
}