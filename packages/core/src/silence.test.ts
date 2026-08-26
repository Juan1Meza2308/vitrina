import { describe, it, expect } from 'vitest';
import { parseSilenceReport, silenceFilter, MARGEN_MS } from './silence.ts';

/** Informe tal y como lo escribe ffmpeg, con su prefijo de filtro. */
const informe = (pares: [number, number][]): string =>
  pares.flatMap(([a, b]) => [
    `[silencedetect @ 000001f4] silence_start: ${a}`,
    `[silencedetect @ 000001f4] silence_end: ${b} | silence_duration: ${(b - a).toFixed(3)}`,
  ]).join('\n');

const OPTS = { adelantoMs: 0, durationMs: 20_000 };

describe('parseSilenceReport', () => {
  it('lee un silencio y le aplica el margen a los dos lados', () => {
    const [c] = parseSilenceReport(informe([[2, 5]]), OPTS);
    expect(c!.startMs).toBe(2000 + MARGEN_MS);
    expect(c!.endMs).toBe(5000 - MARGEN_MS);
  });

  it('descuenta el adelanto del audio', () => {
    // El microfono arranco 2 s antes que el video, asi que el segundo 5 del
    // fichero es el segundo 3 del material. Sin restarlo, todos los cortes
    // irian desplazados el mismo rato.
    const [c] = parseSilenceReport(informe([[5, 9]]), { ...OPTS, adelantoMs: 2000 });
    expect(c!.startMs).toBe(3000 + MARGEN_MS);
    expect(c!.endMs).toBe(7000 - MARGEN_MS);
  });

  it('lee varios silencios', () => {
    expect(parseSilenceReport(informe([[1, 3], [8, 11]]), OPTS)).toHaveLength(2);
  });

  it('descarta lo que queda demasiado corto tras los margenes', () => {
    // 400 ms de silencio menos 300 de margenes deja 100: quitarlo no compensa
    // y ademas se comeria el arranque de la siguiente palabra.
    expect(parseSilenceReport(informe([[2, 2.4]]), OPTS)).toHaveLength(0);
  });

  it('un silencio abierto al final se descarta', () => {
    // ffmpeg emite `silence_start` sin `silence_end` cuando la grabacion acaba
    // callada. Ese final ya lo resuelve el recorte.
    const s = '[silencedetect @ 1] silence_start: 12';
    expect(parseSilenceReport(s, OPTS)).toHaveLength(0);
  });

  it('nada que no sea del filtro se ignora', () => {
    const ruido = 'Input #0, matroska,webm\n  Stream #0:0: Audio: opus\nsize=N/A time=00:00:03';
    expect(parseSilenceReport(ruido, OPTS)).toHaveLength(0);
  });

  it('los cortes se recortan a los limites del material', () => {
    // Con adelanto grande, el margen podria dar un inicio negativo.
    const [c] = parseSilenceReport(informe([[0, 4]]), { ...OPTS, adelantoMs: 500 });
    expect(c!.startMs).toBeGreaterThanOrEqual(0);
    expect(c!.endMs).toBeLessThanOrEqual(OPTS.durationMs);
  });

  it('acepta finales de linea de Windows', () => {
    const crlf = informe([[2, 5]]).replace(/\n/g, '\r\n');
    expect(parseSilenceReport(crlf, OPTS)).toHaveLength(1);
  });
});

describe('silenceFilter', () => {
  it('arma el filtro con los umbrales por defecto', () => {
    expect(silenceFilter()).toBe('silencedetect=noise=-32dB:d=0.6');
  });

  it('admite umbrales propios', () => {
    expect(silenceFilter(-45, 1.2)).toBe('silencedetect=noise=-45dB:d=1.2');
  });
});
