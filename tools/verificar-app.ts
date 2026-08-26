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

const ejecutar = promisify(execFile);

const PORT = 9500;
const APP = path.resolve('apps/desktop');
const grabacion = path.resolve(process.argv[2] ?? 'grabaciones/demo.vitrina');
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

  await fsp.writeFile('apps/desktop/captura-editor.png',
    Buffer.from((await client.Page.captureScreenshot({ format: 'png' })).data, 'base64'));

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

  await fsp.writeFile('apps/desktop/captura-malla.png',
    Buffer.from((await client.Page.captureScreenshot({ format: 'png' })).data, 'base64'));

  // --- linea de tiempo editable ---------------------------------------------
  await verificarTimeline(client);

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
  const medioY = Math.round(pista.y + pista.h / 2);

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
    await ev<boolean>(client, '[...document.querySelectorAll("button")].some(b => b.textContent.includes("Borrar tramo"))'));

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

  await fsp.writeFile('apps/desktop/captura-timeline.png',
    Buffer.from((await client.Page.captureScreenshot({ format: 'png' })).data, 'base64'));

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
  await ev(client, '[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Anadir tramo aqui").click()');
  await sleep(400);
  const n1 = await ev<number>(client, 'document.querySelectorAll(".tramo").length');
  check('anadir crea un tramo nuevo', n1 === n0 + 1, `${n0} -> ${n1}`);

  await ev(client, '[...document.querySelectorAll("button")].find(b => b.textContent.includes("Borrar tramo")).click()');
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
    await ev<boolean>(client, '[...document.querySelectorAll("button")].some(b => b.textContent === "Quitar recorte")'));
  await ev(client, '[...document.querySelectorAll("button")].find(b => b.textContent === "Quitar recorte").click()');
  await sleep(300);

  // Volver al automatico
  check('se ofrece volver al zoom automatico',
    await ev<boolean>(client, '[...document.querySelectorAll("button")].some(b => b.textContent.includes("automatico"))'));
  await ev(client, '[...document.querySelectorAll("button")].find(b => b.textContent.includes("automatico")).click()');
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
      await esperarA(client, 'document.body.textContent.includes("Narracion grabada")',
        'panel de audio', 8000));
  }
  const tramos = await ev<number>(client, 'document.querySelectorAll(".tramo").length');
  check('el zoom se planifico solo al parar', tramos > 0, `${tramos} tramos`);
  // Decodificar el primer frame tarda; esperar a que el lienzo deje de estar en
  // negro es mas fiable que calibrar una pausa.
  const pintado = await esperarA(client, `(${FIRMA}) !== '0'`, 'primer frame pintado', 15_000);
  check('el preview pinta la grabacion nueva', pintado,
    `firma ${await ev<string>(client, FIRMA)}`);

  await fsp.writeFile('apps/desktop/captura-grabacion.png',
    Buffer.from((await client.Page.captureScreenshot({ format: 'png' })).data, 'base64'));

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
 * Inyecta clicks en el navegador que Vitrina abrio para grabar.
 *
 * Las coordenadas van en el viewport emulado (1600x900), que es donde caen los
 * botones del fixture. El grabador escucha esos eventos desde el DOM, asi que
 * un click sintetico produce exactamente el mismo registro que uno humano.
 */
async function interactuarConLoGrabado(): Promise<void> {
  interface Entrada {
    Input: {
      dispatchMouseEvent(p: {
        type: string; x: number; y: number; button?: string; clickCount?: number;
      }): Promise<void>;
    };
    close(): Promise<void>;
  }

  const lista = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as
    { type: string; id: string }[];
  const page = lista.find((t) => t.type === 'page');
  if (!page) throw new Error('El navegador de grabacion no expuso una pagina');

  const input = (await CDP({ port: 9222, target: page.id })) as unknown as Entrada;
  for (const x of [70, 190, 320]) {
    await input.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y: 232 });
    await sleep(120);
    await input.Input.dispatchMouseEvent({ type: 'mousePressed', x, y: 232, button: 'left', clickCount: 1 });
    await sleep(60);
    await input.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y: 232, button: 'left', clickCount: 1 });
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
    await ev<boolean>(client, 'document.body.textContent.includes("Narracion grabada")'));

  await ev(client,
    '[...document.querySelectorAll("button")].find(b => b.textContent.includes("Cortar silencios")).click()');
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

  await fsp.writeFile('apps/desktop/captura-silencios.png',
    Buffer.from((await client.Page.captureScreenshot({ format: 'png' })).data, 'base64'));

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
  : process.argv.includes('--grabar') ? verificarGrabacion : main;
flujo().catch((e: unknown) => {
  console.error('FALLO:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
