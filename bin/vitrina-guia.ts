#!/usr/bin/env node
/**
 * vitrina guia - escribe la guia de una grabacion.
 *
 *   node bin/vitrina-guia.ts grabaciones/demo.vitrina
 *
 * Deja dentro de la carpeta `guia.md` con los pasos y sus capturas,
 * `capitulos.txt` para la descripcion del video y `guia.srt` con los
 * subtitulos de accion.
 */
import path from 'node:path';
import { exportarGuia } from '@vitrina/export';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

if (!dir) {
  console.error(`
vitrina guia - de la demo a la guia escrita

  node bin/vitrina-guia.ts <carpeta.vitrina> [opciones]

  --ancho=<n>      ancho de las capturas en px (por defecto 960)
  --titulo=<txt>   titulo de la guia
`);
  process.exit(1);
}

const carpeta = path.resolve(dir);
const r = await exportarGuia({
  recordingDir: carpeta,
  ancho: Number(flag('ancho') ?? '') || undefined,
  titulo: flag('titulo'),
});

console.log(`\n  carpeta   ${path.relative(process.cwd(), carpeta)}`);
console.log(`  pasos     ${r.pasos.length}`);
for (const p of r.pasos.slice(0, 8)) {
  console.log(`            ${p.titulo}`);
}
if (r.pasos.length > 8) console.log(`            ...y ${r.pasos.length - 8} mas`);
console.log(`  escrito   ${r.ficheros.filter((f) => !f.startsWith('guia/')).join(', ')}`);
console.log(`            ${r.ficheros.filter((f) => f.startsWith('guia/')).length} capturas\n`);
