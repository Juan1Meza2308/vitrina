/**
 * Herramienta de desarrollo: verifica la app de escritorio conduciendola por CDP.
 *
 * Electron expone su renderer por el mismo protocolo que usa Vitrina para
 * grabar, asi que la app se puede pilotar con las mismas herramientas: abrir una
 * grabacion, mover la linea de tiempo, cambiar el fondo y comprobar los pixeles
 * que salen del lienzo.
 *
 * Lo que de verdad se comprueba aqui es la restriccion que sostiene el proyecto:
 * que `composite()` —la misma funcion que usa el exportador en Node— dibuja
 * tambien en el navegador. Hasta ahora solo se habia ejercitado en Node.
 *
 *   node tools/verificar-app.ts grabaciones/demo.vitrina
 */
import CDP from 'chrome-remote-interface';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findFfmpeg } from '@vitrina/export';
import {
  layoutFrame, notchRect, paraOrientacion, defaultExportFor, computeQualityBudget,
  CAPTURE_PRESETS,
} from '@vitrina/core';
import type { FrameStyle } from '@vitrina/core';

const ejecutar = promisify(execFile);

const PORT = 9500;
const APP = path.resolve('apps/desktop');
// El primer argumento QUE NO SEA UNA BANDERA. Con `argv[2]` a secas, invocar
// `--doblar grabaciones/x` tomaba "--doblar" por carpeta y fallaba diciendo que
// no existe project.json, que no es lo que estaba mal.
const grabacion = path.resolve(
  process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'grabaciones/demo.vitrina');
/** En macOS el ejecutable vive dentro del bundle; lanzar el .app no vale. */
const ELECTRON = path.resolve(process.platform === 'darwin'
  ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
  : 'node_modules/electron/dist/electron.exe');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Cliente {
  Page: {
    enable(): Promise<void>;
    captureScreenshot(p: { format?: string }): Promise<{ data: string }>;
  };
  Input: {
    dispatchMouseEvent(p: {
      type: string; x: number; y: number; button?: string; clickCount?: number;
    }): Promise<void>;
  };
  Runtime: {
    enable(): Promise<void>;
    evaluate(p: { expression: string; returnByValue?: boolean; awaitPromise?: boolean }):
      Promise<{ result: { value?: unknown } }>;
  };
  close(): Promise<void>;
}

async function esperarPagina(timeoutMs = 30_000): Promise<string> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const targets = (await r.json()) as { type: string; id: string; url: string }[];
        const page = targets.find((t) => t.type === 'page');
        if (page) return page.id;
      }
    } catch { /* Electron aun arrancando */ }
    await sleep(300);
  }
  throw new Error('El renderer de Electron no aparecio en CDP');
}

/**
 * Firma del lienzo: suma de una rejilla dispersa de pixeles.
 *
 * Comparar un unico pixel central no vale: la app grabada es oscura y dos
 * instantes distintos pueden coincidir ahi por casualidad, de modo que la
 * comprobacion falla sin que nada este roto. Una rejilla cubre toda la imagen y
 * cuesta lo mismo.
 */
const FIRMA = `
  (() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    let h = 0;
    for (let y = 4; y < c.height; y += 37) {
      for (let x = 4; x < c.width; x += 41) {
        const d = g.getImageData(x, y, 1, 1).data;
        h = (h * 31 + d[0] * 65536 + d[1] * 256 + d[2]) % 2147483647;
      }
    }
    return String(h);
  })()
`;

/**
 * Firma DENSA: lee el lienzo entero de una vez y resume todos los pixeles.
 *
 * La dispersa muestrea 589 puntos de 921.600 y se le escapa cualquier cosa
 * pequena. Un rotulo de click cambia unos 900 pixeles —medido—, asi que la
 * probabilidad de que caiga en la rejilla es de una moneda al aire: el test
 * fallaba con el dibujo funcionando perfectamente. Cuesta una sola llamada a
 * `getImageData`, menos que las 589 de la dispersa.
 */
const FIRMA_DENSA = `
  (() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i]) % 2147483647;
    return String(h);
  })()
`;

/**
 * Firma de la REGION de la burbuja de camara, en la esquina de siempre.
 *
 * Mirar el lienzo entero no serviria: la burbuja ocupa un 5 % del area y la
 * pagina grabada cambia sola, asi que una firma global cambiaria igual sin
 * burbuja. Esto mide solo el cuadrado donde tiene que estar.
 */
const FIRMA_BURBUJA = `
  (() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const d = Math.round(c.height * 0.22);
    const m = Math.round(c.width * 0.025);
    const px = g.getImageData(c.width - m - d, c.height - m - d, d, d).data;
    let h = 0;
    for (let i = 0; i < px.length; i += 4) {
      h = (h * 31 + px[i] * 3 + px[i + 1] * 5 + px[i + 2]) % 2147483647;
    }
    return String(h);
  })()
`;

/** Evalua en la pagina y devuelve el valor ya serializado. */
async function ev<T>(c: Cliente, expr: string): Promise<T> {
  const { result } = await c.Runtime.evaluate({
    expression: expr, returnByValue: true, awaitPromise: true,
  });
  return result.value as T;
}

/**
 * Espera a que se cumpla una condicion en la pagina.
 *
 * Sustituye a los `sleep` de duracion fija, que era la fragilidad de fondo de
 * esta herramienta: al anadir el microfono, el arranque de la grabacion paso a
 * tardar mas y las esperas calibradas a ojo empezaron a comprobar la pantalla
 * equivocada, produciendo fallos que se contradecian entre si.
 */
async function esperarA(
  c: Cliente, expr: string, descripcion: string, timeoutMs = 40_000,
): Promise<boolean> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await ev<boolean>(c, expr)) return true;
    await sleep(400);
  }
  console.log(`  (agotada la espera de: ${descripcion})`);
  return false;
}

/**
 * Da por perdida una promesa que tarda demasiado, en vez de colgar el proceso.
 *
 * Nace de `Page.captureScreenshot`: despues de exportar se queda esperando un
 * frame del compositor que ya no llega, y bloqueaba la verificacion ENTERA
 * despues de que todas las comprobaciones hubieran pasado. Una captura de
 * pantalla es un adorno; no puede decidir si el flujo termina.
 */
async function conLimite<T>(p: Promise<T>, ms: number, que: string): Promise<T | null> {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<null>((r) => { temporizador = setTimeout(() => r(null), ms); });
  try {
    return await Promise.race([p, limite]);
  } finally {
    clearTimeout(temporizador);
    void que;
  }
}

/**
 * Guarda una captura de pantalla, o avisa y sigue.
 *
 * `Page.captureScreenshot` espera un frame nuevo del compositor, y cuando la
 * ventana no esta componiendo —pantalla dormida, ventana tapada, justo despues
 * de exportar— no llega nunca y la llamada no vuelve. Colgo la verificacion
 * entera con TODAS las comprobaciones ya en verde. Las capturas son material de
 * apoyo: no pueden decidir si el flujo termina.
 */
async function capturar(client: Cliente, ruta: string): Promise<boolean> {
  const tiro = await conLimite(client.Page.captureScreenshot({ format: 'png' }), 15_000, ruta);
  if (!tiro) {
    console.log(`  (sin captura ${ruta}: el compositor no entrego frame)`);
    return false;
  }
  await fsp.writeFile(ruta, Buffer.from(tiro.data, 'base64'));
  return true;
}

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = ''): void {
  console.log(`  ${ok ? 'OK  ' : 'FALLA'} ${nombre}${detalle ? '  ' + detalle : ''}`);
  if (!ok) fallos++;
}

