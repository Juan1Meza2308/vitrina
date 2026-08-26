import { describe, it, expect } from 'vitest';
import { audioAlignment, supportsAudio, type AudioTrack } from './audio.ts';

const T0 = 1_700_000_000_000;
const pista = (startedAt: number): AudioTrack =>
  ({ file: 'mic.webm', startedAt, mimeType: 'audio/webm;codecs=opus' });

describe('audioAlignment', () => {
  it('el caso normal: el audio arranco antes y se salta lo que sobra', () => {
    // Abrir el navegador tarda, asi que el microfono lleva 2.4 s grabando
    // cuando empieza el video.
    const a = audioAlignment(pista(T0 - 2400), T0);
    expect(a.seekSec).toBeCloseTo(2.4, 6);
    expect(a.delaySec).toBe(0);
  });

  it('si el audio arranco tarde se antepone silencio', () => {
    // No se puede inventar sonido que no se grabo; lo unico honesto es callar.
    const a = audioAlignment(pista(T0 + 800), T0);
    expect(a.delaySec).toBeCloseTo(0.8, 6);
    expect(a.seekSec).toBe(0);
  });

  it('arranque simultaneo no desplaza nada', () => {
    expect(audioAlignment(pista(T0), T0)).toEqual({ seekSec: 0, delaySec: 0 });
  });

  it('el recorte del video desplaza tambien el audio', () => {
    // Sin esto, recortar los primeros 3 s dejaria la voz adelantada 3 s
    // respecto a la imagen durante todo el video.
    const a = audioAlignment(pista(T0 - 2000), T0, 3000);
    expect(a.seekSec).toBeCloseTo(5, 6);
  });

  it('un recorte puede cancelar un arranque tardio', () => {
    const a = audioAlignment(pista(T0 + 1000), T0, 1500);
    expect(a.seekSec).toBeCloseTo(0.5, 6);
    expect(a.delaySec).toBe(0);
  });

  it('nunca devuelve salto y retardo a la vez', () => {
    // Son excluyentes: o sobra audio o falta. Los dos a la vez significaria
    // que la cuenta esta mal.
    for (const delta of [-5000, -1, 0, 1, 5000]) {
      const a = audioAlignment(pista(T0 + delta), T0, 700);
      expect(a.seekSec === 0 || a.delaySec === 0).toBe(true);
    }
  });
});

describe('supportsAudio', () => {
  it('acepta los contenedores con pista de audio', () => {
    expect(supportsAudio('mp4')).toBe(true);
    expect(supportsAudio('webm')).toBe(true);
    expect(supportsAudio('mov')).toBe(true);
  });

  it('el gif no lleva audio', () => {
    expect(supportsAudio('gif')).toBe(false);
  });
});
