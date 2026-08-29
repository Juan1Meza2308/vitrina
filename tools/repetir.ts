/**
 * Repite una grabacion: la vuelve a ejecutar y guarda una grabacion nueva.
 *
 *   node tools/repetir.ts grabaciones/demo.vitrina [--preset=maximo] [--out=...]
 *
 * La comprobacion que importa no es que salgan frames, sino que la repeticion
 * pulse LOS MISMOS ELEMENTOS. Por eso al terminar compara las etiquetas de los
 * clicks del log nuevo con las del viejo: contar eventos no probaria nada.
 */
import CDP from 'chrome-remote-interface';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Recorder, guionDe, duracionDeGuion, reproducir } from '@vitrina/capture-cdp';
import { CAPTURE_PRESETS, paraOrientacion, reescalarProyecto } from '@vitrina/core';
import type { InputEvent, Manifest, Project } from '@vitrina/core';

const PORT = 9223;
const args = process.argv.slice(2);
const origen = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'grabaciones/demo.vitrina');
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const destino = path.resolve(flag('out') ?? `${origen.replace(/\.vitrina$/, '')}-repetida.vitrina`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Entrada {
  Input: {
    dispatchMouseEvent(p: Record<string, unknown>): Promise<void>;
    dispatchKeyEvent(p: Record<string, unknown>): Promise<void>;
  };
  close(): Promise<void>;
}

const leer = async <T>(f: string): Promise<T> =>
  JSON.parse(await fsp.readFile(path.join(origen, f), 'utf8')) as T;

const manifest = await leer<Manifest>('manifest.json');
const events = await leer<InputEvent[]>('events.json');

// El preset se puede cambiar: es el caso de "regrabar a mas resolucion".
const nombre = flag('preset');
const base = CAPTURE_PRESETS.find((p) => p.name === nombre)
  ?? CAPTURE_PRESETS.find((p) => p.name === 'equilibrado')!;
const vertical = (manifest.capture ?? manifest.viewport).h > (manifest.capture ?? manifest.viewport).w;
const preset = nombre
  ? paraOrientacion(base, vertical ? 'vertical' : 'horizontal')
  : null;

const guion = guionDe(events, manifest.startedAt, {
  deviceScaleFactor: manifest.deviceScaleFactor ?? 1,
  relleno: flag('texto') ?? '',
});

console.log(`\n  origen   ${path.relative(process.cwd(), origen)}`);
console.log(`  destino  ${path.relative(process.cwd(), destino)}`);
console.log(`  guion    ${guion.length} acciones, ${(duracionDeGuion(guion) / 1000).toFixed(1)}s`);
console.log(`  captura  ${preset ? `${preset.capture.w}x${preset.capture.h} (${nombre})`
  : 'la misma que el original'}`);
console.log(`  tapado   ${manifest.tapado?.selectores.join(', ') ?? 'nada'}\n`);

await fsp.rm(destino, { recursive: true, force: true });

const rec = new Recorder({
  url: manifest.url,
  viewport: preset?.css ?? preset?.capture ?? manifest.viewport,
  deviceScaleFactor: preset?.dsf ?? (preset ? 1 : manifest.deviceScaleFactor ?? 1),
  outDir: destino,
  port: PORT,
  // Se repite tambien lo que se tapo. Una repeticion sin esto publicaria en la
  // segunda toma justo el dato que se tapo en la primera, y sin avisar.
  tapado: manifest.tapado ?? null,
});

await rec.launch();
await rec.start();

// Al target de la pagina y con `local: true`: conectar en medio del screencast
// sin eso se come mas de quince segundos, y aqui esos segundos desplazarian el
// guion entero respecto a la grabacion.
const objetivos = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as
  { type: string; id: string }[];
const pagina = objetivos.find((t) => t.type === 'page');
if (!pagina) throw new Error('El navegador de repeticion no expuso una pagina');
const input = (await CDP({ port: PORT, target: pagina.id, local: true })) as unknown as Entrada;

await reproducir(input, guion, { relleno: flag('texto') ?? '' });
await sleep(600);
await input.close();

const resultado = await rec.stop();
await rec.close();

// Y el proyecto se copia: es lo que hace que repetir no cueste la edicion.
//
// Reescalado, porque los tramos de zoom guardan su objetivo en pixeles de la
// FUENTE: copiarlos tal cual a una captura de otro tamano deja la camara
// encuadrando otro sitio, y el video sale bien a primera vista.
try {
  const viejo = JSON.parse(await fsp.readFile(path.join(origen, 'project.json'), 'utf8')) as Project;
  const fuenteVieja = manifest.capture ?? manifest.viewport;
  const fuenteNueva = resultado.manifest.capture ?? resultado.manifest.viewport;
  await fsp.writeFile(
    path.join(destino, 'project.json'),
    JSON.stringify(reescalarProyecto(viejo, fuenteVieja, fuenteNueva), null, 2),
  );
} catch {
  console.log('  (el original no tenia project.json)');
}

const etiquetas = (evs: InputEvent[]) =>
  evs.filter((e) => e.type === 'down').map((e) => e.label ?? '(sin texto)');
const antes = etiquetas(events);
const ahora = etiquetas(resultado.events);
const iguales = antes.length === ahora.length && antes.every((l, i) => l === ahora[i]);

console.log(`  frames   ${resultado.manifest.frames.length}`);
console.log(`  pulsado antes  ${antes.join(' | ') || '(nada)'}`);
console.log(`  pulsado ahora  ${ahora.join(' | ') || '(nada)'}`);
console.log(`\n  ${iguales ? 'IGUAL: la repeticion pulso los mismos elementos'
  : 'DISTINTO: la repeticion no aterrizo en los mismos elementos'}\n`);

process.exit(iguales ? 0 : 1);
