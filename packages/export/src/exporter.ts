/**
 * Exportador offline y determinista.
 *
 * No graba en tiempo real: recorre la linea de tiempo a paso fijo, busca el
 * frame de origen vigente en cada instante, lo compone con el mismo modulo que
 * dibuja el preview y lo mete por una tuberia a ffmpeg. Que sea offline es lo
 * que permite que el resultado no dependa de si la maquina iba justa ese dia.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildCameraTrack, cameraConfigForBudget, computeQualityBudget,
  CAMERA_PRESETS, FrameIndex, audioAlignment, audioTimeFor, supportsAudio, TimeMap,
} from '@vitrina/core';
import type {
  CameraPresetName, ExportSettings, InputEvent, Manifest, Project, QualityBudget, ZoomSegment,
} from '@vitrina/core';
import { composite, CursorSource, OverlaySource } from '@vitrina/renderer';
import type { Ctx, ImageLike } from '@vitrina/renderer';
import { findFfmpeg, startEncoder, extraerFrames, type AudioInput } from './ffmpeg.ts';
import { extensionFor, resolvePreset, type ExportPreset } from './presets.ts';

/**
 * Frames por segundo a los que se extrae la camara.
 *
 * Bastan para una cara —no hay movimiento rapido en un plano de busto— y
 * cuestan una cuarta parte que muestrear a 60: cada frame de mas es una
 * decodificacion mas dentro del bucle.
 */
const CAM_FPS = 15;

export interface ExportProgress {
  frame: number;
  totalFrames: number;
  /** 0 a 1. */
  fraction: number;
  /** Frames compuestos por segundo, medido. */
  fps: number;
  etaMs: number;
}

