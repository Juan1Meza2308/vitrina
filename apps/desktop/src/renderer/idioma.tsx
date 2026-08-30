import { createContext, useContext, useMemo } from 'react';
import { conIdioma, type Idioma, type T } from '@vitrina/core';

/**
 * El idioma de la interfaz.
 *
 * Va por contexto y no por una variable de módulo porque cambiar de idioma
 * tiene que repintar la interfaz entera, y eso React solo lo hace por estado.
 * Con una variable suelta habría que acordarse de forzar el repintado en cada
 * pantalla, y la que se olvidara se quedaría en el idioma anterior hasta que
 * algo más la tocara.
 *
 * El valor por defecto es español y no «lo que diga el sistema» a propósito:
 * este contexto no tiene que adivinar nada, lo recibe ya resuelto de los
 * ajustes. Si algún componente se renderizara fuera del proveedor —en un test,
 * por ejemplo— saldría en el idioma en el que está escrito el código, que es lo
 * menos sorprendente.
 */
const Contexto = createContext<T>(conIdioma('es'));

export function ProveedorIdioma(
  { idioma, children }: { idioma: Idioma; children: React.ReactNode },
) {
  // Memorizado por idioma: sin esto, cada render de App crearía una `t` nueva y
  // todo lo que dependa de ella se rehace aunque el idioma no haya cambiado.
  const t = useMemo(() => conIdioma(idioma), [idioma]);
  return <Contexto.Provider value={t}>{children}</Contexto.Provider>;
}

/** La función de traducción del idioma actual. */
export function useT(): T {
  return useContext(Contexto);
}
