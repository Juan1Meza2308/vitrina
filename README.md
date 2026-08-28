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
| Acelerar esperas | hecho |
| Vista de móvil real en vertical | hecho |
| Cursor suavizado | hecho |
| Rótulos y teclas en pantalla | hecho |
| Editor tipo CapCut · deshacer · memoria | hecho |
| macOS y Windows | hecho (sin probar en Mac) |
| Grabación vertical (9:16) | hecho |

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

## Vertical para TikTok, Reels y Shorts

En la pantalla de inicio se elige **Horizontal** o **Vertical**. En vertical no
se recorta nada al final: la pestaña se abre con **proporción de móvil** y se
graba así, lista para subir.

La diferencia importa. Componer una grabación apaisada dentro de un lienzo
1080×1920 —que es lo que hace cualquier recorte posterior— deja el contenido en
una tira central rodeada de fondo. Grabando en vertical el contenido ocupa el
93 % del alto del encuadre, y el resto es el margen del marco.

### Es una vista de móvil de verdad, no una ventana estrecha

La página se maqueta a **430 px CSS** con `devicePixelRatio` 2 o 3 — exactamente
lo que ve un teléfono. Tu web entra en su diseño móvil, carga los assets de alta
resolución y los botones salen del tamaño que tendrían en la mano.

Y sale nítida igualmente, porque la resolución no viene del ancho CSS sino de la
**escala**: a 430×932 con escala 2 el screencast entrega frames de 860×1864.

| Preset | Viewport CSS | Escala | Frame | Salida | Zoom nítido |
|---|---|---|---|---|---|
| fluido | 390×844 | ×2 | 780×1688 | 720×1280 | 1.42× |
| equilibrado | 430×932 | ×2 | 860×1864 | 720×1280 | 1.56× |
| nitido | 430×932 | ×2.5 | 1075×2330 | 1080×1920 | 1.30× |
| maximo | 430×932 | ×3 | 1290×2796 | 1080×1920 | 1.56× |

> Esto **contradice la conclusión de M0**, que dio la combinación por imposible
> porque `Page.startScreencast` ignora el `deviceScaleFactor`. Es cierto puesto
> por `Emulation`; forzándolo al lanzar el navegador
> (`--force-device-scale-factor`) el surface del compositor nace ya escalado y el
> screencast lo respeta. Hay que ponerlo en los dos sitios: sólo en el navegador,
> la página cree tener dpr 1 y carga los assets de baja resolución. Medido en
> [M7](spikes/HALLAZGOS.md).

Un teléfono actual es **19.5:9**, no 16:9, así que el marco sale con la
proporción correcta (0.47) en vez de rechoncho, y el contenido ocupa el 93 % del
alto del encuadre.

Si se quiere comprobar lo de los fps en vez de creerlo:

```bash
node tools/calibrar.ts --vertical
```

Mide **las dos formas seguidas en la misma pasada** y compara dentro de cada
pareja. Comparar contra los presets guardados no vale: se midieron con la maquina
en reposo, y basta con tener algo pesado abierto para que la misma resolucion
apaisada baje de 99 a 34 fps; con esa referencia, la carga del momento se lee
como si la forma fuera el problema. No reescribe los presets.

> **Sin verificar todavia.** En el equipo de desarrollo no se ha podido medir:
> con otras aplicaciones ocupando la CPU, las medidas se contradicen entre si
> —1280×720 daba 8 fps y 1920×1080 daba 20, cuando el pequeno deberia ser el
> rapido—. Por eso la pantalla de inicio dice, al elegir vertical, que los fps
> que muestra estan medidos en horizontal. Ejecuta el comando de arriba con la
> maquina tranquila para saberlo en la tuya.

En vertical el marco por defecto no es la barra de navegador sino un **marco de
móvil**: bisel por los cuatro lados e isla dinámica. Una barra de escritorio
sobre un encuadre 9:16 desentona. Se puede cambiar en el editor, en Marco.

El marco lleva bisel uniforme y una **muesca** que cuelga dentro de la pantalla,
con los rebajes cóncavos donde la pantalla entra en ella, auricular y cámara. La
muesca no llega a la mitad del ancho a propósito: que la app se vea a los dos
lados es lo que la hace leerse como muesca y no como una banda negra pegada
arriba. A cambio tapa una franja estrecha del contenido, igual que en un teléfono
real; si molesta, `Sin marco` en el panel de Marco lo quita.

El editor abre en la salida que corresponde a lo capturado, y el exportador
arranca en ese mismo preset. Si se elige una salida de otra forma, avisa antes de
exportar en vez de dejar que el usuario lo descubra al abrir el fichero.

### La salida no puede dejar al material sin margen

El lienzo por defecto es el mayor de los verticales estándar que conserve al
menos un 15 % de margen de zoom. Reencuadrar a proporción de móvil estrecha la
captura, y exportar eso al lienzo más grande que haya no sólo deja la cámara sin
recorrido: **amplía en reposo** y el vídeo sale blando. Medido antes de la regla,
`fluido` daba 0.87×.

