/**
 * Comprobacion despues de empaquetar: que ffmpeg viaja de verdad dentro.
 *
 * Existe por lo que hace electron-builder cuando un `extraResources` no esta:
 * escribe `file source doesn't exist` en el log y **sigue**. El resultado es un
 * instalador con la app entera y sin exportador, que se descarga, se abre, se
 * graba una demo, se edita... y falla al exportar, en la maquina de otro.
 *
 * Aqui eso se convierte en lo que tiene que ser: el build se para.
 *
 * Ademas se ejecuta el binario para leer sus codecs, que es la unica forma de
 * saber si sirve. Un `ffmpeg` que existe pero no trae `prores_ks` rompe el
 * preset alpha, y esa es justo la razon por la que durante meses no se empaqueto
 * ninguno.
 *
 * En CommonJS porque es un hook de electron-builder, que lo carga con `require`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/** Lo que cada preset de exportacion necesita saber codificar. */
const CODECS = ['libx264', 'prores_ks', 'libopus', 'gif'];

/**
 * Modulos que NO van dentro del bundle y se cargan en tiempo de ejecucion.
 *
 * Tienen que estar declarados en las dependencias de `apps/desktop`, no solo en
 * las de la raiz: electron-builder mete en el asar las dependencias de la app.
 *
 * Esta comprobacion existe porque paso: `electron-updater` estaba en la lista de
 * externos de electron-vite y en el package.json de la RAIZ, asi que el bundle
 * lo pedia con `require` y no viajaba en el paquete. El instalador se publico,
 * se descargo, y al abrirlo salia «Cannot find module 'electron-updater'»: la
 * app no arrancaba siquiera. Nada en el build habia dicho una palabra.
 *
 * La lista se lee de la configuracion de electron-vite para que no haya dos
 * sitios que mantener sincronizados.
 */
function externosDeclarados() {
  const cfg = fs.readFileSync(
    path.join(__dirname, '..', 'electron.vite.config.ts'), 'utf8');
  const m = /const NATIVAS = \{[\s\S]*?include:\s*\[([^\]]*)\]/.exec(cfg);
  if (!m) throw new Error('No se pudo leer la lista de externos de electron-vite');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

exports.default = async function comprobarEmpaquetado(contexto) {
  const { appOutDir, electronPlatformName } = contexto;
  // En macOS los recursos van dentro del bundle; en Windows y Linux, al lado.
  const recursos = electronPlatformName === 'darwin'
    ? path.join(appOutDir, `${contexto.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
  const bin = path.join(recursos, electronPlatformName === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

  if (!fs.existsSync(bin)) {
    throw new Error(
      `El paquete no lleva ffmpeg (${bin}).\n`
      + '  Sin el, la app se instala y falla al exportar, en la maquina de otro.\n'
      + '  Suele ser que `ffmpeg-static` bajo el binario de OTRO sistema: cada\n'
      + '  instalador tiene que compilarse en un runner de su plataforma.',
    );
  }

  // Los modulos externos, dentro del paquete
  const asar = path.join(recursos, 'app.asar');
  if (fs.existsSync(asar)) {
    const dentro = require('@electron/asar').listPackage(asar);
    const faltan = externosDeclarados().filter(
      (mod) => !dentro.some((f) => f.replace(/\\/g, '/').startsWith(`/node_modules/${mod}/`)),
    );
    if (faltan.length > 0) {
      throw new Error(
        `El paquete no lleva estos modulos: ${faltan.join(', ')}.\n`
        + '  Estan en la lista de externos de electron-vite, asi que el bundle los\n'
        + '  pide con `require` en tiempo de ejecucion. Declaralos en las\n'
        + '  dependencias de apps/desktop/package.json, no solo en las de la raiz:\n'
        + '  electron-builder mete en el asar las dependencias de la app.\n'
        + '  Sin esto la app no abre —«Cannot find module»— y el build no dice nada.',
      );
    }
    console.log(`  · los modulos externos viajan dentro (${externosDeclarados().join(', ')})`);
  }

  // Ejecutar el de otra plataforma no tiene sentido; ahi basta con que este.
  const propio = (electronPlatformName === 'win32' && process.platform === 'win32')
    || (electronPlatformName === 'darwin' && process.platform === 'darwin')
    || (electronPlatformName === 'linux' && process.platform === 'linux');
  if (!propio) {
    console.log(`  · ffmpeg empaquetado (${bin}); sus codecs se comprueban en su plataforma`);
    return;
  }

  const r = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  const salida = r.stdout ?? '';
  const faltan = CODECS.filter((c) => !salida.includes(c));
  if (faltan.length > 0) {
    throw new Error(
      `El ffmpeg empaquetado no trae: ${faltan.join(', ')}.\n`
      + '  Los presets de exportacion los necesitan, y el fallo solo aparaceria\n'
      + '  al exportar en la maquina de quien lo descargue.',
    );
  }
  console.log(`  · ffmpeg empaquetado y con sus codecs (${CODECS.join(', ')})`);
};
