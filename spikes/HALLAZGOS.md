# M0 — Resultados del spike de viabilidad

Máquina: i5-7500 (4c/4t, 2017) · Intel HD 630 · 16 GB · monitor 1920×1080 @200 Hz
Navegador: Edge 151.0.4129.107 (EdgeCore / runtime WebView2)
Fecha: 2026-08-25

---

## 1. El supuesto central del plan era falso

El plan asumía que `Emulation.setDeviceMetricsOverride({deviceScaleFactor: 3})` haría
que el screencast entregara frames a 3×. **No es así.**

| Estrategia | `screencastFrame` | `captureScreenshot` |
|---|---|---|
| sin override | 1256×688 | 1256×688 |
| dsf 2, w/h = 0 | 1256×688 | 2512×1376 |
| dsf 3, w/h = 0 | 1256×688 | 3768×2064 |
| dsf 2, w/h explícitos | 1256×688 | 2512×1376 |
| dsf 3, w/h explícitos | 1256×688 | 3768×2064 |
| dsf 3, w/h 1280×720 | 1280×720 | 3840×2160 |
| **dsf 1, w/h 2560×1440** | **2560×1440** | 2560×1440 |
| dsf 2, w/h 1920×1080 | 1920×1080 | 3840×2160 |

**`Page.startScreencast` ignora por completo el deviceScaleFactor** y entrega
siempre el viewport CSS a 1:1. `Page.captureScreenshot` sí lo honra al 100%.
Comprobado idéntico en headed y en `--headless=new`.

Consecuencia: la única forma de subir la resolución del screencast es **emular un
viewport más grande que la ventana física** (dsf 1). Funciona, pero la app maqueta
como si la pantalla midiera 2560 px de ancho.

### El truco de `zoom` no lo arregla

Con viewport 2560×1440 y `document.documentElement.style.zoom = 2`:
`matchMedia("(min-width:2000px)")` **sigue matcheando**. Los media queries ven
2560 px, así que una app responsive muestra su layout ultra-ancho. No sirve para
una demo fiel.

---

## 2. Techo de rendimiento: ~100 MP/s

Fixture de estrés (repinta canvas en cada rAF — peor caso, agravado por el
monitor de 200 Hz que dispara rAF a 200 fps):

| Resolución | MP | q | fps medio | fps mediano/s | delta p50 |
|---|---|---|---|---|---|
| 1280×720 | 0.92 | 92 | 85.5 | 99 | 10.0 ms |
| 1600×900 | 1.44 | 85 | 67.0 | 67 | 10.2 ms |
| 1920×1080 | 2.07 | 80 | 45.3 | 45 | 16.8 ms |
| 2560×1440 | 3.69 | 70 | 34.0 | 35 | 24.7 ms |
| 2560×1440 | 3.69 | 50 | 35.3 | 38 | 25.2 ms |

**La calidad JPEG es irrelevante para el rendimiento** (q50 → 35.3 fps vs
q70 → 34.0). El cuello no es la compresión: es el pipeline de captura y
transferencia. No hay nada que ganar sacrificando calidad de imagen.

### Página realista (sin animación permanente)

| Resolución | fps medio | delta p50 | delta p95 |
|---|---|---|---|
| 1920×1080 | 26.6 | 14.9 ms | 110 ms |
| 2560×1440 | 20.5 | 24.9 ms | 180 ms |

El fps medio baja porque **el screencast solo emite frames cuando la página
cambia** — un segundo estático tiene 3 frames y eso es correcto, no un fallo.
El indicador válido es el delta durante movimiento. El p95 de 110-180 ms sí
indica tirones reales durante la interacción.

> Nota metodológica: la métrica «fps sostenido = peor segundo» del script no
> sirve para contenido realista, porque castiga los segundos estáticos. Hay que
> segmentar por ventanas con actividad de input antes de volver a usarla.

---

## 3. Lo que sí quedó validado

