# VS Code built-in theme palettes

Upstream: Microsoft Visual Studio Code, MIT License, copyright Microsoft Corporation.
Pinned revision: `b57d5c9e1b27c4ede570c76940b7aa5207595a54`.

Repository: <https://github.com/microsoft/vscode/tree/b57d5c9e1b27c4ede570c76940b7aa5207595a54>.
The unmodified MIT license is in `LICENSE.txt` and `source/LICENSE.txt`.
Unmodified upstream theme JSONC, contributing extension manifests and relevant
color registry files are retained under `source/`. `sources.json` lists their
exact source URLs and SHA256 hashes. No marketplace extension or third-party
theme package is included or represented as licensed here.

FORGE adaptation: `generate.mjs` resolves theme includes and the documented
registry defaults, then emits `app/web/src/themes.mjs` and `themes.css`.
The original editor/sidebar/title/input/button colors supply the palette.
Preview miniatures retain original colors. Additional surface tints, borders,
semantic states, shadows and the independent orange FORGE brand are FORGE choices.
Text/link/semantic foregrounds are moved toward white or black only where
necessary for 4.5:1 text contrast. Button foreground and hover contrast receive
the same accessibility correction. This is an adaptation to FORGE's UI, not a
claim of reproducing the full VS Code color registry or its rendered IDE.

Regenerate offline: `node app/vendor/vscode-themes/generate.mjs`.
Refresh only from the pinned revision: append `--refresh`.
Verify source integrity, contrast and picker behavior:
`node app/vendor/vscode-themes/verify.mjs`.
The verification harness uses the existing Vite/esbuild and Playwright tooling.
