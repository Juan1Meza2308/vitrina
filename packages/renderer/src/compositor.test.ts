/**
 * Tests del compositor.
 *
 * Renderizan de verdad con `@napi-rs/canvas` y comprueban pixeles concretos.
 * Un compositor es codigo visual y la tentacion es no probarlo, pero las cosas
 * que se rompen en silencio —el recorte que anula la sombra, el `srcRect` que
 * se sale medio pixel, el cursor que no sigue al zoom— son justo las que un
 * test de pixeles atrapa y una revision a ojo deja pasar.
 */
import { describe, it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { layoutFrame, notchRect, viewRect } from '@vitrina/core';
import type { Project } from '@vitrina/core';
import { composite, sourceToOutput } from './compositor.ts';
import type { Ctx, ImageLike } from './types.ts';

const SOURCE = { w: 1600, h: 900 };
const FONDO = '#ff0000';
const CONTENIDO = '#00ff00';
const MARCA = '#0000ff';

function project(overrides: Partial<Project> = {}): Project {
  return {
    version: 1,
    background: { kind: 'solid', color: FONDO },
    frame: { fill: 0.8, radius: 0, shadow: 0, chrome: 'none', cursor: 'none' },
    zooms: [],
    trimStartMs: 0,
    trimEndMs: null,
    export: { width: 1280, height: 720, fps: 60, format: 'mp4' },
    ...overrides,
  };
}

/** Fuente sintetica: verde con un cuadro azul en la esquina superior izquierda. */
function makeSource() {
  const c = createCanvas(SOURCE.w, SOURCE.h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = CONTENIDO;
  ctx.fillRect(0, 0, SOURCE.w, SOURCE.h);
  ctx.fillStyle = MARCA;
  ctx.fillRect(0, 0, 200, 200);
  return c;
}

/** Imagen de fondo sintetica, de un color plano inconfundible. */
function makeFondo(color: string, w = 400, h = 400) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c;
}

function render(
  p: Project,
  camera = { cx: 800, cy: 450, scale: 1 },
  fondo?: ReturnType<typeof makeFondo>,
) {
  const canvas = createCanvas(p.export.width, p.export.height);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  composite({
    ctx,
    source: makeSource() as unknown as ImageLike,
    sourceSize: SOURCE,
    camera,
    project: p,
    backgroundImage: (fondo ?? null) as unknown as ImageLike | null,
  });
  const data = canvas.getContext('2d').getImageData(0, 0, p.export.width, p.export.height).data;
  return (x: number, y: number): [number, number, number] => {
    const i = (Math.round(y) * p.export.width + Math.round(x)) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
}

const esRojo = (p: [number, number, number]) => p[0] > 200 && p[1] < 60;
const esVerde = (p: [number, number, number]) => p[1] > 200 && p[0] < 60;
const esAzul = (p: [number, number, number]) => p[2] > 200 && p[0] < 60;

describe('composite', () => {
  it('pinta el fondo fuera de la ventana y el contenido dentro', () => {
    const p = project();
    const px = render(p);
    const l = layoutFrame(SOURCE, p.export, p.frame);

    expect(esRojo(px(4, 4))).toBe(true);                                  // esquina
    expect(esRojo(px(p.export.width / 2, 4))).toBe(true);                 // banda superior
    expect(esVerde(px(l.content.x + l.content.w / 2, l.content.y + l.content.h / 2))).toBe(true);
  });

  it('la ventana cae donde dice el layout, al pixel', () => {
    // Si compositor y layout se desincronizan, el presupuesto de calidad y el
    // indicador "zoom nitido hasta Nx" pasan a ser ficcion.
    const p = project();
    const px = render(p);
    const l = layoutFrame(SOURCE, p.export, p.frame);

    const myY = l.content.y + l.content.h / 2;   // por debajo de la marca azul
    expect(esRojo(px(l.content.x - 3, myY))).toBe(true);
    expect(esVerde(px(l.content.x + 3, myY))).toBe(true);
    expect(esVerde(px(l.content.x + l.content.w - 3, myY))).toBe(true);
    expect(esRojo(px(l.content.x + l.content.w + 3, myY))).toBe(true);
  });

  it('ampliar muestra la region correcta de la fuente', () => {
    // Camara centrada en el cuadro azul (0,0)-(200,200) y ampliada: el centro
    // de la ventana tiene que ser azul, no verde.
    const p = project();
    const px = render(p, { cx: 100, cy: 100, scale: 2 });
    const l = layoutFrame(SOURCE, p.export, p.frame);
    expect(esAzul(px(l.content.x + 12, l.content.y + 12))).toBe(true);
  });

  it('las esquinas redondeadas dejan ver el fondo', () => {
    const p = project();
    p.frame.radius = 40;
    const px = render(p);
    const l = layoutFrame(SOURCE, p.export, p.frame);
    // Justo en la esquina del rectangulo, fuera del arco.
    expect(esRojo(px(l.window.x + 2, l.window.y + 2))).toBe(true);
    expect(esRojo(px(l.window.x + l.window.w - 2, l.window.y + 2))).toBe(true);
    // Y en el centro sigue habiendo contenido.
    expect(esVerde(px(l.window.x + l.window.w / 2, l.window.y + l.window.h / 2))).toBe(true);
  });

  it('la sombra sobrevive al recorte redondeado', () => {
    // REGRESION: `clip()` anula `shadowBlur`, asi que la sombra hay que pintarla
    // en una pasada previa. Sin ella, este pixel seria fondo puro.
    const conSombra = project();
    conSombra.frame.shadow = 60;
    conSombra.frame.radius = 20;
    const px = render(conSombra);
    const l = layoutFrame(SOURCE, conSombra.export, conSombra.frame);

    const bajoLaVentana = px(l.window.x + l.window.w / 2, l.window.y + l.window.h + 12);
    const lejos = px(4, 4);
    expect(bajoLaVentana[0]).toBeLessThan(lejos[0] - 20);   // oscurecido por la sombra
  });

  it('sin sombra el fondo queda intacto justo bajo la ventana', () => {
    const p = project();
    const px = render(p);
    const l = layoutFrame(SOURCE, p.export, p.frame);
    expect(esRojo(px(l.window.x + l.window.w / 2, l.window.y + l.window.h + 12))).toBe(true);
  });

  it('la barra sintetica ocupa la franja superior de la ventana', () => {
    const p = project();
    p.frame.chrome = 'macos';
    p.frame.chromeLabel = 'localhost';
    const px = render(p);
    const l = layoutFrame(SOURCE, p.export, p.frame);

    expect(esVerde(px(l.window.x + l.window.w / 2, l.window.y + l.barH / 2))).toBe(false);
    expect(esVerde(px(l.content.x + l.content.w / 2, l.content.y + 20))).toBe(true);
  });
});

describe('fondo de imagen', () => {
  const conImagen = (blur = 0): Project => {
    const p = project();
    p.background = { kind: 'image', path: 'fondo.png', blur };
    return p;
  };

  it('pinta la imagen en vez del color de respaldo', () => {
    const px = render(conImagen(), undefined, makeFondo('#ff00ff'));
    const [r, g, b] = px(6, 6);
    expect(r).toBeGreaterThan(200);
    expect(b).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
  });

  it('sin imagen cae a un color solido en vez de dejarlo transparente', () => {
    // Un fondo declarado como imagen que aun no cargo no puede producir un
    // frame agujereado: el export saldria con zonas transparentes.
    const px = render(conImagen());
    const [r, g, b] = px(6, 6);
    expect(r + g + b).toBeGreaterThan(20);
  });

  it('cubre el lienzo entero aunque la imagen sea cuadrada', () => {
    // 400x400 en un lienzo 16:9: sin recorte por el lado largo quedarian
    // franjas a los lados.
    const p = conImagen();
    const px = render(p, undefined, makeFondo('#ff00ff'));
    for (const [x, y] of [[4, 4], [1275, 4], [4, 715], [1275, 715]] as const) {
      const [r, , b] = px(x, y);
      expect(r > 200 && b > 200).toBe(true);
    }
  });

  it('el desenfoque no deja orla clara en los bordes', () => {
    // `filter: blur` difumina contra el exterior del dibujo, asi que la imagen
    // se pinta mas grande que el lienzo a proposito.
    const px = render(conImagen(20), undefined, makeFondo('#ff00ff'));
    const borde = px(2, 360);
    const centro = px(640, 2);
    expect(Math.abs(borde[0] - centro[0])).toBeLessThan(40);
    expect(borde[0]).toBeGreaterThan(180);
  });
});

describe('sourceToOutput', () => {
  const p = project();
  const l = layoutFrame(SOURCE, p.export, p.frame);
  const view = viewRect({ cx: 800, cy: 450, scale: 1 }, SOURCE);

  it('mapea las esquinas de la vista a las del contenido', () => {
    const tl = sourceToOutput({ x: view.x, y: view.y }, view, l.content)!;
    expect(tl.x).toBeCloseTo(l.content.x, 6);
    expect(tl.y).toBeCloseTo(l.content.y, 6);

    const br = sourceToOutput({ x: view.x + view.w, y: view.y + view.h }, view, l.content)!;
    expect(br.x).toBeCloseTo(l.content.x + l.content.w, 6);
    expect(br.y).toBeCloseTo(l.content.y + l.content.h, 6);
  });

  it('el cursor se mueve mas en pantalla cuando hay zoom', () => {
    // Con la camara ampliada, el mismo desplazamiento en la fuente recorre mas
    // pixeles de salida. Si no fuera asi, el cursor sintetico se despegaria de
    // lo que esta senalando.
    const zoom = viewRect({ cx: 800, cy: 450, scale: 2 }, SOURCE);
    const a = sourceToOutput({ x: 800, y: 450 }, zoom, l.content)!;
    const b = sourceToOutput({ x: 900, y: 450 }, zoom, l.content)!;
    const sinZoom = Math.abs(
      sourceToOutput({ x: 900, y: 450 }, view, l.content)!.x
      - sourceToOutput({ x: 800, y: 450 }, view, l.content)!.x,
    );
    expect(Math.abs(b.x - a.x)).toBeCloseTo(sinZoom * 2, 4);
  });

  it('devuelve null fuera del encuadre', () => {
    const zoom = viewRect({ cx: 400, cy: 300, scale: 2.5 }, SOURCE);
    expect(sourceToOutput({ x: 1550, y: 860 }, zoom, l.content)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('composite con marco de movil', () => {
  const V = { w: 1080, h: 1920 };
  const SALIDA_V = { width: 1080, height: 1920, fps: 60, format: 'mp4' as const };

  function fuenteV() {
    const c = createCanvas(V.w, V.h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = CONTENIDO;
    ctx.fillRect(0, 0, V.w, V.h);
    return c;
  }

  function renderV(frame: Partial<Project['frame']> = {}) {
    const p: Project = {
      ...project(),
      frame: { fill: 0.8, radius: 14, shadow: 0, chrome: 'phone', cursor: 'none', ...frame },
      export: SALIDA_V,
    };
    const canvas = createCanvas(p.export.width, p.export.height);
    const ctx = canvas.getContext('2d') as unknown as Ctx;
    composite({
      ctx,
      source: fuenteV() as unknown as ImageLike,
      sourceSize: V,
      camera: { cx: V.w / 2, cy: V.h / 2, scale: 1 },
      project: p,
    });
    const data = canvas.getContext('2d').getImageData(0, 0, p.export.width, p.export.height).data;
    const px = (x: number, y: number): [number, number, number] => {
      const i = (Math.round(y) * p.export.width + Math.round(x)) * 4;
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    };
    return { p, px, l: layoutFrame(V, p.export, p.frame) };
  }

  // Oscuro: cuerpo o filo del marco. El filo es un blanco al 22% sobre negro y
  // no llega a gris medio, asi que sigue distinguiendose del fondo rojo y de la
  // app verde sin tener que saber en cual de los dos se cayo el pixel.
  const esCarcasa = (c: [number, number, number]) => c[0] < 90 && c[1] < 90 && c[2] < 100;

  it('el contenido llena el encuadre salvo el margen del marco', () => {
    // Es el criterio de la funcionalidad: en 9:16 no puede haber bandas de
    // fondo grandes arriba y abajo, que es justo lo que pasaba componiendo
    // material apaisado en un lienzo vertical.
    const { l } = renderV();
    expect(l.content.h / 1920).toBeGreaterThan(0.75);
    expect(l.content.w / 1080).toBeGreaterThan(0.75);
  });

  it('deja carcasa entre el borde de la ventana y la pantalla', () => {
    const { px, l } = renderV();
    const my = l.window.y + l.window.h / 2;
    expect(esRojo(px(l.window.x - 4, my))).toBe(true);          // fondo fuera
    expect(esCarcasa(px(l.window.x + 4, my))).toBe(true);        // bisel
    expect(esVerde(px(l.content.x + 4, my))).toBe(true);         // pantalla
    expect(esCarcasa(px(l.window.x + l.window.w - 4, my))).toBe(true);
    expect(esRojo(px(l.window.x + l.window.w + 4, my))).toBe(true);
  });

  it('tambien por arriba y por abajo, no solo a los lados', () => {
    // La diferencia con una barra de navegador: el marco rodea, no corona.
    const { px, l } = renderV();
    const mx = l.window.x + l.window.w / 2;
    expect(esCarcasa(px(mx, l.window.y + 3))).toBe(true);
    expect(esCarcasa(px(mx, l.window.y + l.window.h - 3))).toBe(true);
    expect(esRojo(px(mx, l.window.y - 4))).toBe(true);
    expect(esRojo(px(mx, l.window.y + l.window.h + 4))).toBe(true);
  });

  it('dibuja la muesca colgando dentro de la pantalla', () => {
    // Va DESPUES del video: en un telefono real la muesca se come pantalla.
    const { px, l } = renderV();
    const n = notchRect(l.content);
    expect(esCarcasa(px(n.x + n.w / 2, n.y + n.h * 0.5))).toBe(true);
    // Y por debajo de la muesca vuelve a haber app.
    expect(esVerde(px(n.x + n.w / 2, n.y + n.h + 8))).toBe(true);
  });

  it('la app se ve a los dos lados de la muesca', () => {
    // Es lo que distingue una muesca de una banda negra, y por eso no ocupa mas
    // de la mitad del ancho.
    const { px, l } = renderV();
    const n = notchRect(l.content);
    const y = n.y + n.h * 0.5;
    expect(n.w).toBeLessThan(l.content.w * 0.5);
    expect(esVerde(px(l.content.x + 10, y))).toBe(true);
    expect(esVerde(px(l.content.x + l.content.w - 10, y))).toBe(true);
  });

  it('el bisel superior es tan fino como los laterales', () => {
    // Antes la muesca tenia banda propia y el marco se veia pesado por arriba.
    const { l } = renderV();
    expect(l.insets.top).toBe(l.insets.left);
  });

  it('redondea la pantalla concentricamente dentro de la carcasa', () => {
    // Las dos esquinas —cuerpo y pantalla— comparten centro, que es lo que hace
    // que el bisel se vea de grosor constante en la curva. Entre los dos arcos
    // tiene que haber marco: si la pantalla no estuviera recortada, ahi asomaria
    // el video por fuera de la carcasa.
    const { px, l } = renderV();
    const cx = l.content.x + l.contentRadius;
    const cy = l.content.y + l.contentRadius;
    const medio = (l.contentRadius + l.radius) / 2;
    const d = medio / Math.SQRT2;
    expect(esCarcasa(px(cx - d, cy - d))).toBe(true);

    // Y por dentro del arco interior, la app.
    const dentro = (l.contentRadius * 0.6) / Math.SQRT2;
    expect(esVerde(px(cx - dentro, cy - dentro))).toBe(true);
    expect(esVerde(px(l.content.x + l.content.w / 2, l.content.y + l.content.h / 2))).toBe(true);
  });

  it('el fondo se ve en las esquinas del cuerpo redondeado', () => {
    const { px, l } = renderV();
    expect(esRojo(px(l.window.x + 2, l.window.y + 2))).toBe(true);
  });
});
