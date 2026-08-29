/**
 * Backend de codificacion: ffmpeg alimentado por una tuberia de rawvideo.
 *
 * El plan preveia WebCodecs como backend principal, pero `VideoEncoder` es una
 * API de navegador y hoy el exportador corre en Node. Cuando exista el preview
 * de Electron se podra anadir ese camino; la interfaz de este modulo esta hecha
 * para que sea un backend mas, no una reescritura.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import type { ExportSettings } from '@vitrina/core';
import { supportsAudio } from '@vitrina/core';

/** Ultimas lineas de stderr que se guardan para poder explicar un fallo. */
const STDERR_LINES = 12;

/**
 * Rutas donde suele estar ffmpeg, por sistema.
 *
 * Se depende del ffmpeg del sistema en vez de empaquetar uno a proposito: los
 * presets `alpha` y `webm` necesitan `prores_ks` y `libopus`, y un build
 * empaquetado puede no traerlos. Un fallo de codec que solo aparece en la
 * maquina de otro es mucho peor que un paso de instalacion.
 */
function rutasFfmpeg(plataforma: NodeJS.Platform): string[] {
  if (plataforma === 'darwin') {
    return [
      '/opt/homebrew/bin/ffmpeg',   // Apple Silicon
      '/usr/local/bin/ffmpeg',      // Intel, o Homebrew antiguo
      '/usr/bin/ffmpeg',
    ];
  }
  return ['C:/ffmpeg/bin/ffmpeg.exe', 'C:/Program Files/ffmpeg/bin/ffmpeg.exe'];
}

/**
 * Nunca devuelve null: si no encuentra una ruta conocida cae a `ffmpeg` y deja
 * que lo resuelva el PATH. Si tampoco esta ahi, el fallo aparece al arrancar el
 * proceso, con un mensaje que dice como instalarlo.
 */
