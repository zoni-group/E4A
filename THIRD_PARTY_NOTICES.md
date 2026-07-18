# Third-Party Notices

This repository is intended to contain ZONI-owned curriculum, documentation, scripts, configuration, and generated course materials.

The previously vendored Quarto Colab extension located at:

`english-for-ai-course/_extensions/coatless-quarto/colab/`

has been removed from version control and added to `.gitignore` to avoid redistributing third-party code without a verified license notice.

Developers may keep a local ignored copy of the extension if needed for local rendering, but it must not be committed to the public repository.

If any third-party files, libraries, generated assets, or copied components are added in the future, their licenses must be verified and documented here before publication.

## Plotly

Lesson 6 uses Plotly.py 6.9.0 during authoring. The build copies the bundled
Plotly.js 3.7.0 browser library into the rendered static site as
`assets/generated/plotly/plotly-3.7.0.min.js`.

Plotly.py and Plotly.js are provided under the MIT License. The generated site
includes the Plotly license at `assets/generated/plotly/LICENSE.txt`. Plotly's
copyright and license header is preserved in the generated JavaScript file.

Project: <https://plotly.com/python/>

License: <https://github.com/plotly/plotly.py/blob/main/LICENSE.txt>
