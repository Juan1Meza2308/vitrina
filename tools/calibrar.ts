/**
 * Mide el rendimiento de captura de ESTA maquina y reescribe los presets.
 *
 *   node tools/calibrar.ts [--secs=8]
 *   node tools/calibrar.ts --vertical    comprueba la suposicion, no reescribe
 *
 * Los presets de serie estan medidos en un i5-7500 con HD 630. En una maquina
 * mas rapida son muy conservadores: `pickPreset(60)` elegiria 1600x900 cuando
 * el equipo daria de sobra para 2560x1440. Y al reves, en una mas lenta
 * prometerian fps que no llegan.
 *
 * Se usa la clase `Recorder` de produccion, no un spike aparte: si la captura
 * cambia, la calibracion cambia con ella. Medir con otro codigo del que graba
 * es medir otra cosa.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Recorder } from '@vitrina/capture-cdp';
import type { CaptureSize, Frame } from '@vitrina/core';
import { paraOrientacion } from '@vitrina/core';

/**
 * Escalera de captura apaisada: ancho de maquetacion + escala.
 *
 * El ancho CSS es a lo que maqueta la pagina, y la resolucion sale de la
 * escala. Antes se compraba margen de zoom ensanchando el viewport —hasta
 * 2560 px—, y a esa anchura la interfaz de la app sale diminuta en el video.
 * Con la escala de M7 se consigue el mismo margen manteniendo la maquetacion en
 * un ancho de portatil, que es como el usuario ve su app de verdad.
 *
 * Escalas exactas medidas en M8: 1.5, 1.75 y 2 entregan siempre css x dsf; 1.25
 * resulto inestable y no se usa.
 *
 * El coste por escalon se mantiene parecido al de la escalera anterior a
 * proposito. La prioridad del proyecto es la FLUIDEZ, y una tabla que gana
 * nitidez bajando el preset por defecto de 99 a 59 fps no seria una mejora:
 * seria cambiar de moneda sin decirlo.
 */
const RESOLUCIONES: { name: string; css: CaptureSize; dsf: number }[] = [
  { name: 'fluido', css: { w: 960, h: 540 }, dsf: 1.5 },       // 1440x810   1.17 MP
  { name: 'equilibrado', css: { w: 1152, h: 648 }, dsf: 1.5 }, // 1728x972   1.68 MP
  { name: 'nitido', css: { w: 1280, h: 720 }, dsf: 1.5 },      // 1920x1080  2.07 MP
  { name: 'maximo', css: { w: 1280, h: 720 }, dsf: 2 },        // 2560x1440  3.69 MP
];

/** Tamano real del frame de una entrada de la escalera. */
function marcoDe(r: { css: CaptureSize; dsf: number }): CaptureSize {
  return { w: Math.round(r.css.w * r.dsf), h: Math.round(r.css.h * r.dsf) };
}

