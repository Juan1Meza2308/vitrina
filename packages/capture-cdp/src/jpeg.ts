/**
 * Lee el tamano de un JPEG de su cabecera, sin dependencias.
 *
 * Se usa para verificar que el screencast entrega exactamente el viewport que
 * se pidio. Es una comprobacion barata que atrapa el fallo mas caro del
 * proyecto: creerse que se esta grabando a 1600x900 cuando en realidad llegan
 * frames de 1280x720 y todo el margen de zoom era imaginario.
 */
export interface Size {
  w: number;
  h: number;
}

export function jpegSize(buf: Buffer): Size | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1] as number;
    // SOF0..SOF15 llevan las dimensiones, menos DHT (c4), JPG (c8) y DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    }
    // Los marcadores sin payload (SOI, RSTn, EOI) no llevan longitud.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}
