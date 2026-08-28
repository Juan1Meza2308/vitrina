/**
 * Repite una grabacion: vuelve a ejecutar el log de entrada contra la pagina.
 *
 * Es lo que un grabador de pixeles no puede hacer. Los demas editores solo
 * saben QUE SE VIO; Vitrina sabe QUE PASO —cada movimiento, cada click con el
 * rectangulo del elemento— y eso permite volver a ejecutar la misma demo en un
 * navegador nuevo: para regrabarla a mas resolucion, despues de arreglar un
 * fallo que salia en el video, o con la app en otro idioma.
 *
 * El guion se calcula APARTE de ejecutarlo, en `guionDe`, y por eso se puede
 * probar sin navegador. Ejecutarlo es un bucle de esperas.
 */
import type { InputEvent } from '@vitrina/core/types';

/** Una accion a inyectar, ya en coordenadas CSS y con su instante. */
export type Accion =
  | { tMs: number; tipo: 'mover'; x: number; y: number }
  | { tMs: number; tipo: 'abajo'; x: number; y: number }
  | { tMs: number; tipo: 'arriba'; x: number; y: number }
  | { tMs: number; tipo: 'rueda'; x: number; y: number; dy: number }
  | { tMs: number; tipo: 'tecla'; key: string };

export interface GuionOptions {
  /** Escala con la que se grabo. El log va en px de FRAME; CDP quiere px CSS. */
  deviceScaleFactor?: number;
  /**
   * Que teclear donde el log dice "char".
   *
   * El log NUNCA guarda la tecla imprimible, a proposito, para que una demo con
   * un login no filtre credenciales. Al repetir no hay forma de saber que se
   * escribio, asi que se teclea esto. Vacio pulsa una tecla sin contenido.
   */
  relleno?: string;
}

/**
 * Convierte el log en un guion reproducible.
 *
 * Dos decisiones que no son evidentes:
 *
 *  - Solo se reproducen las ENTRADAS. El evento `scroll` es la consecuencia de
 *    un `wheel`, no una accion del usuario: reproducir los dos desplazaria la
 *    pagina el doble.
 *  - Las coordenadas se dividen por la escala. Desde que existe la vista de
 *    movil el log va en pixeles de frame (430 css x 3 = 1290), y
 *    `Input.dispatchMouseEvent` los espera en CSS.
 */
export function guionDe(
  events: InputEvent[],
  startedAt: number,
  opts: GuionOptions = {},
): Accion[] {
  const dsf = opts.deviceScaleFactor && opts.deviceScaleFactor > 0
    ? opts.deviceScaleFactor : 1;
  const css = (v: number) => Math.round(v / dsf);

  const out: Accion[] = [];
  for (const e of events) {
    const tMs = e.t - startedAt;
    if (tMs < 0) continue;

    if (e.type === 'move' && e.x !== undefined && e.y !== undefined) {
      out.push({ tMs, tipo: 'mover', x: css(e.x), y: css(e.y) });
    } else if (e.type === 'down' && e.x !== undefined && e.y !== undefined) {
      out.push({ tMs, tipo: 'abajo', x: css(e.x), y: css(e.y) });
    } else if (e.type === 'up' && e.x !== undefined && e.y !== undefined) {
      out.push({ tMs, tipo: 'arriba', x: css(e.x), y: css(e.y) });
    } else if (e.type === 'wheel' && e.x !== undefined && e.y !== undefined) {
      out.push({ tMs, tipo: 'rueda', x: css(e.x), y: css(e.y), dy: css(e.dy ?? 0) });
    } else if (e.type === 'key' && e.key) {
      out.push({ tMs, tipo: 'tecla', key: e.key });
    }
  }
  return out.sort((a, b) => a.tMs - b.tMs);
}

/** Duracion del guion, para saber cuanto durara la repeticion. */
export function duracionDeGuion(guion: Accion[]): number {
  return guion.length === 0 ? 0 : guion[guion.length - 1]!.tMs;
}

interface ClienteEntrada {
  Input: {
    dispatchMouseEvent(p: {
      type: string; x: number; y: number;
      button?: string; clickCount?: number; deltaX?: number; deltaY?: number;
    }): Promise<void>;
    dispatchKeyEvent(p: { type: string; text?: string; key?: string }): Promise<void>;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ejecuta el guion respetando sus tiempos.
 *
 * Los instantes se miden contra el arranque real y no acumulando esperas: cada
 * `dispatch` tarda unos milisegundos, y sumarlos desplazaria toda la segunda
 * mitad de la demo. Con un origen fijo, un retraso puntual no se arrastra.
 */
export async function reproducir(
  client: ClienteEntrada,
  guion: Accion[],
  opts: { relleno?: string; señal?: { abortado: boolean } } = {},
): Promise<void> {
  const t0 = Date.now();
  const relleno = opts.relleno ?? '';

  for (const a of guion) {
    if (opts.señal?.abortado) return;
    const espera = a.tMs - (Date.now() - t0);
    if (espera > 0) await sleep(espera);

    switch (a.tipo) {
      case 'mover':
        await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x: a.x, y: a.y });
        break;
      case 'abajo':
        await client.Input.dispatchMouseEvent({
          type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1,
        });
        break;
      case 'arriba':
        await client.Input.dispatchMouseEvent({
          type: 'mouseReleased', x: a.x, y: a.y, button: 'left', clickCount: 1,
        });
        break;
      case 'rueda':
        await client.Input.dispatchMouseEvent({
          type: 'mouseWheel', x: a.x, y: a.y, deltaX: 0, deltaY: a.dy,
        });
        break;
      case 'tecla': {
        // "char" es cualquier tecla imprimible, sin decir cual. Se teclea el
        // relleno que se haya pedido; sin el, una pulsacion sin contenido.
        const texto = a.key === 'char' ? relleno.slice(0, 1) : undefined;
        await client.Input.dispatchKeyEvent(
          texto ? { type: 'char', text: texto } : { type: 'keyDown', key: a.key });
        if (!texto) await client.Input.dispatchKeyEvent({ type: 'keyUp', key: a.key });
        break;
      }
    }
  }
}
