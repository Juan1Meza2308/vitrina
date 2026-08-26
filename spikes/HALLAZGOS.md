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