export function findFfmpeg(plataforma: NodeJS.Platform = process.platform): string {
  const candidates = [
    process.env['FFMPEG_PATH'],
    ...rutasFfmpeg(plataforma),
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Ultimo recurso: que lo resuelva el PATH.
  return 'ffmpeg';
}

/** Como instalarlo, dicho en concreto para el sistema que corresponde. */
export function comoInstalarFfmpeg(plataforma: NodeJS.Platform = process.platform): string {
  return plataforma === 'darwin'
    ? 'Instala ffmpeg con `brew install ffmpeg`.'
    : 'Descarga ffmpeg de ffmpeg.org y deja el ejecutable en C:/ffmpeg/bin, '
      + 'o apunta FFMPEG_PATH a el.';
}

/** Pista de audio ya alineada, lista para pasar a ffmpeg. */
export interface AudioInput {
  file: string;
  /**
   * Tramos del fichero que se conservan, en segundos y en orden.
   *
   * Es una lista y no un unico salto porque cortar silencios quita trozos del
   * interior. Sin cortes queda un solo tramo, que es el caso normal.
   */
  keeps: { start: number; end: number; rate?: number }[];
  /** Segundos de silencio a anteponer, si el audio empezo tarde. */
  delaySec: number;
}

/**
 * Argumentos de entrada. `-framerate` va SIEMPRE antes de `-i`: puesto despues
 * se ignora en silencio y el demuxer cae a 25 fps, con lo que el video sale
 * acelerado o ralentizado sin ningun mensaje de error.
 */
function inputArgs(settings: ExportSettings, audio?: AudioInput): string[] {
  const args = [
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${settings.width}x${settings.height}`,
    '-framerate', String(settings.fps),
    '-i', 'pipe:0',
  ];
  if (!audio) return args;
  args.push('-i', audio.file);
  return args;
}

/**
 * Filtro que recorta y vuelve a pegar los tramos conservados del audio.
 *
 * Se hace con `atrim` + `concat` y no con `-ss`, que solo sabe saltar al
 * principio. Cada tramo se reinicia con `asetpts` porque `concat` encadena por
 * marcas de tiempo: sin reiniciarlas, el segundo trozo conservaria las suyas
 * originales y ffmpeg dejaria el hueco del silencio que se pretendia quitar.
 */
/**
 * Cadena de `atempo` para una velocidad cualquiera.
 *
 * `atempo` solo acepta factores entre 0.5 y 2, asi que 4x son dos filtros
 * encadenados y 0.25x otros dos. Se descompone en factores iguales y no en
 * "2 y lo que sobre" porque cada pasada del filtro deja su huella en el timbre,
 * y repartir el trabajo suena mejor que forzar uno al maximo.
 *
 * Devuelve cadena vacia a velocidad 1: encadenar un `atempo=1` es procesar el
 * audio para nada.
 */
export function cadenaAtempo(rate: number): string {
  if (!(rate > 0) || Math.abs(rate - 1) < 1e-6) return '';
  const pasos = Math.max(1, Math.ceil(Math.abs(Math.log2(rate))));
  const factor = Math.pow(rate, 1 / pasos);
  return Array.from({ length: pasos }, () => `atempo=${factor.toFixed(6)}`).join(',');
}

function audioFilter(audio: AudioInput): string {
  const tramos = audio.keeps.length > 0 ? audio.keeps : [{ start: 0, end: 0, rate: 1 }];
  const partes = tramos.map((k, i) => {
    const tempo = cadenaAtempo(k.rate ?? 1);
    return `[1:a]atrim=start=${k.start.toFixed(3)}:end=${k.end.toFixed(3)}`
      + `,asetpts=PTS-STARTPTS${tempo ? ',' + tempo : ''}[k${i}]`;
  });

  const etiquetas = tramos.map((_, i) => `[k${i}]`).join('');
  const unido = tramos.length > 1
    ? `${etiquetas}concat=n=${tramos.length}:v=0:a=1[c]`
    : `[k0]anull[c]`;

  // El retardo va al final: anteponer silencio antes de recortar desplazaria
  // los tiempos de los propios recortes.
  const final = audio.delaySec > 0
    ? `[c]adelay=${Math.round(audio.delaySec * 1000)}:all=1[aout]`
    : `[c]anull[aout]`;

  return [...partes, unido, final].join(';');
}

/**
 * Codec de audio por contenedor. Poner aac en un WebM produce un fichero que
 * ffmpeg rechaza, y en un ProRes destinado a montaje interesa PCM sin perdida.
 */
function audioCodecArgs(format: ExportSettings['format']): string[] {
  switch (format) {
    case 'webm': return ['-c:a', 'libopus', '-b:a', '128k'];
    case 'mov': return ['-c:a', 'pcm_s16le'];
    default: return ['-c:a', 'aac', '-b:a', '160k'];
  }
}

function outputArgs(settings: ExportSettings, file: string, audio?: AudioInput): string[] {
  const conAudio = audio && supportsAudio(settings.format);
  // Sin mapeo explicito, ffmpeg elige por su cuenta y con dos entradas puede
  // no coger la que toca. `-t` acota la salida a la duracion del video: con
  // `-shortest`, un audio mas corto recortaria la imagen.
  const mux = conAudio
    ? [
        '-filter_complex', audioFilter(audio),
        '-map', '0:v:0', '-map', '[aout]',
        ...audioCodecArgs(settings.format),
      ]
    : [];

  switch (settings.format) {
    case 'mp4':
      return [
        ...mux,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        // yuv420p es lo unico que reproducen todos los navegadores y redes.
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        file,
      ];

    case 'webm':
      // VP9 opaco. NO se pide yuva420p aqui: se comprobo que este ffmpeg lo
      // acepta sin protestar y devuelve yuv420p, perdiendo el alfa en silencio.
      // Para transparencia esta el formato 'mov'.
      return [
        ...mux,
        '-c:v', 'libvpx-vp9',
        '-pix_fmt', 'yuv420p',
        '-b:v', '0', '-crf', '30',
        '-row-mt', '1',
        file,
      ];

    case 'mov':
      // ProRes 4444 es el formato de intercambio con alfa que entienden los
      // editores de video. Pesa mucho, y esa es la contrapartida asumida:
      // los formatos de alfa que comprimen bien (VP8/VP9) no funcionan en este
      // build, y uno que dice tener alfa sin tenerla es peor que uno pesado.
      return [
        ...mux,
        '-c:v', 'prores_ks',
        '-profile:v', '4444',
        '-pix_fmt', 'yuva444p10le',
        '-vendor', 'apl0',
        file,
      ];

    case 'gif':
      // Una sola pasada: se parte el flujo, se calcula la paleta sobre el
      // material completo y se aplica. Sin paleta propia, un GIF de una app
      // con degradados se llena de bandas.
      return [
        '-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
        '-loop', '0',
        file,
      ];
  }
}

export interface Encoder {
  /** Escribe un frame en crudo. Resuelve cuando la tuberia acepta mas. */
  write(frame: Uint8Array): Promise<void>;
  /** Cierra la entrada y espera a que ffmpeg termine. */
  finish(): Promise<void>;
  /** Mata el proceso sin esperar. Para cancelaciones. */
  abort(): void;
}

/**
 * Extrae un video a JPEG numerados.
 *
 * Hace falta para la camara web: el compositor dibuja la burbuja con Canvas 2D
 * —es el mismo que pinta el preview, y esa es la regla que no se rompe—, asi
 * que necesita imagenes decodificables, no un webm. Componer la burbuja con un
 * filtro `overlay` de ffmpeg seria una segunda implementacion y el preview
 * dejaria de decir la verdad sobre el video final.
 *
 * Se extrae ya escalado al tamano que va a ocupar la burbuja: decodificar
 * 640x480 para pintar 180 px es trabajo tirado, multiplicado por cada frame.
 */
export function extraerFrames(
  ffmpegPath: string,
  entrada: string,
  patronSalida: string,
  opts: { fps: number; alto: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y', '-loglevel', 'error',
      '-i', entrada,
      '-vf', `fps=${opts.fps},scale=-2:${Math.max(2, Math.round(opts.alto))}`,
      '-q:v', '4',
      patronSalida,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const err: string[] = [];
    proc.stderr?.on('data', (c: Buffer) => { err.push(c.toString()); });
    proc.on('error', (e) => reject(new Error(`No se pudo ejecutar ffmpeg: ${e.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg no pudo extraer la camara (codigo ${code}). ${err.join(' ').trim()}`));
    });
  });
}

export function startEncoder(
  ffmpegPath: string,
  settings: ExportSettings,
  file: string,
  audio?: AudioInput,
  durationSec?: number,
): Encoder {
  const args = [
    '-y', '-loglevel', 'error',
    ...inputArgs(settings, audio),
    ...(durationSec ? ['-t', durationSec.toFixed(3)] : []),
    ...outputArgs(settings, file, audio),
  ];
  const proc: ChildProcess = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });

  const errLines: string[] = [];
  proc.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (!line.trim()) continue;
      errLines.push(line.trim());
      if (errLines.length > STDERR_LINES) errLines.shift();
    }
  });

  let failure: Error | null = null;
  proc.on('error', (e) => {
    failure = new Error(
      `No se pudo ejecutar ffmpeg (${ffmpegPath}): ${e.message}. ${comoInstalarFfmpeg()}`,
    );
  });
  // Sin esto, un ffmpeg que muere a mitad convierte cada write en un EPIPE
  // sin capturar y tumba el proceso entero.
  proc.stdin?.on('error', () => {});

  let aborted = false;

  return {
    async write(frame: Uint8Array): Promise<void> {
      if (aborted || !proc.stdin || proc.stdin.destroyed) return;
      if (failure) throw failure;
      if (!proc.stdin.write(frame)) {
        await new Promise<void>((resolve) => proc.stdin!.once('drain', resolve));
      }
    },

    finish(): Promise<void> {
      return new Promise((resolve, reject) => {
        proc.on('close', (code) => {
          if (failure) return reject(failure);
          if (code === 0) return resolve();
          const detalle = errLines.length ? `\n  ${errLines.join('\n  ')}` : '';
          reject(new Error(`ffmpeg termino con codigo ${code}${detalle}`));
        });
        proc.stdin?.end();
      });
    },

    abort(): void {
      aborted = true;
      proc.stdin?.destroy();
      proc.kill('SIGKILL');
    },
  };
}
