import { defineConfig } from 'vitest/config';

/**
 * Los ficheros de test se ejecutan de UNO EN UNO, no en paralelo.
 *
 * No es una preferencia estetica. Dos de ellos no son unitarios: uno lanza un
 * navegador de verdad y graba una pagina, y otro lanza ffmpeg y codifica varios
 * videos. En paralelo se pisan —CPU, disco y puertos— y fallan por contencion:
 * "socket hang up", el navegador tardando mas de un minuto en arrancar, o el
 * borrado de cientos de JPEG pasandose del limite del hook.
 *
 * Paso tres veces en una sola sesion, con resultados distintos cada vez y sin
 * que el codigo cambiara. Un test que falla y pasa segun lo ocupada que este la
 * maquina no informa de nada, y ademas ensena a ignorar los fallos.
 *
 * El precio es que la suite tarda mas. Merece la pena: los unitarios siguen
 * siendo instantaneos y los lentos ya lo eran.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    // Limpiar una grabacion son cientos de ficheros; con el disco ocupado, diez
    // segundos se quedan cortos.
    hookTimeout: 30_000,
  },
});
