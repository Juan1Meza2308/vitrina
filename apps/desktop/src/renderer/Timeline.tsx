import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { moveSegment, resizeSegment, clampTrim } from '@vitrina/core';
import type { Cut, ZoomSegment, Speed } from '@vitrina/core';
import { marcasDeRegla } from './timeline-calc.ts';
import type { Reloj } from './reloj.ts';

/**
 * Linea de tiempo editable, en carriles.
 *
 * Este componente NO decide que es valido: traduce gestos a llamadas de
 * `@vitrina/core` y pinta el resultado. Las invariantes —orden, ausencia de
 * solapes, duracion minima, limites del material— viven en `camera/edit.ts` y
 * estan cubiertas por tests. Un timeline que ademas las hiciera cumplir tendria
 * la logica repartida entre el manejador del raton y el render, que es donde
 * este tipo de codigo se pudre.
 *
 * La escala amplia el contenido y deja que el contenedor haga scroll. `.pista`
 * es el elemento ANCHO, no el visible, asi que `getBoundingClientRect()` ya
 * viene desplazado por el scroll y la conversion de x a tiempo sigue siendo una
 * division, sin restar desplazamientos a mano.
 */

type Arrastre =
  | { tipo: 'seek' }
  | { tipo: 'tramo'; i: number; offsetMs: number }
  | { tipo: 'inicio'; i: number }
  | { tipo: 'fin'; i: number }
  | { tipo: 'trim-inicio' }
  | { tipo: 'trim-fin' };

export interface TimelineProps {
  durationMs: number;
  /**
   * El instante actual NO llega como prop: llega por suscripcion. Este
   * componente esta memorizado y la aguja cambia sesenta veces por segundo;
   * pasarla como prop anularia el memo justo en el momento que importa.
   */
  reloj: Reloj;
  onSeek: (ms: number) => void;
  zooms: ZoomSegment[];
  onZoomsChange: (z: ZoomSegment[]) => void;
  seleccion: number | null;
  onSeleccion: (i: number | null) => void;
  trimStartMs: number;
  trimEndMs: number | null;
  /** Silencios quitados. Se pintan como el recorte porque son lo mismo: trozos
   *  que no llegan a la salida. */
  cuts?: Cut[];
  /** Tramos acelerados. Se pintan distinto de los cortes: siguen en el video. */
  speeds?: Speed[] | undefined;
  /** Ancho del contenido, en veces el del contenedor. 1 = ajustado. */
  escala?: number;
  /** Picos de la narracion, 0-1. Vacio si la grabacion no tiene audio. */
  onda?: Float32Array | null;
  /**
   * Momentos senalados con el atajo durante la grabacion, en offsets desde el
   * inicio del material. Se llaman `hitos` y no `marcas` porque en este fichero
   * `marcas` ya son las de la regla, y confundirlos costaria un rato.
   */
  hitos?: { ms: number; label?: string | null }[];
  onTrim: (t: { trimStartMs: number; trimEndMs: number | null }) => void;
}

/**
 * Memorizado a proposito: mientras se reproduce o se arrastra, App se rehace en
 * cada frame y este arbol —regla, tramos, cortes, onda— no cambia nada. Para
 * que el memo sirva, los callbacks que llegan de App estan estabilizados con
 * `useCallback` alli; sin eso, cada render traeria funciones nuevas y esto se
 * volveria a dibujar igual.
 */
