/**
 * Lectura validada de los JSON de una grabacion.
 *
 * Los ficheros de una carpeta `.vitrina` viajan entre maquinas, se editan a
 * mano y pueden estar a medias si una grabacion se interrumpio. Leerlos con
 * un `JSON.parse(...) as T` ciego dejaba que un fichero corrupto se viera
 * como datos validos y el error apareciera mas tarde, sin rastro de donde
 * vino. Aqui el parseo y la validacion ocurren en el mismo sitio: quien lee
 * no puede olvidar validar.
 *
 * Este modulo importa `node:fs` a proposito, asi que NO debe reexportarse
 * desde `index.ts` —el renderer lo importaria y el bundle del navegador se
 * traeria fs—. Vive bajo su propia ruta de exportacion, para quien corre en
 * Node.
 */
import { z } from 'zod';
import fsp from 'node:fs/promises';

/** Rectangulo en pixeles del viewport capturado. */
const sRect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

/** Un frame: JPEG en `frames/` (viejo) o segmento de `frames.bin` (nuevo). */
const sFrame = z.object({
  file: z.string().optional(),
  offset: z.number().optional(),
  t: z.number(),
  bytes: z.number(),
});

const sTamano = z.object({ w: z.number(), h: z.number() });

const sAudio = z.object({
  file: z.string(),
  startedAt: z.number(),
  mimeType: z.string(),
});

const sCamara = z.object({
  file: z.string(),
  startedAt: z.number(),
  mimeType: z.string(),
  w: z.number(),
  h: z.number(),
});

const sTapado = z.object({
  selectores: z.array(z.string()),
  desenfoque: z.number().optional(),
});

export const schemaManifest = z.object({
  version: z.literal(1),
  browser: z.string(),
  url: z.string(),
  viewport: sTamano,
  capture: sTamano.nullable(),
  deviceScaleFactor: z.number().optional(),
  quality: z.number(),
  startedAt: z.number(),
  durationMs: z.number(),
  frames: z.array(sFrame),
  audio: sAudio.nullable().optional(),
  tapado: sTapado.nullable().optional(),
  camara: sCamara.nullable().optional(),
});
export type ManifestValidado = z.infer<typeof schemaManifest>;

/** Un evento de entrada del log. Los campos raros son opcionales en el fichero. */
const sEvento = z.object({
  t: z.number(),
  type: z.enum(['move', 'down', 'up', 'wheel', 'key', 'scroll', 'mark']),
  x: z.number().optional(),
  y: z.number().optional(),
  rect: sRect.nullable().optional(),
  tag: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  dy: z.number().optional(),
  sy: z.number().optional(),
  key: z.string().optional(),
});
export const schemaEventos = z.array(sEvento);

const sCorte = z.object({ startMs: z.number(), endMs: z.number() });
const sVelocidad = z.object({ startMs: z.number(), endMs: z.number(), rate: z.number() });

export const schemaBackground = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('solid'), color: z.string() }),
  z.object({ kind: z.literal('linear'), from: z.string(), to: z.string(), angle: z.number() }),
  z.object({ kind: z.literal('mesh'), colors: z.array(z.string()) }),
  z.object({ kind: z.literal('image'), path: z.string(), blur: z.number() }),
]);

const sMarco = z.object({
  fill: z.number(),
  radius: z.number(),
  shadow: z.number(),
  chrome: z.enum(['none', 'macos', 'windows', 'phone']),
  chromeLabel: z.string().optional(),
  chromeTheme: z.enum(['light', 'dark']).optional(),
  cursor: z.enum(['arrow', 'none']).optional(),
  labels: z.boolean().optional(),
  keys: z.boolean().optional(),
});

const sTramoZoom = z.object({
  startMs: z.number(),
  endMs: z.number(),
  target: sRect,
  scale: z.number(),
  auto: z.boolean(),
  label: z.string().nullable().optional(),
});

const sMarca = z.object({
  path: z.string(),
  esquina: z.enum(['ne', 'no', 'se', 'so']),
  opacity: z.number(),
  scale: z.number(),
});

const sEstiloCamara = z.object({
  esquina: z.enum(['ne', 'no', 'se', 'so']),
  tamano: z.number(),
  forma: z.enum(['circulo', 'redondeada']),
  espejo: z.boolean(),
  borde: z.number(),
  sombra: z.number(),
});

const sVoz = z.object({
  file: z.string(),
  desfaseMs: z.number(),
});

const sExport = z.object({
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  format: z.enum(['mp4', 'webm', 'gif', 'mov']),
});

export const schemaProject = z.object({
  version: z.literal(1),
  background: schemaBackground,
  watermark: sMarca.nullable().optional(),
  frame: sMarco,
  zooms: z.array(sTramoZoom),
  trimStartMs: z.number(),
  trimEndMs: z.number().nullable(),
  cuts: z.array(sCorte).optional(),
  speeds: z.array(sVelocidad).optional(),
  camara: sEstiloCamara.nullable().optional(),
  voz: sVoz.nullable().optional(),
  pista: z.enum(['micro', 'voz', 'ninguna']).optional(),
  export: sExport,
});
export type ProjectValidado = z.infer<typeof schemaProject>;

/** Lee y valida un JSON; la excepcion dice cual era el fichero y que esperaba. */
export async function leerValidado<T>(ruta: string, schema: z.ZodType<T>): Promise<T> {
  let crudo: unknown;
  try {
    crudo = JSON.parse(await fsp.readFile(ruta, 'utf8'));
  } catch (e) {
    const base = e instanceof SyntaxError ? 'no es JSON valido' : 'no se pudo leer';
    throw new Error(`${ruta}: ${base}`);
  }
  const r = schema.safeParse(crudo);
  if (!r.success) {
    const detalles = r.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || 'raiz'}: ${i.message}`);
    throw new Error(`${ruta}: formato inesperado: ${detalles.join('; ')}`);
  }
  return r.data;
}

export const leerManifest = (ruta: string): Promise<ManifestValidado> =>
  leerValidado(ruta, schemaManifest);
export const leerProyecto = (ruta: string): Promise<ProjectValidado> =>
  leerValidado(ruta, schemaProject);
export const leerEventos = (ruta: string): Promise<z.infer<typeof schemaEventos>> =>
  leerValidado(ruta, schemaEventos);