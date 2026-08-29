/**
 * Modelo de datos de Vitrina.
 *
 * Una grabacion es una carpeta `<nombre>.vitrina` autocontenida:
 *
 *   frames/        000001.jpg ...
 *   manifest.json  Manifest  - que se capturo y cuando
 *   events.json    InputEvent[] - que hizo el usuario
 *   project.json   Project   - como se compone y exporta (lo escribe el editor)
 *
 * Separar manifest (inmutable, lo produce la captura) de project (mutable, lo
 * produce el editor) permite reeditar sin volver a grabar, y volver al material
 * original en cualquier momento.
 */

// Se reexporta para que quien importe `@vitrina/core/types` tenga el tipo
// completo del manifest sin tener que saber que el audio vive aparte.
export type { AudioTrack } from './audio.ts';
export type { Cut, Speed } from './timemap.ts';
import type { Cut, Speed } from './timemap.ts';
import type { AudioTrack } from './audio.ts';

/** Rectangulo en pixeles del viewport capturado. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * `mark` no viene de la pagina: lo pone quien graba con un atajo, para senalar
 * un momento que le importa. Va en el mismo log porque comparte reloj con todo
 * lo demas, que es lo que hace que la marca caiga en el frame exacto.
 */
export type InputEventType = 'move' | 'down' | 'up' | 'wheel' | 'key' | 'scroll' | 'mark';

/**
 * Un evento de entrada, capturado desde el DOM de la pagina grabada.
 *
 * Las coordenadas van en client space del viewport emulado, que mapea 1:1 con
 * el frame del screencast: no hace falta compensar scroll ni escala.
 *
 * `rect` es la ventaja diferencial sobre grabadores que solo ven pixeles: en un
 * click sabemos el rectangulo exacto del elemento pulsado, asi que la camara
 * puede encuadrar el boton o el formulario real en vez de un radio inventado.
 */
export interface InputEvent {
  /** Epoch en ms (`Date.now()`), mismo reloj que `Frame.t`. */
  t: number;
  type: InputEventType;
  x?: number;
  y?: number;
  /** Solo en down/up: caja del elemento bajo el puntero. */
  rect?: Rect | null;
  tag?: string | null;
  /** aria-label, placeholder o texto del elemento. Alimenta los subtitulos. */
  label?: string | null;
  /** Solo en wheel. */
  dy?: number;
  /** Solo en scroll. */
  sy?: number;
  /**
   * Solo en key. Nunca contiene el caracter tecleado: las teclas imprimibles se
   * registran como "char". Grabar pulsaciones reales convertiria cualquier demo
   * con un login en una fuga de credenciales.
   */
  key?: string;
}

export interface Frame {
  file: string;
  /** Epoch en segundos, tal cual lo entrega `metadata.timestamp` del screencast. */
  t: number;
  bytes: number;
}

export interface CaptureSize {
  w: number;
  h: number;
}

/**
 * Lo que se tapo al grabar.
 *
 * Va en el manifest y no en el proyecto porque no es una decision de montaje
 * que se pueda deshacer: describe lo que YA no esta en los frames. Ademas es lo
 * que permite que repetir la grabacion vuelva a tapar lo mismo.
 */
export interface Tapado {
  /** Selectores CSS de lo que no debia salir. */
  selectores: string[];
  /** Radio del desenfoque en px CSS que se aplico. */
  desenfoque?: number;
}