export const Timeline = memo(function Timeline(props: TimelineProps) {
  const { durationMs, zooms, trimStartMs, trimEndMs } = props;
  const escala = Math.max(1, props.escala ?? 1);
  const pista = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const [anchoPx, setAnchoPx] = useState(900);

  const pct = (ms: number) => `${(ms / durationMs) * 100}%`;
  const finReal = trimEndMs ?? durationMs;

  // El ancho real decide cuantas marcas caben. Se mide en vez de estimarse: con
  // la ventana a medio tamano, una regla calculada sobre un ancho supuesto sale
  // amontonada justo cuando menos sitio hay.
  useEffect(() => {
    const el = pista.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAnchoPx(e?.contentRect.width ?? 900));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // La aguja se mueve escribiendo una variable CSS en la pista, no re-rindiendo:
  // el navegador reposiciona una linea y React no se entera. Aqui tambien se la
  // sigue con el scroll cuando la linea esta ampliada, pero solo si ya no se ve:
  // desplazar en cada frame marearia.
  useEffect(() => props.reloj.sub((ms) => {
    const el = pista.current;
    if (el) el.style.setProperty('--aguja', `${(ms / durationMs) * 100}%`);
    const caja = scroll.current;
    if (!caja || escala <= 1) return;
    const x = (ms / durationMs) * caja.scrollWidth;
    const margen = caja.clientWidth * 0.12;
    if (x < caja.scrollLeft + margen || x > caja.scrollLeft + caja.clientWidth - margen) {
      caja.scrollLeft = x - caja.clientWidth / 2;
    }
  }), [props.reloj, durationMs, escala]);

  const msDeEvento = useCallback((clientX: number): number => {
    const caja = pista.current?.getBoundingClientRect();
    if (!caja || caja.width === 0) return 0;
    const f = (clientX - caja.left) / caja.width;
    return Math.min(durationMs, Math.max(0, f * durationMs));
  }, [durationMs]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const objetivo = (e.target as HTMLElement).closest<HTMLElement>('[data-arrastre]');
    const tipo = objetivo?.dataset['arrastre'] ?? 'seek';
    const i = Number(objetivo?.dataset['i'] ?? -1);
    const ms = msDeEvento(e.clientX);

    let siguiente: Arrastre;
    if (tipo === 'tramo') {
      props.onSeleccion(i);
      // Llevar tambien la aguja al punto pulsado: seleccionar un tramo sin
      // verlo deja el lienzo en otro momento, y entonces reencuadrarlo seria a
      // ciegas. Al pinchar dentro, lo que se edita es lo que se esta mirando.
      props.onSeek(ms);
      siguiente = { tipo: 'tramo', i, offsetMs: ms - (zooms[i]?.startMs ?? ms) };
    } else if (tipo === 'inicio' || tipo === 'fin') {
      props.onSeleccion(i);
      siguiente = { tipo, i };
    } else if (tipo === 'trim-inicio' || tipo === 'trim-fin') {
      siguiente = { tipo };
    } else {
      // Un click en el riel deselecciona y mueve la aguja: es lo que se espera
      // al pinchar "fuera".
      props.onSeleccion(null);
      props.onSeek(ms);
      siguiente = { tipo: 'seek' };
    }

    setArrastre(siguiente);
    // Con captura el gesto sigue vivo aunque el raton se salga de la pista.
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!arrastre) return;
    const ms = msDeEvento(e.clientX);
    const ctx = { durationMs };

    switch (arrastre.tipo) {
      case 'seek':
        props.onSeek(ms);
        break;
      case 'tramo':
        props.onZoomsChange(moveSegment(zooms, arrastre.i, ms - arrastre.offsetMs, ctx));
        break;
      case 'inicio':
      case 'fin':
        props.onZoomsChange(resizeSegment(zooms, arrastre.i, arrastre.tipo, ms, ctx));
        break;
      case 'trim-inicio':
        props.onTrim(clampTrim(ms, trimEndMs, durationMs));
        break;
      case 'trim-fin':
        props.onTrim(clampTrim(trimStartMs, ms, durationMs));
        break;
    }
  };

  const soltar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (arrastre) e.currentTarget.releasePointerCapture(e.pointerId);
    setArrastre(null);
  };

  const marcas = marcasDeRegla(durationMs, anchoPx);
  const onda = props.onda;

  return (
    <div className="tl">
      <div className="tl-rotulos">
        <span className="tl-rot regla" />
        <span className="tl-rot">Vídeo</span>
        <span className="tl-rot">Ritmo</span>
        <span className="tl-rot">Audio</span>
      </div>

      <div className="tl-scroll" ref={scroll}>
        <div
          className={`pista${arrastre ? ' arrastrando' : ''}`}
          ref={pista}
          style={{ width: `${escala * 100}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={soltar}
          onPointerCancel={soltar}
        >
          <div className="carril regla">
            {marcas.map((m) => (
              <span key={m.ms} className="tl-marca" style={{ left: `${m.f * 100}%` }}>
                {m.etiqueta}
              </span>
            ))}
            {/* Los hitos se pintan sobre la regla y no en un carril propio: son
                instantes, no tramos, y un carril entero para una chincheta
                robaria alto a lo que si dura. */}
            {(props.hitos ?? []).map((h, i) => (
              <button
                key={`h${i}`}
                className="hito"
                style={{ left: pct(h.ms) }}
                title={`${h.label ?? 'Momento senalado'} · ${(h.ms / 1000).toFixed(1)}s`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => props.onSeek(h.ms)}
              />
            ))}
          </div>

          <div className="carril video">
            <div className="riel" />
            {zooms.map((z, i) => (
              <div
                key={i}
                className={`tramo${props.seleccion === i ? ' sel' : ''}${z.auto ? '' : ' manual'}`}
                data-arrastre="tramo"
                data-i={i}
                title={`${z.label ?? 'zoom'} · ${z.scale.toFixed(2)}x`}
                style={{ left: pct(z.startMs), width: pct(z.endMs - z.startMs) }}
              >
                <span className="etiqueta">{z.label ?? 'zoom'}</span>
                <span className="asa" data-arrastre="inicio" data-i={i} />
                <span className="asa asa-der" data-arrastre="fin" data-i={i} />
              </div>
            ))}
          </div>

          <div className="carril ritmo">
            <div className="riel" />
            {/* Los acelerados NO se pintan como los cortes: un corte quita
                material y uno acelerado lo conserva. Confundirlos visualmente
                haria pensar que se ha perdido algo. */}
            {(props.speeds ?? []).map((v, i) => (
              <div key={`v${i}`} className="veloz" title={`×${v.rate} en este tramo`}
                   style={{ left: pct(v.startMs), width: pct(v.endMs - v.startMs) }}>
                <span>×{v.rate}</span>
              </div>
            ))}
            {(props.cuts ?? []).map((c, i) => (
              <div key={`c${i}`} className="corte" title="Silencio quitado"
                   style={{ left: pct(c.startMs), width: pct(c.endMs - c.startMs) }} />
            ))}
          </div>

          <div className="carril audio">
            <div className="riel" />
            {onda && onda.length > 0 && <Onda picos={onda} />}
            {!onda && <span className="sin-audio">sin narración</span>}
          </div>

          {/* Zonas recortadas: se atenuan en vez de ocultarse, para que se vea
              que el material sigue ahi y el recorte se puede deshacer. */}
          <div className="recorte" style={{ left: 0, width: pct(trimStartMs) }} />
          <div className="recorte" style={{ left: pct(finReal), right: 0 }} />
          <div className="asa-trim" data-arrastre="trim-inicio" style={{ left: pct(trimStartMs) }} />
          <div className="asa-trim der" data-arrastre="trim-fin" style={{ left: pct(finReal) }} />
          <div className="aguja" />
        </div>
      </div>
    </div>
  );
});

/**
 * La forma de onda, en un lienzo.
 *
 * Antes eran 900 `<span>` en el arbol de React. No cambian nunca —los picos se
 * calculan al cargar la narracion y ya— pero se rehacian en cada tick de
 * reproduccion, unos 54.000 nodos virtuales por segundo para dibujar algo
 * inmovil. En un lienzo se dibujan UNA vez y el zoom de la linea de tiempo lo
 * estira por CSS, igual que estiraba las columnas.
 *
 * El color se lee del estilo calculado en vez de escribirse aqui: asi sigue al
 * tema claro y al oscuro. Como un lienzo no reacciona a un cambio de tema, se
 * vigila el atributo de la raiz y se vuelve a dibujar cuando cambia.
 */
function Onda({ picos }: { picos: Float32Array }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    // El lienzo tiene el tamano de los datos, no el de la pantalla: se estira
    // por CSS. Redimensionarlo con el zoom obligaria a redibujar en cada paso
    // del deslizador para una diferencia que no se ve.
    const alto = 40;
    cv.width = picos.length;
    cv.height = alto;

    // La onda se dibuja NORMALIZADA, no con los valores absolutos.
    //
    // Una narracion normal de portatil tiene picos de 0.15, asi que a escala
    // absoluta el carril entero se ve como una raya —comprobado en pixeles: el
    // pico mas alto ocupaba el 15 % del alto—. Y para lo que sirve esta onda,
    // que es ver DONDE se hablo, los decibelios absolutos no dicen nada; lo que
    // dice algo es el relieve.
    //
    // La referencia es el percentil 95 y no el maximo: un golpe en la mesa no
    // puede aplastar el resto de la grabacion.
    const orden = [...picos].filter((v) => v > 0).sort((a, b) => a - b);
    const p95 = orden[Math.floor(orden.length * 0.95)] ?? 0;
    const escala = p95 > 0.02 ? 0.92 / p95 : 1;

    const pintar = () => {
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, cv.width, alto);
      ctx.fillStyle = getComputedStyle(cv).color;
      for (let i = 0; i < picos.length; i++) {
        // Minimo de un pixel: una columna sin sonido tiene que seguir marcando
        // la linea, o el silencio pareceria un hueco en la pista.
        const h = Math.max(1, Math.min(1, (picos[i] ?? 0) * escala) * alto);
        ctx.fillRect(i, (alto - h) / 2, 1, h);
      }
    };
    pintar();

    const obs = new MutationObserver(pintar);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
    return () => obs.disconnect();
  }, [picos]);

  return <canvas className="onda" ref={ref} aria-hidden />;
}
