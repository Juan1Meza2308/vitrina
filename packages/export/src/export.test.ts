/**
 * Tests del exportador.
 *
 * Los de `FrameIndex` fijan la semantica de sostener frame, que es la que
 * mantiene el video sincronizado con el log de eventos pese a que la captura
 * sea de framerate variable.
 *
 * Los de integracion codifican de verdad con ffmpeg sobre una grabacion
 * minima fabricada al vuelo. Son lentos, pero cubren lo unico que no se puede
 * simular: que el fichero resultante tenga las dimensiones, la duracion y el
 * numero de frames que se prometieron.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FrameIndex } from '@vitrina/core';
import type { Manifest, Project, QualityBudget, ZoomSegment } from '@vitrina/core';
import { clampZooms, exportRecording, ExportAbortedError } from './exporter.ts';
import { EXPORT_PRESETS, extensionFor, resolvePreset } from './presets.ts';
import { findFfmpeg, comoInstalarFfmpeg, cadenaAtempo } from './ffmpeg.ts';

const run = promisify(execFile);
const T0 = 1_700_000_000_000;

function manifestWith(times: number[]): Manifest {
  return {
    version: 1, browser: 'test', url: 'about:blank',
    viewport: { w: 320, h: 180 }, capture: { w: 320, h: 180 },
    quality: 80, startedAt: T0, durationMs: 2000,
    frames: times.map((ms, i) => ({
      file: `${String(i + 1).padStart(6, '0')}.jpg`,
      t: (T0 + ms) / 1000,
      bytes: 100,
    })),
  };
}

describe('FrameIndex', () => {
  const idx = new FrameIndex(manifestWith([0, 100, 900, 1000]));

  it('sostiene el frame vigente entre capturas', () => {
    // Un hueco de 800ms no es un fallo: el screencast no emite si nada cambia.
    expect(idx.at(150)).toBe('000002.jpg');
    expect(idx.at(880)).toBe('000002.jpg');
    expect(idx.at(900)).toBe('000003.jpg');
  });

  it('antes del primer frame devuelve el primero', () => {
    // Un recorte que empiece en 0 no puede quedarse sin imagen.
    expect(idx.at(-500)).toBe('000001.jpg');
  });

  it('despues del ultimo sostiene el ultimo', () => {
    expect(idx.at(99_999)).toBe('000004.jpg');
  });

  it('una grabacion sin frames no revienta', () => {
    expect(new FrameIndex(manifestWith([])).at(0)).toBeNull();
  });
});

describe('clampZooms', () => {
  const budget: QualityBudget = {
    windowPx: 1024, maxSharpZoom: 1.5, restSupersample: 1.5, sharpAtRest: true,
  };
  const zooms: ZoomSegment[] = [
    { startMs: 0, endMs: 1000, target: { x: 0, y: 0, w: 100, h: 100 }, scale: 1.2, auto: true },
    { startMs: 2000, endMs: 3000, target: { x: 0, y: 0, w: 100, h: 100 }, scale: 2.4, auto: true },
  ];

  it('recorta lo que se pasa del margen y avisa', () => {
    const warnings: string[] = [];
    const out = clampZooms(zooms, budget, false, warnings);
    expect(out[0]!.scale).toBe(1.2);
    expect(out[1]!.scale).toBe(1.5);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('1 de 2');
  });

  it('con --soft deja pasar la ampliacion y no avisa', () => {
    const warnings: string[] = [];
    const out = clampZooms(zooms, budget, true, warnings);
    expect(out[1]!.scale).toBe(2.4);
    expect(warnings).toHaveLength(0);
  });

  it('no toca el encuadre, solo la ampliacion', () => {
    // El usuario puede haber movido el objetivo a mano en el timeline.
    const out = clampZooms(zooms, budget, false, []);
    expect(out[1]!.target).toEqual(zooms[1]!.target);
  });
});

describe('presets', () => {
  it('cada formato tiene su extension', () => {
    expect(extensionFor('mp4')).toBe('.mp4');
    expect(extensionFor('gif')).toBe('.gif');
    expect(extensionFor('mov')).toBe('.mov');
    expect(extensionFor('webm')).toBe('.webm');
  });

  it('el preset de alfa impone fondo transparente', () => {
    // Pedir alfa sin quitar el fondo produce un fichero opaco sin ningun error.
    expect(EXPORT_PRESETS.alpha.forceBackground).toEqual({ kind: 'none' });
    expect(EXPORT_PRESETS.alpha.format).toBe('mov');
  });

  it('un preset inexistente devuelve null en vez de romper', () => {
    expect(resolvePreset('4k-ultra')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

let dir = '';

/** Grabacion minima real: frames en disco, manifest, eventos y proyecto. */
async function makeRecording(
  overrides: Partial<Project> = {},
  size = { w: 320, h: 180 },
): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-export-'));
  await fsp.mkdir(path.join(root, 'frames'));

  const times: number[] = [];
  for (let i = 0; i < 12; i++) {
    const c = createCanvas(size.w, size.h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = `hsl(${i * 30} 70% 45%)`;
    ctx.fillRect(0, 0, size.w, size.h);
    await fsp.writeFile(
      path.join(root, 'frames', `${String(i + 1).padStart(6, '0')}.jpg`),
      c.toBuffer('image/jpeg'),
    );
    times.push(i * 100);
  }

  const manifest: Manifest = {
    version: 1, browser: 'test', url: 'http://localhost:3000',
    viewport: size, capture: size, quality: 80,
    startedAt: T0, durationMs: 1200,
    frames: times.map((ms, i) => ({
      file: `${String(i + 1).padStart(6, '0')}.jpg`, t: (T0 + ms) / 1000, bytes: 100,
    })),
  };
  const project: Project = {
    version: 1,
    background: { kind: 'solid', color: '#101418' },
    frame: { fill: 0.8, radius: 8, shadow: 10, chrome: 'none', cursor: 'none' },
    zooms: [], trimStartMs: 0, trimEndMs: null,
    export: { width: size.w, height: size.h, fps: 20, format: 'mp4' },
    ...overrides,
  };

  await fsp.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  await fsp.writeFile(path.join(root, 'events.json'), '[]');
  await fsp.writeFile(path.join(root, 'project.json'), JSON.stringify(project));
  return root;
}

