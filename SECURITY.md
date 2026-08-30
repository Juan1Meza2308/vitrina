# Security

Vitrina records your screen content and, optionally, your microphone and camera.
That makes a few things worth stating plainly.

## What we assume is hostile

**The page you record is not trusted.** It is someone's web app — maybe yours,
maybe a demo of a third-party site — and it runs its own JavaScript. Vitrina
injects two scripts into it and reads what comes back, so everything crossing
that line is treated as data, never as instructions: click labels are trimmed to
60 characters, the input log stores `"char"` instead of the key, and nothing the
page produces is executed or interpolated into markup.

**Your machine is trusted.** Vitrina has no account, no server and no sandbox of
its own to escape from — if something is already running as you on your computer,
it does not need Vitrina to read your files. What we do care about is not
*handing* it anything extra.

## What the app does with your data

- Everything stays **on your machine**. Recordings are folders under
  `Videos/Vitrina`. Nothing is uploaded, and the app has no account, no
  telemetry and no analytics.
- The input log records **that** you typed, never **what**: keystrokes are
  stored as `"char"`. A demo of a login screen cannot leak a password. An
  integration test drives a real browser and asserts it.
- Elements you choose to mask are blurred **while recording**, in the browser,
  so the pixels never reach the video file. See
  [docs/privacidad.md](docs/privacidad.md).
- The only network requests the app makes are the update check against the
  GitHub Releases API, and whatever the page you are recording does.
- Error messages shown in the app do not carry file paths from your disk: the
  plain-language message is on top and the original text is folded underneath,
  where you choose to open it.

## How the app is locked down

| | |
|---|---|
| Renderer | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` — the UI cannot reach Node, and the process runs with OS-level sandboxing |
| Content Security Policy | `default-src 'self'`, `script-src 'self'`, no `unsafe-eval` — an injected `<script>` does not run |
| Navigation | `will-navigate` and `setWindowOpenHandler` deny everything outside the app's own origin; external links go through an allow-list and open in your system browser |
| Recorded browser | Launched with a **free port chosen by the browser**, not a fixed one, into a throwaway profile that is deleted when recording stops |
| Permissions | Only `media` (camera and microphone) is granted; geolocation, notifications and the rest are denied |
| Frame serving | The `vitrina://` protocol is scoped to the open recording's folder and rejects `..` |

These are verified two ways: `npm test` fails if any of the settings is removed,
and `node tools/verificar-app.ts --seguridad` drives the real app and checks what
the window actually *does* — that it will not navigate away, will not open a
window, cannot reach Node, and will not run an injected script.

## Known limits

- **The installers are not code-signed.** Signing needs a paid certificate on
  Windows and a paid developer account on macOS. Until then, verify what you
  download against the checksums on the release, and expect a SmartScreen or
  Gatekeeper warning on first launch.
- **While a recording is running, the browser's debugging port is open on
  localhost.** It is a random port into a throwaway profile, not your real
  browser, but the DevTools Protocol has no authentication: any process already
  running as you could attach to it for the duration of the recording.
- **A cross-origin iframe cannot be masked.** It runs in another process that
  the injected stylesheet does not reach.
- **A blur is a cover, not encryption.** At the default radius interface text is
  unreadable in the video, but anything you must never reveal is better kept off
  the screen.

## Reporting a vulnerability

Please open a [private security advisory](https://github.com/Juan1Meza2308/vitrina/security/advisories/new)
rather than a public issue, and give it a few days before disclosing.

Especially interesting: anything that gets a recorded page to escape its window,
anything that makes the keystroke log store real keys, and anything that lets a
recorded page read files through the `vitrina://` protocol.
