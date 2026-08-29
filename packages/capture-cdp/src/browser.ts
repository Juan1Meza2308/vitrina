/**
 * Localiza un binario Chromium que realmente se pueda ejecutar.
 *
 * El orden de preferencia se invierte segun el sistema, y no es un capricho:
 *
 *  - En **Windows** Edge va primero porque viene preinstalado, asi que el
 *    usuario final no tiene que instalar nada.
 *  - En **macOS** no hay ningun Chromium preinstalado. Safari no sirve: no
 *    expone screencast por CDP. Asi que se prefiere Chrome, que es lo que la
 *    mayoria ya tiene, y si no hay ninguno el error tiene que decirlo claro.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

export interface BrowserInfo {
  path: string;
  /** Etiqueta legible para el manifest y para diagnostico. */
  label: string;
}

export type Plataforma = NodeJS.Platform;

/**
 * Rutas candidatas, en orden de preferencia.
 *
 * La plataforma es un parametro y no una lectura directa de `process.platform`
 * para poder comprobar desde una maquina la lista de la otra: el port a macOS
 * se escribio en Windows y sin esto no habria forma de testearlo.
 */
/**
 * Linux.
 *
 * Vitrina no publica instalador de Linux, pero el proyecto SE DESARROLLA en
 * Linux —y su integracion continua tambien—, asi que la lista tiene que existir:
 * sin ella, `findBrowser()` buscaba rutas de Windows en una maquina Linux y
 * respondia "no hay navegador" con uno instalado al lado. Los tests de
 * integracion, que graban de verdad, no podian correr en CI por eso.
 */
function candidatosLinux(): string[] {
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/brave-browser',
    // Instalado como snap, que es como llega Chromium en Ubuntu moderno.
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
  ];
}

export function candidates(
  plataforma: Plataforma = process.platform,
  home = os.homedir(),
  entorno: NodeJS.ProcessEnv = process.env,
): string[] {
  // Una eleccion explicita manda sobre todo lo demas, igual que `FFMPEG_PATH`
  // con el codificador: un navegador instalado en un sitio raro —o el que se
  // quiere usar de entre varios— no deberia obligar a tocar el codigo.
  const elegido = entorno['VITRINA_BROWSER'];

  // El home tambien es parametro. `os.homedir()` devuelve el del anfitrion, y
  // al pedir la lista de macOS desde Windows colaba una ruta con letra de
  // unidad entre rutas POSIX. En un Mac el resultado era correcto igualmente,
  // pero la funcion mentia sobre lo que devuelve, y eso invalida la unica
  // forma de comprobar el port sin un Mac delante.
  const propias = plataforma === 'darwin' ? candidatosMac(home)
    : plataforma === 'win32' ? candidatosWindows()
    : candidatosLinux();
  return elegido ? [elegido, ...propias] : propias;
}

function candidatosMac(home: string): string[] {
  const apps = [
    'Google Chrome.app/Contents/MacOS/Google Chrome',
    'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'Brave Browser.app/Contents/MacOS/Brave Browser',
    'Chromium.app/Contents/MacOS/Chromium',
  ];
  // Primero las instalaciones para todo el sistema y luego las del usuario,
  // que es el orden en que la gente espera que se resuelva un duplicado.
  return [
    ...apps.map((a) => `/Applications/${a}`),
    ...apps.map((a) => `${home}/Applications/${a}`),
  ];
}

function candidatosWindows(): string[] {
  const local = process.env['LOCALAPPDATA'] ?? '';
  const list = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    local ? local + '/Google/Chrome/Application/chrome.exe' : '',
  ].filter(Boolean);

  // EdgeCore (el runtime de WebView2) guarda una carpeta por version instalada
  // y expone CDP igual que Edge normal. Se coge la mas alta.
  for (const root of [
    'C:/Program Files (x86)/Microsoft/EdgeCore',
    'C:/Program Files/Microsoft/EdgeCore',
  ]) {
    if (!fs.existsSync(root)) continue;
    const versions = fs
      .readdirSync(root)
      .filter((d) => /^\d+\./.test(d))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) list.push(`${root}/${v}/msedge.exe`);
  }
  return list;
}

