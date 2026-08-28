/**
 * `chrome-remote-interface` no publica tipos. Se declara lo minimo para poder
 * conectar; la superficie util esta tipada a mano en `cdp.ts`.
 */
declare module 'chrome-remote-interface' {
  interface Options {
    host?: string;
    port?: number;
    target?: string | ((targets: unknown[]) => unknown);
    /**
     * Usa el descriptor del protocolo que trae el paquete en vez de bajarselo
     * del navegador por HTTP. Importa mas de lo que parece: conectando mientras
     * un screencast esta en marcha, esa descarga compite con el chorro de
     * frames y tarda mas de quince segundos.
     */
    local?: boolean;
  }
  function CDP(options?: Options): Promise<unknown>;
  export default CDP;
}
