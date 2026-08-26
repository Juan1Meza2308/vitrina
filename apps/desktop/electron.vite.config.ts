import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * Los paquetes `@vitrina/*` NO se externalizan: son TypeScript sin compilar y
 * viajan dentro del bundle. Solo quedan fuera las dependencias que no se pueden
 * empaquetar: `@napi-rs/canvas` lleva un binario nativo y
 * `chrome-remote-interface` es CommonJS con resolucion dinamica interna.
 * (`electron` siempre es externo; lo gestiona electron-vite.)
 *
 * El renderer solo importa `core` y `renderer`. Si acabara importando `export`
 * o `capture-cdp` arrastraria estas dependencias de Node al navegador y el
 * build fallaria; ese fallo temprano es deseable, no lo "arregles" anadiendo
 * externals al renderer.
 */
const NATIVAS = { include: ['@napi-rs/canvas', 'chrome-remote-interface'] };

export default defineConfig({
  main: {
    build: { externalizeDeps: NATIVAS },
  },
  preload: {
    build: { externalizeDeps: NATIVAS },
  },
  renderer: {
    plugins: [react()],
  },
});
