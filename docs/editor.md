# El editor

El editor previsualiza con **el mismo compositor que usa el exportador**, así
que lo que se ve es exactamente lo que sale en el vídeo.

[← Volver al README](../README.es.md)

---

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

La interfaz es de **cristal**, con cuatro reglas escritas en la hoja de estilos:

- **El cristal es del contenedor, nunca del contenido.** Panel, píldora, hoja y
  tarjeta son cristal; botón, campo y carril son superficie sólida. Dos velos
  apilados no se leen: cada uno suma su neblina sobre el texto.
- **La luz viene de arriba**: filo claro en el canto superior, oscuro en el
  inferior, y un brillo que **sigue al cursor** por las superficies grandes.
- **Cuanto más flota, más grueso**: tres niveles —panel, flotante, modal— en los
  que suben a la vez opacidad, desenfoque y sombra.
- **El color lo pone lo que hay detrás**: el material se tiñe con el fondo de la
  demo que tienes abierta, así que el editor cambia de color con cada grabación.

> **El desenfoque solo se pone donde se lo gana: encima de algo.** Los paneles
> van al lado del lienzo, no sobre él, así que detrás sólo hay un fondo plano:
> desenfocarlo no cambia un píxel y cuesta recomponer toda esa superficie en cada
> repintado. Medido: con desenfoque en todo, la reproducción del editor caía de
> 27 a 13 fps —ver [`spikes/HALLAZGOS.md`](../spikes/HALLAZGOS.md), M12—. Se queda
> donde sí hay vídeo detrás: la píldora del transporte, la hoja y los avisos.

El aspecto sigue los principios de interfaz de Apple —material translúcido con
desenfoque y filo de luz en vez de cajas opacas, respuesta **al pulsar** y no al
soltar, tipografía con tracking e interlineado propios de cada tamaño, y las tres
señales de accesibilidad: `prefers-reduced-motion`, `prefers-reduced-transparency`
y `prefers-contrast`—. Toca la ventana y nada más: el compositor pinta sus
propios colores, así que el vídeo exportado no se entera.

**`?` abre la hoja de atajos.** Estaban todos y no se veían en ninguna parte:
quien no leyera esto no sabía que existían.

La ventana tiene **tema claro** además del oscuro, con el interruptor en la
esquina de la pantalla de inicio. Cambia el aspecto de la app y nada más: el
compositor pinta sus propios colores, así que el vídeo exportado no se entera.

La app **recuerda** la última dirección, preset, orientación y micrófono en un
`ajustes.json` en `userData`, y ofrece las últimas grabaciones en la pantalla de
inicio. Se guardan al grabar, no al teclear: escribir media URL y cerrar no
debería dejarla puesta para la próxima vez.

## Repetir la grabación

La dolencia número uno de cualquier herramienta de demos: un fallo en el minuto
tres obliga a repetir los tres minutos, y encima se pierde todo lo editado.

Vitrina no graba píxeles: conduce un navegador y guarda **lo que pasó** —cada
movimiento, cada click con el rectángulo del elemento—. Así que puede volver a
ejecutar la misma demo sola, en un navegador nuevo:

- Salió un error en el vídeo → se arregla la app y se repite la demo igual.
- Se grabó a `fluido` y hace falta más resolución → se repite a `maximo`.
- Cambió el idioma, el tema o los datos → misma demo, otro contenido.

**Y conservando la edición.** La repetición sigue los instantes del log, así que
los tramos de zoom caen donde caían y el proyecto entero —look, zooms, ritmo,
cortes— se copia a la grabación nueva. La original no se toca.

> El proyecto se copia **reescalado**. Los tramos de zoom guardan su objetivo en
> píxeles de la fuente, así que copiarlos tal cual a una captura de otro tamaño
> deja la cámara encuadrando otro sitio — y el vídeo sale bien a primera vista.
> Medido al implementarlo: un tramo que encuadraba el 6 % del ancho pasaba a
> apuntar al 4 %.

Tres cosas que conviene saber:

- **Vuelve a tapar lo mismo.** Los selectores quedan en el manifest, así que una
  segunda toma no publica el dato que se tapó en la primera.
- **Lo que se escribió no se puede reproducir.** El log guarda que se pulsó una
  tecla, nunca cuál — es la misma garantía que impide que una demo con un login
  filtre credenciales. Para los formularios se puede dar un texto de relleno.
- **Es volver a ejecutar el guion, no clonar el vídeo.** Si la app depende de la
  red o de un estado previo, el resultado puede diferir.

```bash
node tools/repetir.ts grabaciones/demo.vitrina --preset=maximo
```

Compara al terminar las **etiquetas de los elementos pulsados** con las del
original. Contar eventos no probaría nada: la prueba es que aterrizó en los
mismos botones.

## Tu marca en cada demo

Un **look** guarda el fondo, el marco y la marca de agua con un nombre. Se
guardan en los ajustes y no dentro de la grabación porque son tuyos, no de una
demo concreta: la gracia es aplicar el mismo a la siguiente. Uno se puede marcar
con la estrella para que se aplique solo a las grabaciones nuevas.

> Aplicar un look toca el **aspecto y nada más**: zooms, cortes, velocidades,
> recorte y salida se quedan como estaban. Un look que arrastrara el montaje de
> otra grabación sería una trampa, y hay un test que lo fija.

La **marca de agua** va anclada al lienzo, no al contenido. Una marca que se
moviera con el zoom sería un adorno dentro de la demo; quieta en una esquina es
una firma.

> La imagen se copia **dentro** de la carpeta `.vitrina`, igual que el fondo de
> imagen, y el proyecto guarda una ruta relativa. Así la carpeta se puede mover
> de máquina y sigue exportando igual. Guardar la ruta original haría que el
> export fallara en cuanto se moviera el fichero.

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