async function main(): Promise<void> {
  console.log(`  grabacion  ${grabacion}\n`);
  // La app guarda project.json al tocar cualquier control, asi que verificar
  // modificaria la grabacion de forma permanente. Se restaura al final: un test
  // que deja el fixture distinto de como lo encontro hace que la siguiente
  // ejecucion compruebe otra cosa sin avisar. Paso justamente eso: la primera
  // pasada dejo el fondo en malla y la segunda "cambio" el fondo al que ya
  // estaba puesto, pasando por una diferencia de un nivel.
  const projectPath = path.join(grabacion, 'project.json');
  const projectOriginal = await fsp.readFile(projectPath, 'utf8');

  const child = spawn(ELECTRON, [APP, grabacion, `--remote-debugging-port=${PORT}`], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const targetId = await esperarPagina();
  const client = (await CDP({ port: PORT, target: targetId })) as unknown as Cliente;
  await Promise.all([client.Page.enable(), client.Runtime.enable()]);

  // La grabacion llega por IPC despues de 'ready-to-show', y el primer pintado
  // del lienzo espera a que se decodifique un frame.
  await sleep(3500);

  check('el editor se abrio', await ev<boolean>(client, '!!document.querySelector("canvas")'));

  const dims = await ev<{ w: number; h: number }>(
    client, 'JSON.stringify({w:document.querySelector("canvas").width,h:document.querySelector("canvas").height})',
  ).then((s) => JSON.parse(s as unknown as string));
  check('el lienzo tiene el tamano de salida', dims.w === 1280 && dims.h === 720, `${dims.w}x${dims.h}`);

  // Prueba de fondo: el compositor dibujo de verdad, no dejo el lienzo vacio.
  const pixeles = JSON.parse(await ev<string>(client, `
    (() => {
      const c = document.querySelector('canvas');
      const g = c.getContext('2d');
      const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
      return JSON.stringify({
        esquina: px(6, 6),
        centro: px(c.width / 2, c.height / 2),
        bajoVentana: px(c.width / 2, c.height - 8),
      });
    })()
  `));
  const suma = (p: number[]) => p[0]! + p[1]! + p[2]!;
  check('el fondo esta pintado', suma(pixeles.esquina) > 30, `rgb(${pixeles.esquina.slice(0, 3)})`);
  check('hay contenido en el centro', suma(pixeles.centro) > 0, `rgb(${pixeles.centro.slice(0, 3)})`);
  check('fondo y contenido difieren', suma(pixeles.esquina) !== suma(pixeles.centro));

  const tramos = await ev<number>(client, 'document.querySelectorAll(".tramo").length');
  check('la linea de tiempo muestra los tramos de zoom', tramos > 0, `${tramos} tramos`);

  const calidad = await ev<string>(client, 'document.querySelector(".nota-calidad")?.textContent ?? ""');
  check('el indicador de calidad esta presente', /zoom nitido/i.test(calidad), calidad.trim());

  await capturar(client, 'apps/desktop/captura-editor.png');

  // --- interaccion: mover la aguja repinta con otra camara -------------------
  const antes = await ev<string>(client, FIRMA);
  // Se pincha el riel con el raton, no se fuerza el valor de un control: desde
  // que la linea de tiempo es un componente propio, el scrubbing depende de la
  // logica de punteros y forzar un valor no la ejercitaria.
  const riel = JSON.parse(await ev<string>(client, `
    (() => { const r = document.querySelector('.pista').getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }); })()
  `)) as { x: number; y: number; w: number; h: number };
  const yRiel = Math.round(riel.y + riel.h - 4);   // por debajo de los tramos
  const xRiel = Math.round(riel.x + riel.w * 0.62);
  await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: xRiel, y: yRiel, button: 'left', clickCount: 1 });
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: xRiel, y: yRiel, button: 'left', clickCount: 1 });
  await sleep(1200);
  const despues = await ev<string>(client, FIRMA);
  check('mover la linea de tiempo repinta', antes !== despues, `${antes} -> ${despues}`);

  // --- interaccion: cambiar el fondo ----------------------------------------
  // Se elige una muestra distinta de la que este activa. Pulsar la que ya esta
  // seleccionada no repinta nada y la comprobacion pasaria o fallaria segun el
  // estado con el que viniera la grabacion, no segun el codigo.
  const activa = await ev<number>(client,
    '[...document.querySelectorAll(".muestra")].findIndex(b => b.classList.contains("on"))');
  const objetivo = activa === 2 ? 0 : 2;
  const antesFondo = await ev<string>(client, FIRMA);
  await ev(client, `document.querySelectorAll(".muestra")[${objetivo}].click()`);
  await sleep(900);
  const despuesFondo = await ev<string>(client, FIRMA);
  check('cambiar el fondo repinta', antesFondo !== despuesFondo,
    `muestra ${activa} -> ${objetivo}`);

  await capturar(client, 'apps/desktop/captura-malla.png');

  // --- linea de tiempo editable ---------------------------------------------
  await verificarTimeline(client);

  // --- looks -----------------------------------------------------------------
  // El ciclo entero: guardar el aspecto, cambiarlo, y recuperarlo. Se compara
  // por pixeles del lienzo, no por el estado de un boton: un look que se guarda
  // pero no se aplica seria peor que no tenerlo.
  await ev(client, "window.prompt = () => 'verificacion';");
  const antesLook = await ev<string>(client, FIRMA_DENSA);
  await ev(client,
    "[...document.querySelectorAll('button')].find(b => b.textContent === 'Guardar este look').click()");
  await sleep(700);
  check('el look aparece en la lista',
    await esperarA(client,
      "[...document.querySelectorAll('.look button')].some(b => b.textContent === 'verificacion')",
      'look guardado', 6000));

  // Cambiar el fondo a otro cualquiera y comprobar que el lienzo cambia.
  const otraMuestra = await ev<number>(client,
    '[...document.querySelectorAll(".muestra")].findIndex(b => !b.classList.contains("on"))');
  await ev(client, `document.querySelectorAll(".muestra")[${otraMuestra}].click()`);
  await sleep(800);
  const conOtroFondo = await ev<string>(client, FIRMA_DENSA);
  check('cambiar el fondo cambia el lienzo', conOtroFondo !== antesLook);

  await ev(client,
    "[...document.querySelectorAll('.look button')].find(b => b.textContent === 'verificacion').click()");
  await sleep(900);
  const trasAplicar = await ev<string>(client, FIRMA_DENSA);
  check('aplicar el look devuelve el aspecto guardado', trasAplicar === antesLook,
    `${conOtroFondo} -> ${trasAplicar}`);

  // Los looks se guardan en los ajustes REALES del usuario, asi que hay que
  // quitarlo: verificar no puede dejarle basura en su propia configuracion, del
  // mismo modo que se restaura `project.json` al terminar.
  await ev(client, `
    (async () => {
      const a = await window.vitrina.ajustes();
      await window.vitrina.guardarAjustes({
        looks: a.looks.filter((l) => l.nombre !== 'verificacion'),
        lookPorDefecto: a.lookPorDefecto === 'verificacion' ? null : a.lookPorDefecto,
      });
    })()
  `);

  // --- deshacer --------------------------------------------------------------
  // Se comprueba el EFECTO, no que el boton se active: borrar un tramo y que
  // vuelva el mismo numero es lo unico que demuestra que el historial guarda el
  // proyecto y no una referencia al mismo objeto mutado.
  const tramosAntes = await ev<number>(client, 'document.querySelectorAll(".tramo").length');
  await ev(client, `
    (() => {
      const t = document.querySelector('.tramo');
      const r = t.getBoundingClientRect();
      t.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 1,
      }));
      t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    })()
  `);
  await sleep(400);
  await ev(client,
    "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Borrar zoom').click()");
  await sleep(400);
  const tramosTrasBorrar = await ev<number>(client, 'document.querySelectorAll(".tramo").length');
  check('borrar quita un tramo', tramosTrasBorrar === tramosAntes - 1,
    `${tramosAntes} -> ${tramosTrasBorrar}`);

  await ev(client,
    "[...document.querySelectorAll('button')].find(b => b.textContent === 'Deshacer').click()");
  await sleep(500);
  const tramosTrasDeshacer = await ev<number>(client, 'document.querySelectorAll(".tramo").length');
  check('deshacer lo devuelve', tramosTrasDeshacer === tramosAntes,
    `${tramosTrasBorrar} -> ${tramosTrasDeshacer}`);

  // --- anotaciones -----------------------------------------------------------
  // Son la ventaja de capturar desde el DOM. Se comprueba que el interruptor
  // llegue al lienzo, no solo que el boton se ponga en 'on'.
  // La aguja tiene que estar JUSTO despues de un click con texto: el rotulo dura
  // poco mas de un segundo, y comparando en cualquier otro instante las dos
  // firmas salen iguales y el test falla sin que nada este roto. Paso.
  const eventos = JSON.parse(await fsp.readFile(path.join(grabacion, 'events.json'), 'utf8')) as
    { t: number; type: string; label?: string | null }[];
  const manif = JSON.parse(await fsp.readFile(path.join(grabacion, 'manifest.json'), 'utf8')) as
    { startedAt: number; durationMs: number };
  const conTexto = eventos.find((e) => e.type === 'down' && (e.label ?? '').length > 0);

  if (!conTexto) {
    console.log('  (la grabacion de prueba no tiene clicks con texto)');
  } else {
    const enRotulo = conTexto.t - manif.startedAt + 250;
    const riel2 = JSON.parse(await ev<string>(client, `
      (() => { const r = document.querySelector('.pista').getBoundingClientRect();
        return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }); })()
    `)) as { x: number; y: number; w: number; h: number };
    const xr = Math.round(riel2.x + riel2.w * (enRotulo / manif.durationMs));
    const yr = Math.round(riel2.y + riel2.h - 4);
    await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: xr, y: yr, button: 'left', clickCount: 1 });
    await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: xr, y: yr, button: 'left', clickCount: 1 });
    await sleep(1200);

    const conRotulos = await ev<string>(client, FIRMA_DENSA);
    await ev(client,
      "[...document.querySelectorAll('button')].find(x => x.textContent === 'Rótulos').click()");
    await sleep(900);
    const sinRotulos = await ev<string>(client, FIRMA_DENSA);
    check('los rotulos llegan al lienzo', conRotulos !== sinRotulos,
      `"${conTexto.label}" en ${Math.round(enRotulo)}ms`);
    await ev(client,
      "[...document.querySelectorAll('button')].find(x => x.textContent === 'Rótulos').click()");
    await sleep(600);
  }

  // --- ritmo: acelerar las esperas -------------------------------------------
  // El material sigue entero (no es un corte), asi que lo que tiene que cambiar
  // es la DURACION de salida, no el numero de tramos de zoom.
  const antesRitmo = await ev<string>(client, `
    (() => {
      const b = [...document.querySelectorAll('button')].find(x => /Acelerar [0-9]+ espera/.test(x.textContent));
      return b ? b.textContent : 'sin esperas';
    })()
  `);
  if (antesRitmo === 'sin esperas') {
    console.log('  (la grabacion de prueba no tiene esperas que acelerar)');
  } else {
    await ev(client,
      "[...document.querySelectorAll('button')].find(x => /Acelerar [0-9]+ espera/.test(x.textContent)).click()");
    check('acelerar esperas deja tramos marcados en la linea de tiempo',
      await esperarA(client, '!!document.querySelector(".veloz")', 'tramos acelerados', 8000),
      antesRitmo.trim());
    check('y se puede volver a tiempo real',
      await esperarA(client, `
        (() => {
          const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Volver a la velocidad normal');
          if (b) { b.click(); return false; }
          return !document.querySelector('.veloz');
        })()
      `, 'vuelta a tiempo real', 8000));
  }

  // --- exportar desde la interfaz -------------------------------------------
  // El modulo de exportacion tiene sus propios tests; lo que se comprueba aqui
  // es el cableado IPC entre el boton y ffmpeg, que es justo donde han salido
  // los fallos de esta app (CSP, origen file://, host del esquema propio).
  const destino = path.join(grabacion, 'export-720p.mp4');
  await fsp.rm(destino, { force: true });
  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Exportar').click()
  `);
  await sleep(2500);
  check('la exportacion informa del progreso',
    await ev<boolean>(client, '!!document.querySelector(".barra")'));

  const limite = Date.now() + 180_000;
  let listo = false;
  while (Date.now() < limite && !listo) {
    await sleep(2000);
    listo = await ev<boolean>(client,
      '[...document.querySelectorAll("button")].some(b => b.textContent === "Mostrar en la carpeta")');
  }
  check('la exportacion termina', listo);
  check('el fichero exportado existe',
    await fsp.stat(destino).then((s) => s.size > 10_000).catch(() => false));

  // --- la guia escrita ------------------------------------------------------
  // Sale del mismo log que el video, asi que se comprueba en la misma sesion:
  // que se escriba el fichero y que tenga pasos de verdad, no una plantilla.
  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Exportar guía escrita')?.click()
  `);
  const guiaLista = await esperarA(client,
    'document.body.textContent.includes("Guía escrita ·")', 'guia escrita', 90_000);
  check('la guia se escribe desde el editor', guiaLista);

  const guiaMd = await fsp.readFile(path.join(grabacion, 'guia.md'), 'utf8').catch(() => '');
  check('guia.md tiene pasos', /^## 1\. /m.test(guiaMd), `${guiaMd.length} caracteres`);
  check('capitulos.txt empieza en 0:00',
    (await fsp.readFile(path.join(grabacion, 'capitulos.txt'), 'utf8')
      .catch(() => '')).startsWith('0:00 '));

  // Este bloque va el ULTIMO a proposito: deja el editor abierto en OTRA
  // grabacion. Puesto antes, el resto de comprobaciones miraban un lienzo
  // distinto y la exportacion escribia en la carpeta que este bloque acababa de
  // borrar. Cuatro fallos en cascada y ninguno donde estaba el problema.
  // --- repetir la grabacion ---------------------------------------------------
  // La dolencia que ataca: un fallo obliga a repetirlo todo Y se pierde lo
  // editado. Lo que se comprueba es que la repeticion aterrice en los MISMOS
  // elementos, no que salgan frames: un video de la pagina quieta tambien
  // tendria frames.
  const salidasApp = path.join(os.homedir(), 'Videos', 'Vitrina');
  const antesRepetir = new Set(await listar(salidasApp));
  const tramosPrevios = await ev<number>(client, 'document.querySelectorAll(".tramo").length');

  await ev(client,
    "[...document.querySelectorAll('button')].find(b => b.textContent === 'Repetir esta grabación').click()");
  const repetida = await esperarA(client,
    "!!document.querySelector('canvas') && !document.body.textContent.includes('Repitiendo')",
    'repeticion terminada', 180_000);
  check('repetir termina y deja el editor abierto', repetida);

  const nuevas = (await listar(salidasApp)).filter((n) => !antesRepetir.has(n));
  const carpetaNueva = nuevas[0] ? path.join(salidasApp, nuevas[0]) : null;
  if (!carpetaNueva) {
    check('la repeticion creo una grabacion nueva', false);
  } else {
    const etiquetasDe = async (dir: string) => {
      const evs = JSON.parse(await fsp.readFile(path.join(dir, 'events.json'), 'utf8')) as
        { type: string; label?: string | null }[];
      return evs.filter((e) => e.type === 'down').map((e) => e.label ?? '?').join(' | ');
    };
    const orig = await etiquetasDe(grabacion);
    const rep = await etiquetasDe(carpetaNueva);
    check('la repeticion pulsa los mismos elementos', orig === rep && orig.length > 0,
      `${orig}  ->  ${rep}`);

    const tramosNuevos = await ev<number>(client, 'document.querySelectorAll(".tramo").length');
    check('y conserva la edicion', tramosNuevos === tramosPrevios,
      `${tramosPrevios} -> ${tramosNuevos}`);

    // La original no se toca: repetir no puede destruir lo que ya tenias.
    check('la grabacion original sigue ahi',
      await fsp.stat(path.join(grabacion, 'manifest.json')).then(() => true).catch(() => false));

    await fsp.rm(carpetaNueva, { recursive: true, force: true }).catch(() => {});
  }


  await client.close();
  child.kill();
  await sleep(500);
  await fsp.writeFile(projectPath, projectOriginal);

  console.log(`\n  ${fallos === 0 ? 'TODO OK' : fallos + ' comprobaciones fallaron'}`);
  console.log('  capturas: apps/desktop/captura-editor.png, captura-malla.png\n');
  process.exit(fallos === 0 ? 0 : 1);
}