- **Captura de eventos desde el DOM: perfecta.** 30/30 clicks en todas las
  ejecuciones traen `getBoundingClientRect()` del elemento, su `tagName` y su
  etiqueta de texto. La ventaja diferencial sobre Screen Studio es real.
- **Sincronización trivial.** `metadata.timestamp` del frame y `Date.now()` del
  script inyectado comparten reloj.
- **Coste del pipeline en Node: despreciable.** ack lag medio 0.32-2 ms, cola de
  escritura máx. 32 frames. El cuello está en Chrome, no en nuestro código.
- **`--app=` da ventana sin barra de pestañas ni URL**, material limpio.
- **Privacidad por defecto:** el log de teclado registra `"char"`, nunca la tecla.

## 4. Hallazgos de entorno

- El Chromium de Playwright de esta máquina **no se puede ejecutar**
  (`spawn UNKNOWN`), pese a tener ACLs correctas y ningún Zone.Identifier.
  Probablemente bloqueado por seguridad del sistema.
- **No hay Chrome ni Edge estándar instalados**, solo EdgeCore (runtime de
  WebView2) en `C:/Program Files (x86)/Microsoft/EdgeCore/<version>/msedge.exe`.
  Expone CDP completo y funciona igual.
- Decisión de producto derivada: **apuntar a Edge como navegador por defecto**.
  Viene con Windows, así que el usuario final de Vitrina no instala nada.

---

## 5. Veredicto

**GO en arquitectura, NO-GO en el objetivo de 4K en vivo.**

Todo el diseño (eventos DOM, sincronización, compositor, motor de cámara) sigue
en pie. Lo que no se sostiene en este hardware es capturar 2560×1440 o 4K en
vivo a 60 fps. El límite real en vivo está en **1920×1080 a ~30 fps** o
**1600×900 a ~60 fps**.

Como `captureScreenshot` sí honra el DSF y llega a 3840×2160, la vía a 4K real
existe pero es **offline**: hay que poder re-renderizar la sesión, lo que exige
grabar el DOM y reproducirlo, no grabar píxeles.

Esa bifurcación cambia el producto y está pendiente de decisión.

---

## M7 · La vista de móvil sí se puede grabar con resolución

**Refuta la conclusión de M0 en un punto.** M0 midió que
`Page.startScreencast` ignora el `deviceScaleFactor`, y de ahí salió la regla
«o maquetas como móvil o tienes resolución, no las dos». Es cierto **por la vía
que midió** —`Emulation.setDeviceMetricsOverride`— pero no en general.

Forzando la escala al **lanzar el navegador** el surface del compositor nace ya
escalado y el screencast la respeta:

| Configuración | La página ve | Frame real |
|---|---|---|
| emulado 430×932, dsf 1 | 430 css, dpr 1 | 430×932 |
| emulado 430×932, dsf 3 | 430 css, dpr 3 | **430×932** ✗ |
| `--force-device-scale-factor=3` + emulado dsf 1 | 430 css, **dpr 1** | 1290×2796 |
| `--force-device-scale-factor=3` + emulado dsf 3 | 430 css, **dpr 3** | **1290×2796** ✓ |

**Hay que ponerla en los dos sitios.** Sólo en el navegador, los frames salen
grandes pero la página cree tener `devicePixelRatio` 1 y carga los assets de
baja resolución: se ve blanda pese al tamaño.

**Escalas exactas medidas** (M7c, viewport CSS fijo en 430×932):

| Escala | Frame | ¿Exacto? |
|---|---|---|
| 1.5 | 740×864 | no — entregó otra cosa |
| 2 | 860×1864 | sí |
| 2.5 | 1075×2330 | sí |
| 3 | 1290×2796 | sí |

**Coste** (M7b, con `requestAnimationFrame`, no con `setInterval`):

| Captura | MP | fps | p95 |
|---|---|---|---|
| 860×1864 (escala 2) | 1.60 | 71 | 37 ms |
| 1290×2796 (escala 3) | 3.61 | 37 | 57 ms |

