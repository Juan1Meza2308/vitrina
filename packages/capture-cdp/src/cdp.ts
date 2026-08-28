/**
 * Fachada tipada del trozo de Chrome DevTools Protocol que usa Vitrina.
 *
 * `chrome-remote-interface` no trae tipos y expone los dominios como objetos
 * dinamicos. En vez de tirar de `any` por todo el grabador, se declara aqui
 * solo lo que se usa: asi el compilador avisa si se llama a algo que no existe
 * y el fichero sirve de indice de que superficie de CDP depende el proyecto.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScreencastFrameParams {
  data: string;
  sessionId: number;
  metadata: {
    /** Epoch en segundos. Mismo reloj que el `Date.now()` del script inyectado. */
    timestamp: number;
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
  };
}

export interface BindingCalledParams {
  name: string;
  payload: string;
  executionContextId: number;
}

export interface EvaluateResult {
  result: { value?: unknown; type: string };
}

export interface CdpClient {
  Page: {
    enable(): Promise<void>;
    navigate(p: { url: string }): Promise<unknown>;
    addScriptToEvaluateOnNewDocument(p: { source: string }): Promise<unknown>;
    startScreencast(p: {
      format: 'jpeg' | 'png';
      quality?: number;
      maxWidth?: number;
      maxHeight?: number;
      everyNthFrame?: number;
    }): Promise<void>;
    stopScreencast(): Promise<void>;
    screencastFrameAck(p: { sessionId: number }): Promise<void>;
    captureScreenshot(p: {
      format?: 'jpeg' | 'png';
      quality?: number;
      captureBeyondViewport?: boolean;
    }): Promise<{ data: string }>;
  };
  Runtime: {
    enable(): Promise<void>;
    addBinding(p: { name: string }): Promise<void>;
    evaluate(p: { expression: string; returnByValue?: boolean }): Promise<EvaluateResult>;
  };
  Emulation: {
    setDeviceMetricsOverride(p: {
      width: number;
      height: number;
      deviceScaleFactor: number;
      mobile: boolean;
    }): Promise<void>;
    clearDeviceMetricsOverride(): Promise<void>;
    /** Experimental: no esta en todos los navegadores. Llamar con catch. */
    setScrollbarsHidden(p: { hidden: boolean }): Promise<void>;
  };
  on(event: 'Page.screencastFrame', cb: (p: ScreencastFrameParams) => void): void;
  on(event: 'Runtime.bindingCalled', cb: (p: BindingCalledParams) => void): void;
  on(event: 'Page.loadEventFired', cb: () => void): void;
  on(event: 'Runtime.executionContextCreated', cb: () => void): void;
  close(): Promise<void>;
}
