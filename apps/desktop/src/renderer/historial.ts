/**
 * Historial de deshacer y rehacer.
 *
 * La logica esta aqui y no en el componente porque lo unico dificil de esto es
 * el AGRUPADO, y es puro. Arrastrar un tramo por la linea de tiempo dispara
 * decenas de cambios de estado, y un historial ingenuo haria que deshacer
 * retrocediera un pixel de movimiento: habria que pulsarlo cuarenta veces para
 * volver a donde estaba. Un deslizador de sombra, igual.
 *
 * La regla es temporal: dos cambios separados por menos de `FUSION_MS` son el
 * mismo gesto y ocupan una sola entrada. Es lo que distingue "estoy arrastrando"
 * de "he decidido otra cosa", y no necesita que cada control avise de cuando
 * empieza y termina —que es la otra forma de hacerlo, y se olvida en cuanto
 * alguien anade un control nuevo—.
 */

/** Por debajo de esto, dos cambios son el mismo gesto. */
export const FUSION_MS = 400;
/** Tope de entradas. Cada una es un proyecto entero. */
export const TOPE = 50;

export interface Historial<T> {
  pasado: T[];
  presente: T;
  futuro: T[];
  /** Cuando se registro el ultimo cambio, para decidir si se fusiona. */
  ultimoMs: number;
}

export function inicial<T>(presente: T): Historial<T> {
  return { pasado: [], presente, futuro: [], ultimoMs: -Infinity };
}

/**
 * Registra un estado nuevo.
 *
 * @param ahoraMs Reloj, inyectado para que los tests no dependan del tiempo real.
 */
export function empujar<T>(h: Historial<T>, siguiente: T, ahoraMs: number): Historial<T> {
  if (Object.is(siguiente, h.presente)) return h;

  // Dentro de la ventana de fusion se sustituye el presente sin apilar: el
  // gesto entero acaba siendo una sola entrada, la del estado con el que
  // empezo.
  if (ahoraMs - h.ultimoMs < FUSION_MS && h.pasado.length > 0) {
    return { ...h, presente: siguiente, futuro: [], ultimoMs: ahoraMs };
  }

  const pasado = [...h.pasado, h.presente];
  return {
    pasado: pasado.length > TOPE ? pasado.slice(pasado.length - TOPE) : pasado,
    presente: siguiente,
    // Cualquier cambio nuevo invalida lo rehacible: es la rama que se abandona.
    futuro: [],
    ultimoMs: ahoraMs,
  };
}

export function deshacer<T>(h: Historial<T>): Historial<T> {
  const anterior = h.pasado.at(-1);
  if (anterior === undefined) return h;
  return {
    pasado: h.pasado.slice(0, -1),
    presente: anterior,
    futuro: [h.presente, ...h.futuro],
    // Se rompe la ventana de fusion: el cambio que venga despues de deshacer es
    // una decision nueva, no la continuacion del gesto anterior.
    ultimoMs: -Infinity,
  };
}

export function rehacer<T>(h: Historial<T>): Historial<T> {
  const siguiente = h.futuro[0];
  if (siguiente === undefined) return h;
  return {
    pasado: [...h.pasado, h.presente],
    presente: siguiente,
    futuro: h.futuro.slice(1),
    ultimoMs: -Infinity,
  };
}

export const puedeDeshacer = <T>(h: Historial<T>): boolean => h.pasado.length > 0;
export const puedeRehacer = <T>(h: Historial<T>): boolean => h.futuro.length > 0;
