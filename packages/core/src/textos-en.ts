/**
 * La app en ingles.
 *
 * La clave es la frase en espanol tal y como esta escrita en el codigo (ver
 * `idioma.ts`). Dos reglas al anadir aqui:
 *
 *  1. Se traduce COMO PROSA, no palabra por palabra. Varios de estos textos son
 *     explicaciones —la bienvenida, las notas de calidad, los avisos— y llevan
 *     la voz del producto; una traduccion literal las deja sonando a manual de
 *     electrodomestico.
 *  2. Los huecos `{n}` tienen que aparecer igual en las dos frases, o el numero
 *     desaparece al cambiar de idioma.
 *
 * Un test comprueba que no falta ninguna y que no sobra ninguna.
 */
export const TEXTOS_EN: Record<string, string> = {
  // --- cabecera y ajustes de la app ---------------------------------------
  'demos de apps web con zoom automático': 'web app demos with automatic zoom',
  'Cambiar el aspecto de la app': 'Change the app appearance',
  'Claro': 'Light',
  'Oscuro': 'Dark',
  'Cambiar el idioma de la app': 'Change the app language',

  // --- aviso de version nueva ----------------------------------------------
  'Hay una versión nueva:': 'A new version is available:',
  'Actualizar': 'Update',
  'Ahora no': 'Not now',
  'Descargando… {pct}%': 'Downloading… {pct}%',

  // --- grabaciones recientes ------------------------------------------------
  'Abrir grabación': 'Open a recording',
  'de cualquier carpeta': 'from any folder',
  'hace un momento': 'just now',
  'hace {n} min': '{n} min ago',
  'hace {n} h': '{n} h ago',
  'ayer': 'yesterday',
  'hace {n} días': '{n} days ago',
  'Recientes': 'Recent',
  'Aquí aparecerán tus grabaciones, con su imagen. También puedes arrastrar una carpeta':
    'Your recordings will show up here, with a preview. You can also drag a',
  'hasta esta ventana.': 'folder onto this window.',

  // --- linea de tiempo ------------------------------------------------------
  'Vídeo': 'Video',
  'Ritmo': 'Pace',
  'Audio': 'Audio',
  'sin narración': 'no narration',
  'Silencio quitado': 'Silence removed',
  'Momento señalado': 'Marked moment',
  '{etiqueta} · {seg}s': '{etiqueta} · {seg}s',
  '×{rate} en este tramo': '×{rate} on this stretch',
  'zoom': 'zoom',
  '{label} · {escala}x': '{label} · {escala}x',

  // --- cuenta atras y grabacion --------------------------------------------
  'Se abrirá una ventana con tu app. Haz la demo ahí.':
    'A window with your app is about to open. Do the demo in there.',
  'Vitrina está repitiendo la parte buena': 'Vitrina is replaying the good part',
  'Grabando': 'Recording',
  'frames': 'frames',
  'Nivel del micrófono': 'Microphone level',
  'No toques nada: cuando llegue al punto que elegiste te avisará y seguirás tú.':
    'Hands off: it will tell you when it reaches the point you picked, and then '
    + 'you take over.',
  'En pausa · el trozo pausado no saldrá en el vídeo':
    'Paused · the paused stretch will not be in the video',
  'Reanudar': 'Resume',
  'Pausar': 'Pause',
  'Deja una chincheta en este instante para encontrarlo luego':
    'Drops a pin at this moment so you can find it later',
  'Señalar momento': 'Mark moment',
  'Parar y editar': 'Stop and edit',
  'Sin volver aquí:': 'Without coming back here:',
  'para parar,': 'to stop,',
  'para pausar y': 'to pause and',
  'para señalar un momento.': 'to mark a moment.',
  'Estos no los concedió el sistema, seguramente porque otra app los usa:':
    'The system turned these down, most likely because another app is using them:',
  'Los demás sí funcionan.': 'The rest do work.',

  // --- pantalla de inicio ---------------------------------------------------
  'Nueva grabación': 'New recording',
  'Dirección de tu app': "Your app's address",
  'Formato': 'Format',
  'Horizontal': 'Landscape',
  'Vertical': 'Portrait',
  'La ventana se abre a': 'The window opens at',
  'como un móvil de verdad, así que tu web enseña su diseño móvil.':
    'like a real phone, so your site shows its mobile layout.',
  'menos': 'less',
  'más': 'more',
  ['Se captura a escala ×{escala}: sale nítida pese a la pantalla pequeña. Los fps de abajo '
  + 'están medidos en horizontal; en vertical pueden ser menores. Para medirlo en tu equipo:']:
    'Captured at ×{escala} scale, so it stays sharp despite the small screen. The '
    + 'frame rates below were measured in landscape; portrait can be slower. To '
    + 'measure it on your machine:',
  'Calidad de captura': 'Capture quality',
  'Exportando a {w}×{h}:': 'Exporting at {w}×{h}:',
  'zoom nítido hasta {escala}x': 'sharp zoom up to {escala}x',
  'sin margen: ya se amplía {escala}x en reposo':
    'no headroom: already scaled {escala}x at rest',
  'tu web a {px} px': 'your site at {px} px',
  'Opciones avanzadas': 'Advanced options',
  'Tapar datos sensibles': 'Mask sensitive data',
  ['Selectores CSS de lo que no debe salir —en tu app, clic derecho sobre el dato → '
    + 'Inspeccionar te dice su id o su clase—. Se difuminan']:
    'CSS selectors for whatever must not be shown — in your app, right-click the '
    + 'data → Inspect tells you its id or class. They are blurred',
  'mientras grabas': 'while you record',
  [', así que el dato nunca llega al vídeo ni queda en la carpeta. Se difuminan en vez de '
  + 'ocultarse para no mover nada de sitio.']:
    ', so the data never reaches the video or the folder. Blurred rather than '
    + 'hidden, to keep the layout from shifting.',
  'Grabar': 'Record',
  'Micrófono y cámara': 'Microphone and camera',
  'Narración': 'Narration',
  'Con micrófono': 'With microphone',
  'Sin audio': 'No audio',
  'Micrófono predeterminado': 'Default microphone',
  'Cámara': 'Camera',
  'Con cámara': 'With camera',
  'Sin cámara': 'No camera',
  'Cámara predeterminada': 'Default camera',
  ['Se graba aparte del vídeo: luego puedes moverla, cambiar su tamaño o quitarla sin '
  + 'volver a grabar.']:
    'Recorded separately from the video, so you can move it, resize it or drop it '
    + 'without recording again.',
  'Toca para cerrar': 'Tap to dismiss',

  // --- editor: la grabacion y repetirla ------------------------------------
  'Grabación': 'Recording',
  'Fondo': 'Background',
  'Imagen de fondo...': 'Background image...',
  'Desenfoque': 'Blur',
  'Repetir': 'Replay',
  ['Vuelve a hacer esta misma demo sola, conservando los zooms y el aspecto. Sirve para '
  + 'regrabarla con más resolución, o después de arreglar algo que salía en el vídeo.']:
    'Runs this same demo again on its own, keeping the zooms and the look. Useful '
    + 'to re-record it at a higher resolution, or after fixing something that '
    + 'showed up in the video.',
  'Misma calidad': 'Same quality',
  'Repitiendo...': 'Replaying...',
  'Repetir esta grabación': 'Replay this recording',
  'Vitrina repite sola la demo hasta aquí y después sigues tú':
    'Vitrina replays the demo up to here on its own, and then you take over',
  'Regrabar desde {seg}s': 'Re-record from {seg}s',
  'Lo que escribiste no se repite: se guarda que pulsaste una tecla, nunca cuál.':
    'What you typed is not replayed: only that you pressed a key is stored, never '
    + 'which one.',
  'Lo que tapaste se vuelve a tapar.': 'Whatever you masked gets masked again.',
  'La cámara no se repite: se repite la demo, no quien la cuenta.':
    'The camera is not replayed: the demo is, not the person telling it.',

  // --- editor: looks y marca de agua ---------------------------------------
  'Looks': 'Looks',
  ['Un look es el fondo, el marco y la marca de agua guardados con un nombre, para '
    + 'dejar la siguiente demo igual de un clic.']:
    'A look is the background, the frame and the watermark saved under a name, so '
    + 'the next demo comes out the same in one click.',
  ['Cómo se ve la ventana grabada dentro del vídeo: lo grande que sale, sus esquinas '
    + 'y su sombra.']:
    'How the recorded window looks inside the video: how big it is, its corners '
    + 'and its shadow.',
  ['Cuánto se acerca la cámara sola en cada click. Los tramos que planifica se editan '
    + 'uno a uno más abajo.']:
    'How far the camera zooms in on each click, on its own. The segments it plans '
    + 'are edited one by one below.',
  ['Más resolución se ve mejor y ocupa más. Si dudas, deja el de en medio: es el que '
    + 'aguanta los fps en la mayoría de equipos.']:
    'More resolution looks better and weighs more. When in doubt, keep the middle '
    + 'one: it is the one that holds its frame rate on most machines.',
  'Aplicar este look a la grabación abierta': 'Apply this look to the open recording',
  'Usar este look en las grabaciones nuevas': 'Use this look for new recordings',
  'Guardar este look': 'Save this look',
  'Marca de agua': 'Watermark',
  'Cambiar imagen...': 'Change image...',
  'Añadir imagen...': 'Add image...',
  'Esquina': 'Corner',
  'Opacidad': 'Opacity',
  'Quitar marca': 'Remove watermark',

  // --- editor: transporte ---------------------------------------------------
  'Arrastra para reencuadrar este tramo': 'Drag to reframe this stretch',
  'Pausar (Espacio)': 'Pause (Space)',
  'Reproducir (Espacio)': 'Play (Space)',
  'Reproducir': 'Play',
  'Volver al principio (Inicio)': 'Back to the start (Home)',
  'Volver al principio': 'Back to the start',
  'Oír la narración': 'Unmute the narration',
  'Silenciar la narración': 'Mute the narration',

  // --- editor: hoja de atajos ----------------------------------------------
  'Atajos': 'Shortcuts',
  'Espacio': 'Space',
  'reproducir o parar': 'play or pause',
  'un fotograma; con Mayús, un segundo': 'one frame; with Shift, one second',
  'Inicio / Fin': 'Home / End',
  'al principio o al final': 'to the start or the end',
  'Supr': 'Del',
  'borrar el zoom seleccionado': 'delete the selected zoom',
  'deshacer': 'undo',
  'rehacer': 'redo',
  'abrir y cerrar esta hoja': 'open and close this sheet',
  'Cerrar': 'Close',

  // --- editor: marco --------------------------------------------------------
  'Configuración': 'Settings',
  'Marco': 'Frame',
  'Tamaño': 'Size',
  'Esquinas': 'Corners',
  'Sombra': 'Shadow',
  'Sin marco': 'No frame',
  'Móvil': 'Phone',
  'Movimiento del zoom': 'Zoom motion',
  // Nombres de los presets de camara. La clave viaja en el proyecto y no se
  // renombra; esto es solo como se ensena.
  'sutil': 'subtle',
  'normal': 'normal',
  'marcado': 'strong',
  'Afloja el marco para recuperar su ampliación.':
    'Loosen the frame to get their zoom back.',

  // --- editor: tramos de zoom ----------------------------------------------
  'Tramos de zoom': 'Zoom stretches',
  'Tramo {n}': 'Stretch {n}',
  'Ampliación': 'Zoom level',
  'Arrastra sobre la imagen para mover el encuadre.':
    'Drag on the image to move the framing.',
  'Lleva la aguja dentro del tramo para poder reencuadrarlo.':
    'Move the playhead inside the stretch to reframe it.',
  'Borrar el zoom seleccionado': 'Delete the selected zoom',
  ['Pincha un tramo para editarlo. Arrastra su cuerpo para moverlo y sus bordes para '
  + 'alargarlo.']:
    'Click a stretch to edit it. Drag its body to move it and its edges to make '
    + 'it longer.',
  'Volver al zoom automático': 'Back to automatic zoom',

  // --- editor: recorte y audio ----------------------------------------------
  'Recorte': 'Trim',
  'Arrastra las asas de los extremos para quitar el principio o el final':
    'Drag the handles at either end to cut the start or the finish',
  'Quitar el recorte': 'Remove the trim',
  'Narración grabada · se incluye en mp4, webm y mov (el gif no lleva sonido)':
    'Narration recorded · included in mp4, webm and mov (gif carries no sound)',
  'Esta grabación no tiene narración': 'This recording has no narration',
  'Buscando silencios...': 'Looking for silences...',
  'Quitar los silencios': 'Cut the silences',
  'Volver a poner los silencios': 'Put the silences back',
  'No hay silencios que quitar.': 'There are no silences to cut.',

  // --- editor: camara web ---------------------------------------------------
  'Cámara web': 'Webcam',
  'Arriba izq.': 'Top left',
  'Arriba a la izquierda': 'Top left',
  'Arriba der.': 'Top right',
  'Arriba a la derecha': 'Top right',
  'Abajo izq.': 'Bottom left',
  'Abajo a la izquierda': 'Bottom left',
  'Abajo der.': 'Bottom right',
  'Abajo a la derecha': 'Bottom right',
  'Círculo': 'Circle',
  'Redondeada': 'Rounded',
  'Espejo': 'Mirror',
  ['Con espejo te ves como en un espejo, que es a lo que estás acostumbrado. Sin espejo, '
  + 'el texto de tu camiseta se lee al derecho: es lo que espera quien mire el vídeo.']:
    'Mirrored, you see yourself the way a mirror shows you, which is what you are '
    + 'used to. Unmirrored, the text on your shirt reads the right way round — '
    + 'which is what whoever watches the video expects.',
  'Quitar la cámara del vídeo': 'Take the camera out of the video',
  'Grabaste con cámara, pero ahora mismo no se ve en el vídeo.':
    'You recorded with the camera on, but right now it is not in the video.',
  'Poner la cámara en el vídeo': 'Put the camera in the video',

  // --- editor: doblaje ------------------------------------------------------
  'Doblar la voz': 'Dub the voice',
  ['Graba tu voz viendo el vídeo ya montado, en vez de narrar mientras operas. La '
  + 'narración original se silencia mientras doblas.']:
    'Record your voice while watching the finished cut, instead of narrating as '
    + 'you go. The original narration is muted while you dub.',
  'Parar y guardar la voz': 'Stop and save the voice',
  'Grabar mi voz': 'Record my voice',
  'Grabando tu voz · el vídeo se está reproduciendo':
    'Recording your voice · the video is playing',
  'Qué se oye en el vídeo:': 'What you hear in the video:',
  'Tu voz': 'Your voice',
  'Nada': 'Nothing',

  // --- editor: cursor y anotaciones -----------------------------------------
  'Cursor': 'Cursor',
  'Visible': 'Visible',
  'Oculto': 'Hidden',
  'Anotaciones': 'Annotations',
  'Escribe en el vídeo el nombre del botón que pulsas':
    'Writes the name of the button you click onto the video',
  'Rótulos': 'Labels',
  'Muestra las teclas que pulsas. Las letras salen como un punto, nunca la letra':
    'Shows the keys you press. Letters appear as a dot, never the letter itself',
  'Teclas': 'Keys',
  ['Salen de lo que pasó al grabar, no de los píxeles. Lo que escribes nunca se enseña: '
  + 'cada letra sale como un punto.']:
    'They come from what happened while recording, not from the pixels. What you '
    + 'type is never shown: every letter appears as a dot.',

  // --- editor: ritmo --------------------------------------------------------
  ['Las esperas —una carga, un formulario que se rellena— siguen en el vídeo, pero pasan '
  + 'más deprisa.']:
    'The waiting — a page loading, a form being filled in — stays in the video, '
    + 'but goes by faster.',
  'No hay esperas que acelerar': 'There is no waiting to speed up',
  'Volver a la velocidad normal': 'Back to normal speed',

  // --- editor: barra de herramientas ----------------------------------------
  'Deshacer (Ctrl+Z)': 'Undo (Ctrl+Z)',
  'Deshacer': 'Undo',
  'Rehacer (Ctrl+Mayús+Z)': 'Redo (Ctrl+Shift+Z)',
  'Rehacer': 'Redo',
  'La aguja está dentro de un tramo: muévela a un hueco':
    'The playhead is inside a stretch: move it to a gap',
  'Crea un tramo de zoom donde está la aguja':
    'Creates a zoom stretch where the playhead is',
  'Añadir zoom': 'Add zoom',
  'Borra el tramo de zoom seleccionado (Supr)': 'Deletes the selected zoom stretch (Del)',
  'Borrar zoom': 'Delete zoom',

  // --- exportar -------------------------------------------------------------
  'Exportación cancelada': 'Export cancelled',
  'Exportar': 'Export',
  'faltan {seg}s': '{seg}s left',
  'Cancelar': 'Cancel',
  'Escribe guia.md con los pasos y sus capturas, capitulos.txt y guia.srt':
    'Writes guia.md with the steps and their screenshots, capitulos.txt and guia.srt',
  'Escribiendo la guía...': 'Writing the guide...',
  'Exportar guía escrita': 'Export a written guide',
  'Guía escrita': 'Guide written',
  'guia.md, capitulos.txt y guia.srt en la carpeta':
    'guia.md, capitulos.txt and guia.srt in the folder',
  '{seg}s en salir': '{seg}s to render',
  'Mostrar en la carpeta': 'Show in folder',

  // --- plurales -------------------------------------------------------------
  '{n} selector tapado': '{n} selector masked',
  '{n} selectores tapados': '{n} selectors masked',
  '{n} tramo supera el margen y se muestra recortado.':
    '{n} stretch goes past the margin and is shown cropped.',
  '{n} tramos superan el margen y se muestran recortados.':
    '{n} stretches go past the margin and are shown cropped.',
  '{n} silencio': '{n} silence',
  '{n} silencios': '{n} silences',
  'Acelerar {n} espera': 'Speed up {n} wait',
  'Acelerar {n} esperas': 'Speed up {n} waits',
  '{n} tramo acelerado': '{n} stretch sped up',
  '{n} tramos acelerados': '{n} stretches sped up',
  '{n} paso': '{n} step',
  '{n} pasos': '{n} steps',

  // --- bienvenida -----------------------------------------------------------
  'Bienvenida a Vitrina': 'Welcome to Vitrina',
  'Graba demos de tu app web con zoom automático en los clicks.':
    'Record demos of your web app, with automatic zoom on every click.',
  'Graba páginas web, no la pantalla': 'It records web pages, not your screen',
  ['Vitrina abre tu app en una ventana limpia y la graba desde dentro del navegador. Por '
  + 'eso la cámara sabe encuadrar el botón que pulsas. No captura el escritorio, ni tu '
  + 'editor, ni una videollamada.']:
    'Vitrina opens your app in a clean window and records it from inside the '
    + 'browser. That is how the camera knows to frame the button you clicked. It '
    + 'does not capture your desktop, your editor, or a video call.',
  'Lo que hace falta': 'What you need',
  'Navegador': 'Browser',
  'Descargar Chrome': 'Download Chrome',
  'Vídeo (ffmpeg)': 'Video (ffmpeg)',
  'Incluido con la app': 'Included with the app',
  'Instalado en tu equipo': 'Installed on your machine',
  'Buscando…': 'Looking…',
  'Buscar el archivo…': 'Find the file…',
  'Vitrina trae el suyo, así que esto no debería pasar. Si no aparece, señálalo a mano o':
    'Vitrina ships its own, so this should not happen. If it is missing, point at '
    + 'it yourself or',
  'descárgalo de ffmpeg.org': 'download it from ffmpeg.org',
  'Lo que escribes no se guarda': 'What you type is not saved',
  ['El registro de teclado anota que pulsaste una tecla, nunca cuál. Una demo con login no '
  + 'puede filtrar tu contraseña. Y lo que tapes —un saldo, un correo— se difumina']:
    'The keyboard log records that you pressed a key, never which one. A demo of a '
    + 'login screen cannot leak your password. And whatever you mask — a balance, '
    + 'an email — is blurred',
  'al grabar': 'while recording',
  ': no llega a existir en el vídeo.': ': it never exists in the video at all.',
  'Empezar': 'Get started',
  'Ver la guía rápida': 'See the quick guide',
  'comprobando…': 'checking…',

  // --- la guía rápida dentro de la app --------------------------------------
  'Guía': 'Guide',
  'Guía rápida': 'Quick guide',
  'Qué graba': 'What it records',
  'Tu app web, desde dentro del navegador y con el zoom pegándose a tus clics. No captura el escritorio ni una videollamada.':
    'Your web app, from inside the browser and with the zoom following your '
    + 'clicks. It does not capture your desktop or a video call.',
  'Tu primera demo': 'Your first demo',
  'Pega la dirección, elige la calidad y pulsa Grabar. Haz clic como lo haría quien mira: el zoom te sigue.':
    'Paste the address, pick a quality and hit Record. Click the way a viewer '
    + 'would: the zoom follows you.',
  'El editor': 'The editor',
  'Los zooms se planifican solos. Después se editan uno a uno: reordénalos, quita un silencio o corta lo que sobre.':
    'The zooms are planned for you. Afterwards you edit them one by one: reorder, '
    + 'cut a silence or trim what is left.',
  'Tapar datos': 'Masking data',
  'Señala un saldo o un correo y Vitrina lo difumina al grabar: no llega a existir en el vídeo.':
    'Point at a balance or an email and Vitrina blurs it while recording: it '
    + 'never exists in the video itself.',
  'Vídeo para compartir, o la guía escrita con los pasos y sus capturas para quien lo vaya a repetir.':
    'A video to share, or the written guide with its steps and screenshots for '
    + 'whoever will follow along.',
  'Documentación completa': 'Full documentation',

  // --- dialogos del sistema -------------------------------------------------
  'Elige el ejecutable de ffmpeg': 'Choose the ffmpeg executable',
  'Ejecutable': 'Executable',
  'Todos': 'All files',
  'Imagen de fondo': 'Background image',

  // --- que hacer cuando falta algo ------------------------------------------
  ['Vitrina trae su propio ffmpeg; si no aparece, instálalo con '
  + '`brew install ffmpeg` o señala el ejecutable a mano.']:
    'Vitrina ships its own ffmpeg; if it is missing, install it with '
    + '`brew install ffmpeg` or point at the executable yourself.',
  ['Vitrina trae su propio ffmpeg; si no aparece, descárgalo de ffmpeg.org '
  + 'y déjalo en C:/ffmpeg/bin, o señala el ejecutable a mano.']:
    'Vitrina ships its own ffmpeg; if it is missing, download it from ffmpeg.org '
    + 'and drop it in C:/ffmpeg/bin, or point at the executable yourself.',
  ['Vitrina necesita un navegador Chromium. Instala Google Chrome desde '
  + 'google.com/chrome (Safari no sirve: no expone screencast por DevTools '
  + 'Protocol).']:
    'Vitrina needs a Chromium browser. Install Google Chrome from '
    + 'google.com/chrome (Safari will not do: it exposes no screencast over the '
    + 'DevTools Protocol).',
  'Vitrina necesita Edge o Chrome, y no se encontró ninguno ejecutable.':
    'Vitrina needs Edge or Chrome, and neither was found.',
  ['Vitrina necesita Chrome o Chromium, y no se encontró ninguno '
  + 'ejecutable. Si lo tienes en una ruta poco habitual, apunta '
  + 'VITRINA_BROWSER a él.']:
    'Vitrina needs Chrome or Chromium, and neither was found. If yours lives in '
    + 'an unusual place, point VITRINA_BROWSER at it.',

  // --- la guia escrita que exporta una demo --------------------------------
  //
  // Sale en imperativo, como un tutorial: «Click "Save"», no «Clicked Save».
  // Quien la lee la esta siguiendo, no leyendo un informe de lo que paso.
  'Escribe en {campo}': 'Type in {campo}',
  'Escribe': 'Type',
  'Pulsa {tecla}': 'Press {tecla}',
  'Pulsa {que}': 'Click {que}',
  'Pulsa aquí': 'Click here',
  'Guía generada de una demo grabada en {url}.':
    'Guide generated from a demo recorded at {url}.',
  'del vídeo': 'into the video',
  'Paso {n}': 'Step {n}',
  'Cómo se hace en {donde}': 'How to do it in {donde}',
  'tu app': 'your app',

  // --- cuando algo falla ---------------------------------------------------
  'No se pudo encender la cámara.': 'The camera would not turn on.',
  'No se pudo encender el micrófono.': 'The microphone would not turn on.',
  'No se pudo grabar la voz.': 'The voice-over could not be recorded.',
  'No se pudo empezar a grabar.': 'Recording could not start.',
  'No se pudo exportar el vídeo.': 'The video could not be exported.',
  'No se pudo crear la guía.': 'The written guide could not be created.',
  'No se pudo abrir la grabación.': 'That recording could not be opened.',
  'Algo no ha salido bien.': 'Something went wrong.',
  ['El sistema no dio permiso. Búscalo en los ajustes de privacidad '
    + 'de tu equipo y vuelve a intentarlo.']:
    'Your system denied permission. Grant it in your privacy settings and try '
    + 'again.',
  'No hay ninguno conectado, o el que elegiste ya no está.':
    'There is none connected, or the one you picked is gone.',
  'Otro programa lo está usando. Ciérralo y vuelve a intentarlo.':
    'Another program is using it. Close that program and try again.',
  'No queda espacio en el disco.': 'The disk is full.',
  'El sistema no dejó escribir ahí. Prueba con otra carpeta.':
    'Your system would not let Vitrina write there. Try another folder.',
  ['Falta ffmpeg, que es lo que escribe el vídeo. Vitrina trae el '
    + 'suyo; si no aparece, señálalo a mano desde la pantalla de inicio.']:
    'FFmpeg is missing, and it is what writes the video. Vitrina ships its own; '
    + 'if it does not show up, point to it by hand from the start screen.',
  ['El navegador no llegó a abrirse. Si tienes uno abierto en modo '
    + 'depuración, ciérralo y vuelve a intentarlo.']:
    'The browser never opened. If you have one running in debugging mode, close '
    + 'it and try again.',
  'Detalles técnicos': 'Technical details',
  'Eso no es una carpeta .vitrina. Suelta la carpeta entera, no un frame.':
    'That is not a .vitrina folder. Drop the whole folder, not a single frame.',
};
