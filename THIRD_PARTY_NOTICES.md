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
