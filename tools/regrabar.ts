/**
 * Regraba una demo DESDE UN PUNTO.
 *
 *   node tools/regrabar.ts grabaciones/demo.vitrina --desde=40s
 *
 * La dolencia que ataca es la peor de todas: te equivocas en el segundo cuarenta
 * de una demo de tres minutos y repites los tres minutos. Ningun grabador de
 * pixeles puede evitarlo, porque solo sabe QUE SE VIO. Vitrina sabe QUE PASO,
 * asi que puede ejecutar sola la cabeza —con los mismos tiempos que la
 * original, que es lo que deja la app en el mismo estado— y devolverte el
 * control justo donde te equivocaste.
 *
 * La grabacion original NO se toca: sale una carpeta nueva.
 *
 * Lo que se pierde, dicho claro: tu voz de la cabeza. Durante esos cuarenta
 * segundos no estabas hablando, asi que la narracion empieza en el relevo. El
 * manifest lo resuelve solo —la pista lleva su propio `startedAt` y el montaje
 * antepone silencio—, y si quieres voz tambien en la cabeza, se dobla despues.
 */
import CDP from 'chrome-remote-interface';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Recorder, guionDe, guionHasta, reproducir } from '@vitrina/capture-cdp';
import { CAPTURE_PRESETS, paraOrientacion, reescalarProyecto } from '@vitrina/core';
import type { InputEvent, Manifest, Project } from '@vitrina/core';

