import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CAMERA_PRESETS, cameraConfigForBudget, computeQualityBudget, describeBudget,
  planSegments, deleteSegment, setSegmentScale, insertSegment, hasManualEdits,
  clampTrim, CursorPath, moveSegmentTarget, layoutFrame, viewRect, TimeMap,
  paraOrientacion, defaultExportFor,
  tramosSinActividad, ahorroDe,
} from '@vitrina/core';
import type {
  Background, CameraPresetName, CapturePreset, Cut, Orientacion, Project, ZoomSegment,
} from '@vitrina/core';
import type {
  RecordingData, ExportProgressMsg, ExportPresetInfo, GrabacionReciente, Look, ResultadoExport,
} from '../preload/index.ts';
import { Preview, makeTrack } from './preview.ts';
import { Timeline } from './Timeline.tsx';
import {
  IconoGrabacion, IconoAjustes, IconoRepetir, IconoImagen, IconoReproducir,
  IconoPausa, IconoInicio, IconoSonido, IconoSilencio, IconoAnadir, IconoBorrar,
} from './Iconos.tsx';
import { grabarMicrofono, listarMicrofonos, type MicHandle, type DispositivoAudio } from './mic.ts';
import {
  grabarCamara, listarCamaras, abrirCamara,
  type CamHandle, type DispositivoVideo,
} from './camara.ts';
import { picos } from './timeline-calc.ts';
import { inicial, empujar, deshacer, rehacer, puedeDeshacer, puedeRehacer }
  from './historial.ts';

type Fase = 'inicio' | 'cuenta' | 'grabando' | 'editor';

/**
 * Columnas de la forma de onda.
 *
 * Fijo y generoso: la pista se amplia con el zoom de la linea de tiempo, y
 * recalcular los picos en cada cambio de escala haria trabajo de sobra para una
 * diferencia que no se ve. A 900 columnas una grabacion de tres minutos da una
 * columna cada 200 ms, suficiente para ver donde se hablo.
 */
const COLUMNAS_ONDA = 900;

const FONDOS: { nombre: string; bg: Background; css: string }[] = [
  { nombre: 'Degradado', bg: { kind: 'linear', from: '#6d5efc', to: '#c3f53c', angle: 135 }, css: 'linear-gradient(135deg,#6d5efc,#c3f53c)' },
  { nombre: 'Malla', bg: { kind: 'mesh', colors: ['#2b1b56', '#6d5efc', '#31c9a0', '#c3f53c'] }, css: 'radial-gradient(circle at 25% 25%,#6d5efc,transparent 60%),radial-gradient(circle at 75% 70%,#31c9a0,transparent 60%),#2b1b56' },
  { nombre: 'Sobrio', bg: { kind: 'solid', color: '#161a20' }, css: '#161a20' },
  { nombre: 'Sin fondo', bg: { kind: 'none' }, css: 'repeating-conic-gradient(#2a3038 0% 25%,#1b2027 0% 50%) 50%/12px 12px' },
];

