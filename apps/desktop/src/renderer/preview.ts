/**
 * Preview: el compositor corriendo en el navegador.
 *
 * Este fichero es la prueba de la restriccion que gobierna todo el proyecto —
 * un solo compositor para preview y export. `composite()` es exactamente la
 * misma funcion que usa el exportador en Node; lo unico que cambia es de donde
 * sale el contexto de canvas y como se decodifican los frames.
 *
 * Los frames llegan por el protocolo `vitrina://` y se cachean ya decodificados
 * como ImageBitmap. Sin cache, arrastrar la aguja de la linea de tiempo
 * volveria a decodificar el mismo JPEG decenas de veces por segundo.
 */
import { buildCameraTrack, FrameIndex } from '@vitrina/core';
import type { CameraTrack, InputEvent, Manifest, Project } from '@vitrina/core';
import { composite, CursorSource, OverlaySource } from '@vitrina/renderer';
import type { Ctx, ImageLike } from '@vitrina/renderer';

/** Frames decodificados que se conservan. Suficiente para un scrub suave sin
 *  que la memoria crezca con la duracion de la grabacion. */
const CACHE_MAX = 24;

export class Preview {
  private index: FrameIndex;
  private cursor: CursorSource;
  private overlay: OverlaySource;
  private cache = new Map<string, ImageBitmap>();
  private pendientes = new Map<string, Promise<ImageBitmap | null>>();
  private ultimo: ImageBitmap | null = null;
  /** Fondo decodificado, cacheado por ruta: cambiar de imagen es raro, pero
   *  repintar es constante. */
  private fondo: { ruta: string; img: ImageBitmap } | null = null;
  private marca: { ruta: string; img: ImageBitmap } | null = null;

  constructor(
    private manifest: Manifest,
    events: InputEvent[],
    private track: CameraTrack,
  ) {
    this.index = new FrameIndex(manifest);
    this.cursor = new CursorSource(events, manifest.startedAt);
    this.overlay = new OverlaySource(events, manifest.startedAt);
  }

  /** Se reconstruye al cambiar el zoom o el marco; los frames siguen valiendo. */
  setTrack(track: CameraTrack): void {
    this.track = track;
  }

  get durationMs(): number {
    return this.manifest.durationMs;
  }

  /**
   * Dibuja el instante pedido. Si el frame todavia se esta decodificando,
   * repinta con el ultimo disponible en vez de dejar el lienzo en blanco: al
   * arrastrar la aguja, parpadear es peor que ir un frame por detras.
   */
  async draw(canvas: HTMLCanvasElement, tMs: number, project: Project): Promise<void> {
    const file = this.index.at(tMs);
    if (!file) return;

    const img = this.cache.get(file) ?? (await this.load(file)) ?? this.ultimo;
    if (!img) return;
    this.ultimo = img;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    composite({
      ctx: ctx as unknown as Ctx,
      source: img as unknown as ImageLike,
      sourceSize: this.manifest.capture ?? this.manifest.viewport,
      camera: this.track.sampleAt(tMs),
      project,
      cursor: this.cursor.sample(tMs),
      overlay: this.overlay.sample(tMs),
      backgroundImage: await this.fondoDe(project) as unknown as ImageLike | null,
      watermarkImage: await this.marcaDe(project) as unknown as ImageLike | null,
    });
  }

  /** Decodifica el fondo la primera vez y lo reutiliza mientras no cambie. */
  /** Misma idea que `fondoDe`, con su propia cache: son dos imagenes distintas. */
  private async marcaDe(project: Project): Promise<ImageBitmap | null> {
    const ruta = project.watermark?.path;
    if (!ruta) return null;
    if (this.marca?.ruta === ruta) return this.marca.img;
    try {
      const res = await fetch(`vitrina://${ruta}`);
      const img = await createImageBitmap(await res.blob());
      this.marca?.img.close();
      this.marca = { ruta, img };
      return img;
    } catch {
      return null;
    }
  }

  private async fondoDe(project: Project): Promise<ImageBitmap | null> {
    if (project.background.kind !== 'image') return null;
    const ruta = project.background.path;
    if (this.fondo?.ruta === ruta) return this.fondo.img;
    try {
      const res = await fetch(`vitrina://${ruta}`);
      const img = await createImageBitmap(await res.blob());
      this.fondo?.img.close();
      this.fondo = { ruta, img };
      return img;
    } catch {
      return null;
    }
  }

  private load(file: string): Promise<ImageBitmap | null> {
    const enCurso = this.pendientes.get(file);
    if (enCurso) return enCurso;

    const promesa = (async () => {
      try {
        const res = await fetch(`vitrina://frames/${file}`);
        const bitmap = await createImageBitmap(await res.blob());
        this.cache.set(file, bitmap);
        // Descarte por orden de insercion: al reproducir se avanza en linea,
        // asi que el mas viejo es tambien el menos probable.
        if (this.cache.size > CACHE_MAX) {
          const viejo = this.cache.keys().next().value;
          if (viejo !== undefined) {
            this.cache.get(viejo)?.close();
            this.cache.delete(viejo);
          }
        }
        return bitmap;
      } catch {
        return null;
      } finally {
        this.pendientes.delete(file);
      }
    })();

    this.pendientes.set(file, promesa);
    return promesa;
  }

  destroy(): void {
    for (const b of this.cache.values()) b.close();
    this.cache.clear();
    this.fondo?.img.close();
    this.fondo = null;
  }
}

export function makeTrack(
  manifest: Manifest,
  events: InputEvent[],
  project: Project,
  config: Parameters<typeof buildCameraTrack>[0]['config'],
): CameraTrack {
  return buildCameraTrack({
    events,
    segments: project.zooms,
    viewport: manifest.capture ?? manifest.viewport,
    startedAt: manifest.startedAt,
    durationMs: manifest.durationMs,
    config,
  });
}
