/**
 * Test de integracion de la pausa.
 *
 * Se comprueba contra una grabacion de verdad y por lo que queda en disco, no
 * por lo que diga el grabador: que durante la pausa NO llegaron frames, y que la
 * carpeta sale con un corte de la duracion de la pausa. Preguntarle al objeto
 * "¿estabas pausado?" no probaria nada —eso ya lo sabe—; lo que importa es que
 * el video no tenga ese trozo.
 *
 * El micro no se pausa a proposito (ver `Recorder.pausar`), asi que aqui no hay
 * nada que comprobar sobre el audio: el corte se lo lleva igual que al video.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import type { Project } from '@vitrina/core';
import { Recorder, type RecordingResult } from './recorder.ts';

const PORT = 9414;
const FIXTURE = pathToFileURL(
  path.resolve(import.meta.dirname, '../../../spikes/stress.html'),
).href;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lo que dura la pausa. Holgada a proposito: con 200 ms, un arranque lento del
 *  screencast al reanudar se confundiria con el hueco que se quiere medir. */
const PAUSA_MS = 1200;

let outDir = '';
afterAll(async () => {
  if (outDir) await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {});
});

describe('pausa', () => {
  let result: RecordingResult;
  let pausaDesde = 0;
  let pausaHasta = 0;

  it('graba, pausa y sigue', async () => {
    outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-pausa-'));
    const rec = new Recorder({
      url: FIXTURE, viewport: { w: 1200, h: 700 }, quality: 80, outDir, port: PORT,
    });

    await rec.launch();
    await rec.start();
    await sleep(1200);

    await rec.pausar();
    expect(rec.pausada).toBe(true);
    pausaDesde = Date.now();
    await sleep(PAUSA_MS);
    pausaHasta = Date.now();
    await rec.reanudar();
    expect(rec.pausada).toBe(false);

    await sleep(1200);
    result = await rec.stop();
    await rec.close();

    expect(result.manifest.frames.length).toBeGreaterThan(10);
  }, 60_000);

  it('durante la pausa no llegaron frames', () => {
    // Es la comprobacion de verdad: el screencast estaba parado.
    //
    // El margen no se inventa: al parar y al reanudar hay un viaje de ida y
    // vuelta por CDP, asi que el borde del hueco no cae al milisegundo. Se
    // miran los 200 ms centrales de la pausa, que ninguna latencia razonable
    // alcanza.
    const dentro = result.manifest.frames.filter((f) => {
      const t = f.t * 1000;
      return t > pausaDesde + 300 && t < pausaHasta - 300;
    });
    expect(dentro).toEqual([]);
  });

  it('la pausa queda como un corte en el proyecto', async () => {
    const project = JSON.parse(
      await fsp.readFile(path.join(outDir, 'project.json'), 'utf8')) as Project;
    expect(project.cuts).toHaveLength(1);

    const corte = project.cuts![0]!;
    const duracion = corte.endMs - corte.startMs;
    // Con holgura por los dos viajes a CDP: lo que se fija es que el corte mide
    // lo que duro la pausa, no un valor exacto de reloj.
    expect(duracion).toBeGreaterThan(PAUSA_MS - 400);
    expect(duracion).toBeLessThan(PAUSA_MS + 800);
    expect(corte.startMs).toBeGreaterThan(0);
  });

  it('el corte cae dentro de la grabacion', async () => {
    const project = JSON.parse(
      await fsp.readFile(path.join(outDir, 'project.json'), 'utf8')) as Project;
    const corte = project.cuts![0]!;
    // Un corte que se saliera del material no quitaria nada y ademas dejaria el
    // mapa de tiempo con un tramo vacio.
    expect(corte.endMs).toBeLessThanOrEqual(result.manifest.durationMs);
  });
});