export function App() {
  const [fase, setFase] = useState<Fase>('inicio');
  const [presets, setPresets] = useState<CapturePreset[]>([]);
  const [presetName, setPresetName] = useState('equilibrado');
  const [orientacion, setOrientacion] = useState<Orientacion>('horizontal');
  const [url, setUrl] = useState('http://localhost:3000');
  const [cuenta, setCuenta] = useState(3);
  const [stats, setStats] = useState({ frames: 0, elapsedMs: 0 });
  const [datos, setDatos] = useState<RecordingData | null>(null);
  const [error, setError] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [micDevices, setMicDevices] = useState<DispositivoAudio[]>([]);
  const [micDeviceId, setMicDeviceId] = useState('');
  const [tapar, setTapar] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [camDevices, setCamDevices] = useState<DispositivoVideo[]>([]);
  const [camDeviceId, setCamDeviceId] = useState('');
  /** Stream de previsualizacion: verse ANTES de grabar evita descubrir al
   *  terminar que la tapa estaba puesta o que se sale medio hombro. */
  const [camPreview, setCamPreview] = useState<MediaStream | null>(null);
  const [pausado, setPausado] = useState(false);
  /** Atajos que el sistema no dejo registrar, para poder avisar. */
  const [atajosFallidos, setAtajosFallidos] = useState<string[]>([]);
  const [nivel, setNivel] = useState(0);
  const mic = useRef<MicHandle | null>(null);
  const cam = useRef<CamHandle | null>(null);
  const videoPreview = useRef<HTMLVideoElement>(null);

  const [recientes, setRecientes] = useState<GrabacionReciente[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [tema, setTema] = useState<'oscuro' | 'claro'>('oscuro');

  useEffect(() => {
    void window.vitrina.capturePresets().then(setPresets);
    void window.vitrina.recientes().then(setRecientes);
    // Lo ultimo que se uso. Sin esto cada arranque volvia a localhost:3000 y al
    // preset de fabrica, aunque llevaras diez demos seguidas del mismo sitio.
    void window.vitrina.ajustes().then((a) => {
      setUrl(a.url);
      setPresetName(a.presetName);
      setOrientacion(a.orientacion);
      setMicOn(a.micOn);
      setMicDeviceId(a.micDeviceId);
      setTapar(a.tapar);
      setCamOn(a.camOn);
      setCamDeviceId(a.camDeviceId);
      setTema(a.tema);
    });
  }, []);

  useEffect(() => window.vitrina.onRecordProgress(setStats), []);

  // Los nombres de los dispositivos solo estan disponibles tras conceder
  // permiso, asi que la lista se pide despues del primer acceso al microfono.
  useEffect(() => {
    if (!micOn) return;
    void listarMicrofonos().then(setMicDevices);
  }, [micOn]);

  // Medidor de nivel mientras se graba: un demo narrado con el microfono mudo
  // se descubre al reproducirlo, que es el peor momento posible.
  useEffect(() => {
    if (fase !== 'grabando' || !mic.current) return;
    let raf = 0;
    const leer = () => {
      setNivel(mic.current?.nivel() ?? 0);
      raf = requestAnimationFrame(leer);
    };
    raf = requestAnimationFrame(leer);
    return () => cancelAnimationFrame(raf);
  }, [fase]);

  // Grabacion abierta desde la linea de comandos.
  useEffect(() => window.vitrina.onRecordingOpened((d) => {
    setDatos(d);
    setFase('editor');
  }), []);
  useEffect(() => window.vitrina.onRecordingError(setError), []);

  // Ya reencuadrado: lo que se ensena en las fichas de calidad es lo que se va
  // a capturar de verdad, no la version apaisada del preset.
  const elegido = presets.find((p) => p.name === presetName);
  const preset = elegido ? paraOrientacion(elegido, orientacion) : undefined;

  // El margen de zoom depende del tamano de salida y del marco, asi que se
  // muestra ya en la pantalla de grabacion: es antes de grabar cuando sirve.
  // Tiene que calcularse contra la salida REAL de esta orientacion: en vertical
  // la referencia es 1080x1920 con marco de movil, y el bisel come ancho util.
  const salidaInicial = preset ? defaultExportFor(preset.capture) : null;
  const presupuestoInicial = useMemo(() => {
    if (!preset || !salidaInicial) return null;
    return computeQualityBudget(
      preset.capture,
      { width: salidaInicial.w, height: salidaInicial.h },
      { fill: 0.8, chrome: orientacion === 'vertical' ? 'phone' : 'macos' },
    );
  }, [preset?.capture.w, preset?.capture.h, salidaInicial?.w, salidaInicial?.h, orientacion]);

  // El tema se aplica a la raiz y se guarda al cambiarlo, no al grabar: es un
  // ajuste de la ventana, no de la demo.
  useEffect(() => {
    document.documentElement.dataset['tema'] = tema;
  }, [tema]);

  // La lista de camaras solo trae etiquetas utiles con permiso concedido, igual
  // que la de microfonos: se pide al encender la camara, no al arrancar la app.
  useEffect(() => {
    if (!camOn) {
      camPreview?.getTracks().forEach((t) => t.stop());
      setCamPreview(null);
      return;
    }
    let vivo = true;
    let abierto: MediaStream | null = null;
    void (async () => {
      try {
        abierto = await abrirCamara(camDeviceId || undefined);
        if (!vivo) { abierto.getTracks().forEach((t) => t.stop()); return; }
        setCamPreview(abierto);
        setCamDevices(await listarCamaras());
      } catch (e) {
        setError(`Sin camara: ${e instanceof Error ? e.message : String(e)}`);
        setCamOn(false);
      }
    })();
    return () => {
      vivo = false;
      abierto?.getTracks().forEach((t) => t.stop());
    };
    // `camPreview` no va en las dependencias a proposito: lo escribe este mismo
    // efecto, y meterlo lo haria reabrir la camara en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn, camDeviceId]);

  useEffect(() => {
    if (videoPreview.current) videoPreview.current.srcObject = camPreview;
  }, [camPreview]);

  const grabar = useCallback(async () => {
    setError('');
    setFase('cuenta');
    for (let i = 3; i > 0; i--) {
      setCuenta(i);
      await new Promise((r) => setTimeout(r, 900));
    }
    try {
      // La carpeta se reserva antes porque el audio necesita donde escribir, y
      // arranca antes que el video: abrir el navegador tarda un par de segundos
      // y falta de sonido al principio no se puede inventar. Sobrar, si.
      await window.vitrina.prepareRecording();
      if (micOn) {
        try {
          mic.current = await grabarMicrofono(micDeviceId || undefined);
        } catch (e) {
          // Sin microfono se graba igual: perder la demo entera porque falle el
          // audio seria peor que quedarse sin narracion.
          setError(`Sin audio: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (camOn) {
        try {
          // La previsualizacion se cierra antes de grabar: dos capturas del
          // mismo dispositivo a la vez es pedirle un problema a la camara.
          camPreview?.getTracks().forEach((t) => t.stop());
          setCamPreview(null);
          cam.current = await grabarCamara(camDeviceId || undefined);
        } catch (e) {
          // Igual que con el microfono: perder la demo entera porque falle la
          // camara seria peor que quedarse sin burbuja.
          setError(`Sin camara: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // Se guardan al grabar y no al teclear: escribir media URL y cerrar no
      // deberia dejarla puesta para la proxima vez.
      void window.vitrina.guardarAjustes({
        url, presetName, orientacion, micOn, micDeviceId, tapar, camOn, camDeviceId,
      });
      const r = await window.vitrina.startRecording(url, presetName, orientacion, tapar);
      setAtajosFallidos(r?.atajosFallidos ?? []);
      setPausado(false);
      setStats({ frames: 0, elapsedMs: 0 });
      setFase('grabando');
    } catch (e) {
      await mic.current?.detener().catch(() => {});
      mic.current = null;
      await cam.current?.detener().catch(() => {});
      cam.current = null;
      setError(e instanceof Error ? e.message : String(e));
      setFase('inicio');
    }
  }, [url, presetName, orientacion, micOn, micDeviceId, tapar, camOn, camDeviceId, camPreview]);

  // El atajo global de parar pasa por aqui y no por el proceso principal: el
  // microfono lo lleva el renderer y hay que cerrarlo antes de que se escriba
  // el manifest.
  useEffect(() => window.vitrina.onAtajoGrabacion((que) => {
    if (que === 'parar') void pararRef.current?.();
  }), []);
  useEffect(() => window.vitrina.onPausaCambiada(setPausado), []);

  const parar = useCallback(async () => {
    try {
      // El audio se cierra ANTES de parar el video: `record:stop` escribe el
      // manifest y necesita que la pista ya este cerrada para anotarla.
      await mic.current?.detener().catch(() => {});
      mic.current = null;
      // La camara tambien se cierra ANTES de parar el video, por lo mismo: el
      // manifest se escribe en `record:stop` y necesita la pista ya cerrada.
      await cam.current?.detener().catch(() => {});
      cam.current = null;
      setDatos(await window.vitrina.stopRecording());
      setFase('editor');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFase('inicio');
    }
  }, []);

  // `parar` se crea despues del efecto que escucha el atajo, asi que va por
  // referencia: capturarla directamente dejaria la version del primer render.
  const pararRef = useRef<(() => Promise<void>) | null>(null);
  pararRef.current = parar;

  const abrirDir = useCallback(async (dir: string) => {
    try {
      setDatos(await window.vitrina.loadRecording(dir));
      setFase('editor');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /**
   * Soltar una carpeta `.vitrina` sobre la ventana la abre.
   *
   * Es el gesto que todo el mundo prueba antes de buscar el boton, y hasta
   * ahora el navegador respondia navegando al fichero: la app desaparecia y
   * habia que reabrirla.
   */
  const soltar = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setArrastrando(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const ruta = window.vitrina.rutaDeFichero(f);
    if (!ruta.endsWith('.vitrina')) {
      setError('Eso no es una carpeta .vitrina. Suelta la carpeta entera, no un frame.');
      return;
    }
    void abrirDir(ruta);
  }, [abrirDir]);

  const abrir = useCallback(async () => {
    const d = await window.vitrina.openRecording();
    if (d) {
      setDatos(d);
      setFase('editor');
    }
  }, []);

  if (fase === 'editor' && datos) {
    return (
      <Editor
        key={datos.dir}
        datos={datos}
        onSalir={() => { setDatos(null); setFase('inicio'); }}
        onAbrir={setDatos}
      />
    );
  }

  if (fase === 'cuenta') {
    return (
      <div className="app">
        <div className="centro">
          <div className="cuenta">{cuenta}</div>
          <p style={{ color: 'var(--dim)' }}>Se abrirá una ventana con tu app. Haz la demo ahí.</p>
        </div>
      </div>
    );
  }

  if (fase === 'grabando') {
    return (
      <div className="app">
        <div className="centro">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="pulso" />
            <span style={{ fontSize: 17, fontWeight: 600 }}>Grabando</span>
          </div>
          <div className="stats">
            <span><b>{(stats.elapsedMs / 1000).toFixed(1)}</b> s</span>
            <span><b>{stats.frames}</b> frames</span>
            <span><b>{(stats.frames / Math.max(0.1, stats.elapsedMs / 1000)).toFixed(0)}</b> fps</span>
          </div>
          {mic.current ? (
            <div className="medidor" title="Nivel del microfono">
              <div style={{ transform: `scaleX(${nivel.toFixed(3)})` }} />
            </div>
          ) : null}
          {/* Si el microfono fallo hay que decirlo AQUI. Enterarse al reproducir
              significa repetir la demo entera. */}
          {error && <p className="error" style={{ maxWidth: 460 }}>{error}</p>}
          {pausado && (
            <p className="sutil" style={{ color: 'var(--acc)' }}>
              En pausa · el trozo pausado no saldrá en el vídeo
            </p>
          )}
          <div className="fila" style={{ gap: 10 }}>
            <button onClick={() => void window.vitrina.pausarGrabacion()}>
              {pausado ? 'Reanudar' : 'Pausar'}
            </button>
            <button onClick={() => void window.vitrina.marcarMomento()} disabled={pausado}
                    title="Deja una chincheta en este instante para encontrarlo luego">
              Señalar momento
            </button>
            <button className="primario" onClick={() => void parar()}>Parar y editar</button>
          </div>
          {/* Los atajos se dicen aqui porque su gracia es usarlos con esta
              ventana detras: leerlos en el README no sirve de nada. */}
          <p className="sutil" style={{ maxWidth: 460, textAlign: 'center' }}>
            Sin volver aquí: <b>Ctrl+Mayús+S</b> para parar, <b>Ctrl+Mayús+P</b>{' '}
            para pausar y <b>Ctrl+Mayús+M</b> para señalar un momento.
          </p>
          {atajosFallidos.length > 0 && (
            <p className="sutil" style={{ maxWidth: 460, textAlign: 'center' }}>
              Estos no los concedió el sistema, seguramente porque otra app los
              usa: <b>{atajosFallidos.join(', ')}</b>. Los demás sí funcionan.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`app${arrastrando ? ' soltando' : ''}`}
         onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
         onDragLeave={() => setArrastrando(false)}
         onDrop={soltar}>
      <div className="inicio">
        <div className="marca">
          <h1>Vitrina</h1>
          <span>demos de apps web con zoom automático</span>
          <button className="tema" title="Cambiar el aspecto de la app"
                  onClick={() => {
                    const otro = tema === 'oscuro' ? 'claro' : 'oscuro';
                    setTema(otro);
                    void window.vitrina.guardarAjustes({ tema: otro });
                  }}>
            {tema === 'oscuro' ? 'Claro' : 'Oscuro'}
          </button>
        </div>

        <div className="campo">
          <label htmlFor="url">Dirección de tu app</label>
          <input id="url" type="text" value={url} onChange={(e) => setUrl(e.target.value)}
                 placeholder="http://localhost:3000" spellCheck={false} />
        </div>

        <div className="campo">
          <label>Formato</label>
          <div className="fila">
            <button className={orientacion === 'horizontal' ? 'on' : ''}
                    onClick={() => setOrientacion('horizontal')}>
              Horizontal <small>16:9</small>
            </button>
            <button className={orientacion === 'vertical' ? 'on' : ''}
                    onClick={() => setOrientacion('vertical')}>
              Vertical <small>9:16 · TikTok, Reels</small>
            </button>
          </div>
          {orientacion === 'vertical' && (
            <p className="nota-formato">
              La ventana se abre a <b>{preset?.css?.w ?? 430} px</b> como un móvil
              de verdad, así que tu web enseña su diseño móvil. Se captura a
              escala ×{preset?.dsf ?? 2}: sale nítida pese a la pantalla pequeña.
              <br />
              {/* Los fps de abajo son los medidos EN HORIZONTAL. Se dicen asi de
                  claro porque todo el proyecto se apoya en no prometer numeros
                  sin medir, y en vertical no se han medido. */}
              Los fps de abajo están medidos en horizontal; en vertical pueden ser
              menores. Para medirlo en tu equipo:{' '}
              <code>node tools/calibrar.ts --vertical</code>.
            </p>
          )}
        </div>

        <div className="campo">
          <label>Calidad de captura</label>
          <div className="presets">
            {presets.map((p) => {
              const t = paraOrientacion(p, orientacion);
              return (
                <button key={p.name} className={`preset${p.name === presetName ? ' on' : ''}`}
                        onClick={() => setPresetName(p.name)}>
                  <b>{t.capture.w}×{t.capture.h}</b>
                  {/* El ancho de maquetacion explica por que la UI se ve del
                      tamano que se ve, y es lo que antes se inflaba hasta 2560
                      para comprar margen de zoom. Ahora se compra con escala. */}
                  <small>tu web a {t.css?.w ?? t.capture.w} px</small>
                  <small>~{p.measuredFps} fps</small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="campo">
          <label>Narración</label>
          <div className="fila">
            <button className={micOn ? 'on' : ''} onClick={() => setMicOn(true)}>Con micrófono</button>
            <button className={!micOn ? 'on' : ''} onClick={() => setMicOn(false)}>Sin audio</button>
          </div>
          {micOn && micDevices.length > 1 && (
            <select value={micDeviceId} onChange={(e) => setMicDeviceId(e.target.value)}>
              <option value="">Micrófono predeterminado</option>
              {micDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          )}
        </div>

        <div className="campo">
          <label>Cámara</label>
          <div className="fila">
            <button className={camOn ? 'on' : ''} onClick={() => setCamOn(true)}>
              Con cámara
            </button>
            <button className={!camOn ? 'on' : ''} onClick={() => setCamOn(false)}>
              Sin cámara
            </button>
          </div>
          {camOn && (
            <>
              {camDevices.length > 1 && (
                <select value={camDeviceId} onChange={(e) => setCamDeviceId(e.target.value)}>
                  <option value="">Cámara predeterminada</option>
                  {camDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                  ))}
                </select>
              )}
              {/* Redonda y del tamano de la burbuja: lo que se ve aqui es lo que
                  va a salir, incluido el recorte. Un rectangulo mentiria sobre
                  cuanto encuadre se pierde por los lados. */}
              <video ref={videoPreview} className="camara-previa"
                     autoPlay muted playsInline />
              <p className="nota-formato">
                Se graba aparte del vídeo, así que luego puedes moverla, cambiar
                su tamaño o quitarla sin volver a grabar.
              </p>
            </>
          )}
        </div>

        <div className="campo">
          <label htmlFor="tapar">Tapar datos sensibles</label>
          <input id="tapar" type="text" value={tapar} spellCheck={false}
                 onChange={(e) => setTapar(e.target.value)}
                 placeholder="#saldo, .email, [data-privado]" />
          <p className="nota-formato">
            Escribe qué partes de tu web no deben salir, con el selector CSS de
            cada una. Se difuminan <b>mientras grabas</b>, así que el dato nunca
            llega al vídeo ni queda en la carpeta.
            <br />
            Se difuminan en vez de ocultarse para no mover nada de sitio: si
            desaparecieran, los botones cambiarían de sitio y el zoom acabaría
            encuadrando otra cosa.
          </p>
        </div>

        {presupuestoInicial && (
          <div className={`nota-calidad${presupuestoInicial.maxSharpZoom < 1.15 ? ' aviso' : ''}`}>
            <span>Exportando a {salidaInicial?.w}×{salidaInicial?.h}:</span>
            <b>{describeBudget(presupuestoInicial)}</b>
          </div>
        )}

        {/* Flotante y no en la columna: apareciendo entre los campos empujaba
            todo hacia abajo y el boton de Grabar se movia debajo del cursor. */}
        {error && (
          <div className="aviso-flotante" role="alert" onClick={() => setError('')}>
            {error}
            <span>Toca para cerrar</span>
          </div>
        )}

        <div className="acciones">
          <button className="primario" onClick={() => void grabar()}>Grabar</button>
          <button onClick={() => void abrir()}>Abrir grabación</button>
        </div>

        <div className="campo">
          <label>Recientes</label>
          {recientes.length > 0 ? (
            <div className="recientes">
              {recientes.map((r) => (
                <button key={r.dir} className="reciente" title={r.dir}
                        onClick={() => void abrirDir(r.dir)}>
                  {/* El sello dice cual es cual mucho antes que la fecha: una
                      lista de horas no distingue dos demos del mismo dia. */}
                  {r.miniatura
                    ? <img src={r.miniatura} alt="" />
                    : <span className="sello-vacio" />}
                  <b>{new Date(r.startedAt).toLocaleString()}</b>
                  <small>{(r.durationMs / 1000).toFixed(1)}s</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="nota-formato">
              Aquí aparecerán tus grabaciones. También puedes arrastrar una
              carpeta <code>.vitrina</code> hasta esta ventana para abrirla.
            </p>
          )}
        </div>

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Editor(
  { datos, onSalir, onAbrir }: {
    datos: RecordingData;
    onSalir: () => void;
    /** Cambiar a otra grabacion sin pasar por la pantalla de inicio. */
    onAbrir: (d: RecordingData) => void;
  },
) {
  /**
   * Lo que se deshace es el estado de edicion ENTERO, no solo el proyecto.
   *
   * Los tramos de zoom viven en su propio estado —ver mas abajo por que no se
   * derivan— y son justo lo que mas se quiere deshacer: borrar uno por error es
   * el accidente tipico. Un historial que solo cubriera `project` dejaria el
   * boton puesto y sin efecto, que es peor que no tenerlo.
   */
  const [hist, setHist] = useState(() => inicial({
    project: datos.project,
    zooms: datos.project.zooms,
  }));
  const { project, zooms } = hist.presente;

  // Las dos con la misma firma que `useState`, para que los sitios que ya las
  // llaman no se enteren de nada.
  const setProject = useCallback((accion: Project | ((p: Project) => Project)) => {
    setHist((h) => {
      const siguiente = typeof accion === 'function'
        ? (accion as (p: Project) => Project)(h.presente.project)
        : accion;
      if (Object.is(siguiente, h.presente.project)) return h;
      return empujar(h, { ...h.presente, project: siguiente }, performance.now());
    });
  }, []);
  const setZooms = useCallback((accion: ZoomSegment[] | ((z: ZoomSegment[]) => ZoomSegment[])) => {
    setHist((h) => {
      const siguiente = typeof accion === 'function'
        ? (accion as (z: ZoomSegment[]) => ZoomSegment[])(h.presente.zooms)
        : accion;
      if (Object.is(siguiente, h.presente.zooms)) return h;
      return empujar(h, { ...h.presente, zooms: siguiente }, performance.now());
    });
  }, []);
  const [camara, setCamara] = useState<CameraPresetName>('normal');
  const [tMs, setTMs] = useState(0);
  const [reproduciendo, setReproduciendo] = useState(false);

  // Los tramos son ESTADO, no un valor derivado. En cuanto se pueden editar a
  // mano, recalcularlos en cada render borraria el trabajo del usuario. Viven
  // dentro del historial, arriba, junto al proyecto.
  const [seleccion, setSeleccion] = useState<number | null>(null);
  /**
   * La hoja de atajos tiene tres estados y no dos.
   *
   * Hace falta el de salida para que se cierre por el mismo camino por el que
   * entro: quitarla del arbol de golpe la hace desaparecer, y una cosa que
   * entra desvaneciendose y sale de golpe se lee como un fallo.
   */
  const [mudo, setMudo] = useState(false);
  const [atajos, setAtajos] = useState<'oculto' | 'abierto' | 'cerrando'>('oculto');
  const cerrarAtajos = useCallback(() => {
    setAtajos((v) => (v === 'abierto' ? 'cerrando' : v));
    // Lo mismo que dura la animacion de salida. Quitarla antes la cortaria a
    // media transicion; dejarla mas tiempo la congelaria invisible.
    window.setTimeout(() => setAtajos((v) => (v === 'cerrando' ? 'oculto' : v)), 180);
  }, []);
  // El manejador de teclas vive en un efecto con sus propias dependencias: sin
  // esta referencia leeria el estado del render en que se registro.
  const atajosRef = useRef(atajos);
  useEffect(() => { atajosRef.current = atajos; }, [atajos]);
  const [looks, setLooks] = useState<Look[]>([]);
  const [repitiendo, setRepitiendo] = useState(false);
  const [calidadRepeticion, setCalidadRepeticion] = useState('');
  const [lookPorDefecto, setLookPorDefecto] = useState<string | null>(null);
  const [presetsCaptura, setPresetsCaptura] = useState<CapturePreset[]>([]);
  const [errorRepeticion, setErrorRepeticion] = useState('');

  useEffect(() => {
    void window.vitrina.ajustes().then((a) => {
      setLooks(a.looks);
      setLookPorDefecto(a.lookPorDefecto);
    });
    void window.vitrina.capturePresets().then(setPresetsCaptura);
  }, []);

  const lienzo = useRef<HTMLCanvasElement>(null);
  const preview = useRef<Preview | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const camEl = useRef<HTMLVideoElement>(null);
  /** Ultima posicion del puntero mientras se reencuadra sobre el lienzo. */
  const arrastreLienzo = useRef<{ x: number; y: number } | null>(null);

  const fuente = datos.manifest.capture ?? datos.manifest.viewport;
  const duracion = datos.manifest.durationMs;

  const presupuesto = useMemo(
    () => computeQualityBudget(fuente, project.export, project.frame),
    [fuente, project.export, project.frame],
  );

  const cursorPath = useMemo(
    () => new CursorPath(datos.events, datos.manifest.startedAt),
    [datos],
  );

  const editado = hasManualEdits(zooms);

  // El mismo mapa que usa el exportador. Si el preview no lo usara,
  // reproduciria los silencios que el video final quita.
  const mapa = useMemo(() => new TimeMap({
    durationMs: duracion,
    trimStartMs: project.trimStartMs,
    trimEndMs: project.trimEndMs,
    cuts: project.cuts,
    speeds: project.speeds,
  }), [duracion, project.trimStartMs, project.trimEndMs, project.cuts, project.speeds]);

  // Se calcula siempre, no al pulsar: el boton tiene que poder decir cuanto se
  // ahorraria ANTES de tocarlo, igual que el indicador de zoom nitido dice lo
  // que se va a conseguir antes de grabar.
  const propuesta = useMemo(
    () => tramosSinActividad(datos.events, datos.manifest.startedAt, duracion),
    [datos.events, datos.manifest.startedAt, duracion],
  );

  const acelerarEsperas = useCallback(() => {
    setProject((p) => ({ ...p, speeds: propuesta }));
  }, [propuesta]);

  const repetir = useCallback(async () => {
    setRepitiendo(true);
    try {
      // Se guarda antes: la repeticion copia el project.json del disco, y sin
      // volcar lo editado se repetiria con la version anterior.
      await guardar();
      onAbrir(await window.vitrina.repetirGrabacion(
        datos.dir, calidadRepeticion || undefined));
    } catch (e) {
      setErrorRepeticion(e instanceof Error ? e.message : String(e));
    } finally {
      setRepitiendo(false);
    }
  }, [datos.dir, calidadRepeticion]);

  const guardarLook = useCallback(async () => {
    const nombre = window.prompt('Nombre del look', `Look ${looks.length + 1}`)?.trim();
    if (!nombre) return;
    // Un nombre repetido sustituye en vez de duplicar: dos looks iguales en la
    // lista no le sirven a nadie.
    const nuevo: Look = {
      nombre,
      background: project.background,
      frame: project.frame,
      watermark: project.watermark ?? null,
    };
    const lista = [...looks.filter((l) => l.nombre !== nombre), nuevo];
    setLooks(lista);
    await window.vitrina.guardarAjustes({ looks: lista });
  }, [looks, project.background, project.frame, project.watermark]);

  const usarLook = useCallback((l: Look) => {
    setProject((p) => ({
      ...p,
      background: l.background,
      frame: l.frame,
      watermark: l.watermark ?? null,
    }));
  }, [setProject]);

  const marcarPorDefecto = useCallback(async (nombre: string | null) => {
    setLookPorDefecto(nombre);
    await window.vitrina.guardarAjustes({ lookPorDefecto: nombre });
  }, []);

  const elegirMarca = useCallback(async () => {
    const ruta = await window.vitrina.elegirMarca(datos.dir);
    if (!ruta) return;
    setProject((p) => ({
      ...p,
      watermark: { path: ruta, esquina: 'se', opacity: 0.75, scale: 0.12 },
    }));
  }, [datos.dir, setProject]);

  const replanificar = useCallback((preset: CameraPresetName) => {
    const config = cameraConfigForBudget(CAMERA_PRESETS[preset], presupuesto.maxSharpZoom);
    setZooms(planSegments({
      events: datos.events, viewport: fuente,
      startedAt: datos.manifest.startedAt, durationMs: duracion, config,
    }));
    setSeleccion(null);
  }, [datos, fuente, duracion, presupuesto.maxSharpZoom]);

  const cambiarCamara = (preset: CameraPresetName) => {
    setCamara(preset);
    // Con ediciones a mano no se replanifica sola: replanificar las descarta, y
    // eso tiene que pedirlo el usuario, no ocurrirle.
    if (!editado) replanificar(preset);
  };

  // El margen de zoom depende del marco, asi que al apretar el padding las
  // escalas guardadas pueden pasarse. Se recortan para PINTAR, sin tocar el
  // valor almacenado: al aflojar el marco vuelve la ampliacion original. Es la
  // misma regla que aplica el exportador, para que el preview no mienta.
  const zoomsVisibles = useMemo(
    () => zooms.map((z) => (z.scale <= presupuesto.maxSharpZoom
      ? z
      : { ...z, scale: presupuesto.maxSharpZoom })),
    [zooms, presupuesto.maxSharpZoom],
  );
  const recortados = zooms.filter((z) => z.scale > presupuesto.maxSharpZoom).length;

  const proyectoVivo = useMemo<Project>(
    () => ({ ...project, zooms: zoomsVisibles }),
    [project, zoomsVisibles],
  );

  const track = useMemo(
    () => makeTrack(datos.manifest, datos.events, proyectoVivo,
      cameraConfigForBudget(CAMERA_PRESETS[camara], presupuesto.maxSharpZoom)),
    [datos, proyectoVivo, camara, presupuesto.maxSharpZoom],
  );

  useEffect(() => {
    const p = new Preview(datos.manifest, datos.events, track);
    preview.current = p;
    return () => { p.destroy(); preview.current = null; };
  }, [datos]);

  useEffect(() => { preview.current?.setTrack(track); }, [track]);

  useEffect(() => {
    if (lienzo.current) void preview.current?.draw(lienzo.current, tMs, proyectoVivo);
  }, [tMs, proyectoVivo]);

  useEffect(() => {
    if (!reproduciendo) return;
    let raf = 0;
    let anterior = performance.now();
    const paso = (ahora: number) => {
      const dt = ahora - anterior;
      anterior = ahora;
      setTMs((t) => {
        // Se avanza al ritmo del tramo: en uno acelerado se consume mas
        // material por segundo real. Sin esto el preview reproduciria a tiempo
        // real algo que el export acelera.
        const rate = mapa.rateAt(t);
        const siguiente = t + dt * rate;
        if (audio.current && audio.current.playbackRate !== rate) {
          audio.current.playbackRate = rate;
        }
        // La burbuja se acelera con el video: si no, la cara iria a tiempo real
        // sobre un tramo acelerado y se notaria al instante.
        if (camEl.current && camEl.current.playbackRate !== rate) {
          camEl.current.playbackRate = rate;
        }
        if (siguiente >= duracion) {
          setReproduciendo(false);
          return duracion;
        }
        // Al entrar en un corte se salta al otro lado. El audio hay que
        // recolocarlo a mano: durante la reproduccion el efecto de seek esta
        // desactivado para no hacerlo tartamudear en cada frame.
        const saltado = mapa.skip(siguiente);
        if (saltado !== siguiente && audio.current) {
          audio.current.currentTime = Math.max(0, tiempoAudio(saltado));
        }
        if (saltado !== siguiente && camEl.current) {
          camEl.current.currentTime = Math.max(0, tiempoCam(saltado));
        }
        return saltado;
      });
      raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reproduciendo, duracion, mapa]);

  // Guardado diferido: arrastrar un tramo dispara decenas de cambios y no tiene
  // sentido escribir project.json en cada uno.
  const guardar = useCallback(
    () => window.vitrina.saveProject(datos.dir, proyectoVivo),
    [datos.dir, proyectoVivo],
  );
  useEffect(() => {
    const id = setTimeout(() => void guardar(), 500);
    return () => clearTimeout(id);
  }, [guardar]);

  const borrarSeleccion = useCallback(() => {
    setSeleccion((i) => {
      if (i === null) return null;
      setZooms((z) => deleteSegment(z, i));
      return null;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // La guardia es imprescindible: sin ella, escribir una flecha o una zeta
      // en un campo de texto dispararia los atajos.
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;

      const mando = e.ctrlKey || e.metaKey;
      if (mando && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setHist((h) => (e.shiftKey ? rehacer(h) : deshacer(h)));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') borrarSeleccion();
      if (e.key === ' ') { e.preventDefault(); setReproduciendo((r) => !r); }

      // Un frame a 60 fps, o un segundo con Shift: mover la aguja a mano es
      // como se afina un corte, y arrastrando no se llega al frame exacto.
      const paso = e.shiftKey ? 1000 : 1000 / 60;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setReproduciendo(false);
        const d = e.key === 'ArrowLeft' ? -paso : paso;
        setTMs((t) => Math.min(duracion, Math.max(0, t + d)));
      }
      if (e.key === 'Home') { setReproduciendo(false); setTMs(0); }
      if (e.key === 'End') { setReproduciendo(false); setTMs(duracion); }
      // Los atajos existian y no se veian en ninguna parte: quien no leyera el
      // README no sabia que estaban.
      if (e.key === '?') {
        if (atajosRef.current === 'abierto') cerrarAtajos();
        else setAtajos('abierto');
      }
      if (e.key === 'Escape') cerrarAtajos();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [borrarSeleccion, duracion, cerrarAtajos]);

  const anadirTramo = () => {
    // Se centra donde estaba el cursor en ese instante: es donde estaba pasando
    // algo, asi que casi siempre es el encuadre que se queria.
    const p = cursorPath.at(tMs) ?? { x: fuente.w / 2, y: fuente.h / 2 };
    const nuevos = insertSegment(zooms, tMs, {
      durationMs: duracion, center: p, viewport: fuente,
      scale: Math.min(1.5, presupuesto.maxSharpZoom), label: 'manual',
    });
    if (nuevos.length === zooms.length) return;   // no cabia
    setZooms(nuevos);
    setSeleccion(nuevos.findIndex((z) => z.startMs <= tMs && z.endMs > tMs));
  };

  const cortes = project.cuts ?? [];
  const [buscando, setBuscando] = useState(false);
  const [sinSilencios, setSinSilencios] = useState(false);

  const cortarSilencios = async () => {
    setBuscando(true);
    setSinSilencios(false);
    try {
      const encontrados: Cut[] = await window.vitrina.detectarSilencios(datos.dir);
      setProject((p) => ({ ...p, cuts: encontrados }));
      setSinSilencios(encontrados.length === 0);
    } finally {
      setBuscando(false);
    }
  };

  const elegirImagen = async () => {
    const archivo = await window.vitrina.chooseBackground(datos.dir);
    if (!archivo) return;
    // Desenfoque por defecto: una foto nitida detras compite con la demo, que
    // es lo que se supone que hay que mirar.
    setProject((p) => ({ ...p, background: { kind: 'image', path: archivo, blur: 18 } }));
  };

  const setMarco = (parcial: Partial<Project['frame']>) =>
    setProject((p) => ({ ...p, frame: { ...p.frame, ...parcial } }));

  // Instante del fichero de audio que corresponde al tiempo de video actual.
  // Es la misma cuenta que hace `audioAlignment` al exportar; si divergieran, el
  // preview sonaria sincronizado y el export no, o al reves.
  //
  // La posicion se fija siempre con `currentTime`, nunca a partir de
  // `duration`: el WebM de MediaRecorder no lleva duracion en la cabecera y el
  // elemento reporta `Infinity`. La duracion real la manda el video.
  const pista = datos.manifest.audio ?? null;
  const tiempoAudio = (ms: number) =>
    (datos.manifest.startedAt - (pista?.startedAt ?? 0) + ms) / 1000;

  // La camara tiene el mismo desfase que la narracion y se resuelve igual: se
  // grabo en otro proceso y arranco antes que el video.
  const pistaCam = datos.manifest.camara ?? null;

  // Momentos senalados durante la grabacion. Se calculan una vez: el log no
  // cambia mientras el editor esta abierto.
  const hitos = useMemo(
    () => datos.events
      .filter((e) => e.type === 'mark')
      .map((e) => ({ ms: e.t - datos.manifest.startedAt, label: e.label })),
    [datos],
  );
  const tiempoCam = (ms: number) =>
    (datos.manifest.startedAt - (pistaCam?.startedAt ?? 0) + ms) / 1000;

  // La narracion se descarga entera a un blob en vez de dejar que el elemento
  // la reproduzca en streaming. El WebM de MediaRecorder no lleva duracion ni
  // indices —es un flujo en vivo—, y pedirle al reproductor que busque dentro
  // de algo asi servido por un protocolo propio es fragil: unas veces cargaba
  // y otras se quedaba en HAVE_NOTHING. Con el fichero completo en memoria el
  // seek del scrubbing es inmediato y fiable.
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [camUrl, setCamUrl] = useState<string | null>(null);
  const [escalaTl, setEscalaTl] = useState(1);
  const [onda, setOnda] = useState<Float32Array | null>(null);
  useEffect(() => {
    if (!pista) return;
    let url: string | null = null;
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(`vitrina://${pista.file}`);
        const bytes = await res.arrayBuffer();
        if (!vivo) return;
        url = URL.createObjectURL(new Blob([bytes], { type: pista.mimeType }));
        setAudioUrl(url);

        // La onda se decodifica del mismo fichero que ya se ha traido, no de
        // otra peticion: es el mismo audio y bajarlo dos veces solo anadiria
        // latencia. `decodeAudioData` consume el buffer, asi que se le pasa una
        // copia o el elemento <audio> se quedaria sin datos.
        const ctx = new AudioContext();
        try {
          const buf = await ctx.decodeAudioData(bytes.slice(0));
          if (vivo) setOnda(picos(buf.getChannelData(0), COLUMNAS_ONDA));
        } finally {
          void ctx.close();
        }
      } catch {
        setAudioUrl(null);
        setOnda(null);
      }
    })();
    return () => {
      vivo = false;
      if (url) URL.revokeObjectURL(url);
      setAudioUrl(null);
      setOnda(null);
    };
  }, [pista]);

  // La camara se trae a un blob por la misma razon que la narracion: el WebM de
  // MediaRecorder no lleva duracion ni indices, y buscar dentro de el a traves
  // de un protocolo propio es fragil.
  useEffect(() => {
    if (!pistaCam) return;
    let url: string | null = null;
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(`vitrina://${pistaCam.file}`);
        const bytes = await res.arrayBuffer();
        if (!vivo) return;
        url = URL.createObjectURL(new Blob([bytes], { type: pistaCam.mimeType }));
        setCamUrl(url);
      } catch {
        setCamUrl(null);
      }
    })();
    return () => {
      vivo = false;
      if (url) URL.revokeObjectURL(url);
      setCamUrl(null);
    };
  }, [pistaCam]);

  // El compositor dibuja la burbuja desde este elemento: no se copia el frame a
  // ningun sitio, se le pasa el <video> tal cual.
  useEffect(() => {
    preview.current?.setCam(camUrl ? camEl.current : null);
    if (lienzo.current) void preview.current?.draw(lienzo.current, tMs, proyectoVivo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camUrl, datos]);

  // Un <video> decodifica cuando puede, no cuando se le pide: al abrir el editor
  // y despues de cada salto el frame llega DESPUES del ultimo repintado, asi que
  // la burbuja se quedaria vacia o con la cara del instante anterior hasta que
  // algo mas obligara a repintar. Lo caza la verificacion de camara por pixeles.
  // Silenciar es solo para editar: el mp4 se monta con la narracion pase lo que
  // pase aqui. Editar oyendo la misma frase cuarenta veces cansa.
  useEffect(() => {
    if (audio.current) audio.current.muted = mudo;
  }, [mudo]);

  useEffect(() => {
    const el = camEl.current;
    if (!el || !camUrl) return;
    const repintar = () => {
      if (lienzo.current) void preview.current?.draw(lienzo.current, tMs, proyectoVivo);
    };
    el.addEventListener('loadeddata', repintar);
    el.addEventListener('seeked', repintar);
    return () => {
      el.removeEventListener('loadeddata', repintar);
      el.removeEventListener('seeked', repintar);
    };
  }, [camUrl, tMs, proyectoVivo]);

  useEffect(() => {
    const el = camEl.current;
    if (!el || !camUrl) return;
    if (reproduciendo) {
      el.currentTime = Math.max(0, tiempoCam(tMs));
      void el.play().catch(() => {});
    } else {
      el.pause();
      // Parado hay que recolocarlo a mano, o la burbuja ensenaria el ultimo
      // frame reproducido mientras la aguja esta en otro sitio.
      el.currentTime = Math.max(0, tiempoCam(tMs));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reproduciendo, camUrl, tMs]);

  useEffect(() => {
    const el = audio.current;
    if (!el || !audioUrl) return;
    if (reproduciendo) {
      el.currentTime = Math.max(0, tiempoAudio(tMs));
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
    // `tMs` queda fuera a proposito: reajustar el audio en cada frame lo
    // dejaria tartamudeando. Solo se recoloca al arrancar o al parar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reproduciendo, audioUrl]);

  // Al mover la aguja con el audio parado, recolocarlo para que al dar a
  // reproducir suene desde donde toca.
  useEffect(() => {
    const el = audio.current;
    if (!el || !audioUrl || reproduciendo) return;
    el.currentTime = Math.max(0, tiempoAudio(tMs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tMs, audioUrl, reproduciendo]);

  const sel = seleccion !== null ? zooms[seleccion] : undefined;

  // Reencuadrar solo tiene sentido si se esta VIENDO el tramo que se edita: con
  // la aguja fuera, el lienzo muestra otro momento y arrastrar moveria a ciegas
  // un encuadre que no esta en pantalla.
  const puedeEncuadrar = !!sel && tMs >= sel.startMs && tMs <= sel.endMs;

  const encuadrePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!puedeEncuadrar) return;
    arrastreLienzo.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const encuadrePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const previo = arrastreLienzo.current;
    const cv = lienzo.current;
    if (!previo || !cv || seleccion === null) return;

    // Del gesto en pantalla a pixeles de la fuente hay dos conversiones: el
    // lienzo se muestra reescalado por CSS, y dentro del lienzo la ventana
    // dibuja una region de la fuente que depende del zoom actual.
    const caja = cv.getBoundingClientRect();
    const aLienzo = caja.width > 0 ? cv.width / caja.width : 1;
    const layout = layoutFrame(fuente, project.export, project.frame);
    const vista = viewRect(track.sampleAt(tMs), fuente);
    const aFuente = layout.content.w > 0 ? vista.w / layout.content.w : 1;

    const dx = (e.clientX - previo.x) * aLienzo * aFuente;
    const dy = (e.clientY - previo.y) * aLienzo * aFuente;
    arrastreLienzo.current = { x: e.clientX, y: e.clientY };

    // Signo invertido: se arrastra la IMAGEN, no la camara. Mover el contenido
    // a la derecha destapa lo que habia a la izquierda.
    setZooms((z) => moveSegmentTarget(z, seleccion, -dx, -dy, fuente));
  };

  const encuadreSoltar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (arrastreLienzo.current) e.currentTarget.releasePointerCapture(e.pointerId);
    arrastreLienzo.current = null;
  };
  // Dentro de un tramo existente no cabe otro. Se calcula para poder desactivar
  // el boton: pulsarlo y que no ocurra nada deja al usuario sin saber si es que
  // la app fallo o es que el gesto no procedia.
  const dentroDeTramo = zooms.some((z) => tMs > z.startMs && tMs < z.endMs);
  const recorteActivo = project.trimStartMs > 0 || project.trimEndMs !== null;

  return (
    <div className="editor">
      <div className="fila-alta">
      <aside className="biblioteca">
        <div className="grupo">
          <h2 className="titulo-panel"><IconoGrabacion /> Grabación</h2>
          <p className="sutil">
            {datos.manifest.capture?.w ?? datos.manifest.viewport.w}×
            {datos.manifest.capture?.h ?? datos.manifest.viewport.h}
            {' · '}{(duracion / 1000).toFixed(1)}s
          </p>
          {/* Lo tapado se dice aqui y no se puede quitar: no es un ajuste de
              montaje, es lo que YA no esta en los frames. Ofrecer un
              interruptor para "destaparlo" seria mentir. */}
          {datos.manifest.tapado && (
            <p className="sutil">
              Tapado al grabar: {datos.manifest.tapado.selectores.join(', ')}
            </p>
          )}
        </div>

        <div className="grupo">
          <h3>Fondo</h3>
          <div className="muestras">
            {FONDOS.map((f) => (
              <button key={f.nombre} title={f.nombre}
                      className={`muestra${f.bg.kind === project.background.kind ? ' on' : ''}`}
                      style={{ background: f.css }}
                      onClick={() => setProject((p) => ({ ...p, background: f.bg }))} />
            ))}
          </div>
          <button onClick={() => void elegirImagen()}
                  className={project.background.kind === 'image' ? 'on' : ''}>
            Imagen de fondo...
          </button>
          {project.background.kind === 'image' && (
            <div className="deslizador">
              <label>Desenfoque <b>{project.background.blur}px</b></label>
              <input type="range" min={0} max={40} value={project.background.blur}
                     onChange={(e) => setProject((p) => ({
                       ...p,
                       background: p.background.kind === 'image'
                         ? { ...p.background, blur: Number(e.target.value) }
                         : p.background,
                     }))} />
            </div>
          )}
        </div>
        <div className="grupo">
          <h3>Repetir</h3>
          <p className="sutil">
            Vuelve a hacer esta misma demo sola, conservando los zooms y el
            aspecto. Sirve para regrabarla con más resolución, o después de
            arreglar algo que salía en el vídeo.
          </p>
          <select value={calidadRepeticion} disabled={repitiendo}
                  onChange={(e) => setCalidadRepeticion(e.target.value)}>
            <option value="">Misma calidad</option>
            {presetsCaptura.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          <button onClick={() => void repetir()} disabled={repitiendo}>
            {repitiendo ? 'Repitiendo...' : 'Repetir esta grabación'}
          </button>
          <p className="sutil">
            Lo que escribiste no se repite: se guarda que pulsaste una tecla,
            nunca cuál.
            {datos.manifest.tapado && ' Lo que tapaste se vuelve a tapar.'}
            {pistaCam && ' La cámara no se repite: se repite la demo, no quien la cuenta.'}
          </p>
          {errorRepeticion && <p className="error">{errorRepeticion}</p>}
        </div>

        <div className="grupo">
          <h3>Looks</h3>
          {looks.length === 0 && (
            <p className="sutil">
              Guarda el fondo, el marco y la marca de agua con un nombre para
              usarlos en la siguiente demo.
            </p>
          )}
          {looks.map((l) => (
            <div key={l.nombre} className="look">
              <button onClick={() => usarLook(l)} title="Aplicar este look a la grabación abierta">
                {l.nombre}
              </button>
              <button className={`fijar${lookPorDefecto === l.nombre ? ' on' : ''}`}
                      title="Usar este look en las grabaciones nuevas"
                      onClick={() => void marcarPorDefecto(
                        lookPorDefecto === l.nombre ? null : l.nombre)}>
                ★
              </button>
            </div>
          ))}
          <button onClick={() => void guardarLook()}>Guardar este look</button>
        </div>

        <div className="grupo">
          <h3>Marca de agua</h3>
          <button onClick={() => void elegirMarca()}
                  className={project.watermark ? 'on' : ''}>
            {project.watermark ? 'Cambiar imagen...' : 'Anadir imagen...'}
          </button>
          {project.watermark && (
            <>
              <div className="fila">
                {(['no', 'ne', 'so', 'se'] as const).map((e) => (
                  <button key={e} className={project.watermark!.esquina === e ? 'on' : ''}
                          title="Esquina"
                          onClick={() => setProject((p) => ({
                            ...p,
                            watermark: p.watermark ? { ...p.watermark, esquina: e } : null,
                          }))}>
                    {e.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="deslizador">
                <label>Opacidad <b>{Math.round(project.watermark.opacity * 100)}%</b></label>
                <input type="range" min={10} max={100}
                       value={Math.round(project.watermark.opacity * 100)}
                       onChange={(e) => setProject((p) => ({
                         ...p,
                         watermark: p.watermark
                           ? { ...p.watermark, opacity: Number(e.target.value) / 100 } : null,
                       }))} />
              </div>
              <div className="deslizador">
                <label>Tamaño <b>{Math.round(project.watermark.scale * 100)}%</b></label>
                <input type="range" min={4} max={40}
                       value={Math.round(project.watermark.scale * 100)}
                       onChange={(e) => setProject((p) => ({
                         ...p,
                         watermark: p.watermark
                           ? { ...p.watermark, scale: Number(e.target.value) / 100 } : null,
                       }))} />
              </div>
              <button onClick={() => setProject((p) => ({ ...p, watermark: null }))}>
                Quitar marca
              </button>
            </>
          )}
        </div>
      </aside>

      <div className="escenario">
        <div className="lienzo-caja">
          <canvas
            ref={lienzo}
            width={project.export.width}
            height={project.export.height}
            className={puedeEncuadrar ? 'encuadrable' : ''}
            title={puedeEncuadrar ? 'Arrastra para reencuadrar este tramo' : ''}
            onPointerDown={encuadrePointerDown}
            onPointerMove={encuadrePointerMove}
            onPointerUp={encuadreSoltar}
            onPointerCancel={encuadreSoltar}
          />

          {/* El transporte flota SOBRE el lienzo, como en un reproductor: asi
              los controles estan donde se esta mirando y no en otra fila que
              obliga a bajar la vista. Cada icono lleva su texto en `title`,
              porque un dibujo solo se adivina. */}
          <div className="transporte">
            <button className="redondo primario"
                    title={reproduciendo ? 'Pausar (Espacio)' : 'Reproducir (Espacio)'}
                    aria-label={reproduciendo ? 'Pausar' : 'Reproducir'}
                    onClick={() => setReproduciendo((r) => !r)}>
              {reproduciendo ? <IconoPausa /> : <IconoReproducir />}
            </button>
            <button className="redondo" title="Volver al principio (Inicio)"
                    aria-label="Volver al principio"
                    onClick={() => { setReproduciendo(false); setTMs(0); }}>
              <IconoInicio />
            </button>
            {audioUrl && (
              <button className="redondo" title={mudo ? 'Oír la narración' : 'Silenciar la narración'}
                      aria-label={mudo ? 'Oir la narracion' : 'Silenciar la narracion'}
                      onClick={() => setMudo((m) => !m)}>
                {mudo ? <IconoSilencio /> : <IconoSonido />}
              </button>
            )}
            <span className="reloj">
              {(tMs / 1000).toFixed(1)}s / {(duracion / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
        {atajos !== 'oculto' && (
          <div className={`atajos${atajos === 'cerrando' ? ' saliendo' : ''}`}
               onClick={cerrarAtajos}>
            <div className="hoja" onClick={(e) => e.stopPropagation()}>
              <h3>Atajos</h3>
              <dl>
                <dt>Espacio</dt><dd>reproducir o parar</dd>
                <dt>← →</dt><dd>un fotograma; con Mayús, un segundo</dd>
                <dt>Inicio / Fin</dt><dd>al principio o al final</dd>
                <dt>Supr</dt><dd>borrar el zoom seleccionado</dd>
                <dt>Ctrl+Z</dt><dd>deshacer</dd>
                <dt>Ctrl+Mayus+Z</dt><dd>rehacer</dd>
                <dt>?</dt><dd>abrir y cerrar esta hoja</dd>
              </dl>
              <button onClick={cerrarAtajos}>Cerrar</button>
            </div>
          </div>
        )}

        {audioUrl && <audio ref={audio} src={audioUrl} preload="auto" />}
        {/* Fuera de la vista pero NO con display:none: un elemento oculto asi
            puede dejar de decodificar, y el compositor se quedaria dibujando el
            ultimo frame. */}
        {camUrl && (
          <video ref={camEl} src={camUrl} muted playsInline preload="auto"
                 style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
        )}

      </div>

      <aside className="panel">
        <h2 className="titulo-panel"><IconoAjustes /> Configuración</h2>
        <div className="grupo">
          <h3>Marco</h3>
          <div className="deslizador">
            <label>Tamaño <b>{Math.round(project.frame.fill * 100)}%</b></label>
            <input type="range" min={40} max={100} value={project.frame.fill * 100}
                   onChange={(e) => setMarco({ fill: Number(e.target.value) / 100 })} />
          </div>
          <div className="deslizador">
            <label>Esquinas <b>{project.frame.radius}px</b></label>
            <input type="range" min={0} max={40} value={project.frame.radius}
                   onChange={(e) => setMarco({ radius: Number(e.target.value) })} />
          </div>
          <div className="deslizador">
            <label>Sombra <b>{project.frame.shadow}</b></label>
            <input type="range" min={0} max={120} value={project.frame.shadow}
                   onChange={(e) => setMarco({ shadow: Number(e.target.value) })} />
          </div>
          <div className="fila">
            {(['none', 'macos', 'windows', 'phone'] as const).map((c) => (
              <button key={c} className={project.frame.chrome === c ? 'on' : ''}
                      onClick={() => setMarco({ chrome: c })}>
                {c === 'none' ? 'Sin marco' : c === 'macos' ? 'macOS'
                  : c === 'windows' ? 'Windows' : 'Móvil'}
              </button>
            ))}
          </div>
        </div>

        <div className="grupo">
          <h3>Movimiento del zoom</h3>
          <div className="fila">
            {(Object.keys(CAMERA_PRESETS) as CameraPresetName[]).map((c) => (
              <button key={c} className={camara === c ? 'on' : ''}
                      onClick={() => cambiarCamara(c)}>{c}</button>
            ))}
          </div>
          <div className={`nota-calidad${presupuesto.maxSharpZoom < 1.15 ? ' aviso' : ''}`}>
            <b>{describeBudget(presupuesto)}</b>
          </div>
          {recortados > 0 && (
            <p className="aviso">
              {recortados} {recortados === 1 ? 'tramo supera' : 'tramos superan'} el margen y se
              muestran recortados. Afloja el marco para recuperar su ampliacion.
            </p>
          )}
        </div>

        <div className="grupo">
          <h3>Tramos de zoom · {zooms.length}</h3>

          {sel && seleccion !== null ? (
            <>
              <p className="sutil">
                Tramo {seleccion + 1}{sel.label ? ` · ${sel.label}` : ''} ·{' '}
                {((sel.endMs - sel.startMs) / 1000).toFixed(1)}s
              </p>
              <div className="deslizador">
                <label>Ampliación <b>{sel.scale.toFixed(2)}×</b></label>
                <input type="range" min={100} max={Math.max(105, Math.round(presupuesto.maxSharpZoom * 100))}
                       value={Math.round(sel.scale * 100)}
                       onChange={(e) => setZooms((z) =>
                         setSegmentScale(z, seleccion, Number(e.target.value) / 100))} />
              </div>
              <p className="sutil">
                {puedeEncuadrar
                  ? 'Arrastra sobre la imagen para mover el encuadre.'
                  : 'Lleva la aguja dentro del tramo para poder reencuadrarlo.'}
              </p>
              <button className="peligro" onClick={borrarSeleccion}>Borrar el zoom seleccionado</button>
            </>
          ) : (
            <p className="sutil">
              Pincha un tramo para editarlo. Arrastra su cuerpo para moverlo y sus
              bordes para alargarlo.
            </p>
          )}

          {editado && (
            <button onClick={() => replanificar(camara)}>Volver al zoom automático</button>
          )}
        </div>

        <div className="grupo">
          <h3>Recorte</h3>
          <p className="sutil">
            {recorteActivo
              ? `${(project.trimStartMs / 1000).toFixed(1)}s – ${((project.trimEndMs ?? duracion) / 1000).toFixed(1)}s`
              : 'Arrastra las asas de los extremos para quitar el principio o el final'}
          </p>
          {recorteActivo && (
            <button onClick={() => setProject((p) => ({ ...p, ...clampTrim(0, null, duracion) }))}>
              Quitar el recorte
            </button>
          )}
        </div>

        <div className="grupo">
          <h3>Audio</h3>
          <p className="sutil">
            {pista
              ? 'Narración grabada · se incluye en mp4, webm y mov (el gif no lleva sonido)'
              : 'Esta grabación no tiene narración'}
          </p>

          {pista && (
            <>
              <button onClick={() => void cortarSilencios()} disabled={buscando}>
                {buscando ? 'Buscando silencios...' : 'Quitar los silencios'}
              </button>
              {cortes.length > 0 && (
                <>
                  <p className="sutil">
                    {cortes.length} {cortes.length === 1 ? 'silencio' : 'silencios'} ·{' '}
                    −{((duracion - mapa.outputDurationMs) / 1000).toFixed(1)}s
                  </p>
                  <button onClick={() => setProject((p) => ({ ...p, cuts: [] }))}>
                    Volver a poner los silencios
                  </button>
                </>
              )}
              {sinSilencios && <p className="sutil">No hay silencios que quitar.</p>}
            </>
          )}
        </div>

        {pistaCam && (
          <div className="grupo">
            <h3>Cámara web</h3>
            {project.camara ? (
              <>
                {/* Flechas y no texto: el inspector es estrecho y "Arriba
                    izquierda" se cortaba a la mitad, dejando dos botones que
                    ponian lo mismo. El nombre entero va en el tooltip. */}
                <div className="fila esquinas">
                  {([
                    ['no', 'Arriba izq.', 'Arriba a la izquierda'],
                    ['ne', 'Arriba der.', 'Arriba a la derecha'],
                    ['so', 'Abajo izq.', 'Abajo a la izquierda'],
                    ['se', 'Abajo der.', 'Abajo a la derecha'],
                  ] as const).map(([e, flecha, titulo]) => (
                    <button key={e} title={titulo}
                            className={project.camara?.esquina === e ? 'on' : ''}
                            onClick={() => setProject((p) => (p.camara
                              ? { ...p, camara: { ...p.camara, esquina: e } } : p))}>
                      {flecha}
                    </button>
                  ))}
                </div>
                <div className="deslizador">
                  <label>Tamaño <b>{Math.round(project.camara.tamano * 100)}%</b></label>
                  <input type="range" min={6} max={45} value={Math.round(project.camara.tamano * 100)}
                         onChange={(ev) => setProject((p) => (p.camara
                           ? { ...p, camara: { ...p.camara, tamano: Number(ev.target.value) / 100 } }
                           : p))} />
                </div>
                <div className="fila">
                  <button className={project.camara.forma === 'circulo' ? 'on' : ''}
                          onClick={() => setProject((p) => (p.camara
                            ? { ...p, camara: { ...p.camara, forma: 'circulo' } } : p))}>
                    Circulo
                  </button>
                  <button className={project.camara.forma === 'redondeada' ? 'on' : ''}
                          onClick={() => setProject((p) => (p.camara
                            ? { ...p, camara: { ...p.camara, forma: 'redondeada' } } : p))}>
                    Redondeada
                  </button>
                </div>
                <button className={project.camara.espejo ? 'on' : ''}
                        onClick={() => setProject((p) => (p.camara
                          ? { ...p, camara: { ...p.camara, espejo: !p.camara.espejo } } : p))}>
                  Espejo
                </button>
                <p className="sutil">
                  Con espejo te ves como en un espejo, que es a lo que estás
                  acostumbrado. Sin espejo, el texto de tu camiseta se lee al
                  derecho: es lo que espera quien mire el vídeo.
                </p>
                <button className="peligro"
                        onClick={() => setProject((p) => ({ ...p, camara: null }))}>
                  Quitar la cámara del vídeo
                </button>
              </>
            ) : (
              <>
                <p className="sutil">Grabaste con cámara, pero ahora mismo no se ve en el vídeo.</p>
                <button onClick={() => setProject((p) => ({
                  ...p,
                  camara: {
                    esquina: 'se', tamano: 0.22, forma: 'circulo',
                    espejo: false, borde: 3, sombra: 24,
                  },
                }))}>
                  Poner la cámara en el vídeo
                </button>
              </>
            )}
          </div>
        )}

        <div className="grupo">
          <h3>Cursor</h3>
          <div className="fila">
            <button className={project.frame.cursor !== 'none' ? 'on' : ''}
                    onClick={() => setMarco({ cursor: 'arrow' })}>Visible</button>
            <button className={project.frame.cursor === 'none' ? 'on' : ''}
                    onClick={() => setMarco({ cursor: 'none' })}>Oculto</button>
          </div>
          <h3>Anotaciones</h3>
          <div className="fila">
            <button className={project.frame.labels ? 'on' : ''}
                    title="Escribe en el vídeo el nombre del botón que pulsas"
                    onClick={() => setMarco({ labels: !project.frame.labels })}>Rótulos</button>
            <button className={project.frame.keys ? 'on' : ''}
                    title="Muestra las teclas que pulsas. Las letras salen como un punto, nunca la letra"
                    onClick={() => setMarco({ keys: !project.frame.keys })}>Teclas</button>
          </div>
          <p className="sutil">
            Salen de lo que pasó al grabar, no de los píxeles. Lo que escribes
            nunca se enseña: cada letra sale como un punto.
          </p>
        </div>

        <div className="grupo">
          <h3>Ritmo</h3>
          <p className="sutil">
            Las esperas —una carga, un formulario que se rellena— siguen en el
            vídeo, pero pasan más deprisa.
          </p>
          <button onClick={acelerarEsperas} disabled={propuesta.length === 0}>
            {propuesta.length === 0
              ? 'No hay esperas que acelerar'
              : `Acelerar ${propuesta.length} ${propuesta.length === 1 ? 'espera' : 'esperas'}`
                + ` · −${(ahorroDe(propuesta) / 1000).toFixed(1)}s`}
          </button>
          {(project.speeds ?? []).length > 0 && (
            <>
              <p className="sutil">
                {project.speeds!.length} {project.speeds!.length === 1 ? 'tramo' : 'tramos'}
                {' '}acelerado{project.speeds!.length === 1 ? '' : 's'} ·{' '}
                −{(ahorroDe(project.speeds!) / 1000).toFixed(1)}s
              </p>
              <button onClick={() => setProject((p) => ({ ...p, speeds: [] }))}>
                Volver a la velocidad normal
              </button>
            </>
          )}
        </div>

        <Exportar dir={datos.dir} camara={camara} guardar={guardar} salida={project.export} />

        <div className="pie">
          <button onClick={onSalir}>Nueva grabación</button>
        </div>
      </aside>
      </div>

      <div className="linea">
        <div className="barra">
          <button onClick={() => setHist(deshacer)} disabled={!puedeDeshacer(hist)}
                  title="Deshacer (Ctrl+Z)">Deshacer</button>
          <button onClick={() => setHist(rehacer)} disabled={!puedeRehacer(hist)}
                  title="Rehacer (Ctrl+Shift+Z)">Rehacer</button>
          <span className="separador" />
          <button className="con-icono" onClick={anadirTramo} disabled={dentroDeTramo}
                  title={dentroDeTramo
                    ? 'La aguja está dentro de un tramo: muévela a un hueco'
                    : 'Crea un tramo de zoom donde está la aguja'}>
            <IconoAnadir /> Añadir zoom
          </button>
          <button className="con-icono" onClick={() => borrarSeleccion()}
                  disabled={seleccion === null}
                  title="Borra el tramo de zoom seleccionado (Supr)">
            <IconoBorrar /> Borrar zoom
          </button>
          <span className="hueco" />
          <label className="escala">
            Zoom
            <input type="range" min={1} max={8} step={0.5} value={escalaTl}
                   onChange={(e) => setEscalaTl(Number(e.target.value))} />
            <b>×{escalaTl}</b>
          </label>
        </div>

        <Timeline
          durationMs={duracion}
          tMs={tMs}
          onSeek={(ms) => { setReproduciendo(false); setTMs(ms); }}
          zooms={zooms}
          onZoomsChange={setZooms}
          seleccion={seleccion}
          onSeleccion={setSeleccion}
          trimStartMs={project.trimStartMs}
          trimEndMs={project.trimEndMs}
          cuts={cortes}
          speeds={project.speeds ?? []}
          escala={escalaTl}
          onda={onda}
          hitos={hitos}
          onTrim={(t) => setProject((p) => ({ ...p, ...t }))}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Exportar(
  { dir, camara, guardar, salida }: {
    dir: string; camara: CameraPresetName; guardar: () => Promise<void>;
    salida: { width: number; height: number };
  },
) {
  const [presets, setPresets] = useState<ExportPresetInfo[]>([]);
  const [elegido, setElegido] = useState('720p');
  const [progreso, setProgreso] = useState<ExportProgressMsg | null>(null);
  const [resultado, setResultado] = useState<ResultadoExport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void window.vitrina.exportPresets().then((ps) => {
      setPresets(ps);
      // Arrancar en el preset que ya tiene el proyecto. Una grabacion vertical
      // que se ofreciera por defecto a 720p daria un video casi todo fondo.
      const suyo = ps.find((p) => p.width === salida.width && p.height === salida.height);
      if (suyo) setElegido(suyo.name);
    });
  }, [salida.width, salida.height]);
  useEffect(() => window.vitrina.onExportProgress(setProgreso), []);

  const lanzar = async () => {
    setError('');
    setResultado(null);
    setProgreso({ frame: 0, totalFrames: 1, fraction: 0, fps: 0, etaMs: 0 });
    try {
      // El exportador lee project.json del disco y el guardado normal va con
      // retardo. Sin este volcado, exportar justo despues de mover un tramo
      // produciria un video con la version anterior y ningun aviso.
      await guardar();
      const r = await window.vitrina.runExport({ dir, preset: elegido, cameraPreset: camara, soft: false });
      if (r && 'cancelled' in r) setError('Exportacion cancelada');
      else if (r) setResultado(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgreso(null);
    }
  };

  const activo = progreso !== null;

  return (
    <div className="grupo">
      <h3>Exportar</h3>
      <div className="fila" style={{ flexWrap: 'wrap' }}>
        {presets.map((p) => (
          <button key={p.name} className={elegido === p.name ? 'on' : ''}
                  title={`${p.width}×${p.height} ${p.format} — ${p.nota}`}
                  style={{ flex: '1 1 30%' }}
                  onClick={() => setElegido(p.name)}>
            {p.name}
          </button>
        ))}
      </div>

      {activo ? (
        <>
          <div className="barra-progreso">
            <div style={{ transform: `scaleX(${progreso.fraction})` }} />
          </div>
          <div className="progreso-txt">
            <span>{(progreso.fraction * 100).toFixed(0)}% · {progreso.fps.toFixed(0)} fps</span>
            <span>faltan {Math.ceil(progreso.etaMs / 1000)}s</span>
          </div>
          <button className="peligro" onClick={() => void window.vitrina.cancelExport()}>Cancelar</button>
        </>
      ) : (
        <button className="primario" onClick={() => void lanzar()}>Exportar</button>
      )}

      {resultado && (
        <>
          {/* Que salio, en una linea: sin esto el unico rastro del export era un
              boton, y no habia forma de saber si el fichero pesaba 8 MB o 200. */}
          <p className="sutil">
            {resultado.settings.width}×{resultado.settings.height}
            {' · '}{(resultado.durationMs / 1000).toFixed(1)}s
            {' · '}{(resultado.bytes / 1024 / 1024).toFixed(1)} MB
            {' · '}{(resultado.elapsedMs / 1000).toFixed(1)}s en salir
          </p>
          {resultado.warnings.map((w, i) => <p key={i} className="aviso">{w}</p>)}
          <button onClick={() => void window.vitrina.reveal(resultado.file)}>Mostrar en la carpeta</button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
