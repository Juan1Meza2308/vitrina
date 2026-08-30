/**
 * Tests del traductor de errores.
 *
 * Lo que se comprueba es lo que la gente lee, no que la funcion devuelva algo:
 * que no le llega una ruta de disco a la cara, que un error reconocido dice
 * QUE HACER, y que el mensaje original no se pierde por el camino —sin el, un
 * fallo raro deja de poder reportarse—.
 */
import { describe, it, expect } from 'vitest';
import { conIdioma } from '@vitrina/core';
import { explicar, textoDe, aviso } from './errores.ts';

const es = conIdioma('es');
const en = conIdioma('en');
const leer = (e: unknown, intento?: Parameters<typeof explicar>[1], t = es) =>
  textoDe(explicar(e, intento), t);

/** Un DOMException de `getUserMedia`, que es como llegan de verdad. */
const comoDelNavegador = (nombre: string) => {
  const e = new Error('Permission denied');
  e.name = nombre;
  return e;
};

describe('explicar', () => {
  it('no ensena la ruta del disco en el mensaje principal', () => {
    const e = new Error(
      'spawn C:\\Users\\Juan\\AppData\\Local\\Programs\\Vitrina\\resources\\ffmpeg.exe ENOENT');
    const a = explicar(e, 'exportacion');
    expect(textoDe(a, es)).not.toContain('C:\\Users');
    expect(textoDe(a, es)).toContain('ffmpeg');
    // Pero no se pierde: sin el no hay forma de reportar el fallo.
    expect(a.detalle).toContain('C:\\Users');
  });

  it('dice que hacer cuando el sistema niega el permiso', () => {
    const texto = leer(comoDelNavegador('NotAllowedError'), 'camara');
    expect(texto).toContain('cámara');
    expect(texto).toContain('privacidad');
  });

  it('distingue el dispositivo ocupado del que no esta', () => {
    expect(leer(comoDelNavegador('NotReadableError'), 'microfono')).toContain('Otro programa');
    expect(leer(comoDelNavegador('NotFoundError'), 'microfono')).toContain('ninguno conectado');
  });

  it('no fija el idioma al fallar, sino al pintar', () => {
    // Es el fallo que se vio en la app: el aviso de abrir una grabacion llega
    // antes de que carguen los ajustes, asi que traducirlo en ese momento lo
    // dejaba en espanol para siempre aunque la app estuviera en ingles.
    const a = explicar(comoDelNavegador('NotAllowedError'), 'camara');
    expect(textoDe(a, es)).toContain('cámara');
    expect(textoDe(a, en)).toContain('camera');
    expect(textoDe(a, en)).not.toContain('cámara');
  });

  it('deja pasar enteros los mensajes que escribimos nosotros', () => {
    // Ya estan traducidos y ya dicen que hacer; envolverlos en «Algo no ha
    // salido bien» los empeoraria.
    const nuestro = 'Vitrina necesita Edge o Chrome, y no se encontró ninguno ejecutable.';
    const a = explicar(new Error(nuestro), 'grabacion');
    expect(textoDe(a, es)).toBe(nuestro);
    expect(a.detalle).toBeUndefined();
  });

  it('con un error que no reconoce, no se inventa la causa', () => {
    const a = explicar(new Error('EPROTO alert bad record mac'), 'exportacion');
    expect(textoDe(a, es)).toBe('No se pudo exportar el vídeo.');
    expect(a.detalle).toBe('EPROTO alert bad record mac');
  });

  it('aguanta que le tiren algo que no es un Error', () => {
    expect(explicar('vaya').detalle).toBe('vaya');
    expect(leer(undefined)).toBe('Algo no ha salido bien.');
  });
});

describe('aviso', () => {
  it('es un mensaje nuestro sin detalle tecnico detras', () => {
    expect(aviso('Exportación cancelada')).toEqual({ texto: 'Exportación cancelada' });
    expect(textoDe(aviso('Exportación cancelada'), en)).toBe('Exportación cancelada');
  });
});
