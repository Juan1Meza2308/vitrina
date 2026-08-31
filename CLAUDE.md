# Notas para quien trabaje aquí con Claude Code

## La identidad de los commits

Antes de commitear, en este repositorio:

```bash
git config user.name  "Juan1Meza2308"
git config user.email "juan1meza2308@gmail.com"
```

**Esto no es un detalle cosmético.** Sin ello los commits salen firmados con
`noreply@anthropic.com`, que no es una cuenta de GitHub: el trabajo no se
atribuye a nadie y no cuenta en el gráfico de contribuciones. Pasó con los
primeros setenta commits del proyecto, y solo se notó al mirar el perfil.

`git config` escribe en `.git/config`, que no se versiona y no sobrevive a un
contenedor nuevo. Por eso está aquí: para que cada sesión lo ponga otra vez.

Los commits llevan además el rastro de que Claude los escribió:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

El autor es quien dirige el trabajo; el co-autor, quien lo escribe. Las dos
cosas son ciertas y caben en el mismo commit.

## Micro commits

Un cambio, un commit. No «arreglos varios»: cada commit se lee, se revisa y se
revierte solo. Es lo que hace que el historial sirva para algo cuando algo se
rompe dentro de tres meses, y de paso reparte el trabajo por los días en que se
hizo en vez de amontonarlo en uno.

El mensaje va **en español** y dice qué cambia para quien usa la app, no qué
fichero se tocó:

```
La app instalada no abria: electron-updater no viajaba dentro   ✔
Actualiza main/index.ts y package.json                          ✘
```

Si el commit arregla algo que ya se publicó, el cuerpo cuenta **cómo se
descubrió**. Casi todos los fallos caros de este proyecto fueron silenciosos, y
esa historia es lo que evita repetirlos.

## Antes de dar algo por bueno

```bash
npm test && npm run typecheck && npm run lint
node tools/verificar-app.ts --inicio     # o el flujo que cubra el cambio
```

`tools/verificar-app.ts` maneja la aplicación de verdad por CDP y comprueba
píxeles. Es lento y encuentra lo que los tests unitarios no pueden.

La regla del proyecto está en [CONTRIBUTING.md](CONTRIBUTING.md) y es corta:
**lo que el código afirma, el código lo mide**. Si un comentario dice que algo
es más rápido, hay un número detrás, y suele estar en `spikes/HALLAZGOS.md`
—incluidas las ideas que sonaban bien y la medición tumbó—.

## Los textos de la aplicación

Todo lo que se ve pasa por `t('…')`, con la frase en español como clave y la
traducción en `packages/core/src/textos-en.ts`. Un test de cobertura
(`packages/core/src/idioma.test.ts`) falla si falta una traducción o si sobra
una entrada muerta. No escribas texto suelto en un JSX: el test lo cazará, pero
más tarde de lo necesario.

## Versiones y releases

Cada bug, error, fallo o feature que se trabaje se **versiona y se publica en
GitHub Releases**. No se queda en un commit: se sube la versión, se etiqueta y
se publica el release.

La versión vive en dos sitios que deben ir al mismo número:

- `package.json` (raíz)
- `apps/desktop/package.json`

La convención del repo (releases `0.1.1`, `0.1.2`): la etiqueta git lleva
prefijo `v` (`v0.1.3`); el nombre del release va sin `v` (`0.1.3`). No hay
herramienta de release automatizada ni CHANGELOG: el cuerpo del release es el
registro.

Subida de versión según semver:

- arreglo de un fallo → patch (`0.1.2` → `0.1.3`)
- feature nueva → minor (`0.1.2` → `0.2.0`)
- cambio que rompe → major

Flujo, tras tener el commit del cambio ya verificado (`npm test`,
`typecheck`, el flujo de CDP que aplique):

```bash
# 1. Subir la versión en los dos package.json (y el lockfile)
# 2. Commit en español: «Alcanza la 0.1.3»
# 3. Etiquetar y empujar commit y etiqueta
git tag v0.1.3
git push origin master --follow-tags
# 4. Publicar el release, con el cuerpo contando qué se arregló o añadió
gh release create v0.1.3 --title "0.1.3" --notes "…"
```

El cuerpo del release dice qué cambia para quien usa la app, y si arregla algo
que se publicó, cómo se descubrió (la misma norma que el mensaje de commit).
