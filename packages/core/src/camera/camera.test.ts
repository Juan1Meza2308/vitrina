/**
 * Tests del motor de camara.
 *
 * Los de `planSegments` fijan las DECISIONES (que se encuadra, cuando).
 * Los de `buildCameraTrack` fijan las INVARIANTES del movimiento: son las que
 * permiten tocar las constantes de `config.ts` buscando un feel distinto sin
 * romper el producto sin enterarse.
 */
import { describe, it, expect } from 'vitest';
import type { CaptureSize, InputEvent, Rect } from '../types.ts';
import { planSegments } from './segments.ts';
import { buildCameraTrack, CursorPath, SUAVIZADO_CURSOR_MS } from './track.ts';
import { viewRect } from './geometry.ts';
import { CAMERA_PRESETS, cameraConfigForBudget, type CameraConfig } from './config.ts';

const T0 = 1_700_000_000_000;
const VIEWPORT: CaptureSize = { w: 1600, h: 900 };
const CFG = CAMERA_PRESETS.normal;

const BOTON: Rect = { x: 120, y: 200, w: 160, h: 44 };
const CAMPO: Rect = { x: 140, y: 300, w: 240, h: 40 };
const LEJOS: Rect = { x: 1380, y: 700, w: 160, h: 44 };

function click(atMs: number, rect: Rect, label = 'Cotizar'): InputEvent[] {
  const x = rect.x + rect.w / 2;
  const y = rect.y + rect.h / 2;
  return [
    { t: T0 + atMs, type: 'down', x, y, rect, tag: 'BUTTON', label },
    { t: T0 + atMs + 60, type: 'up', x, y, rect, tag: 'BUTTON', label },
  ];
}
const move = (atMs: number, x: number, y: number): InputEvent =>
  ({ t: T0 + atMs, type: 'move', x, y });
const key = (atMs: number): InputEvent => ({ t: T0 + atMs, type: 'key', key: 'char' });
const wheel = (atMs: number, dy: number): InputEvent =>
  ({ t: T0 + atMs, type: 'wheel', x: 800, y: 450, dy });

function plan(events: InputEvent[], durationMs = 10_000, config: CameraConfig = CFG) {
  return planSegments({ events, viewport: VIEWPORT, startedAt: T0, durationMs, config });
}

// ---------------------------------------------------------------------------

describe('planSegments · que se encuadra', () => {
  it('un click produce un tramo que contiene el elemento pulsado', () => {
    const segs = plan(click(2000, BOTON));
    expect(segs).toHaveLength(1);
    const t = segs[0]!.target;
    expect(t.x).toBeLessThanOrEqual(BOTON.x);
    expect(t.y).toBeLessThanOrEqual(BOTON.y);
    expect(t.x + t.w).toBeGreaterThanOrEqual(BOTON.x + BOTON.w);
    expect(t.y + t.h).toBeGreaterThanOrEqual(BOTON.y + BOTON.h);
    expect(segs[0]!.auto).toBe(true);
  });

  it('empieza a ampliar antes del click, no despues', () => {
    // Si el zoom llega tras el click, el espectador ya vio el resultado.
    const segs = plan(click(2000, BOTON));
    expect(segs[0]!.startMs).toBe(2000 - CFG.leadInMs);
  });

  it('un elemento que ocupa casi toda la pantalla no genera tramo', () => {
    const enorme: Rect = { x: 20, y: 20, w: 1540, h: 850 };
    expect(plan(click(2000, enorme))).toHaveLength(0);
  });

  it('un click sin caja de elemento usa una caja por defecto', () => {
    // Pasa en canvas y SVG, donde el objetivo no tiene rect util.
    const events: InputEvent[] = [
      { t: T0 + 2000, type: 'down', x: 800, y: 450, rect: null, tag: 'CANVAS' },
    ];
    const segs = plan(events);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.scale).toBeGreaterThan(1);
  });

  it('respeta el techo de ampliacion del presupuesto de calidad', () => {
    // Un boton pequeno "pide" mucho zoom; el presupuesto manda.
    const cfg = cameraConfigForBudget(CFG, 1.3);
    const segs = plan(click(2000, BOTON), 10_000, cfg);
    expect(segs[0]!.scale).toBeLessThanOrEqual(1.3 + 1e-6);
  });
});