const flag = (n: string, d: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const SECS = Number(flag('secs', '8'));
/**
 * Comprueba que capturar en vertical cuesta lo mismo que en horizontal.
 *
 * La app transpone el preset elegido en vez de tener una lista propia para 9:16,
 * y eso se apoya en que el coste sean PIXELES y no forma. Es una suposicion
 * razonable, no un hecho: el compositor de la GPU y el codificador JPEG podrian
 * tratar distinto una imagen alta y estrecha.
 *
 * Mide LAS DOS formas seguidas, una detras de otra, y compara dentro de cada
 * pareja. Comparar contra los presets guardados —que es lo primero que hice—
 * no vale: dan 99 fps medidos en una maquina en reposo, y bastan unos procesos
 * de fondo para que la misma resolucion apaisada baje a 34. Con esa referencia,
 * la carga del momento se lee como si la forma fuera el problema.
 *
 * Se mide con el mismo fixture de estres: lo que interesa es el techo de
 * pixeles por segundo, y ese fixture repinta sin parar tenga la forma que tenga
 * el viewport.
 */
const VERTICAL = process.argv.includes('--vertical');
const DESTINO = path.resolve('packages/core/src/presets.medidos.ts');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Medida {
  name: string;
  css: CaptureSize;
  dsf: number;
  capture: CaptureSize;
  measuredFps: number;
  p95DeltaMs: number;
}

/**
 * fps mediano y p95 del hueco entre frames.
 *
 * Se usa la mediana y NO la media porque un tramo estatico —donde el screencast
 * legitimamente no emite— hundiria la media sin que nada vaya mal. Y el p95
 * porque la mediana sola miente: puede dar 35 fps con huecos de 76 ms que se
 * ven como tirones.
 */
function medir(frames: Frame[], startedAt: number): { fps: number; p95: number } {
  if (frames.length < 3) return { fps: 0, p95: 9999 };

  const ordenados = [...frames].sort((a, b) => a.t - b.t);
  const deltas: number[] = [];
  for (let i = 1; i < ordenados.length; i++) {
    deltas.push((ordenados[i]!.t - ordenados[i - 1]!.t) * 1000);
  }
  deltas.sort((a, b) => a - b);

  const p50 = deltas[Math.floor(deltas.length * 0.5)] ?? 0;
  const p95 = deltas[Math.floor(deltas.length * 0.95)] ?? 0;
  void startedAt;
  return { fps: p50 > 0 ? Math.round(1000 / p50) : 0, p95: Number(p95.toFixed(1)) };
}

async function main(): Promise<void> {
  const fixture = pathToFileURL(path.resolve('spikes/stress.html')).href;
  console.log(`\n  calibrando en ${os.cpus()[0]?.model.trim() ?? 'esta maquina'}`);
  console.log(`  ${SECS}s por resolucion sobre el fixture de estres`);
  if (VERTICAL) console.log('  modo comprobacion: resoluciones transpuestas, sin reescribir');
  console.log('');

  const medidas: Medida[] = [];
  const lista = VERTICAL
    ? RESOLUCIONES.flatMap((r, i) => {
        const v = paraOrientacion(
          { name: r.name, capture: marcoDe(r), measuredFps: 0, p95DeltaMs: 0 }, 'vertical');
        void i;
        return [r, { name: `${r.name}·vertical`, css: v.css!, dsf: v.dsf! }];
      })
    : RESOLUCIONES;
  for (const r of lista) {
    const salida = await fsp.mkdtemp(path.join(os.tmpdir(), 'vitrina-cal-'));
    const marco = marcoDe(r);
    const rec = new Recorder({
      url: fixture,
      viewport: r.css,
      deviceScaleFactor: r.dsf,
      quality: 92,
      outDir: salida,
      port: 9411,
    });
    try {
      await rec.launch();
      await rec.start();
      await sleep(SECS * 1000);
      const { manifest } = await rec.stop();
      const m = medir(manifest.frames, manifest.startedAt);
      medidas.push({
        name: r.name, css: r.css, dsf: r.dsf, capture: marco,
        measuredFps: m.fps, p95DeltaMs: m.p95,
      });
      // Se avisa si el frame no salio del tamano pedido: significa que la
      // emulacion no se aplico y la medida es de otra resolucion.
      const real = manifest.capture;
      const raro = real && (real.w !== marco.w || real.h !== marco.h)
        ? `  (!! el frame salio ${real.w}x${real.h})` : '';
      console.log(`  ${r.name.padEnd(12)} ${r.css.w}css x${r.dsf} -> ${marco.w}x${marco.h}`
        + `   ${String(m.fps).padStart(3)} fps   p95 ${m.p95.toFixed(1)}ms${raro}`);
    } catch (e) {
      // Una resolucion que falla no puede tirar la pasada entera: el arranque
      // del navegador se va de los 20s con la maquina cargada, y perder las
      // otras siete medidas por eso deja al usuario sin nada que mirar.
      console.log(`  ${r.name.padEnd(12)} ${marco.w}x${marco.h}`
        + `   FALLO: ${e instanceof Error ? e.message : String(e)}`);
      medidas.push({
        name: r.name, css: r.css, dsf: r.dsf, capture: marco,
        measuredFps: 0, p95DeltaMs: 0,
      });
    } finally {
      await rec.close().catch(() => {});
      await fsp.rm(salida, { recursive: true, force: true }).catch(() => {});
    }
    // Margen para que el navegador anterior suelte el puerto del todo. Con 700ms
    // fallaba una de cada tantas con "no expuso CDP".
    await sleep(2500);
  }

  if (VERTICAL) {
    console.log('\n  vertical frente a apaisado, medidos en esta misma pasada:\n');
    let peor = 0;
    for (const base of RESOLUCIONES) {
      const h = medidas.find((m) => m.name === base.name);
      const v = medidas.find((m) => m.name === `${base.name}·vertical`);
      if (!h || !v || h.measuredFps === 0 || v.measuredFps === 0) {
        console.log(`  ${base.name.padEnd(12)} sin dato: alguna de las dos medidas fallo`);
        continue;
      }
      const dif = ((v.measuredFps - h.measuredFps) / h.measuredFps) * 100;
      peor = Math.min(peor, dif);
      console.log(`  ${base.name.padEnd(12)} ${String(v.measuredFps).padStart(3)} fps vertical`
        + ` frente a ${String(h.measuredFps).padStart(3)} apaisado`
        + `   ${dif >= 0 ? '+' : ''}${dif.toFixed(0)}%`);
    }
    console.log(peor < -15
      ? `\n  ATENCION: en vertical se pierde hasta un ${Math.abs(peor).toFixed(0)}%.`
        + ' Transponer el preset ya no seria gratis en esta maquina: los fps que'
        + ' anuncia la app no se cumplirian girando.\n'
      : '\n  La suposicion se sostiene: transponer no cambia el coste.'
        + ' No se reescribe nada.\n');
    return;
  }

  const maquina = `${os.cpus()[0]?.model.trim() ?? 'desconocida'} · ${process.platform}`;
  await fsp.writeFile(DESTINO, plantilla(maquina, medidas));
  console.log(`\n  escrito en ${path.relative(process.cwd(), DESTINO)}`);
  console.log('  Revisa el diff: si algun numero salio en 0, la captura fallo en esa resolucion.\n');
}

function plantilla(maquina: string, medidas: Medida[]): string {
  const filas = medidas.map((m) =>
    `  {\n    name: '${m.name}',`
    + `\n    css: { w: ${m.css.w}, h: ${m.css.h} }, dsf: ${m.dsf},`
    + `\n    capture: { w: ${m.capture.w}, h: ${m.capture.h} },`
    + `\n    measuredFps: ${m.measuredFps}, p95DeltaMs: ${m.p95DeltaMs},\n  },`).join('\n');

  return `/**
 * Rendimiento de captura MEDIDO, no estimado.
 *
 * GENERADO por \`npm run calibrar\`. No editar a mano: vuelve a medir.
 *
 * El techo de captura depende de la maquina, asi que unos numeros prestados
 * eligen mal el preset — o prometen fps que no llegan, o se quedan cortos en un
 * equipo que daba para mas.
 */
import type { CapturePreset } from './quality.ts';

/** De donde salen los numeros de abajo. Se muestra en la app. */
export const MEDIDO_EN = '${maquina.replace(/'/g, "\\'")}';

export const PRESETS_MEDIDOS: CapturePreset[] = [
${filas}
];
`;
}

main().catch((e: unknown) => {
  console.error('\nFALLO:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