/**
 * Comprueba que la linea de tiempo se puede editar de verdad.
 *
 * Se conduce con `Input.dispatchMouseEvent`, que Chromium convierte en eventos
 * de puntero reales —incluida la captura—, asi que ejercita el mismo camino que
 * un raton. Disparar eventos sinteticos de React desde la pagina no valdria:
 * comprobaria que los manejadores existen, no que el gesto funciona.
 */
async function verificarTimeline(client: Cliente): Promise<void> {
  const pista = JSON.parse(await ev<string>(client, `
    (() => { const r = document.querySelector('.pista').getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }); })()
  `)) as { x: number; y: number; w: number; h: number };
  // La altura sale del CARRIL de video, no del centro de la pista. Con la pista
  // de una sola linea daba igual; ahora abarca tres carriles y su centro cae en
  // el de ritmo, asi que los clicks pasaban de largo de los tramos y fallaban
  // ocho comprobaciones a la vez. Derivarlo del carril vale para cualquier
  // distribucion futura.
  const carril = JSON.parse(await ev<string>(client, `
    (() => { const c = document.querySelector('.carril.video') || document.querySelector('.pista');
      const r = c.getBoundingClientRect();
      return JSON.stringify({ y: r.y, h: r.height }); })()
  `)) as { y: number; h: number };
  const medioY = Math.round(carril.y + carril.h / 2);
  void pista;

  const arrastrar = async (desdeX: number, hastaX: number, y = medioY) => {
    await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: desdeX, y, button: 'left', clickCount: 1 });
    const pasos = 8;
    for (let i = 1; i <= pasos; i++) {
      await client.Input.dispatchMouseEvent({
        type: 'mouseMoved', x: Math.round(desdeX + ((hastaX - desdeX) * i) / pasos), y, button: 'left',
      });
      await sleep(35);
    }
    await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: hastaX, y, button: 'left', clickCount: 1 });
    await sleep(250);
  };

  const tramoRect = async (i: number) => JSON.parse(await ev<string>(client, `
    (() => { const t = document.querySelectorAll('.tramo')[${i}];
      if (!t) return 'null';
      const r = t.getBoundingClientRect();
      return JSON.stringify({ x: r.x, w: r.width }); })()
  `)) as { x: number; w: number } | null;

  const antes = (await tramoRect(0))!;
  const centro = Math.round(antes.x + antes.w / 2);

  // Seleccionar
  await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: centro, y: medioY, button: 'left', clickCount: 1 });
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: centro, y: medioY, button: 'left', clickCount: 1 });
  await sleep(400);
  check('pinchar un tramo lo selecciona',
    await ev<boolean>(client, '!!document.querySelector(".tramo.sel")'));
  check('el panel muestra los controles del tramo',
    await ev<boolean>(client, '[...document.querySelectorAll("button")].some(b => b.textContent.includes("Borrar zoom"))'));

  // Mover
  await arrastrar(centro, centro + 70);
  const movido = (await tramoRect(0))!;
  check('arrastrar el cuerpo mueve el tramo', movido.x > antes.x + 20,
    `x ${antes.x.toFixed(0)} -> ${movido.x.toFixed(0)}`);
  check('conserva la duracion al moverlo', Math.abs(movido.w - antes.w) < 4,
    `ancho ${antes.w.toFixed(0)} -> ${movido.w.toFixed(0)}`);
  check('el tramo movido se marca como manual',
    await ev<boolean>(client, '!!document.querySelector(".tramo.manual")'));

  // Redimensionar por el borde derecho
  await arrastrar(Math.round(movido.x + movido.w - 2), Math.round(movido.x + movido.w + 60));
  const estirado = (await tramoRect(0))!;
  check('arrastrar el borde cambia la duracion', estirado.w > movido.w + 20,
    `ancho ${movido.w.toFixed(0)} -> ${estirado.w.toFixed(0)}`);

  await capturar(client, 'apps/desktop/captura-timeline.png');

  // Anadir y borrar. La aguja tiene que estar en un hueco: dentro de un tramo
  // no cabe otro, y el boton se desactiva. Se busca el hueco mas ancho que haya
  // quedado tras las ediciones anteriores en vez de suponer uno.
  const hueco = JSON.parse(await ev<string>(client, `
    (() => {
      const p = document.querySelector('.pista').getBoundingClientRect();
      const t = [...document.querySelectorAll('.tramo')]
        .map(e => e.getBoundingClientRect()).sort((a, b) => a.x - b.x);
      let mejor = { x: p.x, w: 0 }, cursor = p.x;
      for (const r of [...t, { x: p.right, width: 0 }]) {
        if (r.x - cursor > mejor.w) mejor = { x: cursor, w: r.x - cursor };
        cursor = Math.max(cursor, r.x + r.width);
      }
      return JSON.stringify(mejor);
    })()
  `)) as { x: number; w: number };
  const xHueco = Math.round(hueco.x + hueco.w / 2);
  await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: xHueco, y: medioY, button: 'left', clickCount: 1 });
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: xHueco, y: medioY, button: 'left', clickCount: 1 });
  await sleep(400);
  check('el hueco encontrado admite un tramo', hueco.w > 20, `${hueco.w.toFixed(0)}px`);

  const n0 = await ev<number>(client, 'document.querySelectorAll(".tramo").length');
  await ev(client, '[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Añadir zoom").click()');
  await sleep(400);
  const n1 = await ev<number>(client, 'document.querySelectorAll(".tramo").length');
  check('anadir crea un tramo nuevo', n1 === n0 + 1, `${n0} -> ${n1}`);

  await ev(client, '[...document.querySelectorAll("button")].find(b => b.textContent.includes("Borrar zoom")).click()');
  await sleep(400);
  check('borrar quita el tramo',
    await ev<number>(client, 'document.querySelectorAll(".tramo").length') === n0,
    `vuelve a ${n0}`);

  // --- reencuadre arrastrando sobre el lienzo -------------------------------
  // Pinchar el tramo deja la aguja dentro, que es la condicion para reencuadrar.
  const tramoActual = (await tramoRect(0))!;
  const dentro = Math.round(tramoActual.x + tramoActual.w / 2);
  await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: dentro, y: medioY, button: 'left', clickCount: 1 });
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: dentro, y: medioY, button: 'left', clickCount: 1 });
  await sleep(700);

  check('el lienzo se marca como reencuadrable',
    await ev<boolean>(client, '!!document.querySelector("canvas.encuadrable")'));

  const lienzo = JSON.parse(await ev<string>(client, `
    (() => { const r = document.querySelector('canvas').getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }); })()
  `)) as { x: number; y: number; w: number; h: number };
  const cx = Math.round(lienzo.x + lienzo.w / 2);
  const cy = Math.round(lienzo.y + lienzo.h / 2);

  // Se comprueba el DATO, no los pixeles: dos encuadres distintos pueden dar
  // la misma firma si la zona movida era uniforme, y entonces el test fallaria
  // sin que nada este roto.
  const centroDe = async (): Promise<number> => {
    const p = JSON.parse(await fsp.readFile(path.join(grabacion, 'project.json'), 'utf8')) as
      { zooms: { target: { x: number; w: number } }[] };
    const t = p.zooms[0]?.target;
    return t ? t.x + t.w / 2 : NaN;
  };
  await sleep(900);                       // el guardado va con retardo
  const antesEncuadre = await centroDe();
  await arrastrar(cx, cx - 200, cy);
  await sleep(900);
  const despuesEncuadre = await centroDe();
  check('arrastrar la imagen mueve el encuadre',
    Math.abs(despuesEncuadre - antesEncuadre) > 5,
    `centro ${antesEncuadre.toFixed(0)} -> ${despuesEncuadre.toFixed(0)}`);

  // Recorte
  await arrastrar(Math.round(pista.x + 2), Math.round(pista.x + pista.w * 0.15));
  check('arrastrar el asa de recorte lo aplica',
    await ev<boolean>(client, '[...document.querySelectorAll("button")].some(b => b.textContent === "Quitar el recorte")'));
  await ev(client, '[...document.querySelectorAll("button")].find(b => b.textContent === "Quitar el recorte").click()');
  await sleep(300);

  // Volver al automatico
  check('se ofrece volver al zoom automatico',
    await ev<boolean>(client, '[...document.querySelectorAll("button")].some(b => b.textContent.includes("automático"))'));
  await ev(client, '[...document.querySelectorAll("button")].find(b => b.textContent.includes("automático")).click()');
  await sleep(500);
  check('replanificar borra las marcas manuales',
    !(await ev<boolean>(client, '!!document.querySelector(".tramo.manual")')));
}

