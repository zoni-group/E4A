# English for AI

This repository is the public, student-facing build for the ZONI English for AI curriculum.

The source-of-truth authoring repository is private. Course staff materials, raw authoring source, assessment materials, and planning notes are not published here.

Public contents include:

- the rendered student site in `site/`
- public companion Colab notebooks in `english-for-ai-course/interactives/`
- the public Colab helper module `e4a_colab.py`
- Cloudflare Pages Functions access gate configuration
- temporary GitHub Pages deployment and public safety validation during the hosting migration

The protected Cloudflare Pages pilot host is `https://en4ai.zoni.edu/`.
Production custom domain after cutover: `https://e4ai.zoni.edu/`.

Unauthenticated or expired sessions are redirected to `https://www.zoni.edu/portal`.

See `LICENSE.md` and `THIRD_PARTY_NOTICES.md` for license and attribution information.