El margen no se estima con una fórmula aparte: se le pregunta a
`computeQualityBudget`, que deriva de la misma geometría que dibuja el
compositor. Una fórmula propia volvería a divergir en cuanto cambiara el marco,
que es justo el error que este proyecto ya cometió una vez.

Para 1080×1920 hay que capturar a `nitido` o más.

## Calidad de imagen

El indicador **«zoom nítido hasta N×»** que aparece al grabar no es decorativo.
El margen no es `captura / salida`, como suele asumirse, sino
`ancho_captura / ancho_mostrado_de_la_ventana`: como el marco se dibuja con
padding sobre el fondo, ocupando ~80% del lienzo, capturar a 1728×972 y exportar
a 720p da **1.69× de zoom sin pérdida**, y en reposo submuestrea 1728→1024, que
se ve más nítido que un 1:1.

Reducir el padding se paga en nitidez al ampliar. Por eso el número se recalcula
en vivo: hay que verlo antes de grabar, no al mirar el export.

### El margen se compra con escala, no ensanchando el viewport

La versión anterior compraba margen de zoom **ensanchando la maquetación**: para
llegar a 2.50× había que emular un viewport de 2560 px. A esa anchura la
interfaz de la app se renderiza diminuta, y el vídeo parece una captura vista
desde lejos aunque sea nítida.

Desde [M7](spikes/HALLAZGOS.md) la resolución sale de la **escala de
dispositivo**, así que la página maqueta a un ancho de portátil normal y la
nitidez se consigue aparte. Cada escalón mejoró en los tres ejes a la vez:

| Preset | Maqueta a | Captura | Zoom nítido | fps | p95 |
|---|---|---|---|---|---|
| fluido | 960 px | 1440×810 | 1.41× | 101 | 12.4 ms |
| **equilibrado** | **1152 px** | **1728×972** | **1.69×** | **92** | **23.6 ms** |
| nitido | 1280 px | 1920×1080 | 1.88× | 61 | 32.8 ms |
| maximo | 1280 px | 2560×1440 | 2.50× | 45 | 55.5 ms |

Antes, esos mismos escalones maquetaban a 1280/1600/1920/2560 px con 1.25×/1.56×
/1.88×/2.50× de margen. El coste por escalón se mantuvo casi igual **a
propósito**: la prioridad del proyecto es la fluidez, y una tabla que ganara
nitidez bajando el preset por defecto de 99 a 59 fps no sería una mejora, sería
cambiar de moneda sin decirlo.

Medido en un i5-7500 con Intel HD 630 — reproducible con `npm run calibrar`. La
selección automática usa el p95, no la mediana: a 1440p la mediana parece bastar
para exportar a 30 fps, pero huecos de 55 ms se ven como tirones.

Si el navegador no llega a aplicar la escala, la app **avisa al parar** en vez de
entregar en silencio un vídeo mucho menos nítido del prometido.

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

## El editor

La ventana sigue la forma de un editor de vídeo de escritorio: biblioteca a la
izquierda, previsualización en el centro con su transporte, inspector a la
derecha, y **la línea de tiempo a todo lo ancho abajo** con su barra de
herramientas.

La línea de tiempo tiene una regla con marcas en minutos:segundos y **tres
carriles**, porque tres cosas distintas se superponían antes en una sola franja
de 44 px:

- **Vídeo** — los tramos de zoom, con su etiqueta y sus asas
- **Ritmo** — los acelerados (rayado azul) y los silencios cortados (gris). Se
  pintan distinto a propósito: un corte quita material y un acelerado lo
  conserva
- **Audio** — la narración, con su forma de onda

El **zoom de la línea de tiempo** no es adorno. Con todo aplastado al ancho de
la ventana, una demo de tres minutos daba unos 400 ms por píxel: no se podía
colocar un corte donde tocaba. Por defecto va ajustado al ancho, así que el
comportamiento sólo cambia si se amplía.

> El paso de la regla se elige por la **anchura disponible**, no por la
> duración: la misma grabación al doble de ancho enseña más detalle, y las
> marcas nunca se amontonan a menos de 70 px. Y la onda toma el **pico** de cada
> columna, no la media: la media de una voz normal ronda 0.02 y saldría plana,
> sin decir dónde se habló, que es justo para lo que sirve.

### Deshacer, atajos y memoria

`Ctrl+Z` deshace y `Ctrl+Shift+Z` rehace. Lo que se deshace es el estado de
edición **entero** —proyecto y tramos de zoom—, no sólo la mitad: borrar un tramo
por error es el accidente típico y era irreversible.

> Lo único difícil del historial es el **agrupado**. Arrastrar un tramo dispara
> decenas de cambios de estado; sin agrupar, deshacer retrocedería un píxel de
> movimiento y habría que pulsarlo cuarenta veces. Los cambios separados por
> menos de 400 ms cuentan como el mismo gesto, que es lo que distingue «estoy
> arrastrando» de «he decidido otra cosa» sin que cada control tenga que avisar
> de cuándo empieza y termina.

