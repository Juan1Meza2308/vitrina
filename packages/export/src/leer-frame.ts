/**
 * Lectura de los bytes de un frame, da igual en que formato este la carpeta.
 *
 * Las grabaciones nuevas guardan todos los JPEGs concatenados en `frames.bin`
 * y el manifest lleva el indice: leer uno es una sola lectura posicionada y no
 * se abren cientos de ficheros. Las viejas tienen un fichero por frame
 * (`frames/000001.jpg`). El manifest no dice en que formato esta; lo dice cada
 * frame con su `offset`. Este es el unico sitio que conoce esa conversion:
 * exportador, herramientas y protocolo `vitrina://` no deberian saberla.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Frame } from '@vitrina/core';

export async function leerFrame(root: string, frame: Frame): Promise<Buffer> {
  if (frame.offset != null) {
    const fd = await fsp.open(path.join(root, 'frames.bin'), 'r');
    try {
      const buf = Buffer.alloc(frame.bytes);
      await fd.read(buf, 0, frame.bytes, frame.offset);
      return buf;
    } finally {
      await fd.close();
    }
  }
  if (!frame.file) throw new Error('El frame no dice donde esta (ni offset ni fichero).');
  return fsp.readFile(path.join(root, 'frames', frame.file));
}