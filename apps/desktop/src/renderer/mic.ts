/**
 * Captura de microfono.
 *
 * El audio se graba en el renderer con MediaRecorder y los trozos se mandan al
 * proceso principal segun llegan, en vez de acumularlos y escribir un fichero
 * al final: una narracion de varios minutos son megas retenidos en memoria y un
 * pico al terminar, y si la app se cierra a mitad no queda nada.
 *
 * El instante de arranque se anota cuando MediaRecorder dice que empezo de
 * verdad, no cuando se le pide que empiece. Entre una cosa y otra hay decenas
 * de milisegundos, y ese es exactamente el error que luego se ve como labios
 * desincronizados.
 */

const MIME = 'audio/webm;codecs=opus';
/** Cada cuanto se vuelca un trozo al disco. */
const TROZO_MS = 1000;

export interface MicHandle {
  startedAt: number;
  /** Nivel de 0 a 1, para el medidor. */
  nivel(): number;
  detener(): Promise<void>;
}

export interface DispositivoAudio {
  deviceId: string;
  label: string;
}

export async function listarMicrofonos(): Promise<DispositivoAudio[]> {
  try {
    const todos = await navigator.mediaDevices.enumerateDevices();
    return todos
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microfono ${i + 1}` }));
  } catch {
    return [];
  }
}

/**
 * Pide el microfono con procesado y, si el dispositivo no lo admite, sin el.
 *
 * La demo se narra al lado del teclado, asi que la cancelacion de eco y la
 * supresion de ruido mejoran mucho el resultado. Pero son un extra: hay
 * dispositivos que rechazan esas restricciones con un `NotFoundError` seco, y
 * quedarse sin narracion por haber pedido una mejora es un mal negocio.
 */
async function pedirMicrofono(deviceId?: string): Promise<MediaStream> {
  const dispositivo = deviceId ? { deviceId: { exact: deviceId } } : {};
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        ...dispositivo,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({ audio: { ...dispositivo } });
  }
}

export async function grabarMicrofono(deviceId?: string): Promise<MicHandle> {
  const stream = await pedirMicrofono(deviceId);

  if (!MediaRecorder.isTypeSupported(MIME)) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(`Este Chromium no puede grabar ${MIME}`);
  }

  // Medidor de nivel: sirve para saber ANTES de grabar si el microfono esta
  // mudo, que es la forma mas cara de descubrir un problema.
  const ctx = new AudioContext();
  const analizador = ctx.createAnalyser();
  analizador.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analizador);
  const muestras = new Uint8Array(analizador.fftSize);

  const rec = new MediaRecorder(stream, { mimeType: MIME, audioBitsPerSecond: 128_000 });
  let startedAt = 0;
  const enVuelo: Promise<void>[] = [];

  rec.ondataavailable = (e: BlobEvent) => {
    if (e.data.size === 0) return;
    enVuelo.push(
      e.data.arrayBuffer().then((b) => window.vitrina.audioChunk(new Uint8Array(b))),
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
  await window.vitrina.audioStart(startedAt, MIME);

  return {
    startedAt,
    nivel(): number {
      analizador.getByteTimeDomainData(muestras);
      let suma = 0;
      for (const v of muestras) {
        const d = (v - 128) / 128;
        suma += d * d;
      }
      // RMS escalado: una voz normal ronda 0.05-0.2 en bruto, demasiado bajo
      // para verse en una barra. Se amplifica para que el medidor sea util.
      return Math.min(1, Math.sqrt(suma / muestras.length) * 4);
    },
    async detener(): Promise<void> {
      const parado = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
      rec.stop();
      await parado;
      // Los trozos llegan de forma asincrona: cerrar el fichero antes de que
      // se hayan enviado todos corta el final de la narracion.
      await Promise.all(enVuelo);
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close().catch(() => {});
      await window.vitrina.audioStop();
    },
  };
}