/**
 * Que un ejecutable exista no significa que arranque: puede estar bloqueado por
 * politica, por antivirus o venir de una descarga parcial. El Chromium que
 * Playwright dejo instalado en la maquina de desarrollo falla justo asi
 * (`spawn UNKNOWN`), asi que hay que probarlo, no solo comprobar que esta.
 */
function isLaunchable(path: string): boolean {
  try {
    const probe = spawn(path, ['--no-startup-window'], { stdio: 'ignore' });
    probe.on('error', () => {});
    probe.kill();
    return true;
  } catch {
    return false;
  }
}

/**
 * Version del navegador, solo para diagnostico.
 *
 * Cada sistema usa lo que funciona en el, y NO se unifica a `--version`: en
 * Windows se midio que esa llamada no termina (ETIMEDOUT), asi que alli se lee
 * la version del propio fichero.
 */
function readVersion(path: string, plataforma: Plataforma): string {
  try {
    if (plataforma === 'darwin') {
      const r = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 8000 });
      return (r.stdout || '').trim();
    }
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-Item '${path.replace(/'/g, "''")}').VersionInfo.ProductVersion`],
      { encoding: 'utf8', timeout: 8000 },
    );
    return (r.stdout || '').trim();
  } catch {
    return '';
  }
}

export function findBrowser(plataforma: Plataforma = process.platform): BrowserInfo | null {
  for (const path of candidates(plataforma)) {
    if (!fs.existsSync(path) || !isLaunchable(path)) continue;
    const bajo = path.toLowerCase();
    const nombre = bajo.includes('msedge') || bajo.includes('microsoft edge') ? 'Edge'
      : bajo.includes('brave') ? 'Brave'
      : bajo.includes('chromium') ? 'Chromium'
      : 'Chrome';
    const version = readVersion(path, plataforma);
    return { path, label: `${nombre}${version ? ' ' + version : ''}` };
  }
  return null;
}

/** Que instalar cuando no se encuentra ninguno, dicho en concreto. */
export function comoInstalarNavegador(plataforma: Plataforma = process.platform): string {
  return plataforma === 'darwin'
    ? 'Vitrina necesita un navegador Chromium. Instala Google Chrome desde google.com/chrome '
      + '(Safari no sirve: no expone screencast por DevTools Protocol).'
    : plataforma === 'win32'
      ? 'Vitrina necesita Edge o Chrome, y no se encontro ninguno ejecutable.'
      : 'Vitrina necesita Chrome o Chromium, y no se encontro ninguno ejecutable. '
        + 'Si lo tienes en una ruta poco habitual, apunta VITRINA_BROWSER a el.';
}

/**
 * Flags de lanzamiento.
 *
 * `--app=` abre una ventana sin barra de pestanas ni de direcciones, que es lo
 * que hace que el material salga limpio: el chrome del navegador se dibuja
 * despues en el compositor, vectorial y tematizable, en vez de capturarse.
 */
export function launchFlags(opts: {
  port: number;
  profileDir: string;
  windowWidth: number;
  windowHeight: number;
  /**
   * Escala de dispositivo forzada al navegador entero.
   *
   * Es lo que permite grabar la VISTA DE MOVIL sin perder resolucion: con un
   * viewport de 430 px CSS la web muestra su diseno movil, y a escala 3 el
   * screencast entrega 1290 px de ancho. Ponerla por `Emulation` no sirve
   * —`startScreencast` la ignora, medido en M0—; forzada al lanzar el
   * navegador el surface del compositor nace ya a esa escala. Ver M7.
   */
  deviceScaleFactor?: number;
}): string[] {
  const dsf = opts.deviceScaleFactor ?? 1;
  return [
    ...(dsf !== 1 ? [`--force-device-scale-factor=${dsf}`] : []),
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${opts.profileDir}`,
    '--app=about:blank',
    `--window-size=${opts.windowWidth},${opts.windowHeight}`,
    '--window-position=40,40',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-infobars',
    '--hide-crash-restore-bubble',
    // Color consistente entre lo que se ve y lo que se exporta.
    '--force-color-profile=srgb',
    // Sin esto, una ventana tapada o en segundo plano baja su framerate y la
    // grabacion sale a tirones sin motivo aparente.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=Translate,AutofillServerCommunication,MediaRouter,OptimizationHints',
  ];
}
