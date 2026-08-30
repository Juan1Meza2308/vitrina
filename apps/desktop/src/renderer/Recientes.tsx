/**
 * Las grabaciones recientes, como tarjetas con imagen.
 *
 * Una lista de fechas no dice cual es cual: dos demos del mismo dia se
 * distinguen por lo que se ve en ellas, no por la hora. Por eso cada tarjeta
 * lleva el fotograma del primer click —cuando ya hay algo que ver— y el host de
 * la app grabada como titulo.
 *
 * **La tira se pide al posar el cursor, no al arrancar.** Seis fotogramas por
 * grabacion son decenas de frames grandes que decodificar, y pagarlos en el
 * arranque para animar algo que a lo mejor nadie mira seria caro por gusto.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GrabacionReciente } from '../preload/index.ts';
import { IconoImagen } from './Iconos.tsx';
import { useT } from './idioma.tsx';
import { conIdioma, type T } from '@vitrina/core';

/** Cada cuanto pasa de fotograma la preview. */
const PASO_MS = 140;

/**
 * "hace 5 min", "ayer", "el 3 de marzo".
 *
 * Una hora exacta obliga a hacer la resta mentalmente; lo que se quiere saber
 * es si esto es de hace un rato o de la semana pasada. Pasado un mes se vuelve
 * a la fecha, que a esa distancia "hace 47 dias" ya no orienta a nadie.
 */
export function hace(ms: number, ahora = Date.now(), t: T = conIdioma('es')): string {
  const seg = Math.max(0, Math.round((ahora - ms) / 1000));
  if (seg < 60) return t('hace un momento');
  const min = Math.round(seg / 60);
  if (min < 60) return t('hace {n} min', { n: min });
  const horas = Math.round(min / 60);
  if (horas < 24) return t('hace {n} h', { n: horas });
  const dias = Math.round(horas / 24);
  if (dias === 1) return t('ayer');
  if (dias < 30) return t('hace {n} días', { n: dias });
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

/** `19,5 s` o `2:04` cuando pasa del minuto. */
export function duracion(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function Tarjeta({ r, onAbrir }: { r: GrabacionReciente; onAbrir: (dir: string) => void }) {
  const t = useT();
  const [tira, setTira] = useState<string[]>([]);
  const [i, setI] = useState(0);
  const dentro = useRef(false);
  const timer = useRef<number | null>(null);

  const parar = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => parar, [parar]);

  const entrar = useCallback(async () => {
    dentro.current = true;
    let fotos = tira;
    if (fotos.length === 0) {
      fotos = await window.vitrina.previaDe(r.dir);
      // Si el cursor ya se fue mientras llegaban, no se anima nada: mover una
      // tarjeta que nadie esta mirando es ruido.
      if (!dentro.current) return;
      setTira(fotos);
    }
    if (fotos.length < 2) return;
    parar();
    timer.current = window.setInterval(
      () => setI((n) => (n + 1) % fotos.length), PASO_MS);
  }, [r.dir, tira, parar]);

  const salir = useCallback(() => {
    dentro.current = false;
    parar();
    setI(0);
  }, [parar]);

  const src = tira[i] ?? r.portada;

  return (
    <button className="tarjeta-reciente" title={r.dir}
            onPointerEnter={() => void entrar()}
            onPointerLeave={salir}
            onClick={() => onAbrir(r.dir)}>
      <span className="lienzo">
        {src
          ? <img src={src} alt="" draggable={false} />
          : <span className="sin-portada"><IconoImagen size={20} /></span>}
        <span className="duracion">{duracion(r.durationMs)}</span>
      </span>
      <b>{r.host || 'grabación'}</b>
      <small>{hace(r.startedAt, Date.now(), t)}</small>
    </button>
  );
}

export function Recientes(
  { items, onAbrir, onAbrirOtra }: {
    items: GrabacionReciente[];
    onAbrir: (dir: string) => void;
    /** Abrir una carpeta de cualquier sitio, no solo de las recientes. */
    onAbrirOtra: () => void;
  },
) {
  const t = useT();
  return (
    <div className="rejilla-recientes">
      {items.map((r) => <Tarjeta key={r.dir} r={r} onAbrir={onAbrir} />)}

      {/* La casilla de abrir va con las demas y no en otro sitio: es la misma
          idea —entrar en una grabacion— y buscarla en dos sitios distintos
          seria una lista de tareas repartida. */}
      <button className="tarjeta-reciente abrir" onClick={onAbrirOtra}>
        <span className="lienzo">
          <span className="sin-portada">+</span>
        </span>
        <b>{t('Abrir grabación')}</b>
        <small>{t('de cualquier carpeta')}</small>
      </button>
    </div>
  );
}