> Un `setInterval(…, 33)` para forzar repintado limita la página a 30 fps y
> entonces se mide el driver, no el pipeline. La primera pasada dio 30 fps
> clavados en los cuatro casos, 3.6 MP incluidos, y parecía un techo del
> sistema.

**Dos consecuencias en el código.** `--window-size` va en DIP, así que la
ventana se pide dividida por la escala o sale tres veces más grande que la
pantalla. Y las coordenadas del log van en px CSS: se multiplican por
`devicePixelRatio` en el script inyectado para dejarlas en píxeles de frame, que
es donde trabajan la cámara y el compositor.


---

## M8 · Qué escalas sirven, y una lección sobre spikes

M7c descartó la escala 1.5 porque entregó 740×864 en vez del tamaño pedido. Era
**falso**: repetido con navegador limpio y conectando al target de la *página*
en vez de al primero que hubiera, 1.5 entrega exactamente `css × dsf`.

| Escala | css 1280 | css 960 |
|---|---|---|
| 1.25 | 1073×587 ✗ | 1200×675 ✓ (sólo con 4 s de margen) |
| 1.5 | 1920×1080 ✓ | 1440×810 ✓ |
| 1.75 | 2240×1260 ✓ | 1680×945 ✓ |
| 2 | 2560×1440 ✓ | 1920×1080 ✓ |

1.25 quedó descartada por inestable, no por imposible. No hace falta.

**La lección es del método, no del navegador.** Dos spikes seguidos dieron
resultados falsos por conectarse a un target de CDP que pertenecía al navegador
anterior a medio cerrar. La pista estaba a la vista y se pasó por alto: los
casos que fallaban devolvían todos **el mismo tamaño**, que además era el de la
ventana. Cuando varios casos distintos coinciden en un valor que no depende de
lo que se está variando, lo que falla es el banco de pruebas.

Consecuencia práctica: 1.5 abarata toda la escalera apaisada. Sin ella, el
escalón más barato con maquetación normal costaba 3.69 MP; con ella, 2.07.

## M10 · La CSP de la página anula un `<style>` inyectado, y no avisa

Para tapar datos sensibles hay que meter una hoja de estilos en la página
grabada antes de que se pinte. El script se inyecta por CDP en el *main world*,
que la CSP no filtra —eso ya estaba comprobado—, y de ahí venía el error: que el
script corra no significa que lo que hace aplique.

`node spikes/m10-csp-estilo.mjs`:

| Página | `<style>` creado por script | `new CSSStyleSheet` + `adoptedStyleSheets` |
|---|---|---|
| sin CSP | aplica | aplica |
| `style-src 'self'` | **no aplica** (`filter: none`) | aplica |

Con CSP el elemento **sí entra en el DOM** —`getElementById` lo encuentra— y
`getComputedStyle` devuelve `none`. No hay excepción que capturar. Es el mismo
síntoma que el otro fallo de esta función: el script corre, nada falla, y el dato
sale entero en el vídeo.

Y no es un caso raro: la app que enseña un saldo o un correo en pantalla es justo
la que trae CSP estricta.

**Consecuencia:** el tapado va por hoja construida, que no pasa por esa
comprobación, y el `<style>` se queda de respaldo para un motor que no tenga
`adoptedStyleSheets`. La regresión la fija un test que graba
[`sensible-csp.html`](sensible-csp.html) y mide el contraste del frame: quitando
la hoja construida, la fila tapada pasa de 0,3 a 25 —el mismo valor que la fila
sin tapar—.

**La lección, otra vez, es del método.** Las dos comprobaciones baratas —¿se
genera el script?, ¿se ejecuta?— dieron verde en los dos fallos. La única medida
que los distingue es el píxel del frame guardado.

## M11 · Grabar la cámara no le cuesta fps al screencast

