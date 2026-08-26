/**
 * `chrome-remote-interface` no publica tipos. Se declara lo minimo para poder
 * conectar; la superficie util esta tipada a mano en `cdp.ts`.
 */
declare module 'chrome-remote-interface' {
  interface Options {
    host?: string;
    port?: number;
    target?: string | ((targets: unknown[]) => unknown);
  }
  function CDP(options?: Options): Promise<unknown>;
  export default CDP;
}
