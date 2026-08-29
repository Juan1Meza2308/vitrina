# Grabar

Todo lo que pasa antes de darle a Grabar: qué hace falta, cómo se
elige la calidad, el modo vertical para TikTok y Reels, y los fondos.

> Vitrina graba **páginas web**. Abre tu app en una ventana limpia y captura el
> compositor del navegador por DevTools Protocol; no captura el escritorio.

[← Volver al README](../README.es.md)

---

## Lo que hace falta

Un navegador Chromium. En Windows ya está: Edge viene con el sistema. En macOS
hay que instalar [Chrome](https://google.com/chrome) — Safari no sirve, no expone
screencast por DevTools Protocol.

**ffmpeg viene dentro de Vitrina**, así que no hay nada que instalar para
exportar. Durante mucho tiempo no fue así, y la razón estaba escrita: los presets
`alpha` y `webm` necesitan `prores_ks` y `libopus`, y un build empaquetado puede
no traerlos. La objeción era buena, así que no se cambió a ojo: se comprobó, y
hay un test que para la publicación si el binario que viaja con la app deja de
traer lo que los presets piden. Si aun así no apareciera, la pantalla de
bienvenida deja señalar otro a mano.

En macOS **Vitrina no pide permiso de grabación de pantalla**, porque no captura
la pantalla. Solo pide micrófono, y solo si eliges narrar.

Para ejecutarla desde el código hace falta además Node 22.18+.

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

La pantalla de inicio va en **dos columnas**: a la izquierda lo que hay que
decidir para grabar —con el botón dentro de la tarjeta, no al final de la
página—, y a la derecha el micrófono, la cámara y las grabaciones recientes. Bajo
1040 px de ancho vuelve a una sola columna.

Cada grabación reciente es una **tarjeta con imagen**: la portada es el fotograma
del **primer click** —al arrancar, la página suele estar en blanco—, con la
duración sobrepuesta y el nombre de la app grabada. Al posar el cursor, la
tarjeta **pasa seis fotogramas** de la demo: es lo que la hace reconocible sin
abrirla. La tira se pide en ese momento y se cachea; generarlas todas al arrancar
serían decenas de frames grandes decodificados para algo que quizá nadie mire.

Y una carpeta `.vitrina` se puede **soltar sobre la ventana** para abrirla.

### Calibrar (opcional, una vez)

```bash
npm run calibrar
```

Los presets de captura llevan fps **medidos**, no estimados, y el techo depende
de la máquina. Los de serie salen de un i5-7500 con HD 630; en un equipo más
rápido son conservadores y en uno más lento prometerían fps que no llegan. Esto
vuelve a medir con el mismo grabador que usa la app y reescribe
`packages/core/src/presets.medidos.ts`.

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
--tapar=<sel>       selectores CSS a difuminar al grabar: "#saldo, .email"
--desenfoque=<n>    radio del desenfoque en px (por defecto 12)
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

Y la guía escrita de la misma demo:

```bash
node bin/vitrina-guia.ts grabaciones/mi-demo.vitrina
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
> [M7](../spikes/HALLAZGOS.md).

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

Desde [M7](../spikes/HALLAZGOS.md) la resolución sale de la **escala de
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