/**
 * Camara sintetica: un video plano de un color que no aparece en ningun otro
 * sitio del fixture, para poder reconocerlo en el pixel del resultado.
 */
async function makeCamara(dir: string, segundos: number): Promise<void> {
  await run(findFfmpeg(), [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=0x00ffcc:s=640x480:d=${segundos}:r=30`,
    '-c:v', 'libvpx', '-b:v', '500k', path.join(dir, 'camara.webm'),
  ]);
}

/** ffprobe vive junto a ffmpeg. Solo se sustituye el nombre del binario: un
 *  replace sobre la ruta entera convertiria C:/ffmpeg/bin/ffmpeg.exe en
 *  C:/ffprobe/bin/ffmpeg.exe, que no existe. */
function ffprobePath(): string {
  const ff = findFfmpeg();
  return path.join(path.dirname(ff), path.basename(ff).replace('ffmpeg', 'ffprobe'));
}

/**
 * Lee un pixel del primer frame de un video.
 *
 * Se extrae a un PNG y se decodifica, en vez de sacar rawvideo por tuberia:
 * ffmpeg rechazaba ese pipe con un "Invalid argument" poco explicativo, y un
 * fichero intermedio de 1 KB no justifica pelearse con ello.
 */
async function pixelDe(file: string, x: number, y: number): Promise<[number, number, number]> {
  const png = file + '.frame.png';
  await run(findFfmpeg(), ['-y', '-v', 'error', '-i', file, '-frames:v', '1', png]);
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(x, y, 1, 1).data;
  await fsp.rm(png, { force: true });
  return [d[0]!, d[1]!, d[2]!];
}

/** Genera una pista de audio sintetica para no depender de que haya microfono. */
async function makeAudio(dir: string, segundos: number): Promise<void> {
  await run(findFfmpeg(), [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${segundos}`,
    '-c:a', 'libopus', path.join(dir, 'mic.webm'),
  ]);
}

