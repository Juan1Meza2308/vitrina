# Security

Vitrina records your screen content and, optionally, your microphone and camera.
That makes a few things worth stating plainly.

## What the app does with your data

- Everything stays **on your machine**. Recordings are folders under
  `Videos/Vitrina`. Nothing is uploaded, and the app has no account, no
  telemetry and no analytics.
- The input log records **that** you typed, never **what**: keystrokes are
  stored as `"char"`. A demo of a login screen cannot leak a password.
- Elements you choose to mask are blurred **while recording**, in the browser,
  so the pixels never reach the video file.
- The only network requests the app makes are the update check against the
  GitHub Releases API, and whatever the page you are recording does.

## Reporting a vulnerability

Please open a [private security advisory](https://github.com/Juan1Meza2308/vitrina/security/advisories/new)
rather than a public issue, and give it a few days before disclosing.

Especially interesting: anything that gets a recorded page to escape its window,
anything that makes the keystroke log store real keys, and anything that lets a
recorded page read files through the `vitrina://` protocol.
