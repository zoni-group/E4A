# Third-Party Notices

This repository is intended to contain ZONI-owned curriculum, documentation, scripts, configuration, and generated course materials.

The previously vendored Quarto Colab extension located at:

`english-for-ai-course/_extensions/coatless-quarto/colab/`

has been removed from version control and added to `.gitignore` to avoid redistributing third-party code without a verified license notice.

Developers may keep a local ignored copy of the extension if needed for local rendering, but it must not be committed to the public repository.

Third-party files and libraries currently used by the course are documented
below. Any future addition must also have its license verified and documented
here before publication.

## Plotly

Lesson 6 uses Plotly.py 6.9.0 during authoring. The build copies the bundled
Plotly.js 3.7.0 browser library into the rendered static site as
`assets/generated/plotly/plotly-3.7.0.min.js`.

Plotly.py and Plotly.js are provided under the MIT License. The generated site
includes the Plotly license at `assets/generated/plotly/LICENSE.txt`. Plotly's
copyright and license header is preserved in the generated JavaScript file.

Project: <https://plotly.com/python/>

License: <https://github.com/plotly/plotly.py/blob/main/LICENSE.txt>

## LiveCodes

Lesson 7 uses the LiveCodes SDK 0.14.1 to open a self-hosted LiveCodes v49
editor in a new tab only after a student selects **Open HTML editor in new
tab**. LiveCodes is provided under the MIT License, copyright Hatem Hosny and
the LiveCodes contributors.

The reproducible asset builder downloads the pinned v49 release archive,
verifies its SHA-256 checksum, and extracts only the static application needed
at `/livecodes/`. Documentation, Storybook content, source code, and unrelated
SDK wrappers are not included. The reviewed upstream tree and the complete
generated tree are pinned by separate digests. A reproducible, course-owned
education-mode policy hides account, sharing, deployment, synchronization,
broadcast, and third-party export controls while retaining local project
storage and export. It also triggers LiveCodes' pinned HTML formatter when a
complete lesson file first opens; format-on-save keeps later saved versions
indented. The rendered site includes the upstream license at
`livecodes/LICENSE.txt`.

The core application is served from the same origin as the book. LiveCodes may
load its stock language and editor support packages from public CDNs while the
editor is open.

On Cloudflare Pages, `/livecodes/` is intentionally available without the book
session cookie. LiveCodes runs compilation and student results in an isolated
cross-origin sandbox, which must be able to load the pinned compiler utility
from this public static subtree. The rest of the book remains protected.

For localhost development only, the repository can download and serve the two
small v9 sandbox HTML files from the pinned LiveCodes v49 source tag. Their
individual SHA-256 digests are verified before they are installed in the
ignored `.livecodes-sandbox/` directory. These development files are not
included in the rendered or public site.

Project: <https://livecodes.io/>

Pinned release: <https://github.com/live-codes/livecodes/releases/tag/v49>

License: <https://github.com/live-codes/livecodes/blob/v49/LICENSE>

## Gamedev Canvas Workshop Brick Breaker Code Sample

Lesson 7 includes a classroom copy of `lesson10.html` from the Gamedev Canvas
Workshop by Andrzej Mazur and Mozilla Contributors, pinned to revision
`5199692d8acb9770dc5c16b5b18afbadd95fa497`.

The upstream project dedicates its code samples and snippets to the public
domain under CC0 1.0 Universal. The course copy includes only the code sample,
not the CC BY-SA tutorial prose. A source record, change list, and CC0 notice
are stored beside the file at:

`english-for-ai-course/assets/sample-code/lesson-07/`

Project: <https://github.com/end3r/Gamedev-Canvas-workshop>

Pinned source: <https://github.com/end3r/Gamedev-Canvas-workshop/blob/5199692d8acb9770dc5c16b5b18afbadd95fa497/lesson10.html>

Upstream license notice: <https://raw.githubusercontent.com/end3r/Gamedev-Canvas-workshop/5199692d8acb9770dc5c16b5b18afbadd95fa497/LICENSE>
