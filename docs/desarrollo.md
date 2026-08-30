# Desarrollo

Cómo se monta el entorno, cómo se verifica y cómo se empaqueta.

La regla del proyecto: **lo que el código afirma, el código lo mide**. Si un
comentario dice que algo es más rápido, hay un número detrás y normalmente un
spike en [`spikes/HALLAZGOS.md`](../spikes/HALLAZGOS.md) que cuenta cómo se
midió —incluidas las veces en que la medida dijo que la idea no servía—.

[← Volver al README](../README.es.md)

---

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
pantalla de inicio, graba [`spikes/vertical.html`](../spikes/vertical.html),
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

## Los textos, en dos idiomas

La app está en español e inglés. La clave del diccionario
(`packages/core/src/textos-en.ts`) **es la frase en español**, tal y como está
escrita en el código:

```tsx
const t = useT();
<button>{t('Parar y editar')}</button>
```

Así el código se sigue leyendo como prosa, y una traducción que falte degrada a
español —una frase de verdad— en vez de a `editor.stop_button`. La contrapartida
es que retocar la frase en español deja la traducción huérfana, y eso no se ve
mirando: lo caza `packages/core/src/idioma.test.ts`, que recorre el código, saca
todas las claves y comprueba que ninguna falta, que ninguna sobra y que los
huecos `{n}` coinciden en las dos frases.

**Cada texto nuevo son dos textos.** El test lo recuerda en el momento.

Para comprobarlo en la app de verdad:

```bash
node tools/verificar-app.ts --idioma
```

Cambia a inglés, comprueba que el inicio y el editor cambian de verdad y que no
queda ni un texto en español, y que la elección sobrevive a cerrar la app. Es lo
que caza lo que el diccionario no puede: un texto que nunca llegó a pasar por
`t()`.

Los demás flujos fijan el idioma en español antes de arrancar, porque
seleccionan elementos por su texto (`textContent === 'Grabar'`).

## La ventana, cerrada por fuera

```bash
node tools/verificar-app.ts --seguridad
```

Comprueba lo que la ventana **hace**, no lo que dice su configuración: que no
navega fuera de la app, que `window.open` no abre nada, que el renderer no
alcanza Node y que un `<script>` inyectado no llega a ejecutarse. Quitando las
guardas a propósito fallan tres de las cinco, incluida la de la CSP —al salir de
la página de la app se sale también de su política—, que es lo que explica por
qué una navegación no es un fallo aislado.

La configuración en sí la fija `apps/desktop/src/main/seguridad.test.ts`, que la
lee del fuente y falla en `npm test` sin necesitar pantalla. Hacen falta las dos:
una dice que el ajuste está puesto, la otra que sirve.

> La comprobación de la CSP inyecta un `<script>` en el DOM en vez de llamar a
> `eval`. Chrome exime de la política a lo que se evalúa desde el depurador, así
> que un `eval()` lanzado por CDP se ejecuta aunque esté prohibido: mediría el
> depurador, no la página.

## Lo que se lee cuando algo falla

```bash
node tools/verificar-app.ts --errores
```

Provoca un fallo de verdad —abrir una `.vitrina` que no existe— y mira lo que
queda en pantalla, en los dos idiomas: que el aviso dice qué pasó, que no enseña
la ruta del disco, y que el mensaje original sigue estando plegado debajo.

Los avisos guardan **qué** pasó, no la frase (`renderer/errores.ts`); la frase se
compone al pintar. Traducir al fallar dejaba el mensaje congelado en el idioma de
ese instante, y con la app recién abierta ese instante es antes de que carguen
los ajustes: en inglés salía en español. Lo encontró este flujo.

## Empaquetar y publicar

```bash
npm run app:dist
```

Genera un instalador en `dist/`. **Cada instalador se compila en su sistema**:
electron-builder necesita las herramientas del sistema para el `.dmg`, y además
`ffmpeg-static` descarga el binario de la plataforma donde se instala, así que un
`.exe` hecho desde Linux llevaría el ffmpeg equivocado. Eso último no hay que
recordarlo: un hook `afterPack` comprueba que ffmpeg entró en el paquete **y**
que trae sus códecs, y para el build si no.

Publicar no se hace a mano. Al empujar a `master` un commit que sube `version` en
`package.json` —y en `apps/desktop/package.json`, que un test obliga a mantener
igual—, el flujo `.github/workflows/release.yml` hace esto, en este orden:

1. **Crea la Release como borrador**, antes de compilar nada. Un borrador no
   necesita tag, y así ningún trabajo posterior tiene que crearla.
2. **Compila Windows y macOS**, de uno en uno, y cada uno **solo sube** sus
   ficheros al borrador.
3. **Comprueba que están todos** —el `.exe`, los dos `.dmg` y los dos
   `latest*.yml`— y solo entonces publica el borrador, que es lo que crea el tag.

Los dos primeros puntos no son manías: la v0.1.0 y la v0.1.1 salieron a medias
porque varios publicadores intentaban crear la Release a la vez y chocaban con un
`422 Published releases must have a valid tag`. El tercero tampoco: la v0.1.1 se
publicó **sin `latest.yml`** —o sea, sin actualizaciones en Windows— y nada lo
dijo.

Si un build falla, la Release se queda en borrador y sin tag: nadie se descarga
media versión, y el siguiente intento reutiliza el mismo borrador.

Publicar la Release es también lo que enciende el aviso de «hay una versión
nueva» en las apps ya instaladas.

Ni el `.exe` ni el `.dmg` van firmados: firmar cuesta una cuenta de desarrollador
en cada plataforma. La consecuencia es que Windows avisa con SmartScreen y macOS
pide abrir con clic derecho la primera vez, o quitar la cuarentena:

```bash
xattr -dr com.apple.quarantine /Applications/Vitrina.app
```

Y en macOS la actualización de un clic no funciona sin firma, así que allí el
aviso lleva a la página de descargas.