La cámara la captura el renderer de Electron con MediaRecorder mientras otro
Chromium entrega el screencast: dos procesos peleándose por la misma CPU, y el
que no puede perder frames es el screencast. Como la pantalla de inicio promete
fps **medidos**, había que medirlo antes de ofrecer la cámara sin advertencia.

`node spikes/m11-camara-fps.mjs` (1600×900, 8 s por caso, en la máquina de
desarrollo de este contenedor):

| Condición | Frames | fps |
|---|---|---|
| grabando sola | 479 | 59.9 |
| con la cámara capturando a 640×480 @30 vp8 | 480 | 60.0 |

Caída: **ninguna medible**. A 640×480 el coste de codificar VP8 cabe de sobra en
el margen, así que la cámara se ofrece sin número de aviso.

**El spike comprueba su propio banco de pruebas.** Antes de medir el segundo
caso lee el `document.title` de la página de carga, que solo pasa a `grabando`
cuando `MediaRecorder` ha arrancado de verdad. Sin eso, la primera versión medía
«grabar sola» dos veces —la navegación por `PUT /json/new` no había abierto
nada— y daba un 0,2 % de caída con cara de buena noticia. Es la lección de M8
otra vez: cuando el resultado no depende de lo que se está variando, lo que
falla es el banco de pruebas.

Conviene repetirlo en un portátil modesto antes de dar el dato por bueno en
todas partes: aquí sobran núcleos.

## M12 · El desenfoque solo se gana su sitio encima de algo

El material de cristal se aplicó a todas las superficies —paneles laterales,
línea de tiempo, tarjetas, píldora del transporte, hoja de atajos— y la
reproducción del editor se hundió.

`node tools/verificar-app.ts --cristal`, midiendo fps de `requestAnimationFrame`
durante 3 s de reproducción, con el interruptor `data-cristal` para comparar en
la misma sesión:

| | fps | caída |
|---|---|---|
| Desenfoque en todo | 12.7 | **53.7 %** |
| Solo en lo que flota sobre el vídeo | 26.7 | 5.9 % |

**Y no se pierde nada visualmente.** Los paneles van *al lado* del lienzo, no
encima: detrás de ellos solo hay un fondo plano, así que desenfocarlo no cambia
un píxel y obliga a recomponer toda esa superficie en cada repintado. El cristal
sigue siendo cristal —vidrio translúcido, brillo, tinte, filo y sombra—; lo único
que se va es un filtro que no tenía nada que filtrar.

El desenfoque se queda donde sí hay algo detrás: la píldora del transporte, la
hoja de atajos y los avisos, que flotan sobre el vídeo.

**La lección:** un efecto que no se puede ver es coste puro, y en un editor de
vídeo el coste se paga justo cuando el usuario está mirando. La regla que queda
escrita en `styles.css` es «el desenfoque solo se pone donde se lo gana: encima
de algo».

Los números absolutos son de este contenedor, sin GPU: en una máquina con
aceleración la composición del filtro es mucho más barata. Lo que no cambia con
el hardware es que desenfocar un color plano no dibuja nada.

---

## M13 · Un recorrido de rendimiento del editor, y cuatro sospechosos equivocados

**Pregunta:** la app había crecido mucho —cristal, tarjetas con previsualización,
doblaje, guía, cámara— y nadie había medido el editor. ¿Dónde duele?

`node tools/verificar-app.ts --rendimiento` mide sobre la app de verdad y la
misma grabación: arranque, fps quieto, reproduciendo y arrastrando, tareas
largas, y el export. La línea base decía esto:

| | antes |
|---|---|
| arranque | 916 ms |
| quieto | 60.3 fps |
| reproducción | 43.0 fps |
| **arrastre de la aguja** | **20.0 fps · 279 ms bloqueados** |
| export | 46.7 s para 19.5 s de vídeo |

Quieto a 60 y arrastrando a 20. Ahí estaba.

### Lo que el repaso de código dijo, y la medida desmintió

