import { useCallback, useRef, useState } from 'react';
import { moveSegment, resizeSegment, clampTrim } from '@vitrina/core';
import type { Cut, ZoomSegment, Speed } from '@vitrina/core';

/**
 * Linea de tiempo editable.
 *
 * Este componente NO decide que es valido: traduce gestos a llamadas de
 * `@vitrina/core` y pinta el resultado. Las invariantes —orden, ausencia de
 * solapes, duracion minima, limites del material— viven en `camera/edit.ts` y
 * estan cubiertas por tests. Un timeline que ademas las hiciera cumplir tendria
 * la logica repartida entre el manejador del raton y el render, que es donde
 * este tipo de codigo se pudre.
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
  tMs: number;
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
  speeds?: Speed[];
  onTrim: (t: { trimStartMs: number; trimEndMs: number | null }) => void;
}

export function Timeline(props: TimelineProps) {
  const { durationMs, tMs, zooms, trimStartMs, trimEndMs } = props;
  const pista = useRef<HTMLDivElement>(null);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);

  const pct = (ms: number) => `${(ms / durationMs) * 100}%`;
  const finReal = trimEndMs ?? durationMs;

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

  return (
    <div
      className={`pista${arrastre ? ' arrastrando' : ''}`}
      ref={pista}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={soltar}
      onPointerCancel={soltar}
    >
      <div className="riel" />

      {/* Zonas recortadas: se atenuan en vez de ocultarse, para que se vea que
          el material sigue ahi y el recorte se puede deshacer. */}
      <div className="recorte" style={{ left: 0, width: pct(trimStartMs) }} />
      <div className="recorte" style={{ left: pct(finReal), right: 0 }} />
      {(props.cuts ?? []).map((c, i) => (
        <div key={`c${i}`} className="recorte corte" title="Silencio quitado"
             style={{ left: pct(c.startMs), width: pct(c.endMs - c.startMs) }} />
      ))}
      {/* Los acelerados NO se pintan como los cortes: un corte quita material y
          uno acelerado lo conserva. Confundirlos visualmente haria pensar que se
          ha perdido algo. */}
      {(props.speeds ?? []).map((v, i) => (
        <div key={`v${i}`} className="veloz" title={`×${v.rate} en este tramo`}
             style={{ left: pct(v.startMs), width: pct(v.endMs - v.startMs) }}>
          <span>×{v.rate}</span>
        </div>
      ))}

      {zooms.map((z, i) => (
        <div
          key={i}
          className={`tramo${props.seleccion === i ? ' sel' : ''}${z.auto ? '' : ' manual'}`}
          data-arrastre="tramo"
          data-i={i}
          title={`${z.label ?? 'zoom'} · ${z.scale.toFixed(2)}x`}
          style={{ left: pct(z.startMs), width: pct(z.endMs - z.startMs) }}
        >
          <span className="asa" data-arrastre="inicio" data-i={i} />
          <span className="asa asa-der" data-arrastre="fin" data-i={i} />
        </div>
      ))}

      <div className="asa-trim" data-arrastre="trim-inicio" style={{ left: pct(trimStartMs) }} />
      <div className="asa-trim der" data-arrastre="trim-fin" style={{ left: pct(finReal) }} />
      <div className="aguja" style={{ left: `calc(${pct(tMs)} - 1px)` }} />
    </div>
  );
}