export interface ExportOptions {
  /** Carpeta `.vitrina`. */
  recordingDir: string;
  preset: string | ExportPreset;
  /** Por defecto `<carpeta>/export-<preset><ext>`. */
  outFile?: string;
  cameraPreset?: CameraPresetName;
  /** Permite ampliar mas alla del margen nitido. Por defecto no. */
  allowSoftZoom?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

export interface ExportResult {
  file: string;
  settings: ExportSettings;
  frames: number;
  durationMs: number;
  bytes: number;
  elapsedMs: number;
  budget: QualityBudget;
  /** Problemas que no impiden exportar pero que el usuario debe saber. */
  warnings: string[];
}

export class ExportAbortedError extends Error {
  constructor() {
    super('Exportacion cancelada');
    this.name = 'ExportAbortedError';
  }
}

const readJson = async <T,>(p: string): Promise<T> =>
  JSON.parse(await fsp.readFile(p, 'utf8')) as T;

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function exportRecording(opts: ExportOptions): Promise<ExportResult> {
  const root = path.resolve(opts.recordingDir);
  const preset = typeof opts.preset === 'string' ? resolvePreset(opts.preset) : opts.preset;
  if (!preset) throw new Error(`Preset de exportacion desconocido: ${String(opts.preset)}`);

  const manifest = await readJson<Manifest>(path.join(root, 'manifest.json'));
  const events = await readJson<InputEvent[]>(path.join(root, 'events.json'));
  const project = await readJson<Project>(path.join(root, 'project.json'));

  const sourceSize = manifest.capture ?? manifest.viewport;
  const settings: ExportSettings = {
    width: preset.width, height: preset.height, fps: preset.fps, format: preset.format,
  };

  const budget = computeQualityBudget(sourceSize, settings, project.frame);
  const warnings: string[] = [];

  // El preset de salida cambia el margen de zoom: la ventana se dibuja a otro
  // tamano. Los tramos guardados se planificaron para OTRA salida, asi que hay
  // que recortarlos al margen de esta o el video sale ampliando pixeles.
  const zooms = clampZooms(project.zooms, budget, opts.allowSoftZoom ?? false, warnings);

  if (!opts.allowSoftZoom && budget.maxSharpZoom < 1.15 && project.zooms.length > 0) {
    warnings.push(
      `Con esta salida casi no queda margen de zoom (${budget.maxSharpZoom.toFixed(2)}x). `
      + 'La camara apenas se movera. Para conservar el zoom, exporta mas pequeno o graba a mas resolucion.',
    );
  }
  // Fuente y salida con formas distintas: el material entra entero y centrado,
  // asi que lo que sobra son bandas de fondo. Con una grabacion vertical
  // exportada a 720p es casi todo el encuadre, y sin aviso el usuario solo se
  // entera al abrir el fichero.
  const formaFuente = sourceSize.w / sourceSize.h;
  const formaSalida = settings.width / settings.height;
  const desvio = Math.max(formaFuente / formaSalida, formaSalida / formaFuente);
  // El umbral deja pasar la diferencia normal entre una captura con forma de
  // movil (19.5:9) y un lienzo 9:16, que es el flujo vertical de siempre y
  // produce margen de fondo, no bandas. Lo que tiene que cazar es el error
  // gordo: exportar material vertical a un preset apaisado, que desvia x3.
  if (desvio > 1.35) {
    const cual = formaSalida > formaFuente ? 'a los lados' : 'arriba y abajo';
    warnings.push(
      `El material es ${sourceSize.w}x${sourceSize.h} y la salida ${settings.width}x${settings.height}: `
      + `no tienen la misma forma, asi que quedaran bandas de fondo ${cual}. `
      + 'Elige un preset de la misma orientacion que la grabacion.',
    );
  }
  if (!budget.sharpAtRest) {
    warnings.push(
      `La ventana se dibuja a ${Math.round(budget.windowPx)} px desde un material de ${sourceSize.w} px: `
      + 'ya se esta ampliando en reposo y el resultado sera blando.',
    );
  }

  const renderProject: Project = {
    ...project,
    export: settings,
    zooms,
    background: preset.forceBackground ?? project.background,
  };
  const config = cameraConfigForBudget(
    CAMERA_PRESETS[opts.cameraPreset ?? 'normal'],
    budget.maxSharpZoom,
    opts.allowSoftZoom ?? false,
  );

  const track = buildCameraTrack({
    events, segments: zooms, viewport: sourceSize,
    startedAt: manifest.startedAt, durationMs: manifest.durationMs, config,
  });
  // La marca se carga como el fondo de imagen: ruta relativa dentro de la
  // carpeta, para que la grabacion siga siendo autocontenida.
  let marca: Awaited<ReturnType<typeof loadImage>> | null = null;
  if (project.watermark?.path) {
    try {
      marca = await loadImage(path.join(root, project.watermark.path));
    } catch {
      warnings.push(`No se pudo cargar la marca de agua (${project.watermark.path}).`);
    }
  }

  const cursor = new CursorSource(events, manifest.startedAt);
  const overlay = new OverlaySource(events, manifest.startedAt);
  const index = new FrameIndex(manifest);
  if (index.length === 0) throw new Error('La grabacion no tiene frames');

  // Recorte de los extremos y cortes del interior son lo mismo visto de dos
  // formas: trozos que no llegan a la salida. `TimeMap` los unifica, asi que a
  // partir de aqui nadie vuelve a sumar tiempos a mano.
  const map = new TimeMap({
    durationMs: manifest.durationMs,
    trimStartMs: project.trimStartMs,
    trimEndMs: project.trimEndMs,
    cuts: project.cuts,
    speeds: project.speeds,
  });
  const spanMs = map.outputDurationMs;
  if (spanMs <= 0) throw new Error('El recorte deja la grabacion vacia');

  const totalFrames = Math.max(1, Math.floor((spanMs / 1000) * settings.fps));
  const file = opts.outFile
    ? path.resolve(opts.outFile)
    : path.join(root, `export-${preset.name}${extensionFor(settings.format)}`);

  /*
   * Que se oye en el video.
   *
   * Sin marcar nada manda la voz doblada si la hay, porque es lo que espera
   * quien acaba de doblar. Si se pidio la voz y el fichero no esta, se avisa y
   * se cae a la narracion en vivo: quedarse mudo por un fichero perdido seria
   * peor que sonar distinto.
   */
  const quiere = renderProject.pista ?? (renderProject.voz ? 'voz' : 'micro');
  const llevaAudio = supportsAudio(settings.format);
  let audio: AudioInput | undefined;

  if (!llevaAudio && quiere !== 'ninguna' && (renderProject.voz || manifest.audio)) {
    warnings.push(`El formato ${settings.format} no lleva audio: no saldra en este export.`);
  }

  /*
   * La voz doblada no pasa por el mapa de tiempo.
   *
   * Se grabo contra el video YA montado, asi que los cortes y las
   * aceleraciones ya estan dentro de ella: es un solo tramo de principio a fin.
   * Trocearla por los `keeps` del material la cortaria dos veces y sonaria a
   * saltos. Lo unico que se ajusta es donde empieza.
   */
  if (llevaAudio && quiere === 'voz' && renderProject.voz) {
    const voz = renderProject.voz;
    const ruta = path.join(root, voz.file);
    if (await exists(ruta)) {
      const desfaseSec = voz.desfaseMs / 1000;
      // Desfase negativo: el fichero empezo antes que el video, asi que se
      // salta dentro de el en vez de anteponer silencio.
      const dentro = Math.max(0, -desfaseSec);
      const silencio = Math.max(0, desfaseSec);
      audio = {
        file: ruta,
        keeps: [{ start: dentro, end: dentro + Math.max(0, spanMs / 1000 - silencio), rate: 1 }],
        delaySec: silencio,
      };
    } else {
      warnings.push(`El proyecto declara una voz (${voz.file}) pero el fichero no esta.`);
    }
  }

  if (!audio && llevaAudio && quiere !== 'ninguna' && manifest.audio) {
    const pista = manifest.audio;
    const ruta = path.join(root, pista.file);
    if (await exists(ruta)) {
      // Los mismos tramos que conserva el video, traducidos a segundos del
      // fichero de audio. Cortarlos por separado desincronizaria la narracion
      // justo a partir del primer silencio quitado.
      const keeps = map.keeps.map((k) => ({
        start: audioTimeFor(pista, manifest.startedAt, k.start),
        end: audioTimeFor(pista, manifest.startedAt, k.end),
        // El video se acelera muestreando; el audio hay que estirarlo, y de eso
        // se encarga `atempo` con esta velocidad.
        rate: k.rate,
      }));
      const al = audioAlignment(pista, manifest.startedAt, map.keeps[0]?.start ?? 0);
      audio = { file: ruta, keeps, delaySec: al.delaySec };
    } else {
      warnings.push(`El manifest declara audio (${pista.file}) pero el fichero no esta.`);
    }
  }

  const quitados = (project.cuts ?? []).length;
  if (quitados > 0) {
    const fuera = (manifest.durationMs - spanMs) / 1000;
    warnings.push(`Se quitaron ${quitados} tramos (${fuera.toFixed(1)}s en total).`);
  }

  // El fondo se decodifica UNA vez, fuera del bucle: hacerlo por frame
  // multiplicaria por mil la decodificacion de la misma imagen.
  let fondo: Awaited<ReturnType<typeof loadImage>> | null = null;
  if (renderProject.background.kind === 'image') {
    const ruta = path.resolve(root, renderProject.background.path);
    try {
      fondo = await loadImage(ruta);
    } catch {
      warnings.push(`No se pudo cargar el fondo (${renderProject.background.path}); se usa color solido.`);
    }
  }

  // La camara web se extrae a imagenes ANTES de empezar.
  //
  // El compositor dibuja la burbuja con Canvas 2D porque es el mismo que pinta
  // el preview, y necesita imagenes decodificables, no un webm. 15 fps bastan
  // para una cara y evitan decodificar cuatro veces mas de lo que se ve.
  let cam: { dir: string; total: number } | null = null;
  if (manifest.camara && renderProject.camara) {
    const pista = manifest.camara;
    const ruta = path.join(root, pista.file);
    if (await exists(ruta)) {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-cam-'));
      try {
        // Se extrae al tamano que va a ocupar la burbuja, no al nativo.
        const lado = Math.round(settings.height * Math.min(0.45, renderProject.camara.tamano));
        await extraerFrames(findFfmpeg(), ruta, path.join(dir, '%06d.jpg'),
          { fps: CAM_FPS, alto: lado });
        const total = (await fsp.readdir(dir)).length;
        if (total > 0) {
          cam = { dir, total };
        } else {
          await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
          warnings.push('La camara no tenia frames utiles: el video sale sin burbuja.');
        }
      } catch (e) {
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
        warnings.push(
          `No se pudo preparar la camara (${e instanceof Error ? e.message : String(e)}); `
          + 'el video sale sin burbuja.');
      }
    } else {
      warnings.push(`El manifest declara camara (${pista.file}) pero el fichero no esta.`);
    }
  }

  const canvas = createCanvas(settings.width, settings.height);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  // Media unidad de frame de margen para que el redondeo no se coma el ultimo.
  const durationSec = (totalFrames + 0.5) / settings.fps;
  const encoder = startEncoder(findFfmpeg(), settings, file, audio, durationSec);

  let cachedFile = '';
  let cachedImg: Awaited<ReturnType<typeof loadImage>> | null = null;
  let camFile = '';
  let camImg: Awaited<ReturnType<typeof loadImage>> | null = null;
  const t0 = Date.now();

  /**
   * Reparto del tiempo de un fotograma, para no optimizar a ciegas.
   *
   * Apagado salvo `VITRINA_MEDIR=1`, como `data-medir` en el editor. Un export
   * son cuatro cosas por fotograma —decodificar el JPEG de origen, componer,
   * SACAR los pixeles del lienzo y pasarselos a ffmpeg— y sin repartirlas no hay
   * forma de saber cual arreglar; a ojo, cualquiera parece la culpable.
   *
   * `leer` va aparte de `componer` porque la primera version las juntaba y daba
   * una respuesta enganosa: parecia que componer se llevaba el 69 % del export
   * cuando componer cuesta el 3 % y lo caro es sacar los pixeles del lienzo.
   */
  const midiendo = !!process.env['VITRINA_MEDIR'];
  /**
   * El fotograma que va por el tubo mientras se compone el siguiente.
   *
   * El bucle escribia y se quedaba esperando a que ffmpeg tragara, teniendo el
   * fotograma siguiente por decodificar. Ahora se solapan: se espera al envio
   * ANTERIOR justo antes de mandar el actual, asi que decodificar, componer y
   * leer el lienzo ocurren mientras ffmpeg trabaja.
   *
   * Es seguro porque `canvas.data()` devuelve una COPIA de los pixeles —
   * comprobado, no supuesto—: componer encima del lienzo no toca el buffer que
   * se esta escribiendo.
   */
  let enElTubo: Promise<void> | null = null;
  /**
   * Decodificaciones ya en marcha, por fichero.
   *
   * `loadImage` es asincrono y trabaja en hilos nativos, pero el bucle la
   * esperaba justo cuando la necesitaba, asi que esos hilos no servian de nada:
   * medido, 15,6 s de los 53 de un export se iban en esperar JPEGs. Y hay mas:
   * treinta decodificaciones a la vez salen a 4,8 ms cada una frente a 17,8 ms
   * una detras de otra —3,7 veces mas rapido—, porque el hilo unico ni siquiera
   * saturaba el pool.
   *
   * Cuatro en vuelo bastan para que el bucle no espere nunca; mas solo gastaria
   * memoria (cada imagen decodificada son unos 7 MB).
   */
  const enVuelo = new Map<string, Promise<Awaited<ReturnType<typeof loadImage>>>>();
  const ADELANTO = 4;
  const reparto = { decode: 0, componer: 0, leer: 0, tubo: 0 };
  const ahora = () => (midiendo ? performance.now() : 0);
  const sumar = (campo: keyof typeof reparto, desde: number) => {
    if (midiendo) reparto[campo] += performance.now() - desde;
  };

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (opts.signal?.aborted) throw new ExportAbortedError();

      // El instante de la salida no es el de la grabacion: el recorte desplaza
      // el origen y cada corte adelanta todo lo que viene detras.
      const tMs = map.sourceAt((i / settings.fps) * 1000);
      const frameFile = index.at(tMs);
      if (frameFile && (frameFile !== cachedFile || !cachedImg)) {
        const t = ahora();
        const pedida = enVuelo.get(frameFile);
        enVuelo.delete(frameFile);
        cachedImg = await (pedida ?? loadImage(path.join(root, 'frames', frameFile)));
        cachedFile = frameFile;
        sumar('decode', t);
      }
      if (!cachedImg) continue;

      // Lo que viene, pedido ya. Se mira mas de un fotograma por delante porque
      // con la salida a mas fps que la captura, los siguientes suelen salir del
      // MISMO fichero: buscar solo el de al lado no adelantaria casi nunca.
      for (let k = 1; enVuelo.size < ADELANTO && k <= settings.fps * 2; k++) {
        const f = index.at(map.sourceAt(((i + k) / settings.fps) * 1000));
        if (!f || f === cachedFile || enVuelo.has(f)) continue;
        const img = loadImage(path.join(root, 'frames', f));
        // El error se recoge en la vuelta que la espera; esto es solo para que
        // no quede como rechazo sin dueno si el export se aborta antes.
        img.catch(() => {});
        enVuelo.set(f, img);
      }

      // La camara se muestrea por el MISMO instante de material que el video,
      // asi que los cortes y las aceleraciones le salen gratis: no hay que
      // volver a sumar tiempos aqui.
      if (cam && manifest.camara) {
        const sec = audioTimeFor(manifest.camara, manifest.startedAt, tMs);
        const n = Math.round(sec * CAM_FPS) + 1;
        // Fuera del material grabado no se dibuja nada. Congelar la ultima cara
        // durante los ultimos segundos se leeria como un video colgado.
        const ruta = n >= 1 && n <= cam.total
          ? path.join(cam.dir, `${String(n).padStart(6, '0')}.jpg`)
          : '';
        if (ruta !== camFile) {
          camFile = ruta;
          camImg = ruta ? await loadImage(ruta).catch(() => null) : null;
        }
      }

      const tComponer = ahora();
      composite({
        ctx,
        source: cachedImg as unknown as ImageLike,
        sourceSize,
        camera: track.sampleAt(tMs),
        project: renderProject,
        cursor: cursor.sample(tMs),
        overlay: overlay.sample(tMs),
        watermarkImage: marca as unknown as ImageLike | null,
        backgroundImage: fondo as unknown as ImageLike | null,
        // El tamano es el de la imagen EXTRAIDA, no el nativo de la camara: el
        // pre-pase la escala al tamano de la burbuja, y recortar con las medidas
        // del manifest apuntaria a una region que ya no existe —dibujaba nada, y
        // sin error—.
        cam: cam && camImg
          ? { img: camImg as unknown as ImageLike, w: camImg.width, h: camImg.height }
          : null,
      });

      sumar('componer', tComponer);

      const tLeer = ahora();
      const datos = canvas.data();
      sumar('leer', tLeer);

      const tTubo = ahora();
      if (enElTubo) await enElTubo;
      sumar('tubo', tTubo);
      const envio = encoder.write(datos);
      // Si el envio falla mas tarde, el `await` de la vuelta siguiente lo
      // recoge; este `catch` esta solo para que un fallo despues de abortar no
      // quede como rechazo sin dueno.
      envio.catch(() => {});
      enElTubo = envio;

      if (opts.onProgress && (i % 10 === 0 || i === totalFrames - 1)) {
        const elapsed = Date.now() - t0;
        const fps = (i + 1) / Math.max(0.001, elapsed / 1000);
        opts.onProgress({
          frame: i + 1,
          totalFrames,
          fraction: (i + 1) / totalFrames,
          fps,
          etaMs: ((totalFrames - i - 1) / Math.max(0.001, fps)) * 1000,
        });
      }
    }