export interface Manifest {
  version: 1;
  /** Identificador del navegador usado, para diagnostico. */
  browser: string;
  url: string;
  /**
   * Viewport emulado en css px: lo que ve la pagina y lo que decide su
   * maquetacion. NO es el tamano de los frames cuando hay escala: grabando en
   * vista de movil son 430x932 mientras cada frame mide 1290x2796.
   */
  viewport: CaptureSize;
  /**
   * Tamano leido de la cabecera del primer JPEG: el de los frames de verdad.
   * Es el que tiene que usar todo lo de aguas abajo.
   */
  capture: CaptureSize | null;
  /** Escala de dispositivo con la que se grabo. 1 salvo en vista de movil. */
  deviceScaleFactor?: number;
  quality: number;
  /** Epoch en ms del arranque del screencast. */
  startedAt: number;
  durationMs: number;
  frames: Frame[];
  /**
   * Pista de microfono, si se grabo. Lleva su propio `startedAt` porque se
   * captura en otro proceso y arranca antes que el video; el desfase lo
   * resuelve `audioAlignment`.
   */
  audio?: AudioTrack | null;
  /**
   * Que se difumino al grabar, si se difumino algo.
   *
   * Es informativo para el editor y necesario para repetir: una repeticion que
   * no tapara lo mismo publicaria en la segunda toma lo que se tapo en la
   * primera.
   */
  tapado?: Tapado | null;
  /**
   * Camara web, si se grabo. Como la de audio, lleva su propio `startedAt`
   * porque la captura otro proceso y arranca antes que el video.
   */
  camara?: CamTrack | null;
}

/** Fondo sobre el que se compone la ventana grabada. */
export type Background =
  /** Sin fondo: deja el lienzo transparente, para exportar con alpha y
   *  superponer la demo sobre otro material. */
  | { kind: 'none' }
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; from: string; to: string; angle: number }
  | { kind: 'mesh'; colors: string[] }
  | { kind: 'image'; path: string; blur: number };

export interface FrameStyle {
  /** Fraccion del ancho de salida que ocupa la ventana. Gobierna el margen de zoom. */
  fill: number;
  radius: number;
  shadow: number;
  /**
   * Marco dibujado por el compositor, no capturado.
   *
   * `macos` y `windows` son barras de navegador y solo ocupan alto por arriba.
   * `phone` es un bisel que rodea el contenido por los cuatro lados, para
   * grabaciones verticales: una barra de escritorio sobre un encuadre 9:16
   * chirria.
   */
  chrome: 'none' | 'macos' | 'windows' | 'phone';
  /** Dominio mostrado en la barra sintetica. */
  chromeLabel?: string;
  /** Tema de la barra. Por defecto oscuro, que es lo que pega con apps oscuras. */
  chromeTheme?: 'light' | 'dark';
  /** Cursor sintetico redibujado desde el log. 'none' lo oculta. */
  cursor?: 'arrow' | 'none';
  /**
   * Rotula el elemento pulsado con su texto, sacado del DOM al grabar.
   * Ausente cuenta como falso: las grabaciones anteriores no cambian de aspecto.
   */
  labels?: boolean;
  /** Muestra las teclas pulsadas. Las imprimibles salen como un punto. */
  keys?: boolean;
}

/** Un tramo de zoom automatico, editable a mano en el timeline. */
export interface ZoomSegment {
  /** Offset en ms desde `Manifest.startedAt`. */
  startMs: number;
  endMs: number;
  /** Region de la fuente a encuadrar, en px del viewport. */
  target: Rect;
  scale: number;
  /** true si lo genero el motor; false si lo movio el usuario. */
  auto: boolean;
  /**
   * Texto del elemento que origino el tramo ("Cotizar", "Email"). Sale gratis
   * de la captura desde el DOM y sirve para nombrar el tramo en el timeline y
   * para generar subtitulos automaticos.
   */
  label?: string | null;
}

/**
 * Pista de camara web.
 *
 * Va en el MANIFEST y no en el proyecto, igual que la narracion: describe lo que
 * se grabo, no una decision de montaje. Y lleva su propio `startedAt` por el
 * mismo motivo que la de audio —se captura en el renderer de Electron, no en el
 * grabador, y arranca antes que el screencast—, asi que el desfase lo resuelve
 * `audioTimeFor`, que sirve para las dos pistas.
 */
export interface CamTrack {
  /** Nombre del fichero dentro de la carpeta `.vitrina`. */
  file: string;
  /** Epoch en ms del arranque real de la captura. */
  startedAt: number;
  mimeType: string;
  /** Tamano nativo de la captura. Hace falta para recortar sin deformar. */
  w: number;
  h: number;
}