/**
 * Verifica el flujo principal: grabar desde la app y aterrizar en el editor.
 *
 * Es distinto de abrir una grabacion existente porque ejercita el grabador, la
 * planificacion automatica al parar y el paso a la vista de edicion. Se graba
 * el fixture local para no depender de que haya un servidor de desarrollo.
 */
async function verificarGrabacion(): Promise<void> {
  const fixture = pathToFileURL(path.resolve('spikes/stress.html')).href;
  const salidas = path.join(os.homedir(), 'Videos', 'Vitrina');
  const antes = new Set(await listar(salidas));

  console.log(`  grabando   ${fixture}\n`);
  // Dispositivo de audio falso de Chromium: genera un tono sintetico y concede
  // el permiso solo. Sin esto la comprobacion del microfono depende de que la
  // maquina tenga uno, y esta no lo tiene: fallaba con "Requested device not
  // found" y parecia un fallo de la app.
  const child = spawn(ELECTRON, [
    APP,
    `--remote-debugging-port=${PORT}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  const client = (await CDP({ port: PORT, target: await esperarPagina() })) as unknown as Cliente;
  await Promise.all([client.Page.enable(), client.Runtime.enable()]);
  await sleep(2000);

  await ev(client, `
    (() => {
      const i = document.querySelector('#url');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        .call(i, ${JSON.stringify(fixture)});
      i.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('button')].find(b => b.textContent === 'Grabar').click();
    })()
  `);

  check('la app entro en modo grabacion',
    await esperarA(client, '!!document.querySelector(".pulso")', 'estado grabando'));

  // Sin interaccion no hay zoom, y con razon: el motor de camara encuadra
  // clicks. Hay que pulsar de verdad dentro de la pagina grabada, no solo
  // dejar correr el tiempo. Vitrina expone ese navegador en el puerto 9222.
  await interactuarConLoGrabado();
  await sleep(1500);

  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Parar y editar')?.click()
  `);

  check('parar lleva al editor',
    await esperarA(client, '!!document.querySelector("canvas")', 'editor abierto'));

  // --- audio ---------------------------------------------------------------
  const nuevas = (await listar(salidas)).filter((n) => !antes.has(n));
  const carpeta = nuevas[0] ? path.join(salidas, nuevas[0]) : null;
  if (!carpeta) {
    check('se creo la carpeta de grabacion', false);
  } else {
    const manifest = JSON.parse(
      await fsp.readFile(path.join(carpeta, 'manifest.json'), 'utf8'),
    ) as { startedAt: number; audio?: { file: string; startedAt: number } | null };

    check('el manifest registra la pista de audio', !!manifest.audio,
      manifest.audio ? manifest.audio.file : 'sin audio');

    const wav = await fsp.stat(path.join(carpeta, 'mic.webm')).catch(() => null);
    check('mic.webm tiene contenido', (wav?.size ?? 0) > 1000, `${wav?.size ?? 0} bytes`);

    if (manifest.audio) {
      // El audio tiene que arrancar ANTES que el video: si llegara despues
      // faltaria narracion al principio y eso no se puede inventar.
      const adelanto = manifest.startedAt - manifest.audio.startedAt;
      check('el audio arranco antes que el video', adelanto > 0, `${adelanto} ms de adelanto`);
    }

    // Que el manifest anote la pista no significa que se pueda reproducir: la
    // carga la gobierna `media-src` de la CSP y el esquema propio, y los dos
    // han fallado ya en este proyecto dejando el elemento mudo sin avisar.
    // Se comprueba que el navegador PUEDE decodificarla, no su duracion: el
    // WebM que produce MediaRecorder no lleva duracion en la cabecera porque es
    // un flujo en vivo, y el elemento reporta `Infinity`. Exigir `duration > 0`
    // media una propiedad que el formato no tiene.
    check('el editor puede cargar la narracion',
      await esperarA(client,
        '(() => { const a = document.querySelector("audio"); return !!a && a.readyState >= 1 && !a.error; })()',
        'audio decodificable', 12_000));

    check('el editor muestra que hay narracion',
      await esperarA(client, 'document.body.textContent.includes("Narración grabada")',
        'panel de audio', 8000));
  }
  const tramos = await ev<number>(client, 'document.querySelectorAll(".tramo").length');
  check('el zoom se planifico solo al parar', tramos > 0, `${tramos} tramos`);
  // Decodificar el primer frame tarda; esperar a que el lienzo deje de estar en
  // negro es mas fiable que calibrar una pausa.
  const pintado = await esperarA(client, `(${FIRMA}) !== '0'`, 'primer frame pintado', 15_000);
  check('el preview pinta la grabacion nueva', pintado,
    `firma ${await ev<string>(client, FIRMA)}`);

  await capturar(client, 'apps/desktop/captura-grabacion.png');

  await client.close();
  child.kill();
  await sleep(800);

  // Se borra la grabacion de prueba: verificar no deberia dejar basura en la
  // carpeta de videos del usuario.
  for (const nombre of await listar(salidas)) {
    if (antes.has(nombre)) continue;
    await fsp.rm(path.join(salidas, nombre), { recursive: true, force: true }).catch(() => {});
    console.log(`  limpiado   ${nombre}`);
  }

  console.log(`\n  ${fallos === 0 ? 'TODO OK' : fallos + ' comprobaciones fallaron'}`);
  console.log('  captura: apps/desktop/captura-grabacion.png\n');
  process.exit(fallos === 0 ? 0 : 1);
}

/**
 * Verifica regrabar desde un punto.
 *
 * Lo que se comprueba es lo unico que puede fallar sin dar la cara: que la
 * CABEZA aterrizo en los mismos elementos. Contar frames no probaria nada —una
 * regrabacion que empezara en blanco tendria frames igual—; que se pulsaran los
 * mismos botones en el mismo orden dice que la app quedo donde tenia que
 * quedar.
 */
