# Cómo está hecho

Cómo decide la cámara a dónde mirar, cómo se compone cada fotograma y cómo se
codifica el vídeo. Es la parte que conviene leer antes de tocar el motor.

Las mediciones que respaldan varias de estas decisiones están en
[`spikes/HALLAZGOS.md`](../spikes/HALLAZGOS.md).

[← Volver al README](../README.es.md)

---

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