const PORT = 9224;
const args = process.argv.slice(2);
const origen = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'grabaciones/demo.vitrina');
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const destino = path.resolve(flag('out') ?? `${origen.replace(/\.vitrina$/, '')}-regrabada.vitrina`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `40`, `40s` o `40000ms`: se escribe como se piensa. */
function instante(txt: string | undefined): number {
  if (!txt) return 0;
  const n = parseFloat(txt);
  if (!Number.isFinite(n)) return 0;
  if (txt.endsWith('ms')) return n;
  return n * 1000;
}

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
const desde = instante(flag('desde'));

const nombre = flag('preset');
const base = CAPTURE_PRESETS.find((p) => p.name === nombre)
  ?? CAPTURE_PRESETS.find((p) => p.name === 'equilibrado')!;
const fuenteVieja = manifest.capture ?? manifest.viewport;
const vertical = fuenteVieja.h > fuenteVieja.w;
const preset = nombre ? paraOrientacion(base, vertical ? 'vertical' : 'horizontal') : null;

const guion = guionDe(events, manifest.startedAt, {
  deviceScaleFactor: manifest.deviceScaleFactor ?? 1,
  relleno: flag('texto') ?? '',
});
const cabeza = guionHasta(guion, desde);

console.log(`\n  origen    ${path.relative(process.cwd(), origen)}`);
console.log(`  destino   ${path.relative(process.cwd(), destino)}`);
console.log(`  desde     ${(desde / 1000).toFixed(1)}s`);
console.log(`  cabeza    ${cabeza.length} acciones que ejecuta Vitrina sola`);
console.log(`  cola      la haces tu, y paras con Enter\n`);

await fsp.rm(destino, { recursive: true, force: true });

const rec = new Recorder({
  url: manifest.url,
  viewport: preset?.css ?? preset?.capture ?? manifest.viewport,
  deviceScaleFactor: preset?.dsf ?? (preset ? 1 : manifest.deviceScaleFactor ?? 1),
  outDir: destino,
  port: PORT,
  // Lo que se tapo se sigue tapando: la toma nueva no puede publicar lo que la
  // vieja escondia.
  tapado: manifest.tapado ?? null,
});

await rec.launch();
await rec.start();

// Al target de la pagina y con `local: true`: sin eso, conectar en medio del
// screencast se come mas de quince segundos y desplaza el guion entero.
const objetivos = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as
  { type: string; id: string }[];
const pagina = objetivos.find((t) => t.type === 'page');
if (!pagina) throw new Error('El navegador de regrabacion no expuso una pagina');
const input = (await CDP({ port: PORT, target: pagina.id, local: true })) as unknown as Entrada;

await reproducir(input, cabeza, { relleno: flag('texto') ?? '' });
await input.close();

console.log('  --- AHORA TU ---  sigue la demo en la ventana del navegador');
console.log('  (pulsa Enter aqui cuando termines)\n');
await new Promise<void>((resolve) => {
  const onData = () => {
    process.stdin.off('data', onData);
    process.stdin.pause();
    resolve();
  };
  process.stdin.resume();
  process.stdin.on('data', onData);
});
await sleep(400);

const resultado = await rec.stop();
await rec.close();

/*
 * El proyecto: la cabeza conserva TU edicion, la cola se planifica de cero.
 *
 * Los tramos de zoom de la cabeza siguen valiendo porque la cabeza se ejecuto
 * con los mismos tiempos —incluidos los que moviste a mano, que es justo lo que
 * no se puede perder—. Los de la cola no: ahi hay material nuevo. Copiarlos
 * todos dejaria la camara encuadrando lo que ya no esta.
 */
try {
  const viejo = JSON.parse(await fsp.readFile(path.join(origen, 'project.json'), 'utf8')) as Project;
  const fuenteNueva = resultado.manifest.capture ?? resultado.manifest.viewport;
  const copiado = reescalarProyecto(viejo, fuenteVieja, fuenteNueva);

  const nuevoProyecto = JSON.parse(
    await fsp.readFile(path.join(destino, 'project.json'), 'utf8')) as Project;

  const zoomsCabeza = copiado.zooms.filter((z) => z.endMs <= desde);
  const zoomsCola = nuevoProyecto.zooms.filter((z) => z.startMs >= desde);

  await fsp.writeFile(path.join(destino, 'project.json'), JSON.stringify({
    ...copiado,
    zooms: [...zoomsCabeza, ...zoomsCola],
    // La toma nueva no tiene camara ni voz: eran de la grabacion vieja.
    camara: null,
    voz: null,
    pista: undefined,
    // Los cortes y las velocidades tambien eran del material viejo, y sus
    // instantes no significan nada en la toma nueva.
    cuts: [],
    speeds: [],
    export: nuevoProyecto.export,
  }, null, 2));

  console.log(`  zooms     ${zoomsCabeza.length} conservados de la cabeza`
    + ` + ${zoomsCola.length} nuevos en la cola`);
} catch {
  console.log('  (el original no tenia project.json: se deja el plan automatico)');
}

/*
 * La comprobacion que importa: la cabeza aterrizo en los mismos elementos.
 *
 * Contar eventos no probaria nada. Lo que dice que la app quedo donde tenia que
 * quedar es que se pulsaron los mismos botones, en el mismo orden.
 */
// Cada log se mide contra SU propio arranque: la toma nueva empezo en otro
// instante, y compararla con el reloj de la vieja dejaba la cabeza vacia.
const etiquetas = (evs: InputEvent[], arranque: number, hasta: number) => evs
  .filter((e) => e.type === 'down' && e.t - arranque < hasta)
  .map((e) => e.label ?? '(sin texto)');

const antes = etiquetas(events, manifest.startedAt, desde);
const ahora = etiquetas(resultado.events, resultado.manifest.startedAt, desde);
const iguales = antes.length === ahora.length && antes.every((l, i) => l === ahora[i]);

console.log(`\n  frames    ${resultado.manifest.frames.length}`);
console.log(`  cabeza antes  ${antes.join(' | ') || '(nada)'}`);
console.log(`  cabeza ahora  ${ahora.join(' | ') || '(nada)'}`);
console.log(`\n  ${iguales ? 'IGUAL: la cabeza pulso los mismos elementos'
  : 'DISTINTO: la cabeza no aterrizo en los mismos elementos'}\n`);

process.exit(iguales ? 0 : 1);