Las flechas mueven la aguja un frame, con `Shift` un segundo, e `Inicio`/`Fin`
van a los extremos. Arrastrando no se llega al frame exacto.

La app **recuerda** la última dirección, preset, orientación y micrófono en un
`ajustes.json` en `userData`, y ofrece las últimas grabaciones en la pantalla de
inicio. Se guardan al grabar, no al teclear: escribir media URL y cerrar no
debería dejarla puesta para la próxima vez.

## Ritmo: acelerar las esperas

Una demo real está llena de esperas —una carga, un formulario que se rellena, un
scroll largo— y en tiempo real cansan. El material sigue haciendo falta, así que
acelerarlo es mejor que cortarlo.

El botón **Acelerar esperas** las deduce del log de eventos, no de los píxeles:
comparar frames marcaría como actividad cualquier animación, un spinner o el
cursor parpadeando en un input, que es justo lo que hay durante una espera.

La velocidad no es fija. Sale de cuánto dura cada espera, porque lo que molesta
no es esperar sino cuánto: una de 3 s a 2× sigue siendo lenta. Con un objetivo
común, todas acaban durando más o menos lo mismo en el vídeo.

Se guarda como datos, igual que los cortes: volver a tiempo real devuelve el
tramo sin haber degradado nada.

### Por qué esto salió casi gratis

El exportador saca el frame, la posición de la cámara y el cursor de
`map.sourceAt(instante de salida)`. En cuanto `TimeMap` remapea el tiempo con
una velocidad por tramo, **el vídeo, el zoom y el puntero se aceleran solos**.

Lo único que no se puede muestrear es el audio: hay que estirarlo. De eso se
encarga una cadena de `atempo`, que sólo acepta factores entre 0.5 y 2, así que
4× son dos filtros. Se descompone en factores iguales y no en «2 y lo que sobre»
porque cada pasada deja huella en el timbre.

El preview aplica el mismo mapa —incluido el `playbackRate` del audio—, o el
editor mentiría respecto al vídeo exportado.

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

### El cursor va suavizado

El puntero que se dibuja no repite las muestras crudas del ratón: pasa por el
mismo muelle críticamente amortiguado que usa la cámara, remuestreado a 240 Hz.
La mano tiembla, y ese temblor a pantalla completa se ve como nerviosismo —
medido sobre un trazo horizontal con temblor sintético, el recorrido vertical
baja de 400 px a 16.

El asentamiento es corto (90 ms) por un motivo concreto: un muelle lento llega
tarde, y si el puntero se dibuja lejos del botón justo al pulsar, la onda del
click y el cursor se contradicen y queda peor que el temblor. Como todo el mundo
se para antes de pulsar, a 90 ms el error en ese instante es de menos de un
píxel, y hay un test que lo fija.

El motor de cámara sigue recibiendo la trayectoria **cruda**: ya tiene su propio
muelle, y encadenar dos haría que el encuadre persiguiera a un puntero que a su
vez persigue al ratón.

## Rótulos y teclas

Al pulsar un botón aparece su **texto** —«Cotizar», «Email»— junto al puntero, y
las teclas se muestran como insignias. Salen del DOM al grabar, no de los
píxeles: es lo que un grabador de pantalla no puede tener.

> **Lo que se escribe nunca se muestra.** El log guarda `"char"` para cualquier
> tecla imprimible, a propósito, para que una demo con un login no filtre
> credenciales. La capa de dibujo pinta esos `"char"` como un punto y no
> reconstruye texto. Hay un test que lo fija, porque es el tipo de cosa que
> alguien «arregla» sin saber por qué estaba así.

El rótulo va junto al click y no abajo del todo: señala. Puesto en una posición
fija sería un subtítulo y habría que buscar a qué se refiere.

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
npm run app:check:vertical   # el flujo vertical entero, de grabar a exportar
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

Con `--vertical` recorre el flujo 9:16 de punta a punta: elige vertical en la
pantalla de inicio, graba [`spikes/vertical.html`](spikes/vertical.html),
comprueba que el manifest sale girado, que el marco de móvil se dibuja **de
verdad** —por píxeles del lienzo, no por lo que diga `project.json`— y que el mp4
resultante mide 1080×1920. Ese fixture va en claro a propósito: con una app
oscura el bisel del marco y el fondo de la app serían el mismo color y la
comprobación no distinguiría nada. También comprueba que el lienzo **quepa** en
su caja y que el transporte siga dentro de la ventana: ese fallo —una fila de
grid `auto` que crecía con el contenido— no lo habría visto ninguna prueba de
píxeles del compositor, porque estaba en el CSS del editor y no en lo que se
dibuja.

Para trabajar sobre el marco sin abrir la app entera:

```bash
node tools/grabar-vertical.ts        # graba una demo 9:16 corta
node tools/ver-marco.ts --t=3000     # compone un frame a PNG
```

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