describe('planSegments · agrupacion', () => {
  it('rellenar un formulario es UN tramo, no uno por campo', () => {
    const segs = plan([
      ...click(1000, CAMPO, 'Nombre'),
      ...click(1600, CAMPO, 'Nombre'),
      ...click(2200, { ...CAMPO, y: 360 }, 'Email'),
    ]);
    expect(segs).toHaveLength(1);
  });

  it('clicks separados por mas del idle producen tramos distintos', () => {
    const segs = plan([...click(1000, BOTON), ...click(6000, BOTON)]);
    expect(segs).toHaveLength(2);
  });

  it('REGRESION yo-yo: dos tramos a 900ms se fusionan en vez de alejarse y volver', () => {
    // El hold de 900ms hace que el primer tramo acabe en 1960 y el segundo
    // empiece en 2100: 140ms de hueco. Alejar y volver a ampliar en ese tiempo
    // se ve como un tic.
    const segs = plan([...click(1000, BOTON), ...click(2500, { ...BOTON, y: 260 })]);
    expect(segs).toHaveLength(1);
  });

  it('dos zonas alejadas no se fusionan en una vista que no las contiene', () => {
    // Fusionarlas obligaria a una escala por debajo del minimo util, y el
    // encuadre resultante no contendria su propio objetivo.
    const segs = plan([...click(1000, BOTON), ...click(2500, LEJOS)]);
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) {
      const fits = Math.min(VIEWPORT.w / s.target.w, VIEWPORT.h / s.target.h);
      expect(fits).toBeGreaterThanOrEqual(CFG.minScale - 1e-6);
    }
  });

  it('escribir mantiene la ampliacion viva sin generar clicks', () => {
    const sinEscribir = plan(click(1000, CAMPO));
    const escribiendo = plan([
      ...click(1000, CAMPO),
      key(1500), key(1900), key(2300), key(2700),
    ]);
    expect(escribiendo[0]!.endMs).toBeGreaterThan(sinEscribir[0]!.endMs);
  });
});

