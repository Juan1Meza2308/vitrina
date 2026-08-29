# Third-party software

Vitrina is MIT licensed (see [LICENSE](LICENSE)). The installers ship two
third-party components:

## FFmpeg

The Windows and macOS installers bundle a static **FFmpeg** build, obtained
through [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static)
(builds by [John Van Sickle](https://johnvansickle.com/ffmpeg/)).

FFmpeg is licensed under the **GNU General Public License v3**. Vitrina does not
link against it: FFmpeg runs as a separate process, invoked through its command
line interface, and it is shipped unmodified.

- Source code: <https://ffmpeg.org/download.html>
- License text: `ffmpeg.LICENSE`, inside the `ffmpeg-static` package, and
  <https://www.gnu.org/licenses/gpl-3.0.html>

Vitrina bundles it so that recording, editing and exporting work the moment you
open the app. If you would rather use your own build, point the app at it from
the welcome screen, or set `FFMPEG_PATH`.

## Electron

The app is built on [Electron](https://electronjs.org) (MIT), which includes
Chromium (BSD-style) and Node.js (MIT). Their licenses ship inside the
application bundle, as `LICENSES.chromium.html`.
