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
igual—, el flujo `.github/workflows/release.yml` compila en Windows y macOS y
publica la Release con los instaladores. Eso es también lo que enciende el aviso
de «hay una versión nueva» en las apps ya instaladas.

Ni el `.exe` ni el `.dmg` van firmados: firmar cuesta una cuenta de desarrollador
en cada plataforma. La consecuencia es que Windows avisa con SmartScreen y macOS
pide abrir con clic derecho la primera vez, o quitar la cuarentena:

```bash
xattr -dr com.apple.quarantine /Applications/Vitrina.app
```

Y en macOS la actualización de un clic no funciona sin firma, así que allí el
aviso lleva a la página de descargas.
