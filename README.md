# Vitrina

**Grabador de demos para apps web, con zoom automático en los clicks y fondo cinematográfico.**
Alternativa open source a Screen Studio, para Windows.

> **Solo graba páginas web.** No captura el escritorio, ni VS Code, ni Figma.
> Esa es la decisión de diseño de la que sale todo lo demás, no una carencia.

## Por qué existe

Screen Studio es macOS, de pago, y no puede grabar por encima de tu monitor
físico. Vitrina controla el navegador por Chrome DevTools Protocol en vez de
capturar píxeles de la pantalla, y de ahí salen tres ventajas que un grabador
de escritorio no puede tener:

- **Los clicks traen el rectángulo del elemento pulsado.** La cámara encuadra el
  botón o el formulario de verdad, no un radio inventado alrededor del cursor.
- **Los frames no llevan cursor del sistema.** Se redibuja después, suavizado,
  con tamaño constante al ampliar y ripple en cada click.
- **La sincronización sale gratis.** Los frames y el log de entrada comparten
  reloj, así que no hay que alinear nada.

Y una garantía de privacidad: el log de teclado registra `"char"`, nunca la
tecla pulsada. Una demo con login no puede filtrar credenciales.

## Estado

En desarrollo. Grabación funcionando y verificada; el editor y el exportador
todavía no.

| Hito | Estado |
|---|---|
| M0 · Spike de viabilidad | hecho — ver [`spikes/HALLAZGOS.md`](spikes/HALLAZGOS.md) |
| M1 · Grabador | hecho |
| M2 · Motor de cámara | hecho |
| M3 · Compositor y fondos | hecho |
| M4 · Exportador | hecho |
| App de escritorio | hecha (grabar, editar, exportar) |
| M5 · Timeline editable | hecho |
| Narración con micrófono | hecho |
| Fondo de imagen · reencuadre manual | hecho |
| Cortar silencios | hecho |
| macOS y Windows | hecho (sin probar en Mac) |

## Uso

Requiere Node 22.18+, un navegador Chromium y ffmpeg.