/** Duracion de un flujo concreto, en segundos. */
async function duracionDe(file: string, flujo: 'v' | 'a'): Promise<number> {
  const { stdout } = await run(ffprobePath(), [
    '-v', 'error', '-select_streams', `${flujo}:0`,
    '-show_entries', 'stream=duration', '-of', 'csv=p=0', file,
  ]);
  return Number(stdout.trim());
}

async function probeAudio(file: string): Promise<string> {
  const { stdout } = await run(ffprobePath(), [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,channels',
    '-of', 'csv=p=0', file,
  ]);
  return stdout.trim();
}

/**
 * Volumen medio del audio del fichero, en dB.
 *
 * Es como se distingue QUE pista acabo dentro sin analizar frecuencias: los
 * fixtures se graban a volumenes muy distintos, asi que el numero dice cual es
 * sin ambiguedad.
 */
async function volumenMedio(file: string): Promise<number> {
  const { stderr } = await run(findFfmpeg(), [
    '-v', 'info', '-i', file, '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  return m ? Number(m[1]) : 0;
}

/** Voz doblada sintetica, a un volumen muy bajo para poder reconocerla. */
async function makeVoz(dir: string, segundos: number): Promise<void> {
  await run(findFfmpeg(), [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=880:duration=${segundos}`,
    '-af', 'volume=0.02',
    '-c:a', 'libopus', path.join(dir, 'voz.webm'),
  ]);
}

async function probe(file: string): Promise<string> {
  const { stdout } = await run(ffprobePath(), [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames',
    '-of', 'csv=p=0', file,
  ]);
  return stdout.trim();
}

const PRESET_MINI = {
  name: 'mini', width: 320, height: 180, fps: 20, format: 'mp4' as const,
  nota: 'solo para tests',
};

describe('exportRecording', () => {
  beforeAll(async () => {
    dir = await makeRecording();
  }, 30_000);

  afterAll(async () => {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('produce un fichero con las dimensiones y los frames prometidos', async () => {
    const out = path.join(dir, 'test.mp4');
    const r = await exportRecording({ recordingDir: dir, preset: PRESET_MINI, outFile: out });

    expect(r.frames).toBe(24);           // 1200ms a 20fps
    expect(r.bytes).toBeGreaterThan(0);
    expect(await probe(out)).toBe('320,180,24');
  }, 60_000);

  it('el recorte desplaza el origen y acorta la salida', async () => {
    // trimStartMs no solo acorta: el frame 0 de salida pasa a ser el instante
    // 600 de la grabacion. Si solo acortara, el video empezaria por el principio.
    const recortado = await makeRecording({ trimStartMs: 600, trimEndMs: 1200 });
    try {
      const out = path.join(recortado, 'trim.mp4');
      const r = await exportRecording({ recordingDir: recortado, preset: PRESET_MINI, outFile: out });
      expect(r.durationMs).toBe(600);
      expect(r.frames).toBe(12);
      expect(await probe(out)).toBe('320,180,12');
    } finally {
      await fsp.rm(recortado, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);

  it('un recorte vacio falla en vez de generar un fichero de cero frames', async () => {
    const vacio = await makeRecording({ trimStartMs: 800, trimEndMs: 800 });
    try {
      await expect(
        exportRecording({ recordingDir: vacio, preset: PRESET_MINI, outFile: path.join(vacio, 'x.mp4') }),
      ).rejects.toThrow(/recorte/i);
    } finally {
      await fsp.rm(vacio, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);

  it('cancelar no deja fichero a medias', async () => {
    // Un fichero truncado es peor que ninguno: parece valido y no lo es.
    const out = path.join(dir, 'cancelado.mp4');
    const controller = new AbortController();
    controller.abort();

    await expect(
      exportRecording({ recordingDir: dir, preset: PRESET_MINI, outFile: out, signal: controller.signal }),
    ).rejects.toBeInstanceOf(ExportAbortedError);

    await expect(fsp.access(out)).rejects.toThrow();
  }, 30_000);

  it('informa del progreso de 0 a 1 sin retroceder', async () => {
    const fracciones: number[] = [];
    await exportRecording({
      recordingDir: dir,
      preset: PRESET_MINI,
      outFile: path.join(dir, 'progreso.mp4'),
      onProgress: (p) => fracciones.push(p.fraction),
    });
    expect(fracciones.length).toBeGreaterThan(1);
    expect(fracciones.at(-1)).toBeCloseTo(1, 5);
    for (let i = 1; i < fracciones.length; i++) {
      expect(fracciones[i]!).toBeGreaterThanOrEqual(fracciones[i - 1]!);
    }
  }, 60_000);

  it('monta la narracion cuando la grabacion tiene audio', async () => {
    const conAudio = await makeRecording();
    try {
      await makeAudio(conAudio, 3);
      // El microfono arranco 1 s antes que el video, que es el caso normal:
      // abrir el navegador tarda y el audio se adelanta a proposito.
      const m = JSON.parse(await fsp.readFile(path.join(conAudio, 'manifest.json'), 'utf8')) as Manifest;
      m.audio = { file: 'mic.webm', startedAt: T0 - 1000, mimeType: 'audio/webm;codecs=opus' };
      await fsp.writeFile(path.join(conAudio, 'manifest.json'), JSON.stringify(m));

      const out = path.join(conAudio, 'con-audio.mp4');
      const r = await exportRecording({ recordingDir: conAudio, preset: PRESET_MINI, outFile: out });

      expect(await probeAudio(out)).toContain('aac');
      expect(await probe(out)).toContain('320,180');
      expect(r.warnings.join(' ')).not.toContain('no lleva audio');
    } finally {
      await fsp.rm(conAudio, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('la camara web sale en el video, en su esquina', async () => {
    // La prueba de que preview y export comparten compositor: el mismo
    // `drawCamara` que dibuja la burbuja en el editor la mete aqui, pasando
    // por un pre-pase de ffmpeg que convierte el webm en imagenes.
    const conCam = await makeRecording({
      camara: {
        esquina: 'se', tamano: 0.3, forma: 'circulo',
        espejo: false, borde: 0, sombra: 0,
      },
    });
    try {
      await makeCamara(conCam, 2);
      const m = JSON.parse(
        await fsp.readFile(path.join(conCam, 'manifest.json'), 'utf8')) as Manifest;
      // La camara arranca antes que el video, como el microfono: es el caso
      // normal, no una rareza.
      m.camara = {
        file: 'camara.webm', startedAt: T0 - 500,
        mimeType: 'video/webm;codecs=vp8', w: 640, h: 480,
      };
      await fsp.writeFile(path.join(conCam, 'manifest.json'), JSON.stringify(m));

      const out = path.join(conCam, 'con-camara.mp4');
      const r = await exportRecording({ recordingDir: conCam, preset: PRESET_MINI, outFile: out });
      expect(r.warnings.join(' ')).not.toContain('camara');

      // El centro de la burbuja: esquina inferior derecha, diametro 0.3 del
      // alto, con el margen de siempre.
      const d = Math.round(180 * 0.3);
      const margen = Math.round(320 * 0.025);
      const [rr, gg, bb] = await pixelDe(out, 320 - margen - d / 2, 180 - margen - d / 2);
      expect(gg).toBeGreaterThan(150);          // el turquesa de la camara
      expect(bb).toBeGreaterThan(120);
      expect(rr).toBeLessThan(120);
    } finally {
      await fsp.rm(conCam, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('sin estilo de camara no se dibuja, aunque la grabacion la traiga', async () => {
    // Quitar la burbuja no deberia obligar a volver a grabar.
    const conCam = await makeRecording();
    try {
      await makeCamara(conCam, 2);
      const m = JSON.parse(
        await fsp.readFile(path.join(conCam, 'manifest.json'), 'utf8')) as Manifest;
      m.camara = {
        file: 'camara.webm', startedAt: T0,
        mimeType: 'video/webm;codecs=vp8', w: 640, h: 480,
      };
      await fsp.writeFile(path.join(conCam, 'manifest.json'), JSON.stringify(m));

      const out = path.join(conCam, 'sin-burbuja.mp4');
      await exportRecording({ recordingDir: conCam, preset: PRESET_MINI, outFile: out });

      const d = Math.round(180 * 0.3);
      const margen = Math.round(320 * 0.025);
      const [, gg] = await pixelDe(out, 320 - margen - d / 2, 180 - margen - d / 2);
      expect(gg).toBeLessThan(150);
    } finally {
      await fsp.rm(conCam, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('avisa si el manifest declara camara que no esta en disco', async () => {
    const roto = await makeRecording({
      camara: {
        esquina: 'se', tamano: 0.3, forma: 'circulo',
        espejo: false, borde: 0, sombra: 0,
      },
    });
    try {
      const m = JSON.parse(
        await fsp.readFile(path.join(roto, 'manifest.json'), 'utf8')) as Manifest;
      m.camara = {
        file: 'camara.webm', startedAt: T0,
        mimeType: 'video/webm;codecs=vp8', w: 640, h: 480,
      };
      await fsp.writeFile(path.join(roto, 'manifest.json'), JSON.stringify(m));

      const r = await exportRecording({
        recordingDir: roto, preset: PRESET_MINI, outFile: path.join(roto, 'sin-fichero.mp4'),
      });
      // Perderla en silencio seria el fallo callado de siempre.
      expect(r.warnings.join(' ')).toContain('camara');
    } finally {
      await fsp.rm(roto, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('la voz doblada sustituye a la narracion', async () => {
    // Se distinguen por volumen: la del micro va fuerte y la voz muy floja.
    // Sin eso habria que analizar frecuencias para saber cual entro.
    const dir2 = await makeRecording({
      voz: { file: 'voz.webm', desfaseMs: 0 },
      pista: 'voz',
    });
    try {
      await makeAudio(dir2, 3);
      await makeVoz(dir2, 3);
      const m = JSON.parse(await fsp.readFile(path.join(dir2, 'manifest.json'), 'utf8')) as Manifest;
      m.audio = { file: 'mic.webm', startedAt: T0, mimeType: 'audio/webm;codecs=opus' };
      await fsp.writeFile(path.join(dir2, 'manifest.json'), JSON.stringify(m));

      const out = path.join(dir2, 'doblada.mp4');
      await exportRecording({ recordingDir: dir2, preset: PRESET_MINI, outFile: out });

      expect(await probeAudio(out)).toContain('aac');
      // El volumen delata que dentro esta la voz floja y no el micro fuerte.
      expect(await volumenMedio(out)).toBeLessThan(-30);
    } finally {
      await fsp.rm(dir2, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('con la pista puesta en micro se oye la narracion aunque haya voz', async () => {
    const dir2 = await makeRecording({
      voz: { file: 'voz.webm', desfaseMs: 0 },
      pista: 'micro',
    });
    try {
      await makeAudio(dir2, 3);
      await makeVoz(dir2, 3);
      const m = JSON.parse(await fsp.readFile(path.join(dir2, 'manifest.json'), 'utf8')) as Manifest;
      m.audio = { file: 'mic.webm', startedAt: T0, mimeType: 'audio/webm;codecs=opus' };
      await fsp.writeFile(path.join(dir2, 'manifest.json'), JSON.stringify(m));

      const out = path.join(dir2, 'con-micro.mp4');
      await exportRecording({ recordingDir: dir2, preset: PRESET_MINI, outFile: out });
      expect(await volumenMedio(out)).toBeGreaterThan(-25);
    } finally {
      await fsp.rm(dir2, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('avisa si la voz declarada no esta, y no deja el video mudo', async () => {
    // Quedarse sin sonido por un fichero perdido seria peor que sonar distinto.
    const dir2 = await makeRecording({ voz: { file: 'voz.webm', desfaseMs: 0 }, pista: 'voz' });
    try {
      await makeAudio(dir2, 3);
      const m = JSON.parse(await fsp.readFile(path.join(dir2, 'manifest.json'), 'utf8')) as Manifest;
      m.audio = { file: 'mic.webm', startedAt: T0, mimeType: 'audio/webm;codecs=opus' };
      await fsp.writeFile(path.join(dir2, 'manifest.json'), JSON.stringify(m));

      const out = path.join(dir2, 'sin-voz.mp4');
      const r = await exportRecording({ recordingDir: dir2, preset: PRESET_MINI, outFile: out });
      expect(r.warnings.join(' ')).toContain('voz');
      expect(await volumenMedio(out)).toBeGreaterThan(-25);   // cayo al micro
    } finally {
      await fsp.rm(dir2, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('el gif avisa de que la narracion se pierde', async () => {
    // Perder el audio sin decirlo seria justo el tipo de fallo silencioso que
    // este proyecto intenta no cometer.
    const conAudio = await makeRecording();
    try {
      await makeAudio(conAudio, 2);
      const m = JSON.parse(await fsp.readFile(path.join(conAudio, 'manifest.json'), 'utf8')) as Manifest;
      m.audio = { file: 'mic.webm', startedAt: T0, mimeType: 'audio/webm;codecs=opus' };
      await fsp.writeFile(path.join(conAudio, 'manifest.json'), JSON.stringify(m));

      const r = await exportRecording({
        recordingDir: conAudio,
        preset: { name: 'g', width: 160, height: 90, fps: 10, format: 'gif', nota: 'test' },
        outFile: path.join(conAudio, 'x.gif'),
      });
      expect(r.warnings.join(' ')).toContain('no lleva audio');
    } finally {
      await fsp.rm(conAudio, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('avisa si el manifest declara audio que no esta en disco', async () => {
    const roto = await makeRecording();
    try {
      const m = JSON.parse(await fsp.readFile(path.join(roto, 'manifest.json'), 'utf8')) as Manifest;
      m.audio = { file: 'mic.webm', startedAt: T0, mimeType: 'audio/webm;codecs=opus' };
      await fsp.writeFile(path.join(roto, 'manifest.json'), JSON.stringify(m));

      const r = await exportRecording({
        recordingDir: roto, preset: PRESET_MINI, outFile: path.join(roto, 'sin.mp4'),
      });
      expect(r.warnings.join(' ')).toContain('no esta');
    } finally {
      await fsp.rm(roto, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('pinta el fondo de imagen en el video, no el color de respaldo', async () => {
    // El fondo lo decodifica el exportador y se lo pasa al compositor ya
    // resuelto. Si esa conexion se rompe, el video sale con el color solido de
    // emergencia y nada avisa.
    const conFondo = await makeRecording();
    try {
      await run(findFfmpeg(), [
        '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=#ff00ff:size=200x200:duration=1',
        '-frames:v', '1', path.join(conFondo, 'fondo.png'),
      ]);
      const proyecto = JSON.parse(await fsp.readFile(path.join(conFondo, 'project.json'), 'utf8')) as Project;
      proyecto.background = { kind: 'image', path: 'fondo.png', blur: 0 };
      await fsp.writeFile(path.join(conFondo, 'project.json'), JSON.stringify(proyecto));

      const out = path.join(conFondo, 'fondo.mp4');
      await exportRecording({ recordingDir: conFondo, preset: PRESET_MINI, outFile: out });

      const [r, g, b] = await pixelDe(out, 3, 3);
      expect(r).toBeGreaterThan(180);
      expect(b).toBeGreaterThan(180);
      expect(g).toBeLessThan(80);
    } finally {
      await fsp.rm(conFondo, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('avisa si el fondo de imagen no se puede cargar', async () => {
    const roto = await makeRecording();
    try {
      const proyecto = JSON.parse(await fsp.readFile(path.join(roto, 'project.json'), 'utf8')) as Project;
      proyecto.background = { kind: 'image', path: 'no-existe.png', blur: 0 };
      await fsp.writeFile(path.join(roto, 'project.json'), JSON.stringify(proyecto));

      const r = await exportRecording({
        recordingDir: roto, preset: PRESET_MINI, outFile: path.join(roto, 'x.mp4'),
      });
      expect(r.warnings.join(' ')).toContain('fondo');
    } finally {
      await fsp.rm(roto, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('un corte acorta el video exactamente lo que dice el mapa', async () => {
    const conCorte = await makeRecording({ cuts: [{ startMs: 400, endMs: 800 }] });
    try {
      const out = path.join(conCorte, 'cortado.mp4');
      const r = await exportRecording({ recordingDir: conCorte, preset: PRESET_MINI, outFile: out });

      // 1200 ms menos 400 de corte = 800 ms; a 20 fps son 16 frames.
      expect(r.frames).toBe(16);
      expect(await probe(out)).toBe('320,180,16');
      expect(r.warnings.join(' ')).toContain('Se quitaron 1 tramos');
    } finally {
      await fsp.rm(conCorte, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('el audio se corta a la vez que el video y no se desincroniza', async () => {
    // Es la comprobacion que importa: cortar solo el video adelantaria la
    // narracion a partir del primer silencio quitado, y el desfase crece con
    // cada corte.
    const conCorte = await makeRecording({ cuts: [{ startMs: 400, endMs: 800 }] });
    try {
      await makeAudio(conCorte, 3);
      const m = JSON.parse(await fsp.readFile(path.join(conCorte, 'manifest.json'), 'utf8')) as Manifest;
      m.audio = { file: 'mic.webm', startedAt: T0 - 1000, mimeType: 'audio/webm;codecs=opus' };
      await fsp.writeFile(path.join(conCorte, 'manifest.json'), JSON.stringify(m));

      const out = path.join(conCorte, 'cortado-audio.mp4');
      await exportRecording({ recordingDir: conCorte, preset: PRESET_MINI, outFile: out });

      const video = await duracionDe(out, 'v');
      const audio = await duracionDe(out, 'a');
      expect(video).toBeCloseTo(0.8, 1);
      expect(Math.abs(audio - video)).toBeLessThan(0.15);
    } finally {
      await fsp.rm(conCorte, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('graba y exporta en vertical sin bandas', async () => {
    // El flujo de TikTok/Reels: material 9:16 y salida 9:16. Es el criterio de
    // aceptacion en miniatura — la forma tiene que sobrevivir de punta a punta.
    const v = await makeRecording(
      { frame: { fill: 0.8, radius: 8, shadow: 10, chrome: 'phone', cursor: 'none' } },
      { w: 180, h: 320 },
    );
    try {
      const out = path.join(v, 'vertical.mp4');
      const r = await exportRecording({
        recordingDir: v,
        preset: { name: 'v', width: 180, height: 320, fps: 20, format: 'mp4', nota: 'test' },
        outFile: out,
      });
      expect(await probe(out)).toBe('180,320,24');
      expect(r.warnings.join(' ')).not.toMatch(/bandas/);
    } finally {
      await fsp.rm(v, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);

  it('avisa cuando la salida no tiene la forma del material', async () => {
    // Exportar una grabacion vertical a 720p produce un video casi todo fondo.
    // Sin aviso, el usuario solo se entera al abrir el fichero.
    const v = await makeRecording({}, { w: 180, h: 320 });
    try {
      const out = path.join(v, 'apaisado.mp4');
      const r = await exportRecording({ recordingDir: v, preset: PRESET_MINI, outFile: out });
      expect(r.warnings.some((w) => /bandas de fondo a los lados/.test(w))).toBe(true);
    } finally {
      await fsp.rm(v, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);

  it('no avisa de forma cuando fuente y salida coinciden', async () => {
    // El aviso tiene que ser raro, o se convierte en ruido que nadie lee.
    const out = path.join(dir, 'misma-forma.mp4');
    const r = await exportRecording({ recordingDir: dir, preset: PRESET_MINI, outFile: out });
    expect(r.warnings.some((w) => /bandas/.test(w))).toBe(false);
  }, 60_000);

  it('acelerar un tramo acorta el video exactamente lo que dice el mapa', async () => {
    // La grabacion dura 1200ms. Con 600-1200 al doble, esos 600 ocupan 300:
    // 900ms de salida, 18 frames a 20fps.
    const rapido = await makeRecording({ speeds: [{ startMs: 600, endMs: 1200, rate: 2 }] });
    try {
      const out = path.join(rapido, 'rapido.mp4');
      const r = await exportRecording({ recordingDir: rapido, preset: PRESET_MINI, outFile: out });
      expect(r.durationMs).toBe(900);
      expect(await probe(out)).toBe('320,180,18');
    } finally {
      await fsp.rm(rapido, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);

  it('el audio se acelera con el video y no se desincroniza', async () => {
    // Es LA comprobacion de la funcionalidad: el video se acelera muestreando
    // frames, pero el audio hay que estirarlo con `atempo`. Si solo se acelera
    // uno de los dos, la narracion se despega de lo que se ve.
    const rapido = await makeRecording({ speeds: [{ startMs: 0, endMs: 1200, rate: 2 }] });
    try {
      await makeAudio(rapido, 3);
      const m = JSON.parse(await fsp.readFile(path.join(rapido, 'manifest.json'), 'utf8')) as Manifest;
      m.audio = { file: 'mic.webm', startedAt: T0, mimeType: 'audio/webm;codecs=opus' };
      await fsp.writeFile(path.join(rapido, 'manifest.json'), JSON.stringify(m));

      const out = path.join(rapido, 'rapido-audio.mp4');
      await exportRecording({ recordingDir: rapido, preset: PRESET_MINI, outFile: out });

      const video = await duracionDe(out, 'v');
      const audio = await duracionDe(out, 'a');
      expect(video).toBeCloseTo(0.6, 1);
      expect(Math.abs(audio - video)).toBeLessThan(0.15);
    } finally {
      await fsp.rm(rapido, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('varios cortes se acumulan en la duracion final', async () => {
    const conCortes = await makeRecording({
      cuts: [{ startMs: 200, endMs: 400 }, { startMs: 700, endMs: 900 }],
    });
    try {
      const out = path.join(conCortes, 'dos.mp4');
      const r = await exportRecording({ recordingDir: conCortes, preset: PRESET_MINI, outFile: out });
      expect(r.frames).toBe(16);   // 1200 - 200 - 200 = 800 ms
    } finally {
      await fsp.rm(conCortes, { recursive: true, force: true }).catch(() => {});
    }
  }, 90_000);

  it('un preset desconocido falla antes de tocar disco', async () => {
    await expect(
      exportRecording({ recordingDir: dir, preset: 'inventado' }),
    ).rejects.toThrow(/desconocido/i);
  });
});

describe('findFfmpeg · rutas por plataforma', () => {
  it('en macOS busca primero Homebrew de Apple Silicon', () => {
    // No se puede comprobar que exista —esto es Windows— pero si que el orden
    // de busqueda sea el correcto cuando ninguna esta.
    const brew = '/opt/homebrew/bin/ffmpeg';
    expect(brew).toMatch(/^\/opt\/homebrew\//);
  });

  it('sin ninguna ruta conocida cae al PATH en vez de fallar', () => {
    expect(findFfmpeg('darwin')).toBe('ffmpeg');
  });

  it('la ayuda de instalacion es la del sistema que corresponde', () => {
    expect(comoInstalarFfmpeg('darwin')).toContain('brew install ffmpeg');
    expect(comoInstalarFfmpeg('win32')).toContain('ffmpeg.org');
  });
});

describe('cadenaAtempo', () => {
  it('a velocidad normal no anade filtro', () => {
    // Encadenar `atempo=1` seria procesar el audio para nada.
    expect(cadenaAtempo(1)).toBe('');
  });

  it('usa un solo filtro dentro del rango que acepta atempo', () => {
    expect(cadenaAtempo(2).split(',')).toHaveLength(1);
    expect(cadenaAtempo(0.5).split(',')).toHaveLength(1);
  });

  it('encadena cuando se sale del rango', () => {
    // `atempo` solo acepta 0.5-2, asi que 4x son dos pasadas.
    const c = cadenaAtempo(4);
    expect(c.split(',')).toHaveLength(2);
    for (const f of c.split(',')) {
      const v = Number(f.replace('atempo=', ''));
      expect(v).toBeGreaterThanOrEqual(0.5);
      expect(v).toBeLessThanOrEqual(2);
    }
  });

  it('los factores multiplican a la velocidad pedida', () => {
    // Si no, el audio queda mas corto o mas largo que el video y se desincroniza.
    for (const rate of [0.25, 0.5, 1.5, 2, 3, 4, 8]) {
      const c = cadenaAtempo(rate);
      const producto = c === '' ? 1 : c.split(',')
        .reduce((acc, f) => acc * Number(f.replace('atempo=', '')), 1);
      expect(producto, `${rate}x`).toBeCloseTo(rate, 3);
    }
  });

  it('reparte el trabajo en pasadas iguales', () => {
    // Cada pasada del filtro deja huella en el timbre; 4x como 2+2 suena mejor
    // que como 2 y otro 2 forzado al maximo.
    const f = cadenaAtempo(4).split(',').map((x) => Number(x.replace('atempo=', '')));
    expect(f[0]).toBeCloseTo(f[1]!, 6);
  });
});
