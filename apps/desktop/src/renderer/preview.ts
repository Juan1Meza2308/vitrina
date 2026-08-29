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
const CACHE_MAX = 48;

/**
 * Cuanto se adelanta la carga, en ms de material.
 *
 * Reproduciendo, el fotograma siguiente se sabe de antemano; pedirlo cuando ya
 * hace falta pone la decodificacion en el camino critico de cada repintado.
 * Con 400 ms de adelanto llega decodificado antes de que le toque.
 */
const ADELANTO_MS = 400;

/**
 * Cargas simultaneas.
 *
 * Existe por la lectura anticipada: sin limite, arrastrar la aguja lanzaria una
 * decodificacion por movimiento MAS las adelantadas de cada uno, y todas a la
 * vez —medido en su dia: 7,4 s de trabajo acumulado en un arrastre de un
 * segundo, para ensenar imagenes que al llegar ya no tocaban—. Con el limite se
 * decodifica lo ultimo que se pidio y lo demas se tira, que es exactamente lo
 * que el ojo espera al arrastrar.
 */
const CARGAS_A_LA_VEZ = 3;

/**
 * Cuentas de un repintado, para poder decir DONDE se va el tiempo.
 *
 * Existe porque medir fps desde fuera no basta: el banco inyecta los eventos de
 * raton por CDP, y eso solo ya baja los fotogramas casi a la mitad —moviendo el
 * raton sin arrastrar, sin que la app haga nada, se miden 35-49 fps en vez de
 * 60—. Con esa cifra no se puede saber que parte del coste es de la aplicacion.
 * Estas cuentas si son suyas.
 *
 * Apagado salvo que se pida con `data-medir` en la raiz, como `data-cristal`.
 */
export interface Medida {
  /** Repintados completos. */
  repintados: number;
  /** Tiempo total dentro de `draw`, en ms. */
  msTotal: number;
  /** Repintados que no encontraron su fotograma en la cache. */
  fallos: number;
  /** Tiempo total decodificando, en ms. Puede solaparse con `msTotal`. */
  msDecode: number;
  /**
   * Cargas simultaneas maximas.
   *
   * Es LA cifra de la cola, y la unica que no depende de lo caliente que este
   * la cache: el tiempo de decodificacion de un arrastre cambia segun lo que ya
   * hubiera cargado antes, pero cuantas decodificaciones llegan a solaparse
   * depende solo del limite.
   */
  enVuelo: number;
}

declare global {
  interface Window { __vitrinaMedida?: Medida }
}

const midiendo = (): boolean => document.documentElement.dataset['medir'] !== undefined;

const cuentas = (): Medida =>
  (window.__vitrinaMedida ??= { repintados: 0, msTotal: 0, fallos: 0, msDecode: 0, enVuelo: 0 });

const apuntar = (campo: keyof Medida, valor: number): void => {
  cuentas()[campo] += valor;
};