| | Navegador | ffmpeg |
|---|---|---|
| **Windows** | Edge ya viene instalado | [ffmpeg.org](https://ffmpeg.org) en `C:/ffmpeg/bin`, o `FFMPEG_PATH` |
| **macOS** | Instala [Chrome](https://google.com/chrome). Safari no sirve: no expone screencast por CDP | `brew install ffmpeg` |

En macOS **Vitrina no pide permiso de grabación de pantalla**, porque no captura
la pantalla: captura el compositor del navegador por DevTools Protocol. Solo
pide micrófono, y solo si eliges narrar.

No se empaqueta un ffmpeg propio a propósito: los presets `alpha` y `webm`
necesitan `prores_ks` y `libopus`, y un build empaquetado puede no traerlos. Un
fallo de códec que solo aparece en la máquina de otro es peor que un paso de
instalación.

### App de escritorio

```bash
npm install
npm run app
```

Se escribe la dirección de la app, se elige calidad de captura —con el margen de
zoom visible antes de grabar, no después—, se decide si narrar con micrófono y se
pulsa Grabar. Vitrina abre una
ventana limpia con la app, sin pestañas ni marcadores; se hace la demo ahí y al
parar se cae directamente en el editor con el zoom ya calculado.

El editor previsualiza con **el mismo compositor que usa el exportador**, así que
lo que se ve es exactamente lo que sale.

En la línea de tiempo cada tramo de zoom se arrastra para moverlo y se estira por
los bordes para alargarlo; se puede añadir uno en la posición de la aguja,
borrarlo con Supr y ajustar su ampliación. Pinchar un tramo lleva también la
aguja hasta él, y entonces **arrastrando sobre la imagen se mueve su encuadre** —
el motor lo centra en el elemento pulsado, que acierta casi siempre pero no
siempre. Las asas grises de los extremos
recortan el material. Un tramo tocado a mano se dibuja con borde discontinuo,
porque es lo que se perdería al volver al zoom automático — y por eso cambiar el
preset de cámara **no** replanifica sola si hay ediciones: hay que pedirlo. También acepta abrir una grabación desde
la línea de comandos:

```bash
npm run app:build && npx electron apps/desktop grabaciones/mi-demo.vitrina
```

### Calibrar (opcional, una vez)

```bash
npm run calibrar
```

Los presets de captura llevan fps **medidos**, no estimados, y el techo depende
de la máquina. Los de serie salen de un i5-7500 con HD 630; en un equipo más
rápido son conservadores y en uno más lento prometerían fps que no llegan. Esto
vuelve a medir con el mismo grabador que usa la app y reescribe
`packages/core/src/presets.medidos.ts`.

### Empaquetar

```bash
npm run app:dist
```

Genera un instalador en `dist/`. **Un `.app` o `.dmg` de macOS solo se puede
generar desde macOS** — electron-builder necesita las herramientas del sistema.

El build de Mac va sin firmar, así que la primera apertura pide clic derecho →
Abrir, o quitar la cuarentena:

```bash
xattr -dr com.apple.quarantine /Applications/Vitrina.app
```

### Por línea de comandos

```bash
npm install
node bin/vitrina-record.ts http://localhost:3000
```

Opciones:

```
--preset=<nombre>   fluido | equilibrado | nitido | maximo
--out=<ruta>        carpeta de salida
--secs=<n>          parar solo tras n segundos
--quality=<n>       calidad JPEG 1-100 (por defecto 92)
```

Deja una carpeta `.vitrina` autocontenida con los frames, el log de eventos, el
manifest y los ajustes de composición.

Después, calcular el zoom automático:

```bash
node bin/vitrina-plan.ts grabaciones/mi-demo.vitrina
```

Escribe los tramos en `project.json` y dibuja la curva de la cámara en la
terminal. Con `--preset=sutil|normal|marcado` se cambia el carácter del
movimiento, y con `--dry` no se escribe nada.

Y exportar:

```bash
node bin/vitrina-export.ts grabaciones/mi-demo.vitrina --preset=720p
```

| Preset | Salida | Para qué |
|---|---|---|
| `720p` | 1280×720 mp4 | por defecto; deja 1.56× de margen de zoom |
| `1080p` | 1920×1080 mp4 | más resolución, pero sin margen de zoom desde 1600×900 |
| `vertical` | 1080×1920 mp4 | stories y shorts |
| `cuadrado` | 1080×1080 mp4 | redes |
| `gif` | 960×540 gif | README y chats; pesado por naturaleza |
| `alpha` | ProRes 4444 .mov | transparencia, para montar sobre otro material |

Ctrl+C cancela y borra el fichero a medias — uno truncado parece válido y no lo
es. Con `--soft` se permite ampliar más allá del margen nítido.

## Calidad de imagen

El indicador **«zoom nítido hasta N×»** que aparece al grabar no es decorativo.
El margen no es `captura / salida`, como suele asumirse, sino
`ancho_captura / ancho_mostrado_de_la_ventana`: como el marco se dibuja con
padding sobre el fondo, ocupando ~80% del lienzo, capturar a 1600×900 y exportar
a 720p da **1.56× de zoom sin pérdida**, y en reposo submuestrea 1600→1024, que
se ve más nítido que un 1:1.

Reducir el padding se paga en nitidez al ampliar. Por eso el número se recalcula
en vivo: hay que verlo antes de grabar, no al mirar el export.

Los presets llevan el rendimiento **medido**, no teórico:

| Preset | Captura | fps mediano | p95 |
|---|---|---|---|
| fluido | 1280×720 | 99 | 13.5 ms |
| **equilibrado** | **1600×900** | **67** | **30.4 ms** |
| nitido | 1920×1080 | 45 | 51.1 ms |
| maximo | 2560×1440 | 35 | 76.6 ms |

Medido en un i5-7500 con Intel HD 630. La selección automática usa el p95, no la
mediana: a 1440p la mediana de 35 fps parece bastar para exportar a 30, pero
huecos de 76 ms se ven como tirones.

## Fondos

Degradado, malla, color sólido, transparente o **imagen propia**. La imagen se
copia dentro de la carpeta `.vitrina` en lugar de guardar una referencia: el
formato es autocontenido, y con una ruta externa mover la carpeta a otro equipo
—o borrar la foto— dejaría el proyecto sin fondo y sin explicación.

Se dibuja cubriendo el lienzo y con desenfoque opcional (18 px por defecto: una
foto nítida detrás compite con la demo, que es lo que hay que mirar). Con
desenfoque se pinta más grande que el lienzo a propósito, porque `filter: blur`
difumina también contra el exterior del dibujo y a tamaño justo aparecería una
orla clara en los bordes.

## Narración

El micrófono se graba en el renderer con MediaRecorder y los trozos se vuelcan al
disco según llegan, no al final: una narración de varios minutos son megas
retenidos en memoria, y si la app se cierra a mitad no quedaría nada.

**El audio arranca antes que el vídeo, a propósito.** Empezar los dos a la vez es
imposible —abrir el navegador tarda un par de segundos— y si el audio llegara
tarde faltaría sonido al principio, que no se puede inventar. Con arranque
anticipado sobra audio, y sobrar se resuelve saltando: cada pista anota su propio
`Date.now()` y `audioAlignment` calcula el desfase al exportar, teniendo también
en cuenta el recorte del vídeo.

Durante la grabación hay un **medidor de nivel**, y si el micrófono falla el error
sale en pantalla en ese momento. Descubrir que la pista está muda al reproducir
significa repetir la demo entera.

El audio se monta en mp4, webm y mov; el GIF no lleva pista y el exportador avisa
en lugar de perderla en silencio.

### Cortar silencios

Un botón en el panel de audio detecta los silencios de la narración con el filtro
`silencedetect` de ffmpeg y los propone como cortes. Son **datos, no un recorte
del material**: quitarlos devuelve el trozo, y volver a detectar no degrada nada.

Se deja 150 ms de margen a cada lado, porque cortar justo en el límite detectado
se come la inspiración previa y el arranque de la palabra siguiente. Los cortes
se aplican **a la vez al vídeo y al audio** — cortar solo el vídeo adelantaría la
narración a partir del primer silencio y el desfase crecería con cada corte.

Todo el tiempo de la salida pasa por un mapa: recortar los extremos y quitar
silencios son la misma operación vista de dos formas. La reproducción del editor
usa ese mismo mapa, así que salta los silencios igual que el vídeo final.

## Cómo decide la cámara

El zoom no se calcula por frame: se planifica en dos etapas separadas, porque el
timeline tiene que poder editar las decisiones sin recalcular el movimiento.

1. **`planSegments`** agrupa los clicks y decide qué encuadrar. Rellenar un
   formulario es un solo tramo, no uno por campo; escribir mantiene la
   ampliación viva aunque no haya clicks; dos tramos a menos de 800 ms se
   fusionan para evitar el efecto yo-yo; y el scroll rápido corta la ampliación,
   porque ampliar mientras la página se desplaza marea.
2. **`buildCameraTrack`** convierte los tramos en movimiento con un muelle
   amortiguado. Actúa sobre `log2(escala)`, no sobre la escala: ir de 1× a 2× y
   de 2× a 4× son el mismo salto para el ojo, y en lineal las ampliaciones
   grandes arrancan de golpe y frenan pastosas.

El usuario manda sobre las dos etapas: la línea de tiempo edita los tramos y la
cámara se recalcula sola. Las operaciones de edición —mover, estirar, insertar,
borrar— viven en `camera/edit.ts` y son puras, porque lo difícil no es arrastrar
sino mantener las invariantes: lista ordenada, sin solapes, con duración
suficiente para percibirse y dentro del material. Un componente de interfaz que
además tuviera que garantizar eso acabaría con la lógica repartida entre el
manejador del ratón y el render.

La pista se precomputa entera a 240 Hz. Un muelle es estado, así que para saber
dónde está en el segundo 30 hay que haber simulado los 30 anteriores; el editor
necesita acceso aleatorio para el scrubbing y el exportador necesita que dos
ejecuciones den exactamente lo mismo. Cuesta ~170 KB por minuto.

## El compositor

Un solo módulo dibuja el preview y el export. Si fueran dos implementaciones, lo
que se ve al editar no sería lo que sale exportado, y ese desajuste es imposible
de depurar después. Para conseguirlo el compositor se escribe contra la API
estándar de Canvas 2D y nada más: en el navegador el contexto viene de un
`<canvas>`, y en Node de `@napi-rs/canvas`, que implementa la misma superficie
sobre Skia.

Capas, de atrás a delante:

```
fondo → silueta con sombra → [recorte] barra + contenido → borde → cursor
```

El paso de la silueta no es decorativo: `clip()` con un rectángulo redondeado
anula `shadowBlur`, así que la sombra hay que pintarla antes como una forma
opaca. Hay un test de regresión que lo fija.

La **barra de navegador es vectorial**, no capturada. Se graba con `--app=`, que
abre una ventana sin pestañas ni barra de direcciones, y la barra se dibuja
después: sale nítida a cualquier zoom porque no se amplía con la imagen, es
tematizable, y no ensucia la demo con los marcadores de quien graba.

El **cursor también se redibuja** desde el log. Los frames del screencast no
llevan cursor del sistema, así que se dibuja a tamaño constante en pantalla —un
cursor incrustado se ampliaría con el zoom y quedaría enorme—, con el trazo
suavizado y una onda en cada click. Sin esa onda, en un vídeo mudo el espectador
no sabe si el cambio lo provocó un click o simplemente ocurrió.

## El exportador

Render **offline y determinista**: recorre la línea de tiempo a paso fijo, busca
el frame de origen vigente en cada instante y lo compone con el mismo módulo que
dibuja el preview. Que sea offline es lo que hace que el resultado no dependa de
si la máquina iba justa ese día.

La captura es de framerate variable —el screencast solo emite cuando la página
cambia— así que para cada instante de salida se sostiene el frame vigente.
Asumir framerate constante aquí desplazaría el vídeo respecto al log de eventos
y el zoom llegaría a destiempo sin que nada lo explicara.

**El preset de salida cambia el margen de zoom**, porque cambia a cuántos
píxeles se dibuja la ventana. Los tramos guardados se planificaron para otra
salida, así que al exportar se recortan al margen de esta y el exportador avisa.
Exportar a 1080p desde una captura de 1600×900 deja 1.04×: la cámara apenas se
moverá, y es mejor saberlo antes que descubrirlo en el vídeo.

### Alpha: por qué ProRes y no WebM

El plan pedía WebM con transparencia. Se comprobó que **libvpx-vp9 y libvpx-vp8
aceptan `-pix_fmt yuva420p` sin protestar y devuelven `yuv420p`**, perdiendo el
canal alfa en silencio. ProRes 4444, qtrle y WebP animado sí lo conservan; se
eligió ProRes porque es el formato de intercambio que entienden los editores de
vídeo. Pesa unos 27 MB/s y el exportador lo advierte.

## Arquitectura

```
packages/core/         modelo de proyecto, geometría del marco, calidad, cámara
packages/renderer/     compositor compartido por preview y export
packages/capture-cdp/  navegador, screencast y captura de eventos del DOM
packages/export/       render offline determinista y codificación con ffmpeg
apps/desktop/          app de Electron: grabar, editar y exportar
bin/                   CLI de grabación, planificación y exportación
tools/                 utilidades de desarrollo (demo sintética, hoja de contacto)
spikes/                mediciones de viabilidad
```

## Desarrollo

```bash
npm test              # unitarios + integración (arranca un navegador real)
npm run typecheck     # monorepo y app de escritorio
npm run app:check     # compila la app y la verifica pilotándola por CDP
```

Nota: esta máquina de desarrollo no tiene micrófono, así que la verificación de
audio usa el dispositivo falso de Chromium (`--use-fake-device-for-media-stream`),
que genera un tono sintético y concede el permiso solo. La ruta de captura queda
probada; el timbre real de un micro concreto, no.

La app se verifica conduciéndola con el mismo protocolo que usa para grabar:
`tools/verificar-app.ts` la arranca con depuración remota, abre una grabación,
mueve la línea de tiempo, cambia el fondo y comprueba los píxeles que salen del
lienzo. Con `--grabar` ejercita el flujo completo: graba el fixture inyectando
clicks reales en la página grabada y comprueba que al parar hay zoom planificado.

Para trabajar sobre el motor de cámara sin grabar a mano:

```bash
node tools/grabar-demo.ts --secs=14              # graba con guión sintético
node bin/vitrina-plan.ts grabaciones/demo.vitrina
node tools/contacto.ts grabaciones/demo.vitrina  # dibuja el encuadre sobre frames reales
node tools/render.ts grabaciones/demo.vitrina    # hoja de stills compuestos
```

La hoja de contacto es la verificación que importa: la curva de la cámara dice
cuánto amplía, pero solo el recuadro dibujado sobre el frame dice si amplía
sobre lo correcto.

## Licencia

MIT
