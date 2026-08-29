# Narración, cámara y rehacer trozos

La voz, la cara y las tres formas de arreglar una demo sin volver a grabarla
entera: pausar mientras grabas, doblar la narración después, o regrabar desde un
punto conservando lo de antes.

[← Volver al README](../README.es.md)

---

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

## Tu cara en la demo

La cámara se enciende en la pantalla de inicio, al lado del micrófono, y sale en
una **burbuja** sobre el vídeo. La previsualización de antes de grabar es
redonda y del tamaño real de la burbuja: lo que se ve ahí es lo que va a salir,
recorte incluido, y así no se descubre al terminar que se sale medio hombro.

Se graba en **su propio fichero**, aparte del vídeo, y eso es lo que permite
tratarla como montaje y no como material quemado:

- La burbuja se mueve de esquina, cambia de tamaño y de forma, se voltea o se
  quita entera **sin volver a grabar**.
- Va **anclada al lienzo**, no al contenido: una burbuja que se moviera con el
  zoom sería parte de la demo, y no lo es —es quien la cuenta—. Es el mismo
  argumento que la marca de agua, y va debajo de ella para que la firma gane si
  comparten esquina.
- La imagen se **recorta**, nunca se deforma. La cámara entrega 4:3 y la burbuja
  es cuadrada; escalar para que quepa haría una cara más estrecha de lo que es,
  que es justo el defecto que nadie perdona en su propia imagen.
- Sin espejo por defecto: quien se graba se ve en espejo y le resulta natural,
  pero quien mira el vídeo espera el texto de la camiseta al derecho.

> **Un solo compositor, también aquí.** La burbuja la dibuja `composite()` en
> Canvas 2D, la misma función que pinta el preview y el export. Componerla con
> un filtro `overlay` de ffmpeg habría sido más corto y habría roto lo único que
> este proyecto no negocia: que lo que se ve al editar sea lo que sale. El precio
> es un pre-pase que extrae el `webm` a imágenes antes de exportar, ya escaladas
> al tamaño de la burbuja.

Los cortes y las aceleraciones le salen **gratis**: la cámara se muestrea por el
mismo instante de material que el vídeo, así que un tramo a 4× lleva la cara a
4× sin tocar nada. Y la narración y la cámara comparten la corrección de desfase,
porque las dos se capturan en otro proceso y arrancan antes que el vídeo.

Dos cosas que conviene saber:

- **La repetición no arrastra la cámara.** Se repite la demo, no a quien la
  cuenta: sin volver a grabar no hay pista.
- **Grabar la cámara no le cuesta fps al vídeo** —medido en
  [`spikes/HALLAZGOS.md`](../spikes/HALLAZGOS.md), M11: 479 frames sola contra 480
  con la cámara capturando—. Para comprobarlo en tu equipo:
  `node spikes/m11-camara-fps.mjs`.

Se verifica con el dispositivo falso de Chromium, igual que el micrófono, así
que una máquina sin cámara puede comprobar la ruta entera:
`node tools/verificar-app.ts --camara` graba con cámara, comprueba el fichero y
el desfase, y **mide por píxeles** la región del lienzo donde va la burbuja con
ella y sin ella. Lo que queda sin probar es el encuadre de una cara de verdad.

## Pausar, parar y marcar sin volver a Vitrina

La demo pasa en **otra ventana**, así que volver a la de Vitrina para pulsar un
botón sale en el vídeo. Tres atajos que funcionan con la ventana detrás:

| | |
|---|---|
| `Ctrl+Mayús+S` | parar y editar |
| `Ctrl+Mayús+P` | pausar y reanudar |
| `Ctrl+Mayús+M` | señalar este momento |

Se registran **sólo mientras se graba** y se liberan al parar: un atajo global
que sobreviva a la grabación se dispararía dentro de otra app. Si el sistema no
concede alguno —porque otro programa lo usa— se dice en pantalla, porque un
atajo mudo es peor que no tenerlo. Y hay botones para todo, que el atajo puede
estar cogido.

> **La pausa para el vídeo, no el micrófono.** No es un descuido: el reloj del
> audio tiene que seguir coincidiendo con el de pared, que es de lo que vive la
> corrección de desfase. Parar el micro obligaría a reescribir el mapeo de la
> narración entera para ahorrar unos segundos de ruido de sala que el corte se
> lleva igual. El trozo pausado se guarda como un **corte**, así que no sale en
> el vídeo y se puede recuperar quitándolo.

Los momentos señalados salen como **chinchetas** en la regla de la línea de
tiempo —se pinchan y la aguja va ahí— y son los que mandan al generar los
capítulos: quien graba sabe mejor que nadie dónde empieza cada parte.

## Doblar la narración

