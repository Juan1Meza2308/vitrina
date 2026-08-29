/**
 * El script de captura viaja como TEXTO, asi que nada lo compila hasta que ya
 * esta dentro de la pagina grabada: un parentesis de menos no da error al
 * construirlo, da una grabacion sin un solo evento. Estas dos comprobaciones
 * valen mas de lo que parecen.
 */
import { describe, it, expect } from 'vitest';
import { INJECT_SOURCE } from './inject.ts';
import { GLOBAL_TAPADO } from './tapar.ts';

describe('INJECT_SOURCE', () => {
  it('es JavaScript valido', () => {
    expect(() => new Function(INJECT_SOURCE)).not.toThrow();
  });

  it('consulta el tapado antes de guardar la etiqueta de un elemento', () => {
    // Difuminar el pixel y escribir el texto en events.json seria tapar solo lo
    // que se ve. Los dos scripts se inyectan por separado y se encuentran en
    // esta global.
    expect(INJECT_SOURCE).toContain(`window.${GLOBAL_TAPADO}`);
    expect(INJECT_SOURCE).toContain('if (!el || tapado(el)) return null;');
  });
});
