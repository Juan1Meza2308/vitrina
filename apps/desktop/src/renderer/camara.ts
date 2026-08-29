/**
 * Captura de camara web.
 *
 * Calcado en forma a `mic.ts`, y por las mismas razones, que aqui pesan mas
 * todavia porque un video ocupa mucho mas que una voz:
 *
 *  - Los trozos se mandan al proceso principal SEGUN LLEGAN. Acumularlos seria
 *    retener decenas de megas en memoria y perderlo todo si la app se cierra a
 *    mitad.
 *  - El instante de arranque se anota cuando MediaRecorder dice que empezo de
 *    verdad, no cuando se le pide. Entre una cosa y otra hay decenas de
 *    milisegundos, y ese desfase es exactamente lo que despues se ve como
 *    labios que no cuadran con la voz.
 *
 * Lo que no se copia del microfono es el medidor de nivel: la camara se
 * comprueba mirandola, y para eso el handle expone el propio `MediaStream`.
 */

/** VP8 y no VP9: codifica bastante mas barato, y aqui se compite por CPU con
 *  el screencast del navegador, que es lo que no puede perder frames. */
const MIME = 'video/webm;codecs=vp8';
/** Cada cuanto se vuelca un trozo al disco. */
const TROZO_MS = 1000;

/** Suficiente para una burbuja, y sin pelearse con el screencast por la CPU. */
export const TAMANO_CAMARA = { width: 640, height: 480, frameRate: 30 };

export interface CamHandle {
  startedAt: number;
  /** El stream vivo, para poder ensenarlo mientras se graba. */
  stream: MediaStream;
  detener(): Promise<void>;
}

export interface DispositivoVideo {
  deviceId: string;
  label: string;
}

export async function listarCamaras(): Promise<DispositivoVideo[]> {
  try {
    const todos = await navigator.mediaDevices.enumerateDevices();
    return todos
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camara ${i + 1}` }));
  } catch {
    return [];
  }
}

/**
 * Abre la camara sin grabar, para la previsualizacion de la pantalla de inicio.
 *
 * Verse antes de grabar no es un adorno: encuadrarse mal o descubrir que la
 * tapa esta puesta al terminar la demo es la forma cara de enterarse.
 */
export async function abrirCamara(deviceId?: string): Promise<MediaStream> {
  const dispositivo = deviceId ? { deviceId: { exact: deviceId } } : {};
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { ...dispositivo, ...TAMANO_CAMARA },
    });
  } catch {
    // Una camara que no admite ese tamano exacto no es motivo para quedarse sin
    // camara: se acepta lo que de. Misma decision que con el microfono.
    return navigator.mediaDevices.getUserMedia({ video: { ...dispositivo } });
  }
}

export async function grabarCamara(deviceId?: string): Promise<CamHandle> {
  const stream = await abrirCamara(deviceId);

  if (!MediaRecorder.isTypeSupported(MIME)) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(`Este Chromium no puede grabar ${MIME}`);
  }

  // El tamano REAL, no el pedido: la camara puede haber dado otro, y el
  // compositor recorta con estas medidas. Con las equivocadas la cara saldria
  // descentrada dentro de la burbuja.
  const ajustes = stream.getVideoTracks()[0]?.getSettings() ?? {};
  const w = ajustes.width ?? TAMANO_CAMARA.width;
  const h = ajustes.height ?? TAMANO_CAMARA.height;

  const rec = new MediaRecorder(stream, { mimeType: MIME, videoBitsPerSecond: 1_500_000 });
  let startedAt = 0;
  const enVuelo: Promise<void>[] = [];

  rec.ondataavailable = (e: BlobEvent) => {
    if (e.data.size === 0) return;
    enVuelo.push(
      e.data.arrayBuffer().then((b) => window.vitrina.camChunk(new Uint8Array(b))),
    );
  };

  const arrancado = new Promise<void>((resolve) => {
    rec.onstart = () => {
      startedAt = Date.now();
      resolve();
    };
  });

  rec.start(TROZO_MS);
  await arrancado;
  await window.vitrina.camStart(startedAt, MIME, w, h);

  return {
    startedAt,
    stream,
    async detener(): Promise<void> {
      const parado = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
      rec.stop();
      await parado;
      // Los trozos llegan de forma asincrona: cerrar el fichero antes de que
      // hayan salido todos corta el final del video.
      await Promise.all(enVuelo);
      stream.getTracks().forEach((t) => t.stop());
      await window.vitrina.camStop();
    },
  };
}
