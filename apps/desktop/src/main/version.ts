/**
 * Comparar versiones, que es lo unico con logica del sistema de actualizacion.
 *
 * Va aparte y sin importar Electron para poder probarlo: el resto —hablar con
 * GitHub, descargar, reiniciar— lo hace `electron-updater`, y eso solo se puede
 * comprobar publicando de verdad. Esto si se puede, y es donde estan los fallos
 * que se cuelan: `0.10.0` es MAYOR que `0.9.0`, aunque como texto vaya antes.
 */

/** `v1.2.3`, `1.2.3-beta.1` → [1, 2, 3]. Lo que no encaje da null. */
export function partes(version: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Si `candidata` es posterior a `actual`.
 *
 * Ante la duda, NO. Una version que no se entiende no puede disparar un aviso
 * de actualizacion: molestar a alguien con un aviso equivocado gasta la
 * confianza que hace falta el dia que la actualizacion importe de verdad.
 */
export function esMasNueva(candidata: string, actual: string): boolean {
  const a = partes(candidata);
  const b = partes(actual);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  // Iguales en numeros: una preliberacion (`1.2.3-beta`) NO gana a la final.
  // Al reves tampoco se avisa: quien instalo una beta no quiere que la app le
  // proponga "actualizar" a lo mismo con otro nombre.
  return false;
}

/**
 * Si esta plataforma puede instalar la actualizacion ella sola.
 *
 * En macOS, Squirrel exige que la app este FIRMADA, y Vitrina no lo esta:
 * firmar pide una cuenta de desarrollador de Apple. Sin firma, la descarga
 * silenciosa falla, asi que ahi el boton lleva a la pagina de descarga en vez de
 * prometer algo que no va a pasar. En Windows el instalador NSIS se actualiza
 * sin firma; avisa el SmartScreen, pero funciona.
 */
export function puedeActualizarSolo(plataforma: NodeJS.Platform = process.platform): boolean {
  return plataforma === 'win32';
}