/**
 * Aspecto de la burbuja de camara.
 *
 * Va en el PROYECTO porque es montaje: se cambia, se deshace y se guarda con la
 * edicion. La pista es del manifest; esto es como se ensena.
 */
export interface CamaraStyle {
  esquina: Esquina;
  /** Diametro de la burbuja como fraccion del ALTO del lienzo. */
  tamano: number;
  forma: 'circulo' | 'redondeada';
  /**
   * Quien se graba se ve en espejo y le resulta natural; quien mira el video
   * espera el texto de la camiseta al derecho. Por eso es una opcion y no una
   * constante, y por defecto va sin espejo.
   */
  espejo: boolean;
  /** Grosor del aro, en px de salida. 0 lo quita. */
  borde: number;
  /** Radio de la sombra. 0 la quita. */
  sombra: number;
}

/**
 * Voz grabada DESPUES, viendo el video ya montado.
 *
 * Narrar mientras operas es donde se estropea la mayoria de las demos: o la voz
 * va a trompicones, o el raton espera a la voz. Esta pista se graba contra el
 * tiempo de la SALIDA, no el del material, y por eso no hay que remapear nada:
 * es una capa sobre el video final.
 */
export interface Voz {
  /** Nombre del fichero dentro de la carpeta `.vitrina`. */
  file: string;
  /**
   * Instante de la SALIDA en el que empieza el fichero.
   *
   * Positivo: la voz entra mas tarde y hay que anteponer silencio. Negativo: se
   * empezo a grabar antes y hay que saltar dentro del fichero. Sale de medir el
   * arranque real de MediaRecorder contra el reloj del preview, que es el mismo
   * cuidado que ya tiene la narracion en vivo.
   */
  desfaseMs: number;
}

/** Esquina del lienzo. La comparten la marca de agua y la camara web. */
export type Esquina = 'ne' | 'no' | 'se' | 'so';

/**
 * Marca de agua: una imagen anclada al LIENZO.
 *
 * Anclada al lienzo y no al contenido a proposito. Una marca que se moviera con
 * el zoom seria un adorno dentro de la demo; quieta en una esquina es una firma.
 *
 * `path` es relativo a la carpeta de la grabacion, como el fondo de imagen: la
 * carpeta tiene que poder moverse de maquina y seguir exportando igual.
 */
export interface Watermark {
  path: string;
  esquina: Esquina;
  /** 0-1. */
  opacity: number;
  /** Fraccion del ancho del lienzo que ocupa la marca. */
  scale: number;
}

export interface Project {
  version: 1;
  background: Background;
  watermark?: Watermark | null;
  frame: FrameStyle;
  zooms: ZoomSegment[];
  /** Recorte del material: ms desde el inicio. */
  trimStartMs: number;
  trimEndMs: number | null;
  /**
   * Trozos que se quitan del interior, tipicamente silencios detectados en la
   * narracion. Se guardan como datos y no se aplican al material: quitar el
   * corte devuelve el trozo, y volver a detectar no degrada nada.
   */
  cuts?: Cut[];
  /**
   * Tramos que se reproducen a otra velocidad. Como los cortes, se guardan como
   * datos y no se aplican al material: quitar una aceleracion devuelve el tramo
   * a tiempo real sin haber degradado nada.
   */
  speeds?: Speed[];
  /**
   * Aspecto de la burbuja de camara. Ausente o nulo: no se dibuja, aunque la
   * grabacion traiga pista —quitar la burbuja del video no deberia obligar a
   * volver a grabar—.
   */
  camara?: CamaraStyle | null;
  /** Voz doblada despues, si se grabo. Ver `Voz`. */
  voz?: Voz | null;
  /**
   * Que se oye en el video.
   *
   * Ausente vale por "la voz doblada si la hay, y si no la narracion": es lo
   * que espera quien acaba de doblar, sin tener que ir a marcarlo.
   */
  pista?: 'micro' | 'voz' | 'ninguna';
  export: ExportSettings;
}

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  format: 'mp4' | 'webm' | 'gif' | 'mov';
}
