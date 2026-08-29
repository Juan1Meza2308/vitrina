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
