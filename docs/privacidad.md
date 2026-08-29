# Privacidad

Dos garantías, y las dos se cumplen **al grabar**, no al editar: lo que no
llega a los ficheros no se puede filtrar después.

- El registro de teclado guarda `"char"`, nunca la tecla pulsada. Una demo con
  login no puede enseñar una contraseña.
- Lo que tapas se difumina dentro del navegador, así que no llega a existir en
  los fotogramas.

[← Volver al README](../README.es.md)

---

## Tapar lo que no debe salir

Una demo de una app real enseña datos reales: el saldo de un cliente, un correo,
una clave de API en la pantalla de ajustes. En la pantalla de inicio hay un campo
para los **selectores CSS** de lo que no debe salir:

```
#saldo, .email, [data-privado]
```

Y por línea de comandos:

```bash
node bin/vitrina-record.ts http://localhost:3000 --tapar="#saldo, .email"
```

**Se tapa al grabar, no al exportar.** Es la diferencia que importa: el JPEG que
se escribe en disco ya va difuminado, así que el dato en claro no llega a
existir. Difuminarlo en el editor sería una garantía falsa —seguiría dentro de
cada frame de la carpeta `.vitrina`, y quien la reciba lo tiene entero—.

Tres decisiones que no son evidentes:

- **Se difumina, no se oculta.** `display:none` mueve la maqueta y la demo deja
  de ser la demo: los botones cambian de sitio y la cámara encuadra otra cosa.
  El desenfoque deja el hueco donde estaba. Conviene apuntar al dato y no a
  media página: un `filter` crea contenedor para los `position: fixed` que haya
  dentro, y una cabecera fija sí se movería.
- **Es CSS, no un script que recorra el DOM.** Una hoja de estilos cubre también
  lo que aparezca después —una fila que llega por fetch, un modal que se abre a
  mitad de demo— sin volver a mirar. Un script tendría que reaccionar a cada
  mutación, y llegaría tarde justo cuando importa.
- **El log tampoco guarda el texto.** Cada click registra la etiqueta del
  elemento pulsado, así que tapar los píxeles y dejar el correo escrito en
  `events.json` sería tapar solo lo que se ve. La caja sí se guarda: se tapa el
  contenido, no la geometría, y un click sobre un dato tapado sigue generando su
  zoom.

> **Dos detalles que costó encontrar**, y los dos fallan igual de callados: el
> script corre, no lanza, y el dato sale entero.
>
> **El parser.** El estilo se inyecta antes de que el parser construya el
> documento —tiene que estar puesto antes de la primera pintura—, y a esa altura
> el documento está vacío: el parser lo reemplaza después y se lleva por delante
> lo que hubiera. Por eso la hoja se **repone**: un `MutationObserver` la
> devuelve en cuanto aparece el documento, en la misma microtarea, sin un frame
> con el dato al aire.
>
> **La CSP.** Medido: con `style-src 'self'`, un `<style>` inyectado por script
> entra en el DOM y no aplica nada —`getComputedStyle` devuelve `filter: none`—
> sin excepción ni aviso. Y la app que tiene datos sensibles es justo la que trae
> CSP estricta. Así que el tapado va por **hoja construida** (`new CSSStyleSheet`
> + `adoptedStyleSheets`), que no pasa por esa comprobación; el `<style>` se
> queda de respaldo para un motor que no las tenga.

Dos límites, dichos claros:

- **Un iframe de otro origen no se tapa.** Vitrina se engancha a la página, y un
  iframe cross-origin corre en otro proceso al que no llega el script.
- **Un desenfoque es tapar, no cifrar.** Con el radio por defecto un texto de
  interfaz queda ilegible en el vídeo; lo que no quieras enseñar de ninguna
  manera es mejor no tenerlo en pantalla.

Lo fija un test que graba [`spikes/sensible.html`](../spikes/sensible.html) —dos
filas idénticas, una tapada y otra no— y **mide el contraste del frame guardado**
comparándolas. Y lo graba **dos veces**, con y sin
[CSP estricta](../spikes/sensible-csp.html), porque ese es el caso que de verdad
importa. Es la única comprobación que habría cazado los dos fallos de arriba: el
script se generaba, se ejecutaba, el estilo estaba puesto, y el dato salía igual.
Comprobado quitando la hoja construida: la variante con CSP pasa de 0,3 a 25 de
contraste, el mismo valor que la fila sin tapar.