Del repaso salieron dos culpables «con nombre y apellidos»: la forma de onda,
que eran 900 `<span>` rehechos en cada tick, y la falta de `React.memo` en la
línea de tiempo. El perfilador de muestreo durante un arrastre repartió así el
tiempo: **51.5 % `(program)`** —pintado, fuera de JS—, 37.5 % inactivo y **~1 %
React**. Los dos sospechosos juntos valían un uno por ciento.

Luego cayeron dos más, y por el mismo método: **no esperar al decode** para
componer con el fotograma anterior salió *peor* (35.8 fps frente a 39.2), porque
con la aguja ya fuera de React esperar no retrasa la respuesta y no esperar
obliga a componer dos veces por movimiento; y **el tamaño del lienzo** no movía
la aguja en absoluto.

### Lo que sí era

Aislando por casos con `data-cristal` y sondas inyectadas:

| | hover sobre el panel |
|---|---|
| La luz del cristal como capa de fondo | 30.8 fps |
| La luz como caja que se mueve con `transform` | **61.7 fps** |

**La luz que sigue al cursor repintaba el panel entero en cada movimiento del
ratón.** Un degradado en `background-image` posicionado con variables CSS obliga
a repintar toda la superficie; una caja con `transform` la recoloca el
compositor sin repintar nada. El efecto es el mismo, el precio es la mitad.

En el export, `VITRINA_MEDIR=1` repartió el tiempo de cada fotograma:

| | antes | después |
|---|---|---|
| decodificar el JPEG | 15.2 s (27 %) | 0.0 s |
| componer | 1.5 s (3 %) | 1.1 s |
| sacar los píxeles del lienzo | *(escondido)* | 34.4 s (87 %) |
| tubo a ffmpeg | 39.1 s (70 %) | 3.2 s |
| **total** | **56.0 s** | **39.7 s** |

El bucle escribía un fotograma y esperaba a que ffmpeg lo tragara, con el
siguiente sin decodificar; y `loadImage` es asíncrona y va en hilos nativos,
pero se la esperaba justo cuando hacía falta —treinta a la vez rinden 4.8 ms
cada una frente a 17.8 ms una detrás de otra—. Solapando ambas cosas, el mp4
sale **idéntico bit a bit** (mismo md5) en un 29 % menos de tiempo.

La primera medida juntaba «componer» con «sacar los píxeles» y respondía que
componer costaba el 69 %. Separadas, componer cuesta el 3 %: lo caro es
`canvas.data()`, 23-37 ms por fotograma para sacar 3.7 MB de Skia. Ese es el
suelo de hoy, y no lo arreglan ni un lienzo opaco ni `willReadFrequently`
—probados—.

| | antes | después |
|---|---|---|
| arrastre | 20.0 fps · 279 ms bloqueados | 43-50 fps · 0 ms |
| suelo del banco (mover sin arrastrar) | 47.5 fps | 61.7 fps |
| export (en la app) | 60.2 s | 44.8 s |
| export (aislado, A/B seguido) | 54.7 s | 39.7 s |

### Dos lecciones, y una vergüenza

**El repaso de código señala lo que se lee, no lo que cuesta.** Los cuatro
sospechosos eran razonables y ninguno era el problema. El perfilador tardó dos
minutos en decir que React no pintaba nada en esta película.

**Y el banco tiene que demostrar que mide lo que dice medir.** Dos veces saqué
conclusiones de un binario viejo —media tarde diciendo «esto no mejora nada»
sobre un bundle de trece horas antes, y otra vez con el exportador, que el
proceso principal empaqueta al compilar—. Ahora `verificar-app` compara la fecha
de lo compilado con la del código y avisa antes de medir. Es la misma lección de
M8 y M11, por tercera vez: **la primera medida hay que hacérsela al banco**.

Por eso los interruptores: `data-cristal`, `data-preview`, `data-medir`,
`VITRINA_SIN_SOLAPE`, `VITRINA_MEDIR`. Este contenedor da 40 s o 60 s para el
mismo export según el rato, así que un antes/después que no sea en el mismo
minuto no vale nada.
