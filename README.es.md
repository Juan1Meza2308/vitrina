<div align="center">

# Vitrina

**Demos de tu app web, con zoom automático en cada click.**
Alternativa open source a Screen Studio, para Windows y macOS.

[Descargar](https://github.com/Juan1Meza2308/vitrina/releases/latest) ·
[Documentación](docs/) ·
[English](README.md)

<img src="docs/img/vitrina.gif" width="720" alt="Una grabación hecha con Vitrina: la cámara se acerca a cada elemento al pulsarlo, sobre un fondo cinematográfico.">

</div>

## Por qué existe

Vitrina graba **páginas web**, no tu pantalla. Abre tu app en una ventana limpia
y captura el compositor del propio navegador por Chrome DevTools Protocol. De esa
única restricción sale todo lo demás:

- **Los clicks traen el rectángulo del elemento.** La cámara encuadra el botón o
  el formulario que pulsaste, no un radio inventado alrededor del cursor.
- **Los fotogramas no llevan cursor del sistema.** Se dibuja después: suavizado,
  con tamaño constante al ampliar y una onda en cada click.
- **No hay nada que sincronizar.** Los fotogramas y el registro de entrada
  comparten reloj.

Y una garantía que un grabador de pantalla no puede dar: el registro de teclado
guarda `"char"`, nunca la tecla. Una demo con login no puede filtrar una
contraseña. Lo que tapas se difumina **al grabar**, así que no llega a existir en
el vídeo.

> No captura el escritorio, ni tu editor, ni una videollamada. Si es eso lo que
> necesitas, esta no es la herramienta —y es una renuncia a propósito—.

## Instalar

Descarga el instalador de
[Releases](https://github.com/Juan1Meza2308/vitrina/releases/latest) —`.exe` para
Windows, `.dmg` para macOS— y ábrelo. ffmpeg viene dentro, así que no hay nada
más que instalar.

La app no está firmada digitalmente (firmar pide una cuenta de desarrollador de
pago en cada plataforma), así que la primera vez sale un aviso: en Windows, *Más
información → Ejecutar de todas formas*; en macOS, clic derecho → *Abrir*.

<details>
<summary>O ejecutarla desde el código</summary>

```bash
git clone https://github.com/Juan1Meza2308/vitrina.git
cd vitrina
npm install
npm run app
```

Hace falta Node 22.18+ y un navegador Chromium (en Windows, Edge ya está).

Esto también funciona en **Linux**: no hay instalador todavía, pero grabar y
exportar sí van —la integración continua graba una demo de verdad, con un
navegador de verdad, en cada push—. Si tu navegador está en una ruta poco
habitual, apunta `VITRINA_BROWSER` a él.

</details>

## Tu primera demo

1. **Escribe la dirección de tu app** y pulsa Grabar. Se abre una ventana limpia,
   sin pestañas ni barra de direcciones.
2. **Haz la demo.** Pincha, desplaza, escribe. Vitrina está mirando los elementos
   que tocas, no solo los píxeles.
3. **Para**, y caes en el editor con los zooms ya planificados. Se arrastran, se
   estiran, se cambia el fondo, y se exporta.

<img src="docs/img/editor.png" width="820" alt="El editor de Vitrina: la previsualización en el centro, la línea de tiempo en carriles debajo y los paneles de fondo, marco y zoom.">

## Qué sabe hacer

|  |  |
|---|---|
| **Cámara automática** | Planifica los zooms a partir de lo que pulsaste, y deja editar cada uno |
| **Fondos cinematográficos** | Degradado, malla, sólido, tu propia imagen, o transparente |
| **Vertical** | Una vista de móvil de verdad para TikTok, Reels y Shorts, no un recorte |
| **Narración** | Graba tu voz, corta los silencios sola, o dóblala después |
| **Burbuja de cámara** | Tu cara en una esquina, del tamaño y en el sitio que elijas |
| **Acelerar las esperas** | Los tiempos muertos comprimidos, con el audio en su sitio |
| **Tapar datos sensibles** | Selectores CSS difuminados *al grabar*: un saldo, un correo, un nombre |
| **Rehacer solo un trozo** | Regraba desde un punto conservando todo lo anterior |
| **Se documenta sola** | Exporta una guía escrita de la demo, con una captura por paso |
| **Exportar** | MP4, WebM, GIF y ProRes con alfa |

## Documentación

- [Grabar](docs/grabar.md) — calidad, vertical, fondos
- [El editor](docs/editor.md) — línea de tiempo, deshacer, looks, marca de agua
- [Narración, cámara y rehacer trozos](docs/narracion-y-camara.md)
- [Privacidad](docs/privacidad.md) — qué se graba y qué no
- [Cómo está hecho](docs/arquitectura.md) — cámara, compositor, exportador
- [Desarrollo](docs/desarrollo.md) — ejecutar, verificar, empaquetar

## Contribuir

Los issues y los pull requests son bienvenidos: está explicado en
[CONTRIBUTING.md](CONTRIBUTING.md).

El proyecto tiene una regla que conviene saber antes de mandar código: **lo que
el código afirma, el código lo mide**. Los comentarios sobre rendimiento vienen
con números, y las mediciones están en
[`spikes/HALLAZGOS.md`](spikes/HALLAZGOS.md) —incluidas las que demostraron que
una idea que sonaba bien no servía—.

## Licencia

[MIT](LICENSE). Los instaladores incluyen ffmpeg (GPL), sin modificar y
ejecutado como proceso aparte: ver [THIRD-PARTY.md](THIRD-PARTY.md).