    if (enElTubo) await enElTubo;
    await encoder.finish();

    if (midiendo) {
      const total = Date.now() - t0;
      const pct = (ms: number) => `${((ms / total) * 100).toFixed(0)}%`;
      process.stderr.write(
        `[vitrina] export ${totalFrames} fotogramas en ${(total / 1000).toFixed(1)} s: `
        + `decode ${(reparto.decode / 1000).toFixed(1)} s (${pct(reparto.decode)}), `
        + `componer ${(reparto.componer / 1000).toFixed(1)} s (${pct(reparto.componer)}), `
        + `leer el lienzo ${(reparto.leer / 1000).toFixed(1)} s (${pct(reparto.leer)}), `
        + `tubo ${(reparto.tubo / 1000).toFixed(1)} s (${pct(reparto.tubo)})\n`,
      );
    }
  } catch (e) {
    encoder.abort();
    // Un fichero a medias es peor que ninguno: parece valido y no lo es.
    await fsp.rm(file, { force: true }).catch(() => {});
    throw e;
  } finally {
    // Los frames de la camara son de usar y tirar, y son cientos: se borran
    // salga bien o mal.
    if (cam) await fsp.rm(cam.dir, { recursive: true, force: true }).catch(() => {});
  }

  const stat = await fsp.stat(file);
  const mbPorSegundo = stat.size / 1024 / 1024 / (spanMs / 1000);
  if (mbPorSegundo > 8) {
    warnings.push(
      `El fichero pesa ${(stat.size / 1024 / 1024).toFixed(0)} MB `
      + `(${mbPorSegundo.toFixed(0)} MB/s). Es lo normal en este formato, `
      + 'pero no sirve para compartir tal cual: sirve para montarlo en un editor.',
    );
  }

  return {
    file,
    settings,
    frames: totalFrames,
    durationMs: spanMs,
    bytes: stat.size,
    elapsedMs: Date.now() - t0,
    budget,
    warnings,
  };
}

/**
 * Recorta las escalas de los tramos al margen de la salida elegida.
 *
 * Se respetan los encuadres (que el usuario puede haber movido a mano) y solo
 * se toca la ampliacion, que es lo que la resolucion de salida condiciona.
 */
export function clampZooms(
  zooms: ZoomSegment[],
  budget: QualityBudget,
  allowSoft: boolean,
  warnings: string[],
): ZoomSegment[] {
  if (allowSoft) return zooms;

  let recortados = 0;
  const out = zooms.map((z) => {
    if (z.scale <= budget.maxSharpZoom) return z;
    recortados++;
    return { ...z, scale: budget.maxSharpZoom };
  });

  if (recortados > 0) {
    warnings.push(
      `${recortados} de ${zooms.length} tramos se recortaron a ${budget.maxSharpZoom.toFixed(2)}x `
      + 'para no ampliar pixeles. Usa --soft si prefieres mas zoom aunque pierda nitidez.',
    );
  }
  return out;
}