describe('planSegments · guardas anti-mareo', () => {
  it('el scroll rapido corta la ampliacion', () => {
    const conScroll = plan([
      ...click(1000, BOTON),
      ...Array.from({ length: 12 }, (_, i) => wheel(1500 + i * 40, 300)),
    ]);
    const sinScroll = plan(click(1000, BOTON));
    const finConScroll = conScroll.length ? conScroll[0]!.endMs : 0;
    expect(finConScroll).toBeLessThan(sinScroll[0]!.endMs);
  });

  it('un scroll suave NO corta la ampliacion', () => {
    // Leer despacio mientras se mira un panel ampliado es legitimo.
    const segs = plan([
      ...click(1000, BOTON),
      wheel(1500, 20), wheel(1900, 20), wheel(2300, 20),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.endMs).toBeGreaterThan(1900);
  });

  it('descarta tramos demasiado cortos para percibirse', () => {
    const cfg: CameraConfig = { ...CFG, minDurationMs: 5000 };
    expect(plan(click(1000, BOTON), 10_000, cfg)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

function track(events: InputEvent[], durationMs = 8000, config: CameraConfig = CFG) {
  const segments = planSegments({ events, viewport: VIEWPORT, startedAt: T0, durationMs, config });
  return {
    segments,
    track: buildCameraTrack({ events, segments, viewport: VIEWPORT, startedAt: T0, durationMs, config }),
  };
}

describe('buildCameraTrack · movimiento', () => {
  it('arranca centrado y sin ampliar', () => {
    const { track: tr } = track(click(3000, BOTON));
    const s = tr.sampleAt(0);
    expect(s.scale).toBeCloseTo(1, 3);
    expect(s.cx).toBeCloseTo(VIEWPORT.w / 2, 3);
    expect(s.cy).toBeCloseTo(VIEWPORT.h / 2, 3);
  });

  it('alcanza la ampliacion del tramo dentro del tiempo de asentamiento', () => {
    const { segments, track: tr } = track(click(3000, BOTON));
    const seg = segments[0]!;
    const s = tr.sampleAt(seg.startMs + CFG.settleMs + 200);
    expect(s.scale).toBeGreaterThan(seg.scale * 0.9);
  });

  it('vuelve a 1x despues del tramo', () => {
    const { segments, track: tr } = track(click(2000, BOTON));
    const s = tr.sampleAt(segments[0]!.endMs + CFG.settleMs + 500);
    expect(s.scale).toBeCloseTo(1, 2);
  });

  it('sin eventos se queda quieto', () => {
    const { track: tr } = track([]);
    for (const t of [0, 1000, 4000, 8000]) {
      expect(tr.sampleAt(t).scale).toBeCloseTo(1, 4);
    }
  });
});

describe('buildCameraTrack · invariantes', () => {
  const events = [
    move(500, 200, 300),
    ...click(1000, BOTON),
    ...click(2400, CAMPO),
    move(3000, 1500, 850),
    ...click(4000, LEJOS),
    ...Array.from({ length: 10 }, (_, i) => wheel(5000 + i * 40, 400)),
    ...click(6200, BOTON),
  ];

  it('la vista nunca se sale del material grabado', () => {
    // Si esto falla, el export sale con bordes negros en el rebote del muelle.
    const { track: tr } = track(events);
    for (let t = 0; t <= 8000; t += 1000 / 60) {
      const v = viewRect(tr.sampleAt(t), VIEWPORT);
      expect(v.x).toBeGreaterThanOrEqual(-1e-3);
      expect(v.y).toBeGreaterThanOrEqual(-1e-3);
      expect(v.x + v.w).toBeLessThanOrEqual(VIEWPORT.w + 1e-3);
      expect(v.y + v.h).toBeLessThanOrEqual(VIEWPORT.h + 1e-3);
    }
  });

  it('la escala nunca baja de 1x', () => {
    // La amortiguacion por debajo de 1 sobreoscila al volver del zoom.
    const { track: tr } = track(events);
    for (let t = 0; t <= 8000; t += 1000 / 120) {
      expect(tr.sampleAt(t).scale).toBeGreaterThanOrEqual(1 - 1e-4);
    }
  });

  it('el movimiento entre frames a 60fps esta acotado', () => {
    // Cota anti-tiron: ningun frame puede saltar mas de un 4% de escala ni
    // recorrer mas de un 6% del ancho de la fuente.
    const { track: tr } = track(events);
    let prev = tr.sampleAt(0);
    for (let t = 1000 / 60; t <= 8000; t += 1000 / 60) {
      const cur = tr.sampleAt(t);
      expect(Math.abs(cur.scale / prev.scale - 1)).toBeLessThan(0.04);
      expect(Math.hypot(cur.cx - prev.cx, cur.cy - prev.cy)).toBeLessThan(VIEWPORT.w * 0.06);
      prev = cur;
    }
  });

  it('es determinista: dos construcciones dan el mismo resultado', () => {
    // El exportador depende de esto para que el video coincida con el preview.
    const a = track(events).track;
    const b = track(events).track;
    for (let t = 0; t <= 8000; t += 137) {
      expect(a.sampleAt(t)).toEqual(b.sampleAt(t));
    }
  });
});

describe('buildCameraTrack · seguimiento del cursor', () => {
  const base = click(1000, { x: 700, y: 400, w: 200, h: 60 });
  // El tramo de este click va de 600 a 1960 ms. Hay que muestrear DENTRO: una
  // vez termina, la camara vuelve al centro y cualquier comparacion da igual
  // pase lo que pase con el cursor.
  const DENTRO_MS = 1900;

  it('un temblor del cursor no mueve la camara', () => {
    // Sin zona muerta la imagen vibra siguiendo cada microdesplazamiento.
    const quieto = track([...base, move(1200, 800, 430), move(1500, 800, 430)]);
    const tembloroso = track([...base, move(1200, 812, 438), move(1500, 795, 425)]);
    const a = quieto.track.sampleAt(DENTRO_MS);
    const b = tembloroso.track.sampleAt(DENTRO_MS);
    expect(Math.abs(a.cx - b.cx)).toBeLessThan(1);
    expect(Math.abs(a.cy - b.cy)).toBeLessThan(1);
  });

  it('un cursor que se aleja si arrastra la camara', () => {
    const quieto = track([...base, move(1200, 800, 430)]);
    const alejado = track([...base, move(1200, 1500, 430), move(1500, 1560, 430)]);
    const a = quieto.track.sampleAt(DENTRO_MS);
    const b = alejado.track.sampleAt(DENTRO_MS);
    expect(b.cx).toBeGreaterThan(a.cx + 20);
  });

  it('el arrastre respeta los bordes del material', () => {
    // Un cursor pegado a la esquina no puede empujar la vista fuera de la fuente.
    const { track: tr } = track([...base, move(1200, 1599, 899)]);
    const v = viewRect(tr.sampleAt(DENTRO_MS), VIEWPORT);
    expect(v.x + v.w).toBeLessThanOrEqual(VIEWPORT.w + 1e-3);
    expect(v.y + v.h).toBeLessThanOrEqual(VIEWPORT.h + 1e-3);
  });
});

describe('CursorPath suavizado', () => {
  /** Movimiento con temblor de mano: deriva mas un diente de sierra encima. */
  function conTemblor(desde: number, hasta: number, pasos: number): InputEvent[] {
    const ev: InputEvent[] = [];
    for (let i = 0; i <= pasos; i++) {
      const f = i / pasos;
      ev.push({
        t: T0 + i * 8,
        type: 'move',
        x: desde + (hasta - desde) * f + (i % 2 === 0 ? 6 : -6),
        y: 300 + (i % 3 === 0 ? 5 : -5),
      });
    }
    return ev;
  }

  it('quita el temblor', () => {
    // La metrica es el recorrido VERTICAL mientras la mano solo avanza en
    // horizontal: su ideal es cero, asi que mide temblor puro. La longitud
    // total del camino no vale, y no por poco: el muelle va por dentro de las
    // curvas, asi que un camino suavizado puede salir mas CORTO que la linea
    // recta y confundir retardo con suavidad.
    const ev = conTemblor(100, 900, 60);
    const recorridoY = (p: CursorPath) => {
      let d = 0;
      let ant = p.at(0)!;
      for (let t = 4; t <= 480; t += 4) {
        const q = p.at(t)!;
        d += Math.abs(q.y - ant.y);
        ant = q;
      }
      return d;
    };
    const crudo = recorridoY(new CursorPath(ev, T0));
    const suave = recorridoY(new CursorPath(ev, T0, SUAVIZADO_CURSOR_MS));
    expect(crudo).toBeGreaterThan(100);          // el fixture tiembla de verdad
    expect(suave).toBeLessThan(crudo * 0.1);     // medido: 400 px -> 16 px
  });

  it('llega exacto al punto del click tras la pausa de siempre', () => {
    // Es el riesgo real del suavizado: si el puntero se dibuja lejos del boton
    // en el instante de pulsar, la onda del click y el cursor se contradicen y
    // se ve peor que el temblor. Nadie pulsa en movimiento: se para y pulsa.
    const ev = conTemblor(100, 800, 40);
    const finMov = ev[ev.length - 1]!.t;
    for (let i = 1; i <= 25; i++) ev.push({ t: finMov + i * 8, type: 'move', x: 800, y: 300 });
    const tClick = finMov + 25 * 8;
    ev.push({ t: tClick, type: 'down', x: 800, y: 300 });

    const suave = new CursorPath(ev, T0, SUAVIZADO_CURSOR_MS);
    const p = suave.at(tClick - T0)!;
    expect(Math.hypot(p.x - 800, p.y - 300)).toBeLessThan(1);
  });

  it('sin suavizado devuelve la trayectoria cruda', () => {
    // El motor de camara la necesita asi: ya tiene su propio muelle.
    const ev = conTemblor(100, 900, 20);
    const a = new CursorPath(ev, T0);
    const b = new CursorPath(ev, T0, 0);
    for (let t = 0; t <= 160; t += 20) {
      expect(a.at(t)).toEqual(b.at(t));
    }
  });

  it('aguanta un log vacio o de una sola muestra', () => {
    expect(new CursorPath([], T0, SUAVIZADO_CURSOR_MS).at(0)).toBeNull();
    const uno: InputEvent[] = [{ t: T0, type: 'move', x: 5, y: 7 }];
    expect(new CursorPath(uno, T0, SUAVIZADO_CURSOR_MS).at(50)).toEqual({ x: 5, y: 7 });
  });
});