async function verificarRegrabar(): Promise<void> {
  const salidas = path.join(os.homedir(), 'Videos', 'Vitrina');
  const antes = new Set(await listar(salidas));
  const DESDE_MS = 5000;

  const viejo = JSON.parse(
    await fsp.readFile(path.join(grabacion, 'events.json'), 'utf8')) as
    { t: number; type: string; label?: string | null }[];
  const viejoManifest = JSON.parse(
    await fsp.readFile(path.join(grabacion, 'manifest.json'), 'utf8')) as
    { startedAt: number; durationMs: number };
  const cabezaVieja = viejo
    .filter((e) => e.type === 'down' && e.t - viejoManifest.startedAt < DESDE_MS)
    .map((e) => e.label ?? '(sin texto)');

  console.log(`  regrabando ${grabacion} desde ${(DESDE_MS / 1000).toFixed(1)}s\n`);
  const child = spawn(ELECTRON, [
    APP, grabacion,
    `--remote-debugging-port=${PORT}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  const client = (await CDP({ port: PORT, target: await esperarPagina() })) as unknown as Cliente;
  await Promise.all([client.Page.enable(), client.Runtime.enable()]);
  await sleep(2500);

  /*
   * La aguja al instante del relevo. Es imprescindible: el boton regraba desde
   * DONDE ESTE LA AGUJA, y sin moverla se regraba desde cero —cabeza vacia— y
   * la comprobacion siguiente miente sin decir por que.
   */
  const duracion = viejoManifest.durationMs;
  const pista = JSON.parse(await ev<string>(client, `
    (() => { const r = document.querySelector('.pista').getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }); })()
  `)) as { x: number; y: number; w: number; h: number };
  const xRelevo = Math.round(pista.x + pista.w * (DESDE_MS / duracion));
  const yPista = Math.round(pista.y + pista.h / 2);
  await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: xRelevo, y: yPista, button: 'left', clickCount: 1 });
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: xRelevo, y: yPista, button: 'left', clickCount: 1 });
  await sleep(500);

  const rotulo = await ev<string>(client, `
    ([...document.querySelectorAll('button')].find(b => /^Regrabar desde/.test(b.textContent))?.textContent ?? '')
  `);
  check('el boton apunta al instante de la aguja', /Regrabar desde [45]\.\d/.test(rotulo), rotulo);

  await ev(client, `
    [...document.querySelectorAll('button')].find(b => /^Regrabar desde/.test(b.textContent))?.click()
  `);

  check('la app avisa de que esta repitiendo la parte buena',
    await esperarA(client,
      'document.body.textContent.includes("repitiendo la parte buena")', 'cabeza en marcha'));

  // El relevo: el aviso desaparece cuando el control vuelve a la persona.
  check('el control vuelve a la persona',
    await esperarA(client,
      '!document.body.textContent.includes("repitiendo la parte buena")'
      + ' && !!document.querySelector(".pulso")',
      'relevo', 60_000));

  // Un par de clicks de cola, para que la toma nueva tenga algo propio.
  await interactuarConLoGrabado();
  await sleep(1000);

  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Parar y editar')?.click()
  `);
  check('parar lleva al editor',
    await esperarA(client, '!!document.querySelector("canvas")', 'editor abierto', 60_000));

  const nuevas = (await listar(salidas)).filter((n) => !antes.has(n));
  const carpeta = nuevas[0] ? path.join(salidas, nuevas[0]) : null;
  if (!carpeta) {
    check('se creo la carpeta de la regrabacion', false);
  } else {
    const m = JSON.parse(
      await fsp.readFile(path.join(carpeta, 'manifest.json'), 'utf8')) as
      { startedAt: number; frames: unknown[] };
    const evs = JSON.parse(
      await fsp.readFile(path.join(carpeta, 'events.json'), 'utf8')) as
      { t: number; type: string; label?: string | null }[];

    check('la toma nueva tiene material', m.frames.length > 20, `${m.frames.length} frames`);

    const cabezaNueva = evs
      .filter((e) => e.type === 'down' && e.t - m.startedAt < DESDE_MS)
      .map((e) => e.label ?? '(sin texto)');
    const iguales = cabezaVieja.length === cabezaNueva.length
      && cabezaVieja.every((l, i) => l === cabezaNueva[i]);
    check('la cabeza pulso los mismos elementos', iguales,
      `${cabezaVieja.join(' | ')} -> ${cabezaNueva.join(' | ')}`);

    const cola = evs.filter((e) => e.type === 'down' && e.t - m.startedAt >= DESDE_MS);
    check('y la cola trae lo que se hizo despues', cola.length > 0, `${cola.length} clicks`);

    check('la grabacion original sigue intacta',
      await fsp.stat(path.join(grabacion, 'manifest.json')).then(() => true).catch(() => false));
  }

  await capturar(client, 'apps/desktop/captura-regrabar.png');
  await client.close();
  child.kill();
  await sleep(800);

  for (const nombre of await listar(salidas)) {
    if (antes.has(nombre)) continue;
    await fsp.rm(path.join(salidas, nombre), { recursive: true, force: true }).catch(() => {});
    console.log(`  limpiado   ${nombre}`);
  }

  console.log(`\n  ${fallos === 0 ? 'TODO OK' : fallos + ' comprobaciones fallaron'}`);
  console.log('  captura: apps/desktop/captura-regrabar.png\n');
  process.exit(fallos === 0 ? 0 : 1);
}

/**
 * Verifica el doblaje de la voz.
 *
 * Se comprueba lo que queda en disco —el fichero de voz con contenido y el
 * proyecto apuntando a el— y, sobre todo, el DESFASE: es lo unico que puede
 * salir mal sin dar la cara, porque un doblaje corrido dos segundos suena
 * perfecto en el editor y mal en el video.
 */
async function verificarDoblaje(): Promise<void> {
  console.log(`  doblando   ${grabacion}\n`);
  await fsp.rm(path.join(grabacion, 'voz.webm'), { force: true }).catch(() => {});

  const child = spawn(ELECTRON, [
    APP, grabacion,
    `--remote-debugging-port=${PORT}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  const client = (await CDP({ port: PORT, target: await esperarPagina() })) as unknown as Cliente;
  await Promise.all([client.Page.enable(), client.Runtime.enable()]);
  await sleep(2500);

  check('el editor ofrece doblar la voz',
    await ev<boolean>(client, 'document.body.textContent.includes("Doblar la voz")'));

  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Grabar mi voz')?.click()
  `);
  check('empieza a doblar y el video se reproduce',
    await esperarA(client, 'document.body.textContent.includes("Grabando tu voz")', 'doblando'));
  await sleep(3000);

  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Parar y guardar la voz')?.click()
  `);
  check('para de doblar',
    await esperarA(client,
      '[...document.querySelectorAll("button")].some(b => b.textContent === "Grabar mi voz")',
      'doblaje parado', 10_000));

  // El guardado del proyecto va con retardo: se espera a que aparezca en disco.
  let proyecto: { voz?: { file: string; desfaseMs: number } | null; pista?: string } = {};
  const limite = Date.now() + 15_000;
  while (Date.now() < limite && !proyecto.voz) {
    await sleep(700);
    proyecto = JSON.parse(await fsp.readFile(path.join(grabacion, 'project.json'), 'utf8')) as typeof proyecto;
  }

  check('el proyecto apunta a la voz', proyecto.voz?.file === 'voz.webm');
  check('y la elige para el video', proyecto.pista === 'voz', String(proyecto.pista));

  const webm = await fsp.stat(path.join(grabacion, 'voz.webm')).catch(() => null);
  check('voz.webm tiene contenido', (webm?.size ?? 0) > 1000, `${webm?.size ?? 0} bytes`);

  // El desfase tiene que ser NEGATIVO y pequeno: el micro arranca antes que la
  // reproduccion, y por poco. Positivo significaria que el video empezo antes y
  // la voz entraria tarde.
  const desfase = proyecto.voz?.desfaseMs ?? 1;
  check('el desfase es negativo y pequeno', desfase <= 0 && desfase > -2000, `${desfase} ms`);

  check('el editor deja elegir que se oye',
    await ev<boolean>(client, 'document.body.textContent.includes("Qué se oye en el vídeo")'));

  await capturar(client, 'apps/desktop/captura-doblaje.png');
  await client.close();
  child.kill();
  await sleep(800);

  console.log(`\n  ${fallos === 0 ? 'TODO OK' : fallos + ' comprobaciones fallaron'}`);
  console.log('  captura: apps/desktop/captura-doblaje.png\n');
  process.exit(fallos === 0 ? 0 : 1);
}

/**
 * Verifica la pausa y las marcas, de punta a punta.
 *
 * Lo que se comprueba es el RESULTADO, no que la app diga que pauso: que la
 * carpeta sale con un corte de la duracion de la pausa y que la marca aparece
 * como chincheta en la regla del timeline. Preguntarle a la interfaz si esta
 * pausada solo probaria que sabe pintar un boton.
 */
async function verificarPausa(): Promise<void> {
  const fixture = pathToFileURL(path.resolve('spikes/stress.html')).href;
  const salidas = path.join(os.homedir(), 'Videos', 'Vitrina');
  const antes = new Set(await listar(salidas));
  const PAUSA_MS = 1500;

  console.log(`  grabando con pausa   ${fixture}\n`);
  const child = spawn(ELECTRON, [
    APP,
    `--remote-debugging-port=${PORT}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  const client = (await CDP({ port: PORT, target: await esperarPagina() })) as unknown as Cliente;
  await Promise.all([client.Page.enable(), client.Runtime.enable()]);
  await sleep(2000);

  await ev(client, `
    (() => {
      const i = document.querySelector('#url');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        .call(i, ${JSON.stringify(fixture)});
      i.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('button')].find(b => b.textContent === 'Grabar').click();
    })()
  `);
  check('la app entro en modo grabacion',
    await esperarA(client, '!!document.querySelector(".pulso")', 'estado grabando'));

  await interactuarConLoGrabado();
  await sleep(600);

  // Una marca en mitad de la grabacion, por el boton: el atajo global es de
  // teclado del sistema y no se puede inyectar desde aqui.
  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Señalar momento')?.click()
  `);
  await sleep(400);

  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Pausar')?.click()
  `);
  check('la app dice que esta en pausa',
    await esperarA(client, 'document.body.textContent.includes("En pausa")', 'aviso de pausa'));
  await sleep(PAUSA_MS);
  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Reanudar')?.click()
  `);
  check('y vuelve a grabar',
    await esperarA(client, '!document.body.textContent.includes("En pausa")', 'sin aviso'));
  await sleep(1200);

  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Parar y editar')?.click()
  `);
  check('parar lleva al editor',
    await esperarA(client, '!!document.querySelector("canvas")', 'editor abierto'));

  const nuevas = (await listar(salidas)).filter((n) => !antes.has(n));
  const carpeta = nuevas[0] ? path.join(salidas, nuevas[0]) : null;
  if (!carpeta) {
    check('se creo la carpeta de grabacion', false);
  } else {
    const project = JSON.parse(
      await fsp.readFile(path.join(carpeta, 'project.json'), 'utf8'),
    ) as { cuts?: { startMs: number; endMs: number }[] };
    const cortes = project.cuts ?? [];
    check('la pausa quedo como un corte', cortes.length === 1, `${cortes.length} cortes`);

    if (cortes[0]) {
      const dura = cortes[0].endMs - cortes[0].startMs;
      check('el corte mide lo que duro la pausa',
        dura > PAUSA_MS - 500 && dura < PAUSA_MS + 900, `${dura} ms`);
    }

    const manifest = JSON.parse(
      await fsp.readFile(path.join(carpeta, 'manifest.json'), 'utf8'),
    ) as { startedAt: number; frames: { t: number }[] };
    if (cortes[0]) {
      // Lo que de verdad importa: durante la pausa no se capturo nada.
      const dentro = manifest.frames.filter((f) => {
        const off = f.t * 1000 - manifest.startedAt;
        return off > cortes[0]!.startMs + 300 && off < cortes[0]!.endMs - 300;
      });
      check('durante la pausa no llegaron frames', dentro.length === 0, `${dentro.length} frames`);
    }

    const eventos = JSON.parse(
      await fsp.readFile(path.join(carpeta, 'events.json'), 'utf8'),
    ) as { type: string }[];
    check('la marca quedo en el log',
      eventos.filter((e) => e.type === 'mark').length === 1);
  }

  check('la chincheta aparece en la regla',
    await ev<number>(client, 'document.querySelectorAll(".hito").length') === 1);

  await capturar(client, 'apps/desktop/captura-pausa.png');
  await client.close();
  child.kill();
  await sleep(800);

  for (const nombre of await listar(salidas)) {
    if (antes.has(nombre)) continue;
    await fsp.rm(path.join(salidas, nombre), { recursive: true, force: true }).catch(() => {});
    console.log(`  limpiado   ${nombre}`);
  }

  console.log(`\n  ${fallos === 0 ? 'TODO OK' : fallos + ' comprobaciones fallaron'}`);
  console.log('  captura: apps/desktop/captura-pausa.png\n');
  process.exit(fallos === 0 ? 0 : 1);
}

