import { useState } from 'react';
import { useT } from './idioma.tsx';

/**
 * La guia rapida, dentro de la app.
 *
 * Mismo patron que la hoja de atajos: una capa que cierra al pulsar fuera, la
 * hoja de cristal con `stopPropagation`, y la animacion de salida por el mismo
 * camino por el que entro. Lo unico distinto es de donde se abre: la bienvenida
 * y la cabecera de la pantalla de inicio.
 *
 * Documenta lo que cuesta descubrir tarde. La bienvenida sale una sola vez, asi
 * que una guia que solo viviera ahi nadie volveria a encontrarla; por eso se
 * abre tambien desde la cabecera.
 */
export function GuiaRapida({ onCerrar }: { onCerrar: () => void }) {
  const t = useT();
  const [saliendo, setSaliendo] = useState(false);

  const cerrar = () => {
    setSaliendo(true);
    // El mismo tiempo de la animacion de salida que la hoja de atajos: quitarla
    // antes la corta a media transicion y dejarla mas la congela invisible.
    window.setTimeout(onCerrar, 180);
  };

  return (
    <div className={`guia${saliendo ? ' saliendo' : ''}`} onClick={cerrar}>
      <div className="hoja cristal modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('Guía rápida')}</h3>

        <section className="guia-bloque">
          <h4>{t('Qué graba')}</h4>
          <p>
            {t('Tu app web, desde dentro del navegador y con el zoom pegándose a '
              + 'tus clics. No captura el escritorio ni una videollamada.')}
          </p>
        </section>

        <section className="guia-bloque">
          <h4>{t('Tu primera demo')}</h4>
          <p>
            {t('Pega la dirección, elige la calidad y pulsa Grabar. Haz clic como '
              + 'lo haría quien mira: el zoom te sigue.')}
          </p>
        </section>

        <section className="guia-bloque">
          <h4>{t('El editor')}</h4>
          <p>
            {t('Los zooms se planifican solos. Después se editan uno a uno: '
              + 'reordénalos, quita un silencio o corta lo que sobre.')}
          </p>
        </section>

        <section className="guia-bloque">
          <h4>{t('Tapar datos')}</h4>
          <p>
            {t('Señala un saldo o un correo y Vitrina lo difumina al grabar: '
              + 'no llega a existir en el vídeo.')}
          </p>
        </section>

        <section className="guia-bloque">
          <h4>{t('Exportar')}</h4>
          <p>
            {t('Vídeo para compartir, o la guía escrita con los pasos y sus '
              + 'capturas para quien lo vaya a repetir.')}
          </p>
        </section>

        <footer className="guia-pie">
          <button className="enlace" onClick={() => window.vitrina.abrirEnlace('guia')}>
            {t('Documentación completa')}
          </button>
          <button onClick={cerrar}>{t('Cerrar')}</button>
        </footer>
      </div>
    </div>
  );
}
