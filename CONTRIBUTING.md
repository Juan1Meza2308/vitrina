# Contributing

Thanks for taking a look. Vitrina is a small, opinionated project, and it is
easier to contribute to than most Electron apps: everything runs from source
with two commands.

## Getting set up

```bash
npm install     # also downloads the ffmpeg build the app ships with
npm run app     # runs the desktop app from source
```

You need **Node 22.18+** and a Chromium-based browser (Edge is fine, and it is
already there on Windows). Nothing else — no ffmpeg to install, no build step to
learn.

## Before you open a pull request

```bash
npm test          # unit tests, including real exports through ffmpeg
npm run typecheck
```

And, if you touched the app itself, drive it for real:

```bash
node tools/verificar-app.ts              # the whole editor: drag, undo, export
node tools/verificar-app.ts --bienvenida # whichever flow covers your change
```

`tools/verificar-app.ts` runs the real application over the Chrome DevTools
Protocol and checks **pixels**, not mocks. It is slower than a unit test and it
catches what unit tests cannot: a panel that overflows, a canvas that never
repaints, a bubble that is missing from the exported mp4.

## The one rule

**What the code claims, the code measures.** If a comment says an approach is
faster, there is a number behind it, and usually a spike in
[`spikes/HALLAZGOS.md`](spikes/HALLAZGOS.md) explaining how it was measured —
including the times the measurement proved the idea wrong. That file is the most
useful thing to read before changing anything performance-related.

Some concrete habits that follow from it:

- A test that fails depending on the machine it runs on is worse than no test.
  Inject the filesystem, the clock, the home directory — there are examples in
  `packages/export/src/ffmpeg.ts` and `packages/capture-cdp/src/browser.ts`.
- Comments explain **why**, not what. The interesting comment is the one that
  says what was tried and did not work.
- Spanish is the language of the code and its comments. The README and the
  GitHub-facing files are in English so people can find the project; you are
  welcome to write in either.

## Reporting something

Open an issue — bug reports with the exact URL you were recording, your OS, and
what the app showed are the most useful. If it is a security or privacy issue,
see [SECURITY.md](SECURITY.md) instead.