/**
 * Verifica la camara web de punta a punta.
 *
 * La maquina de desarrollo no tiene camara, asi que se usa el dispositivo falso
 * de Chromium —el mismo truco que ya hace posible comprobar el microfono—: da
 * un patron sintetico en movimiento y concede el permiso solo. Lo que queda sin
 * probar es el encuadre de una cara de verdad; todo lo demas —captura, fichero,
 * desfase, burbuja en el lienzo— se comprueba aqui.
 */
async function verificarCamara(): Promise<void> {
  const fixture = pathToFileURL(path.resolve('spikes/stress.html')).href;
  const salidas = path.join(os.homedir(), 'Videos', 'Vitrina');
  const antes = new Set(await listar(salidas));

  console.log(`  grabando con camara   ${fixture}\n`);
  const child = spawn(ELECTRON, [
    APP,
    `--remote-debugging-port=${PORT}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  const client = (await CDP({ port: PORT, target: await esperarPagina() })) as unknown as Cliente;
  await Promise.all([client.Page.enable(), client.Runtime.enable()]);
  await sleep(2000);

  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Con cámara')?.click()
  `);
  // Abrir la camara y pintar el primer frame tarda; sin esta espera se graba
  // antes de que el dispositivo este listo y la pista sale vacia.
  check('la previsualizacion de camara aparece',
    await esperarA(client, '!!document.querySelector(".camara-previa")', 'video de previa'));
  await sleep(1500);

  await ev(client, `
    (() => {
      const i = document.querySelector('#url');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        .call(i, ${JSON.stringify(fixture)});
      i.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('button')].find(b => b.textContent === 'Grabar').click();
    })()
  `);

  check('la app entro en modo grabacion',
    await esperarA(client, '!!document.querySelector(".pulso")', 'estado grabando'));

  await interactuarConLoGrabado();
  await sleep(1500);

  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Parar y editar')?.click()
  `);
  check('parar lleva al editor',
    await esperarA(client, '!!document.querySelector("canvas")', 'editor abierto'));

  const nuevas = (await listar(salidas)).filter((n) => !antes.has(n));
  const carpeta = nuevas[0] ? path.join(salidas, nuevas[0]) : null;
  if (!carpeta) {
    check('se creo la carpeta de grabacion', false);
  } else {
    const manifest = JSON.parse(
      await fsp.readFile(path.join(carpeta, 'manifest.json'), 'utf8'),
    ) as { startedAt: number; camara?: { file: string; startedAt: number; w: number; h: number } | null };

    check('el manifest registra la pista de camara', !!manifest.camara,
      manifest.camara ? `${manifest.camara.file} ${manifest.camara.w}x${manifest.camara.h}` : 'sin camara');

    const webm = await fsp.stat(path.join(carpeta, 'camara.webm')).catch(() => null);
    check('camara.webm tiene contenido', (webm?.size ?? 0) > 1000, `${webm?.size ?? 0} bytes`);

    if (manifest.camara) {
      const adelanto = manifest.startedAt - manifest.camara.startedAt;
      check('la camara arranco antes que el video', adelanto > 0, `${adelanto} ms de adelanto`);
    }

    // Que el manifest la anote no significa que se pueda dibujar: el elemento
    // de video pasa por el esquema propio y por la CSP, y los dos han dejado
    // ya una pista muda en este proyecto sin avisar.
    check('el editor puede decodificar la camara',
      await esperarA(client,
        '(() => { const v = document.querySelector("video"); return !!v && v.readyState >= 2 && !v.error; })()',
        'video decodificable', 15_000));

    check('el editor ofrece el panel de camara',
      await ev<boolean>(client, 'document.body.textContent.includes("Cámara web")'));

    // Y la prueba que importa: la burbuja esta EN EL LIENZO. Se compara la
    // region con y sin ella; el lienzo entero cambiaria igual, porque la pagina
    // grabada se mueve sola.
    await esperarA(client, `(${FIRMA}) !== '0'`, 'primer frame pintado', 15_000);
    await sleep(500);
    const conBurbuja = await ev<string>(client, FIRMA_BURBUJA);
    await ev(client, `
      [...document.querySelectorAll('button')].find(b => b.textContent === 'Quitar la cámara del vídeo')?.click()
    `);
    await sleep(600);
    const sinBurbuja = await ev<string>(client, FIRMA_BURBUJA);
    check('la burbuja se dibuja en el lienzo', conBurbuja !== sinBurbuja,
      `${conBurbuja} -> ${sinBurbuja}`);

    await ev(client, `
      [...document.querySelectorAll('button')].find(b => b.textContent === 'Poner la cámara en el vídeo')?.click()
    `);
    await sleep(600);
    check('se puede volver a ponerla',
      await ev<string>(client, FIRMA_BURBUJA) !== sinBurbuja);
  }

  await capturar(client, 'apps/desktop/captura-camara.png');
  await client.close();
  child.kill();
  await sleep(800);

  for (const nombre of await listar(salidas)) {
    if (antes.has(nombre)) continue;
    await fsp.rm(path.join(salidas, nombre), { recursive: true, force: true }).catch(() => {});
    console.log(`  limpiado   ${nombre}`);
  }

  console.log(`\n  ${fallos === 0 ? 'TODO OK' : fallos + ' comprobaciones fallaron'}`);
  console.log('  captura: apps/desktop/captura-camara.png\n');
  process.exit(fallos === 0 ? 0 : 1);
}

/**
 * Verifica la grabacion vertical de principio a fin.
 *
 * Es el flujo que pidio el encargo y el unico modo que lo cubre entero: elegir
 * vertical en la pantalla de inicio, grabar, aterrizar en un editor 9:16 con
 * marco de movil y exportar un mp4 1080x1920. Probado solo por partes quedaria
 * la duda de siempre —que cada pieza funcione y el conjunto no—, que es justo
 * lo que paso con la CSP y con el esquema propio.
 */
async function verificarVertical(): Promise<void> {
  const fixture = pathToFileURL(path.resolve('spikes/vertical.html')).href;
  const salidas = path.join(os.homedir(), 'Videos', 'Vitrina');
  const antes = new Set(await listar(salidas));

  // Lo que la app va a capturar, calculado igual que ella: el preset por
  // defecto de la pantalla de inicio, transpuesto.
  const esperado = paraOrientacion(
    CAPTURE_PRESETS.find((p) => p.name === 'equilibrado') ?? CAPTURE_PRESETS[1]!,
    'vertical',
  ).capture;

  const salida = defaultExportFor(esperado);

  console.log(`  grabando   ${fixture}`);
  console.log(`  esperado   captura ${esperado.w}x${esperado.h}`
    + `  salida ${salida.w}x${salida.h}\n`);

  const child = spawn(ELECTRON, [APP, `--remote-debugging-port=${PORT}`],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  const client = (await CDP({ port: PORT, target: await esperarPagina() })) as unknown as Cliente;
  await Promise.all([client.Page.enable(), client.Runtime.enable()]);
  await sleep(2000);

  // --- pantalla de inicio ---------------------------------------------------
  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('Vertical')).click()
  `);

  const ficha = await ev<string>(client, 'document.querySelector(".preset.on b").textContent');
  check('las fichas de calidad muestran la resolucion girada',
    ficha === `${esperado.w}×${esperado.h}`, ficha);

  const nota = await ev<string>(client, 'document.querySelector(".nota-calidad span").textContent');
  check('el indicador de calidad apunta a la salida vertical',
    nota.includes(`${salida.w}×${salida.h}`), nota);

  await ev(client, `
    (() => {
      const i = document.querySelector('#url');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        .call(i, ${JSON.stringify(fixture)});
      i.dispatchEvent(new Event('input', { bubbles: true }));
      // Sin microfono: aqui se verifica la forma del video, y el audio ya tiene
      // su propio modo de comprobacion.
      [...document.querySelectorAll('button')].find(b => b.textContent === 'Sin audio').click();
    })()
  `);
  // Grabar va en OTRA evaluacion a proposito: el manejador de Grabar cierra
  // sobre el estado de React, y pulsando los dos en el mismo tick todavia
  // arrastra el valor anterior y grabaria con microfono igualmente.
  await sleep(300);
  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Grabar').click()
  `);

  check('la app entro en modo grabacion',
    await esperarA(client, '!!document.querySelector(".pulso")', 'estado grabando'));

  await interactuarConLoGrabado(['#b2', '#b3', '#i1']);
  await sleep(1500);

  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Parar y editar')?.click()
  `);
  check('parar lleva al editor',
    await esperarA(client, '!!document.querySelector("canvas")', 'editor abierto'));

  // --- lo que quedo en disco ------------------------------------------------
  const nuevas = (await listar(salidas)).filter((n) => !antes.has(n));
  const carpeta = nuevas[0] ? path.join(salidas, nuevas[0]) : null;
  if (!carpeta) {
    check('se creo la carpeta de grabacion', false);
    process.exit(1);
  }

  const manifest = JSON.parse(await fsp.readFile(path.join(carpeta, 'manifest.json'), 'utf8')) as
    {
      viewport: { w: number; h: number };
      capture: { w: number; h: number } | null;
      deviceScaleFactor?: number;
    };
  const cap = manifest.capture ?? manifest.viewport;
  check('el material se capturo en vertical', cap.h > cap.w, `${cap.w}x${cap.h}`);
  check('la captura coincide con el preset de movil',
    cap.w === esperado.w && cap.h === esperado.h, `${cap.w}x${cap.h}`);

  // Lo que hace que la web muestre su diseno movil: la pagina se maqueta a un
  // ancho de telefono aunque los frames sean mucho mas grandes. Si un cambio
  // volviera a igualar viewport y frame, la vista de movil se perderia sin que
  // nada mas fallara.
  check('la pagina se maqueto como un movil',
    manifest.viewport.w <= 430, `${manifest.viewport.w} px css`);
  check('y aun asi se capturo a resolucion de publicar',
    cap.w >= manifest.viewport.w * 2,
    `${manifest.viewport.w} css -> ${cap.w} px, escala ${manifest.deviceScaleFactor ?? 1}`);

  const proyecto = JSON.parse(await fsp.readFile(path.join(carpeta, 'project.json'), 'utf8')) as
    { frame: FrameStyle; export: { width: number; height: number } };
  check('el proyecto abre en 9:16',
    proyecto.export.width === salida.w && proyecto.export.height === salida.h,
    `${proyecto.export.width}x${proyecto.export.height}`);
  // La regla que evita que el video salga blando. Se comprueba el MARGEN, no el
  // ancho: con `nitido` la salida (1080) es mas ancha que la captura (978) y
  // aun asi no amplia. Comparar anchos pasaria aqui por casualidad y fallaria
  // con otro preset.
  const margen = computeQualityBudget(cap, proyecto.export, proyecto.frame);
  check('la salida deja margen de zoom, no amplia en reposo',
    margen.sharpAtRest && margen.maxSharpZoom >= 1.15,
    `${margen.maxSharpZoom.toFixed(2)}x`);
  check('el proyecto trae marco de movil', proyecto.frame.chrome === 'phone', proyecto.frame.chrome);

  // --- lo que se ve en el editor --------------------------------------------
  const lienzo = JSON.parse(await ev<string>(client,
    'JSON.stringify({ w: document.querySelector("canvas").width, h: document.querySelector("canvas").height })',
  )) as { w: number; h: number };
  check('el lienzo del editor es vertical', lienzo.h > lienzo.w, `${lienzo.w}x${lienzo.h}`);

  // Que el lienzo QUEPA, no solo que exista. `.editor` era un grid sin
  // `grid-template-rows`, asi que la fila implicita crecia con el contenido: un
  // lienzo 9:16 estiraba la fila muy por debajo de la ventana y `overflow:
  // hidden` se comia el transporte y la linea de tiempo. Con 16:9 cabia por los
  // pelos y no se veia. Ninguna prueba de pixeles del compositor lo habria
  // pillado: el fallo esta en el CSS del editor, no en lo que se dibuja.
  const caja = JSON.parse(await ev<string>(client, `
    (() => {
      const c = document.querySelector('canvas');
      const r = (el) => { const b = el.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height) }; };
      return JSON.stringify({
        lienzo: r(c), caja: r(c.parentElement),
        hayTransporte: !!document.querySelector('.transporte'),
        transporteVisible: (() => {
          const t = document.querySelector('.transporte');
          return !!t && t.getBoundingClientRect().bottom <= window.innerHeight + 1;
        })(),
      });
    })()
  `)) as { lienzo: { w: number; h: number }; caja: { w: number; h: number };
           hayTransporte: boolean; transporteVisible: boolean };
  check('el lienzo cabe en su caja',
    caja.lienzo.h <= caja.caja.h + 1 && caja.lienzo.w <= caja.caja.w + 1,
    `${caja.lienzo.w}x${caja.lienzo.h} en ${caja.caja.w}x${caja.caja.h}`);
  check('el transporte y la linea de tiempo siguen dentro de la ventana',
    caja.hayTransporte && caja.transporteVisible);

  check('el preview pinta la grabacion',
    await esperarA(client, `(${FIRMA}) !== '0'`, 'primer frame pintado', 20_000));

  // El marco se comprueba por pixeles y no por el estado de un boton: que el
  // proyecto DIGA 'phone' no prueba que el compositor lo dibuje.
  const l = layoutFrame(cap, proyecto.export, proyecto.frame);
  const muestras = JSON.parse(await ev<string>(client, `
    (() => {
      const g = document.querySelector('canvas').getContext('2d');
      const p = (x, y) => { const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data;
                            return [d[0], d[1], d[2]]; };
      const cy = ${l.window.y + l.window.h / 2};
      return JSON.stringify({
        esquina:  p(${l.window.x + 6}, ${l.window.y + 6}),
        bisel:    p(${l.window.x + 5}, cy),
        biselDer: p(${l.window.x + l.window.w - 5}, cy),
        arriba:   p(${l.window.x + l.window.w / 2}, ${l.window.y + 4}),
        abajo:    p(${l.window.x + l.window.w / 2}, ${l.window.y + l.window.h - 4}),
        muesca:   p(${notchRect(l.content).x + notchRect(l.content).w / 2},
                    ${notchRect(l.content).y + notchRect(l.content).h * 0.5}),
        juntoAMuesca: p(${l.content.x + 10},
                    ${notchRect(l.content).y + notchRect(l.content).h * 0.5}),
        app:      [0, 1, 2, 3, 4].map(i => p(${l.content.x + 8}, cy + (i - 2) * 40))
      });
    })()
  `)) as { [k: string]: number[] } & { app: number[][] };

  const oscuro = (c: number[]) => Math.max(c[0]!, c[1]!, c[2]!) < 80;
  const claro = (c: number[]) => Math.min(c[0]!, c[1]!, c[2]!) > 170;

  check('el marco rodea el contenido por los lados',
    oscuro(muestras.bisel!) && oscuro(muestras.biselDer!),
    JSON.stringify([muestras.bisel, muestras.biselDer]));
  check('y tambien por arriba y por abajo',
    oscuro(muestras.arriba!) && oscuro(muestras.abajo!),
    JSON.stringify([muestras.arriba, muestras.abajo]));
  check('la carcasa tiene esquinas de movil: el fondo asoma por fuera',
    !oscuro(muestras.esquina!) && !claro(muestras.esquina!), JSON.stringify(muestras.esquina));
  check('la muesca cuelga dentro de la pantalla',
    oscuro(muestras.muesca!), JSON.stringify(muestras.muesca));
  // Lo que la distingue de una banda negra: la app se ve a su lado, a la misma
  // altura. Si ocupara todo el ancho, esto seria carcasa.
  check('la app se ve al lado de la muesca',
    claro(muestras.juntoAMuesca!), JSON.stringify(muestras.juntoAMuesca));
  const claros = muestras.app.filter(claro).length;
  check('la app se ve dentro del marco', claros >= 3, `${claros}/5 muestras claras`);

  // --- exportar -------------------------------------------------------------
  // Se comprueba por el titulo, que lleva las dimensiones, en vez de por el
  // nombre: cual sea el preset correcto depende del ancho capturado.
  const preseleccion = await ev<string>(client, `
    (() => {
      const b = [...document.querySelectorAll('button')].find(x => x.classList.contains('on')
        && /\\d+×\\d+/.test(x.title || ''));
      return b ? b.title : 'ninguno';
    })()
  `);
  check('el export arranca en el preset que corresponde',
    preseleccion.startsWith(`${salida.w}×${salida.h}`), preseleccion);

  const nombre = await ev<string>(client,
    "[...document.querySelectorAll('button')].find(x => x.classList.contains('on')"
    + " && /\\d+×\\d+/.test(x.title || '')).textContent");
  const destino = path.join(carpeta, `export-${nombre}.mp4`);
  await ev(client, `
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Exportar').click()
  `);
  const listo = await esperarA(client,
    '[...document.querySelectorAll("button")].some(b => b.textContent === "Mostrar en la carpeta")',
    'exportacion terminada', 240_000);
  check('la exportacion termina', listo);

  const dimensiones = await medirVideo(destino);
  check(`el mp4 sale en ${salida.w}x${salida.h}`,
    dimensiones === `${salida.w},${salida.h}`, dimensiones);

  // Sin bandas: el contenido tiene que llenar el encuadre salvo el margen del
  // marco. Es el criterio de aceptacion del encargo.
  const ocupacion = (l.content.h / proyecto.export.height) * 100;
  check('el contenido llena el encuadre', ocupacion > 75, `${ocupacion.toFixed(0)}% del alto`);

  const tiro = await capturar(client, 'apps/desktop/captura-vertical.png');

  await conLimite(client.close(), 5000, 'cierre del cliente');
  child.kill();
  await sleep(800);

  for (const nombre of await listar(salidas)) {
    if (antes.has(nombre)) continue;
    await fsp.rm(path.join(salidas, nombre), { recursive: true, force: true }).catch(() => {});
    console.log(`  limpiado   ${nombre}`);
  }

  console.log(`\n  ${fallos === 0 ? 'TODO OK' : fallos + ' comprobaciones fallaron'}`);
  console.log(tiro
    ? '  captura: apps/desktop/captura-vertical.png\n'
    : '  (sin captura: tras exportar, el compositor no entrega frame nuevo)\n');
  process.exit(fallos === 0 ? 0 : 1);
}