const marcaMaxima = (valor: number): void => {
  const m = cuentas();
  if (valor > m.enVuelo) m.enVuelo = valor;
};

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
  /**
   * Elemento de video de la camara web.
   *
   * No se cachea ningun frame: el elemento YA es una fuente valida para
   * `drawImage`, y pedirle una copia por cada repintado seria trabajo tirado.
   * Quien lo coloca en el tiempo es el editor, igual que hace con el audio.
   */
  private cam: HTMLVideoElement | null = null;
  /** El fotograma que hace falta AHORA, para no repintar por uno que ya paso. */
  private pedido: string | null = null;
  /** A quien avisar cuando llega un fotograma que se estaba esperando. */
  private aviso: (() => void) | null = null;
  /** Cargas en vuelo ahora mismo. */
  private enCurso = 0;
  /** El pedido que no cupo. Solo uno: el ultimo, los intermedios sobran. */
  private cola: string | null = null;
  /** Ultimo instante dibujado, para saber hacia donde se va. */
  private anterior = 0;

  constructor(
    private manifest: Manifest,
    events: InputEvent[],
    private track: CameraTrack,
  ) {
    this.index = new FrameIndex(manifest);
    this.cursor = new CursorSource(events, manifest.startedAt);
    this.overlay = new OverlaySource(events, manifest.startedAt);
  }

  /**
   * A quien avisar cuando termina de decodificarse el fotograma que toca.
   *
   * `draw` ya no espera al decode, asi que sin este aviso el ultimo movimiento
   * de un arrastre se quedaria pintado con el fotograma anterior para siempre.
   */
  onFrame(f: (() => void) | null): void {
    this.aviso = f;
  }

  /** Se reconstruye al cambiar el zoom o el marco; los frames siguen valiendo. */
  setTrack(track: CameraTrack): void {
    this.track = track;
  }

  setCam(el: HTMLVideoElement | null): void {
    this.cam = el;
  }

  /**
   * El frame de camara de ahora mismo, si hay uno decodificado.
   *
   * `readyState < 2` significa que el elemento todavia no tiene imagen; pasarlo
   * igualmente pintaria un rectangulo vacio en la esquina, que se lee como un
   * fallo del compositor y no como un video que aun no ha cargado.
   */
  private camFrame(): { img: ImageLike; w: number; h: number } | null {
    const el = this.cam;
    if (!el || el.readyState < 2 || !el.videoWidth || !el.videoHeight) return null;
    return { img: el as unknown as ImageLike, w: el.videoWidth, h: el.videoHeight };
  }

  get durationMs(): number {
    return this.manifest.durationMs;
  }

  /**
   * Dibuja el instante pedido.
   *
   * Aqui se probo lo contrario de lo que quedo, y conviene dejarlo escrito: se
   * intento NO esperar al decode —componer ya con el fotograma anterior y
   * repintar al llegar el bueno—. Medido, salio peor (35,8 fps frente a 39,2
   * arrastrando): con la aguja ya fuera del ciclo de React, esperar no retrasa
   * la respuesta, y no esperar obliga a componer dos veces por movimiento.
   *
   * Lo que si cambia las cosas es `pedir`: un limite de cargas simultaneas que
   * tira los fotogramas intermedios de un arrastre en vez de decodificarlos
   * todos (M13).
   */
  async draw(canvas: HTMLCanvasElement, tMs: number, project: Project): Promise<void> {
    const file = this.index.at(tMs);
    if (!file) return;
    this.pedido = file;

    const medir = midiendo();
    const t0 = medir ? performance.now() : 0;

    let img = this.cache.get(file) ?? null;
    if (medir && !img) apuntar('fallos', 1);
    // Acertar en la cache reinserta: el orden del Map pasa a ser el de uso, que
    // es lo que `limpiar` necesita para tirar lo que menos falta hace.
    if (img) { this.cache.delete(file); this.cache.set(file, img); }
    // Si el pedido no cabe ahora, `pedir` resuelve a null y se compone con el
    // anterior: al arrastrar, ir un fotograma por detras es mejor que parpadear.
    if (!img) img = (await this.pedir(file)) ?? this.ultimo;

    this.adelantar(tMs);
    this.anterior = tMs;
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
      cam: this.camFrame(),
    });

    if (medir) {
      apuntar('repintados', 1);
      apuntar('msTotal', performance.now() - t0);
    }
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

  /**
   * Pide por adelantado lo que viene, si se va hacia delante.
   *
   * Solo hacia delante y solo si el salto es pequeno: reproduciendo o
   * avanzando poco a poco, lo siguiente es predecible y merece la pena; al
   * saltar la aguja de un sitio a otro no hay nada que predecir y adelantar
   * seria quitarle sitio en la cola a lo que si se va a ver.
   */
  private adelantar(tMs: number): void {
    if (document.documentElement.dataset['preview'] === 'basico') return;
    const avance = tMs - this.anterior;
    if (avance <= 0 || avance > ADELANTO_MS) return;
    for (let d = avance; d <= ADELANTO_MS; d += Math.max(20, avance)) {
      const f = this.index.at(tMs + d);
      if (f && !this.cache.has(f) && !this.pendientes.has(f)) void this.pedir(f);
    }
  }

  /**
   * Pide un fotograma respetando el limite de cargas simultaneas.
   *
   * Si no hay hueco, se apunta como "el siguiente" —pisando al anterior que
   * esperaba— y se resuelve con lo que haya. Quien llama no se queda colgado:
   * `draw` compone con el fotograma anterior y repinta cuando llegue el bueno.
   */
  private pedir(file: string): Promise<ImageBitmap | null> {
    const yaVa = this.pendientes.get(file);
    if (yaVa) return yaVa;
    if (this.enCurso >= CARGAS_A_LA_VEZ) {
      this.cola = file;
      return Promise.resolve(null);
    }
    return this.load(file);
  }

  private load(file: string): Promise<ImageBitmap | null> {
    const enCurso = this.pendientes.get(file);
    if (enCurso) return enCurso;
    this.enCurso++;
    if (midiendo()) marcaMaxima(this.enCurso);

    const promesa = (async () => {
      const t0 = midiendo() ? performance.now() : 0;
      try {
        const res = await fetch(`vitrina://frames/${file}`);
        const bitmap = await createImageBitmap(await res.blob());
        if (t0) apuntar('msDecode', performance.now() - t0);
        this.cache.set(file, bitmap);
        this.limpiar();
        // Solo se avisa si es el fotograma que hace falta ahora: al soltar un
        // arrastre pueden quedar varias cargas en vuelo, y repintar por cada
        // una seria trabajo para ensenar imagenes que ya pasaron.
        if (file === this.pedido) this.aviso?.();
        return bitmap;
      } catch {
        return null;
      } finally {
        this.pendientes.delete(file);
        this.enCurso--;
        // Al liberarse un hueco entra el ultimo pedido, y solo si sigue siendo
        // el que hace falta: durante un arrastre lo demas ya ha caducado.
        const siguiente = this.cola;
        this.cola = null;
        if (siguiente && siguiente === this.pedido && !this.cache.has(siguiente)) {
          void this.load(siguiente);
        }
      }
    })();

    this.pendientes.set(file, promesa);
    return promesa;
  }

  /**
   * Descarte por uso, no por orden de llegada.
   *
   * Con lectura anticipada, lo que lleva mas tiempo en la cache puede ser justo
   * lo siguiente que toca —se pidio antes de tiempo, a proposito—. Se tira lo
   * que hace mas que no se usa: `draw` reinserta lo que acierta, asi que el
   * primero del Map es siempre el menos util.
   */
  private limpiar(): void {
    while (this.cache.size > CACHE_MAX) {
      const viejo = this.cache.keys().next().value;
      if (viejo === undefined) return;
      this.cache.get(viejo)?.close();
      this.cache.delete(viejo);
    }
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
