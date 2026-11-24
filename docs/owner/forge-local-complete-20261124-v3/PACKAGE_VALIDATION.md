# Package Validation — v3

Reviewed **2026-11-24, Asia/Bangkok**. Scope: this documentation/prompt package only.

## Checks completed

| Check | Result |
|---|---|
| UTF-8, final newline, trailing whitespace and JSON parsing for new/updated files | PASSED |
| Relative Markdown links in new/updated files | PASSED: 81 destinations resolve |
| Explicit repository paths in prompts | PASSED: 22 paths resolve |
| Original copied reference hashes | PASSED: all 14 preserved |
| Original acceptance criteria | PASSED: all 21 A00–A20 rows retained verbatim |
| Complete acceptance sequence | PASSED: 31 rows, A00–A30 |
| Main workflow prompts | PASSED: AG-UI, Univer, WordCraft/PdfCraft and no-prototype scope present |
| Cross-review of protocol/office/report contracts and model recommendations | No material contradictions identified in read-only document review |
| Package manifest and ZIP integrity | PASSED: archive entries match included file bytes and manifest hashes |
| Archive paths and file types | PASSED: only Markdown, text and JSON beneath the v3 docs directory |

Historical reference text is preserved unchanged. It is governed by the current scope/precedence guide; old relative links or embedded prototype instructions are not activated by preservation.

## Evidence boundaries

These checks do not establish an application build, completed FORGE integration, installed native engine, verified Thai rendering, live provider call, fixed T3 installation, Windows startup or home UAT. Those remain implementation/qualification work defined in the acceptance matrix. No application commit or push was performed by preparing this package.

Upstream facts are dated source observations. The owner Windows checkout and T3 installation were not inspected. PR #38889 was open/unmerged when researched; its existence does not prove a shipped fix. Use a runnable model while diagnosing the separate picker issue.

The manifest excludes its own hash to avoid recursion. It records every other delivered file; the ZIP also contains the manifest. Original source hashes remain in `REFERENCE_MANIFEST.json`, and inspected upstream revisions are recorded in `UPSTREAM_REFERENCE_PINS.json`.