/** Ancho,alto reales del fichero, leidos con ffprobe. */
async function medirVideo(file: string): Promise<string> {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) return 'sin ffprobe';
  const ffprobe = path.join(path.dirname(ffmpeg), path.basename(ffmpeg).replace('ffmpeg', 'ffprobe'));
  const { stdout } = await ejecutar(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=,', file,
  ]);
  return stdout.trim();
}

/**
 * Inyecta clicks en el navegador que Vitrina abrio para grabar.
 *
 * Las coordenadas van en el viewport emulado, que es donde caen los botones del
 * fixture. El grabador escucha esos eventos desde el DOM, asi que un click
 * sintetico produce exactamente el mismo registro que uno humano.
 *
 * Con `selectores` las posiciones se preguntan a la pagina en vez de fijarlas a
 * mano: en vertical el viewport depende del preset y del equipo, asi que unas
 * coordenadas escritas a ojo pulsarian el vacio y la comprobacion diria "sin
 * zoom" sin que nada estuviera roto.
 */
async function interactuarConLoGrabado(selectores?: string[]): Promise<void> {
  interface Entrada {
    Input: {
      dispatchMouseEvent(p: {
        type: string; x: number; y: number; button?: string; clickCount?: number;
      }): Promise<void>;
    };
    Runtime: {
      enable(): Promise<void>;
      evaluate(p: { expression: string; returnByValue?: boolean }):
        Promise<{ result: { value?: unknown } }>;
    };
    close(): Promise<void>;
  }

  const lista = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as
    { type: string; id: string }[];
  const page = lista.find((t) => t.type === 'page');
  if (!page) throw new Error('El navegador de grabacion no expuso una pagina');

  const input = (await CDP({ port: 9222, target: page.id })) as unknown as Entrada;

  let puntos: { x: number; y: number }[];
  if (selectores) {
    await input.Runtime.enable();
    const { result } = await input.Runtime.evaluate({
      expression: `JSON.stringify(${JSON.stringify(selectores)}.map(sel => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }))`,
      returnByValue: true,
    });
    puntos = JSON.parse(String(result.value)) as { x: number; y: number }[];
  } else {
    puntos = [70, 190, 320].map((x) => ({ x, y: 232 }));
  }

  for (const { x, y } of puntos) {
    await input.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
    await sleep(120);
    await input.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
    await input.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(700);
  }
  await input.close();
}

