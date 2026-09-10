/**
 * Lectura validada de los JSON de una grabacion.
 *
 * La promesa de `persistencia.ts` es que un fichero corrupto YA NO PASA por
 * tipo valido: quien llamaba a `JSON.parse(...) as T` no notaba que la carpeta
 * estaba rota y el error aparecia mas tarde, lejos del fichero. Aqui se mide:
 * un manifest valido entra, y el mismo manifest con un campo obligatorio
 * borrado o con el JSON cortado no se devuelve como si nada.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultProject } from './project.ts';
import { leerManifest, leerProyecto, leerEventos } from './persistencia.ts';
import type { InputEvent, Manifest } from './types.ts';

const T0 = 1_700_000_000_000;

function manifestValido(): Manifest {
  return {
    version: 1,
    browser: 'chromium',
    url: 'https://ejemplo.dev/demo',
    viewport: { w: 1600, h: 900 },
    capture: { w: 1600, h: 900 },
    deviceScaleFactor: 1,
    quality: 90,
    startedAt: T0,
    durationMs: 10_000,
    frames: [{ offset: 0, t: T0, bytes: 1234 }],
  };
}

let dir: string;

beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'persistencia-'));
});

afterAll(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

async function escribir(nombre: string, valor: unknown): Promise<void> {
  await fsp.writeFile(path.join(dir, nombre), JSON.stringify(valor));
}

describe('leerManifest', () => {
  it('devuelve un manifest valido tal cual', async () => {
    await escribir('manifest.json', manifestValido());
    const m = await leerManifest(path.join(dir, 'manifest.json'));
    expect(m.url).toBe('https://ejemplo.dev/demo');
    expect(m.capture).toEqual({ w: 1600, h: 900 });
  });

  it('admite camara, audio y tapado nulos, como graban las demos reales', async () => {
    const m = manifestValido();
    m.audio = null;
    m.tapado = null;
    m.camara = null;
    await escribir('manifest.json', m);
    await expect(leerManifest(path.join(dir, 'manifest.json'))).resolves.toBeTruthy();
  });

  it('rebota un JSON cortado citando el fichero', async () => {
    await fsp.writeFile(path.join(dir, 'manifest.json'), '{ "version": 1, ');
    await expect(leerManifest(path.join(dir, 'manifest.json')))
      .rejects.toThrow(/manifest\.json/);
  });

  it('rebota JSON valido pero con un campo obligatorio borrado', async () => {
    const m = manifestValido();
    delete (m as Partial<Manifest>).browser;
    await escribir('manifest.json', m);
    await expect(leerManifest(path.join(dir, 'manifest.json')))
      .rejects.toThrow(/browser/);
  });

  it('rebota si los frames no son un array', async () => {
    const m = manifestValido() as unknown as Record<string, unknown>;
    m.frames = 'nada';
    await escribir('manifest.json', m);
    await expect(leerManifest(path.join(dir, 'manifest.json'))).rejects.toThrow();
  });
});

describe('leerEventos', () => {
  it('devuelve el log valido', async () => {
    const eventos: InputEvent[] = [
      { t: T0 + 100, type: 'move', x: 10, y: 20 },
      { t: T0 + 500, type: 'down', x: 30, y: 40, tag: 'button.cotizar', rect: { x: 1, y: 2, w: 3, h: 4 } },
    ];
    await escribir('events.json', eventos);
    const log = await leerEventos(path.join(dir, 'events.json'));
    expect(log.length).toBe(2);
    expect(log[1]?.rect?.w).toBe(3);
  });

  it('rebota un tipo de evento inexistente', async () => {
    await escribir('events.json', [{ t: T0, type: 'dblclick' }]);
    await expect(leerEventos(path.join(dir, 'events.json')))
      .rejects.toThrow(/"move"/);
  });
});

describe('leerProyecto', () => {
  it('devuelve el proyecto por defecto, que debe ser siempre valido', async () => {
    await escribir('project.json', defaultProject({ capture: { w: 1600, h: 900 } }));
    await expect(leerProyecto(path.join(dir, 'project.json'))).resolves.toBeTruthy();
  });

  it('admite zooms con label null, como los guarda el editor', async () => {
    const p = defaultProject();
    p.zooms.push({
      startMs: 0, endMs: 1000,
      target: { x: 0, y: 0, w: 100, h: 100 },
      scale: 1.5, auto: true, label: null,
    });
    await escribir('project.json', p);
    await expect(leerProyecto(path.join(dir, 'project.json'))).resolves.toBeTruthy();
  });

  it('rebota un proyecto sin salida (export)', async () => {
    const p = defaultProject() as unknown as Record<string, unknown>;
    delete p.export;
    await escribir('project.json', p);
    await expect(leerProyecto(path.join(dir, 'project.json')))
      .rejects.toThrow(/export/);
  });
});