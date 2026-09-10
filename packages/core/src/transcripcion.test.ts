/**
 * Tests de los subtitulos de voz.
 *
 * Lo importante aqui es el MAPEO: el motor transcribe en segundos del fichero
 * de audio, y el video de salida puede empezar, cortar y acelerar cuando le
 * da la gana. Un rotulo tiene que decir lo que se oye CUANDO se oye, o el
 * subtitulo mentira antes de llegar al reproductor.
 */
import { describe, it, expect } from 'vitest';
import { TimeMap } from './timemap.ts';
import { audioTimeFor } from './audio.ts';
import { subtitulosDeVoz, srtDeVoz } from './transcripcion.ts';

const T0 = 1_700_000_000_000;
// El microfono se arranca 2 s antes que el screencast, a proposito: si el audio
// llegara tarde faltaria sonido al principio, que no se puede inventar.
const AUDIO_START = T0 - 2000;
const pista = { startedAt: AUDIO_START };
const DUR = 20_000;

const mapa = (opts: Partial<ConstructorParameters<typeof TimeMap>[0]> = {}) =>
  new TimeMap({ durationMs: DUR, ...opts });

// Segmento medido en el FICHERO. `desdeMs=7000` con el audio 2 s antes del
// video quiere decir material en 5000: la mitad del video.
describe('subtitulosDeVoz', () => {
  it('sin cortes: fichero y video comparten reloj con un desfase', () => {
    const rotulos = subtitulosDeVoz(
      [{ desdeMs: 7000, hastaMs: 9000, texto: 'Uno, dos.' }],
      pista, T0, mapa(),
    );
    // Audio arranco 2 s antes: lo que el fichero marca en 7000 es material en
    // 5000, y sin cortes la salida es el material.
    expect(rotulos).toEqual([{ desdeMs: 5000, hastaMs: 7000, texto: 'Uno, dos.' }]);
  });

  it('un tramo acelerado se aprieta, como el video', () => {
    // Material 4000-8000 va a 2x; el segmento cae entero dentro (sin cortes).
    const map = mapa({
      speeds: [{ startMs: 4000, endMs: 8000, rate: 2 }],
    });
    const rotulos = subtitulosDeVoz(
      // Fichero 6000-8000 = material 4000-6000: dos segundos a 2x, uno de salida.
      [{ desdeMs: 6000, hastaMs: 8000, texto: 'Corre' }],
      pista, T0, map,
    );
    expect(rotulos).toEqual([{ desdeMs: 4000, hastaMs: 5000, texto: 'Corre' }]);
  });

  it('un trozo que cae en un corte no sale', () => {
    const map = mapa({ cuts: [{ startMs: 5000, endMs: 7000 }] });
    const rotulos = subtitulosDeVoz(
      [{ desdeMs: 7000, hastaMs: 9000, texto: 'Cae en el corte' }],
      pista, T0, map,
    );
    // Fichero 7000 = material 5000: dentro del corte hasta 7000.
    expect(rotulos).toEqual([]);
  });

  it('un subtitulo que cruza un corte se parte en dos', () => {
    const map = mapa({ cuts: [{ startMs: 5000, endMs: 6000 }] });
    const rotulos = subtitulosDeVoz(
      [{ desdeMs: 6000, hastaMs: 9000, texto: 'Cruza el corte' }],
      pista, T0, map,
    );
    // Fichero 6000-9000 = material 4000-7000. Cortado en 6000, asi que sale
    // material 4000-5000 (salida igual) y material 6000-7000. El corte deja de
    // material 6000 en adelante en salida 5000, porque antes ya se quito 1000.
    expect(rotulos).toEqual([
      { desdeMs: 4000, hastaMs: 5000, texto: 'Cruza el corte' },
      { desdeMs: 5000, hastaMs: 6000, texto: 'Cruza el corte' },
    ]);
  });

  it('un segmento que empieza antes que el video se recorta al borde', () => {
    const rotulos = subtitulosDeVoz(
      // El audio arranco 2 s antes: 0-1000 del fichero es material negativo.
      [{ desdeMs: 500, hastaMs: 2500, texto: 'Antes de grabar' }],
      pista, T0, mapa(),
    );
    expect(rotulos).toEqual([{ desdeMs: 0, hastaMs: 500, texto: 'Antes de grabar' }]);
  });

  it('responde con el tiempo del fichero: checklist audioTimeFor > 0', () => {
    // Material negativo devuelve 0 (guardado por audioTimeFor). El fichero 0
    // es material -2000; el primer rotulo no puede ser negativo.
    const rotulos = subtitulosDeVoz(
      [{ desdeMs: 0, hastaMs: 100, texto: 'x' }],
      pista, T0, mapa(),
    );
    expect(rotulos.every((r) => r.desdeMs >= 0)).toBe(true);
  });
});

describe('audioTimeFor (contrato con subtitulosDeVoz)', () => {
  it('es la inversa del desfase que aplica subtitulosDeVoz', () => {
    const src = 5000;
    expect(audioTimeFor(pista, T0, src)).toBe(7); // segundos, no ms
    const rotulos = subtitulosDeVoz(
      [{ desdeMs: 7000, hastaMs: 7100, texto: 'x' }],
      pista, T0, mapa(),
    );
    expect(rotulos[0]?.desdeMs).toBe(src);
  });
});

describe('srtDeVoz', () => {
  it('escribe el formato SRT', () => {
    const srt = srtDeVoz([{ desdeMs: 1500, hastaMs: 3000, texto: 'Hola' }]);
    expect(srt).toBe('1\n00:00:01,500 --> 00:00:03,000\nHola\n');
  });
});