async function listar(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir);
  } catch {
    return [];
  }
}

/**
 * Comprueba cortar silencios de punta a punta.
 *
 * Se fabrica una grabacion minima con una narracion que TIENE silencios: el
 * dispositivo de audio falso de Chromium genera un tono continuo, asi que la
 * grabacion real del otro modo nunca tendria nada que cortar y la comprobacion
 * pasaria sin comprobar nada.
 */
async function verificarSilencios(): Promise<void> {
  const ff = findFfmpeg();
  const root = path.resolve('grabaciones/silencios.vitrina');
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(path.join(root, 'frames'), { recursive: true });

  const T0 = Date.now() - 60_000;
  const DUR = 8000;

  // Frames: uno por cada 250 ms, suficiente para que el preview pinte.
  const frames: { file: string; t: number; bytes: number }[] = [];
  for (let i = 0; i < 32; i++) {
    const file = `${String(i + 1).padStart(6, '0')}.jpg`;
    await ejecutar(ff, ['-y', '-v', 'error', '-f', 'lavfi',
      '-i', `color=c=0x${(0x203040 + i * 0x030201).toString(16).padStart(6, '0')}:size=640x360`,
      '-frames:v', '1', path.join(root, 'frames', file)]);
    frames.push({ file, t: (T0 + i * 250) / 1000, bytes: 1000 });
  }

  // Narracion de 8 s con silencio entre el 2 y el 5.
  await ejecutar(ff, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=8',
    '-af', "volume=enable='between(t,2,5)':volume=0", '-c:a', 'libopus',
    path.join(root, 'mic.webm')]);

  await fsp.writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    version: 1, browser: 'test', url: 'http://localhost:3000',
    viewport: { w: 640, h: 360 }, capture: { w: 640, h: 360 }, quality: 80,
    startedAt: T0, durationMs: DUR, frames,
    audio: { file: 'mic.webm', startedAt: T0, mimeType: 'audio/webm;codecs=opus' },
  }));
  await fsp.writeFile(path.join(root, 'events.json'), '[]');
  await fsp.writeFile(path.join(root, 'project.json'), JSON.stringify({
    version: 1,
    background: { kind: 'solid', color: '#161a20' },
    frame: { fill: 0.8, radius: 8, shadow: 10, chrome: 'none', cursor: 'none' },
    zooms: [], trimStartMs: 0, trimEndMs: null,
    export: { width: 640, height: 360, fps: 20, format: 'mp4' },
  }));

  console.log(`  grabacion sintetica en ${root}
`);
  const child = spawn(ELECTRON, [APP, root, `--remote-debugging-port=${PORT}`],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  const client = (await CDP({ port: PORT, target: await esperarPagina() })) as unknown as Cliente;
  await Promise.all([client.Page.enable(), client.Runtime.enable()]);

  check('el editor abrio la grabacion',
    await esperarA(client, '!!document.querySelector("canvas")', 'editor'));
  check('detecta que hay narracion',
    await ev<boolean>(client, 'document.body.textContent.includes("Narración grabada")'));

  await ev(client,
    '[...document.querySelectorAll("button")].find(b => b.textContent.includes("Quitar los silencios")).click()');
  check('la deteccion termina',
    await esperarA(client, '!document.body.textContent.includes("Buscando silencios")',
      'fin de la deteccion', 30_000));

  const bandas = await ev<number>(client, 'document.querySelectorAll(".recorte.corte").length');
  check('el silencio aparece en la linea de tiempo', bandas === 1, `${bandas} bandas`);

  await sleep(900);   // guardado diferido
  const proyecto = JSON.parse(await fsp.readFile(path.join(root, 'project.json'), 'utf8')) as
    { cuts?: { startMs: number; endMs: number }[] };
  const corte = proyecto.cuts?.[0];
  check('el corte se guarda en el proyecto', !!corte,
    corte ? `${corte.startMs.toFixed(0)}–${corte.endMs.toFixed(0)}ms` : 'sin cortes');

  if (corte) {
    // Silencio real 2000–5000 con 150 ms de margen a cada lado.
    check('el corte cae donde esta el silencio, con margen',
      Math.abs(corte.startMs - 2150) < 250 && Math.abs(corte.endMs - 4850) < 250);
  }

  await capturar(client, 'apps/desktop/captura-silencios.png');

  await client.close();
  child.kill();
  await sleep(500);
  await fsp.rm(root, { recursive: true, force: true }).catch(() => {});

  console.log(`
  ${fallos === 0 ? 'TODO OK' : fallos + ' comprobaciones fallaron'}
`);
  process.exit(fallos === 0 ? 0 : 1);
}

const flujo = process.argv.includes('--silencios') ? verificarSilencios
  : process.argv.includes('--vertical') ? verificarVertical
  : process.argv.includes('--regrabar') ? verificarRegrabar
  : process.argv.includes('--doblar') ? verificarDoblaje
  : process.argv.includes('--pausa') ? verificarPausa
  : process.argv.includes('--camara') ? verificarCamara
  : process.argv.includes('--grabar') ? verificarGrabacion : main;
flujo().catch((e: unknown) => {
  console.error('FALLO:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