Narrar mientras operas es donde se estropea la mayoría de las demos: o la voz va
a trompicones, o el ratón espera a la voz. En el panel **Doblar la voz** se graba
la voz **viendo el vídeo ya montado** —con sus cortes, sus aceleraciones y sus
zooms—, y después se elige qué se oye: la narración original, tu voz o nada.

> **La voz no pasa por el mapa de tiempo, y es lo que la hace barata.** Se grabó
> contra el vídeo ya cortado y acelerado, así que esos cortes ya están dentro de
> ella: es un solo tramo de principio a fin. Trocearla otra vez por los tramos
> del material la cortaría dos veces y sonaría a saltos.

Dos detalles que se cuidan solos:

- **La narración original se silencia mientras doblas**, o el micrófono la
  volvería a grabar por los altavoces.
- **El desfase se mide, no se estima.** El micrófono arranca antes que la
  reproducción y se anota la ventaja que le sacó —unos milisegundos—, igual que
  ya se hace con la narración en vivo. Un doblaje corrido dos segundos suena
  perfecto en el editor y mal en el vídeo.

Si se pide la voz y el fichero no está, se avisa y se cae a la narración:
quedarse mudo por un fichero perdido sería peor que sonar distinto.

## Regrabar desde un punto

La dolencia peor de todas: te equivocas en el segundo cuarenta de una demo de
tres minutos y repites los tres minutos. Ningún grabador de píxeles puede
evitarlo, porque sólo sabe **qué se vio**. Vitrina sabe **qué pasó**.

Pon la aguja donde se torció y pulsa **Regrabar desde ahí**: Vitrina vuelve a
ejecutar sola la parte buena —con los mismos tiempos, que es lo que deja tu app
en el mismo estado—, te avisa y sigues tú.

```bash
node tools/regrabar.ts grabaciones/mi-demo.vitrina --desde=40s
```

- **La grabación original no se toca**: sale una carpeta nueva.
- **Los zooms de la cabeza se conservan**, incluidos los que moviste a mano, que
  es justo lo que no se puede perder. Los de la cola se planifican de cero:
  ahí hay material nuevo, y copiar los viejos dejaría la cámara encuadrando lo
  que ya no está.
- **Lo que se tapó se sigue tapando.** La toma nueva no puede publicar lo que la
  vieja escondía.

> **La cabeza espera hasta el instante exacto**, aunque el último click cayera
> antes. Sin eso duraría menos que la original —entre el último click y el punto
> elegido no pasa nada, pero ese hueco existe— y los zooms conservados, que van
> por instante, apuntarían un poco antes de donde toca. Lo cazó
> `verificar-app --regrabar` al ver la cola metida dentro de la cabeza.

Lo que se pierde, dicho claro: **tu voz de la cabeza**. Durante esos segundos no
estabas hablando, así que la narración empieza en el relevo —el montaje antepone
el silencio solo—. Si la quieres, se dobla después con la voz.

## La demo se documenta sola

De una demo sale un vídeo y, normalmente, nada más: quien quiera la versión
escrita la escribe a mano viendo el vídeo. Vitrina no graba píxeles, así que del
**mismo log** salen tres cosas más:

```bash
node bin/vitrina-guia.ts grabaciones/mi-demo.vitrina
```

- **`guia.md`** — los pasos en Markdown, cada uno con su marca de tiempo y una
  captura recortada al elemento del que habla.
- **`capitulos.txt`** — los capítulos con marca de tiempo, listos para pegar en
  la descripción de YouTube.
- **`guia.srt`** — subtítulos de **acción**: no es una transcripción de la voz,
  es lo que se está haciendo en cada momento, que es justo lo que un vídeo mudo
  no cuenta.

También hay un botón **Exportar guía escrita** en el panel de exportación.

Tres decisiones que no son evidentes:

- **Los instantes van en tiempo de salida.** Un paso que apuntara al material
  mandaría al lector a un segundo que el vídeo no tiene en cuanto hubiera un
  corte o un tramo acelerado. Y lo que se cortó **no es un paso**: `outputAt`
  devuelve nulo, en vez de saturar al borde y dar un número plausible y falso.
- **Una ráfaga de teclas es un paso, no veinte.** Dice *dónde* se escribió
  —«Escribe en «Email»»— y nunca *qué*: el log guarda que se pulsó una tecla,
  jamás cuál, y la guía no iba a ser la grieta de esa garantía. Lo mismo con lo
  tapado, que llega con la etiqueta a nulo y sale como «Pulsa aquí».
- **La captura es el frame crudo, recortado al elemento**, no el frame compuesto
  del vídeo. El fondo y el marco son el envoltorio del vídeo; en un tutorial
  escrito sólo roban espacio al botón del que habla el paso. Y nunca se amplía:
  una captura estirada se ve peor que una más pequeña.
