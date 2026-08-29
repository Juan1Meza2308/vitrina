/**
 * El instante actual del editor, fuera del ciclo de render.
 *
 * La aguja se mueve sesenta veces por segundo. Si esa posicion viaja como una
 * prop, React rehace el arbol de la linea de tiempo sesenta veces por segundo
 * para mover una linea de dos pixeles: medido, arrastrar la aguja bajaba de 60
 * fps a 21 con casi 300 ms de tareas largas (M13).
 *
 * Aqui el instante viaja por un canal aparte: quien lo necesita se suscribe y
 * escribe directamente en el DOM —una variable CSS— sin pasar por el render.
 * Es lo que hacen los editores de video de verdad, y es lo que permite que el
 * resto de la interfaz se quede quieta mientras la aguja corre.
 *
 * El estado de React sigue existiendo para lo que SI necesita re-render (el
 * reloj en texto, si el instante cae dentro de un tramo); esto es un atajo para
 * lo que solo mueve pixeles, no un estado paralelo.
 */
export class Reloj {
  private ms = 0;
  private oyentes = new Set<(ms: number) => void>();

  get valor(): number {
    return this.ms;
  }

  set(ms: number): void {
    if (ms === this.ms) return;
    this.ms = ms;
    for (const f of this.oyentes) f(ms);
  }

  /**
   * Se avisa al suscribirse con el valor actual: quien se acaba de montar
   * necesita pintar la aguja donde esta, no esperar al siguiente cambio.
   * Devuelve la baja, para poder pasarla tal cual a `useEffect`.
   */
  sub(f: (ms: number) => void): () => void {
    this.oyentes.add(f);
    f(this.ms);
    return () => {
      this.oyentes.delete(f);
    };
  }
}
