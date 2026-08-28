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
import type { RecordingData, ExportProgressMsg, ExportPresetInfo } from '../preload/index.ts';
import { Preview, makeTrack } from './preview.ts';
import { Timeline } from './Timeline.tsx';
import { grabarMicrofono, listarMicrofonos, type MicHandle, type DispositivoAudio } from './mic.ts';
import { picos } from './timeline-calc.ts';

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
  const [nivel, setNivel] = useState(0);
  const mic = useRef<MicHandle | null>(null);

  useEffect(() => {
    void window.vitrina.capturePresets().then(setPresets);
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
      await window.vitrina.startRecording(url, presetName, orientacion);
      setStats({ frames: 0, elapsedMs: 0 });
      setFase('grabando');
    } catch (e) {
      await mic.current?.detener().catch(() => {});
      mic.current = null;
      setError(e instanceof Error ? e.message : String(e));
      setFase('inicio');
    }
  }, [url, presetName, orientacion, micOn, micDeviceId]);

  const parar = useCallback(async () => {
    try {
      // El audio se cierra ANTES de parar el video: `record:stop` escribe el
      // manifest y necesita que la pista ya este cerrada para anotarla.
      await mic.current?.detener().catch(() => {});
      mic.current = null;
      setDatos(await window.vitrina.stopRecording());
      setFase('editor');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFase('inicio');
    }
  }, []);

  const abrir = useCallback(async () => {
    const d = await window.vitrina.openRecording();
    if (d) {
      setDatos(d);
      setFase('editor');
    }
  }, []);

  if (fase === 'editor' && datos) {
    return <Editor key={datos.dir} datos={datos} onSalir={() => { setDatos(null); setFase('inicio'); }} />;
  }

  if (fase === 'cuenta') {
    return (
      <div className="app">
        <div className="centro">
          <div className="cuenta">{cuenta}</div>
          <p style={{ color: 'var(--dim)' }}>Se abrira una ventana con tu app. Haz la demo ahi.</p>
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
          <button className="primario" onClick={() => void parar()}>Parar y editar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="inicio">
        <div className="marca">
          <h1>Vitrina</h1>
          <span>demos de apps web con zoom automatico</span>
        </div>

        <div className="campo">
          <label htmlFor="url">Direccion de tu app</label>
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
              La pestana se abre a <b>{preset?.css?.w ?? 430} px</b> como un movil de
              verdad, asi que tu web muestra su diseno movil. Se captura a escala
              ×{preset?.dsf ?? 2}: sale nitida pese al viewport pequeno.
              <br />
              {/* Los fps de abajo son los medidos EN HORIZONTAL. Se dicen asi de
                  claro porque todo el proyecto se apoya en no prometer numeros
                  sin medir, y en vertical no se han medido. */}
              Los fps son los medidos en horizontal; en vertical pueden ser menores.
              Para comprobarlo en tu equipo: <code>node tools/calibrar.ts --vertical</code>.
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
                  <small>maqueta a {t.css?.w ?? t.capture.w} px</small>
                  <small>~{p.measuredFps} fps</small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="campo">
          <label>Narracion</label>
          <div className="fila">
            <button className={micOn ? 'on' : ''} onClick={() => setMicOn(true)}>Con microfono</button>
            <button className={!micOn ? 'on' : ''} onClick={() => setMicOn(false)}>Sin audio</button>
          </div>
          {micOn && micDevices.length > 1 && (
            <select value={micDeviceId} onChange={(e) => setMicDeviceId(e.target.value)}>
              <option value="">Microfono predeterminado</option>
              {micDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          )}
        </div>

        {presupuestoInicial && (
          <div className={`nota-calidad${presupuestoInicial.maxSharpZoom < 1.15 ? ' aviso' : ''}`}>
            <span>Exportando a {salidaInicial?.w}×{salidaInicial?.h}:</span>
            <b>{describeBudget(presupuestoInicial)}</b>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="acciones">
          <button className="primario" onClick={() => void grabar()}>Grabar</button>
          <button onClick={() => void abrir()}>Abrir grabacion</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Editor({ datos, onSalir }: { datos: RecordingData; onSalir: () => void }) {
  const [project, setProject] = useState<Project>(datos.project);
  const [camara, setCamara] = useState<CameraPresetName>('normal');
  const [tMs, setTMs] = useState(0);
  const [reproduciendo, setReproduciendo] = useState(false);

  // Los tramos son ESTADO, no un valor derivado. En cuanto se pueden editar a
  // mano, recalcularlos en cada render borraria el trabajo del usuario.
  const [zooms, setZooms] = useState<ZoomSegment[]>(datos.project.zooms);
  const [seleccion, setSeleccion] = useState<number | null>(null);

  const lienzo = useRef<HTMLCanvasElement>(null);
  const preview = useRef<Preview | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
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
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') borrarSeleccion();
      if (e.key === ' ') { e.preventDefault(); setReproduciendo((r) => !r); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [borrarSeleccion]);

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

  // La narracion se descarga entera a un blob en vez de dejar que el elemento
  // la reproduzca en streaming. El WebM de MediaRecorder no lleva duracion ni
  // indices —es un flujo en vivo—, y pedirle al reproductor que busque dentro
  // de algo asi servido por un protocolo propio es fragil: unas veces cargaba
  // y otras se quedaba en HAVE_NOTHING. Con el fichero completo en memoria el
  // seek del scrubbing es inmediato y fiable.
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
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
          <h3>Grabacion</h3>
          <p className="sutil">
            {datos.manifest.capture?.w ?? datos.manifest.viewport.w}×
            {datos.manifest.capture?.h ?? datos.manifest.viewport.h}
            {' · '}{(duracion / 1000).toFixed(1)}s
          </p>
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
        </div>
        {audioUrl && <audio ref={audio} src={audioUrl} preload="auto" />}

        <div className="transporte">
          <button className="primario" onClick={() => setReproduciendo((r) => !r)}
                  style={{ minWidth: 104 }}>
            {reproduciendo ? 'Pausa' : 'Reproducir'}
          </button>
          <span className="reloj">{(tMs / 1000).toFixed(1)}s / {(duracion / 1000).toFixed(1)}s</span>
        </div>
      </div>

      <aside className="panel">
        <div className="grupo">
          <h3>Marco</h3>
          <div className="deslizador">
            <label>Tamano <b>{Math.round(project.frame.fill * 100)}%</b></label>
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
                  : c === 'windows' ? 'Windows' : 'Movil'}
              </button>
            ))}
          </div>
        </div>

        <div className="grupo">
          <h3>Camara</h3>
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
          <h3>Zoom · {zooms.length} {zooms.length === 1 ? 'tramo' : 'tramos'}</h3>

          {sel && seleccion !== null ? (
            <>
              <p className="sutil">
                Tramo {seleccion + 1}{sel.label ? ` · ${sel.label}` : ''} ·{' '}
                {((sel.endMs - sel.startMs) / 1000).toFixed(1)}s
              </p>
              <div className="deslizador">
                <label>Ampliacion <b>{sel.scale.toFixed(2)}×</b></label>
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
              <button className="peligro" onClick={borrarSeleccion}>Borrar tramo (Supr)</button>
            </>
          ) : (
            <p className="sutil">
              Pincha un tramo para editarlo. Arrastra su cuerpo para moverlo y sus
              bordes para alargarlo.
            </p>
          )}

          {editado && (
            <button onClick={() => replanificar(camara)}>Volver al zoom automatico</button>
          )}
        </div>

        <div className="grupo">
          <h3>Recorte</h3>
          <p className="sutil">
            {recorteActivo
              ? `${(project.trimStartMs / 1000).toFixed(1)}s – ${((project.trimEndMs ?? duracion) / 1000).toFixed(1)}s`
              : 'Arrastra las asas grises de los extremos'}
          </p>
          {recorteActivo && (
            <button onClick={() => setProject((p) => ({ ...p, ...clampTrim(0, null, duracion) }))}>
              Quitar recorte
            </button>
          )}
        </div>

        <div className="grupo">
          <h3>Audio</h3>
          <p className="sutil">
            {pista
              ? 'Narracion grabada · se monta en mp4, webm y mov (el gif no lleva audio)'
              : 'Esta grabacion no tiene narracion'}
          </p>

          {pista && (
            <>
              <button onClick={() => void cortarSilencios()} disabled={buscando}>
                {buscando ? 'Buscando silencios...' : 'Cortar silencios'}
              </button>
              {cortes.length > 0 && (
                <>
                  <p className="sutil">
                    {cortes.length} {cortes.length === 1 ? 'silencio' : 'silencios'} ·{' '}
                    −{((duracion - mapa.outputDurationMs) / 1000).toFixed(1)}s
                  </p>
                  <button onClick={() => setProject((p) => ({ ...p, cuts: [] }))}>
                    Quitar cortes
                  </button>
                </>
              )}
              {sinSilencios && <p className="sutil">No se encontraron silencios que quitar.</p>}
            </>
          )}
        </div>

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
                    title="Rotula el elemento pulsado con su texto, sacado del DOM"
                    onClick={() => setMarco({ labels: !project.frame.labels })}>Rotulos</button>
            <button className={project.frame.keys ? 'on' : ''}
                    title="Muestra las teclas. Las imprimibles salen como un punto"
                    onClick={() => setMarco({ keys: !project.frame.keys })}>Teclas</button>
          </div>
          <p className="sutil">
            Salen del DOM al grabar, no de los pixeles. Lo que se escribe nunca se
            muestra: las teclas imprimibles se dibujan como un punto.
          </p>
        </div>

        <div className="grupo">
          <h3>Ritmo</h3>
          <p className="sutil">
            Las esperas —una carga, un formulario que se rellena— siguen en el
            video pero pasan mas deprisa.
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
                Volver a tiempo real
              </button>
            </>
          )}
        </div>

        <Exportar dir={datos.dir} camara={camara} guardar={guardar} salida={project.export} />

        <div className="pie">
          <button onClick={onSalir}>Nueva grabacion</button>
        </div>
      </aside>
      </div>

      <div className="linea">
        <div className="barra">
          <button onClick={() => borrarSeleccion()} disabled={seleccion === null}>
            Borrar tramo
          </button>
          <button onClick={anadirTramo} disabled={dentroDeTramo}
                  title={dentroDeTramo
                    ? 'La aguja esta dentro de un tramo. Muevela a un hueco.'
                    : 'Crea un tramo en la posicion de la aguja'}>
            Anadir tramo
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
  const [resultado, setResultado] = useState<{ file: string; warnings: string[] } | null>(null);
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
      else if (r) setResultado({ file: r.file, warnings: r.warnings ?? [] });
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
          <div className="barra"><div style={{ transform: `scaleX(${progreso.fraction})` }} /></div>
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
          {resultado.warnings.map((w, i) => <p key={i} className="aviso">{w}</p>)}
          <button onClick={() => void window.vitrina.reveal(resultado.file)}>Mostrar en la carpeta</button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
