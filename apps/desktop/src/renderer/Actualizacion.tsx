import { useEffect, useState } from 'react';

/**
 * Aviso de que hay una versión nueva.
 *
 * Una barra fina arriba, y nada más. Ni un diálogo que hay que cerrar antes de
 * seguir, ni una descarga que empieza sola: quien abre Vitrina viene a grabar
 * una demo, y una actualización nunca es más urgente que eso.
 *
 * Tres decisiones, y las tres van en la misma dirección:
 *
 *  - **Se puede cerrar**, y no vuelve en esta sesión. Al reabrir la app sí,
 *    porque para entonces ya no está a mitad de nada.
 *  - **No aparece grabando.** Lo decide quien la coloca (`App.tsx`), que es
 *    quien sabe en qué fase está.
 *  - **Dice la versión.** «Hay una actualización» no deja decidir nada; «0.2.0,
 *    tú tienes 0.1.0» sí.
 *
 * En Windows el botón descarga y reinicia. En macOS abre la página de descargas,
 * porque sin firma digital la actualización automática no es posible —y
 * prometerla y que no pase es peor que no ofrecerla—.
 */
export function AvisoActualizacion() {
  const [version, setVersion] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<number | null>(null);
  const [cerrado, setCerrado] = useState(false);

  useEffect(() => {
    void window.vitrina.versionPendiente().then((v) => { if (v) setVersion(v); });
    const bajaVersion = window.vitrina.alHaberVersion(setVersion);
    const bajaProgreso = window.vitrina.alProgresarDescarga(setProgreso);
    return () => { bajaVersion(); bajaProgreso(); };
  }, []);

  if (!version || cerrado) return null;

  const instalar = async () => {
    setProgreso(0);
    const via = await window.vitrina.instalarVersion();
    // En macOS se abre la pagina y aqui no va a pasar nada mas: dejar una barra
    // de progreso quieta pareceria que se ha colgado.
    if (via === 'pagina') setProgreso(null);
  };

  return (
    <div className="aviso-version cristal flota" role="status">
      <span className="punto" aria-hidden />
      <span>
        Hay una versión nueva: <b>{version}</b>
      </span>
      {progreso === null ? (
        <>
          <button className="primario" onClick={instalar}>Actualizar</button>
          <button className="enlace" onClick={() => setCerrado(true)}>Ahora no</button>
        </>
      ) : (
        <span className="sutil">Descargando… {progreso}%</span>
      )}
    </div>
  );
}
