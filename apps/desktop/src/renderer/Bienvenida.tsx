import { useEffect, useState } from 'react';
import type { EstadoSistema } from '../preload/index.ts';

/**
 * Lo que se ve la primera vez que se abre Vitrina.
 *
 * No es una pantalla de marketing ni un tour de seis pasos: es lo mínimo que
 * alguien necesita saber ANTES de grabar, y la comprobación de que su máquina
 * puede hacerlo. Sale una vez y se puede cerrar en un clic.
 *
 * Los tres bloques están elegidos por lo que cuesta descubrirlos tarde:
 *
 *  1. **Qué graba.** Es el malentendido caro. Quien espera un grabador de
 *     escritorio abre Vitrina, no encuentra dónde elegir la ventana, y se va.
 *     Decirlo aquí cuesta una línea; descubrirlo después cuesta el usuario.
 *  2. **Qué hace falta**, comprobado en el momento. Un aviso en verde no vale
 *     nada si no se ha mirado: el proceso principal busca el navegador y le
 *     PIDE la versión a ffmpeg. Si algo falta, aquí está el botón que lo
 *     arregla, no un mensaje de error dentro de dos pantallas.
 *  3. **Privacidad.** Va antes de grabar y no en un aviso legal, porque es una
 *     razón para usar Vitrina y no una advertencia: las teclas no se guardan.
 *
 * No hay «no volver a mostrar»: ya no vuelve a salir. Un ajuste para apagar algo
 * que solo ocurre una vez es una casilla que nadie necesita leer.
 */
export function Bienvenida({ onEmpezar }: { onEmpezar: () => void }) {
  const [estado, setEstado] = useState<EstadoSistema | null>(null);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    void window.vitrina.estadoDelSistema().then(setEstado);
  }, []);

  const elegirFfmpeg = async () => {
    setBuscando(true);
    try {
      setEstado(await window.vitrina.elegirFfmpeg());
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="bienvenida-fondo" role="dialog" aria-modal="true"
         aria-label="Bienvenida a Vitrina">
      <div className="bienvenida cristal modal">
        <header>
          <Marca />
          <h1>Vitrina</h1>
          <p className="sutil">
            Graba demos de tu app web con zoom automático en los clicks.
          </p>
        </header>

        <section className="bloque">
          <h2>Graba páginas web, no la pantalla</h2>
          <p>
            Vitrina abre tu app en una ventana limpia y la graba desde dentro del
            navegador. Por eso la cámara sabe encuadrar el botón que pulsas. No
            captura el escritorio, ni tu editor, ni una videollamada.
          </p>
        </section>

        <section className="bloque">
          <h2>Lo que hace falta</h2>
          <ul className="requisitos">
            <Requisito
              nombre="Navegador"
              ok={estado?.navegador.ok}
              detalle={estado?.navegador.detalle}
              accion={estado && !estado.navegador.ok
                ? { texto: 'Descargar Chrome', hacer: () => window.vitrina.abrirEnlace('navegador') }
                : null}
            />
            <Requisito
              nombre="Vídeo (ffmpeg)"
              ok={estado?.ffmpeg.ok}
              detalle={estado?.ffmpeg.ok
                ? (estado.ffmpeg.origen === 'incluido'
                  ? 'Incluido con la app'
                  : 'Instalado en tu equipo')
                : estado?.ffmpeg.detalle}
              accion={estado && !estado.ffmpeg.ok
                ? {
                  texto: buscando ? 'Buscando…' : 'Buscar el archivo…',
                  hacer: elegirFfmpeg,
                }
                : null}
            />
          </ul>
          {estado && !estado.ffmpeg.ok && (
            <p className="sutil">
              Vitrina trae el suyo, así que esto no debería pasar. Si no aparece,
              señálalo a mano o{' '}
              <button className="enlace" onClick={() => window.vitrina.abrirEnlace('ffmpeg')}>
                descárgalo de ffmpeg.org
              </button>.
            </p>
          )}
        </section>

        <section className="bloque">
          <h2>Lo que escribes no se guarda</h2>
          <p>
            El registro de teclado anota que pulsaste una tecla, nunca cuál. Una
            demo con login no puede filtrar tu contraseña. Y lo que tapes —un
            saldo, un correo— se difumina <b>al grabar</b>: no llega a existir en
            el vídeo.
          </p>
        </section>

        <footer>
          <button className="primario" onClick={onEmpezar} autoFocus>
            Empezar
          </button>
          <button className="enlace" onClick={() => window.vitrina.abrirEnlace('guia')}>
            Ver la documentación
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * La marca, con las mismas formas que el icono de la app (`tools/icono.ts`).
 *
 * Va en SVG y no como imagen para que no dependa de un fichero que cargar: es
 * lo primero que se ve, y una imagen que tarda deja la cabecera bailando.
 */
function Marca() {
  return (
    <svg width="46" height="46" viewBox="0 0 1024 1024" aria-hidden className="marca-app">
      <defs>
        <linearGradient id="vitrina-marca" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d5efc" />
          <stop offset="1" stopColor="#c3f53c" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="224" fill="url(#vitrina-marca)" />
      <rect x="192" y="332" width="640" height="360" rx="48" fill="#12151b" />
      <path d="M464 433 L597 512 L464 591 Z" fill="#c3f53c" />
    </svg>
  );
}

/**
 * Una línea de requisito.
 *
 * Mientras se comprueba no se dice ni que sí ni que no: un check verde que
 * aparece antes de haber mirado es peor que esperar medio segundo.
 */
function Requisito(
  { nombre, ok, detalle, accion }: {
    nombre: string;
    ok: boolean | undefined;
    detalle: string | undefined;
    accion: { texto: string; hacer: () => void } | null;
  },
) {
  const estado = ok === undefined ? 'comprobando' : ok ? 'bien' : 'falta';
  return (
    <li className={`requisito ${estado}`}>
      <span className="marca" aria-hidden>{ok === undefined ? '·' : ok ? '✓' : '!'}</span>
      <span className="nombre">{nombre}</span>
      <span className="detalle" title={detalle}>
        {ok === undefined ? 'comprobando…' : detalle}
      </span>
      {accion && (
        <button onClick={accion.hacer}>{accion.texto}</button>
      )}
    </li>
  );
}
