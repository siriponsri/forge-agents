# Professional English README and step-by-step media

Owner-confirmed 2026-11-25. Required final release documentation task, extending
`docs/RELEASE_DOCUMENTATION_GATE.md`. It does not authorize a push/deployment or
make the unfinished product a complete release. Rewrite after the demonstrated
flows and final verification settle, so screenshots/GIFs match delivered code.

## References inspected

Official public repository pages and README content retrieved on 2026-11-25:

| Reference | Observed rounded stars, not a ranking claim | Pattern to adapt |
|---|---|---|
| [n8n](https://github.com/n8n-io/n8n) | 212.0k | Concise value proposition, real product screenshot, capabilities, short quickstart, deeper resource links |
| [Supabase](https://github.com/supabase/supabase) | 115.4k | Clear product scope, dashboard screenshot, architecture explanation, docs/support/contribution wayfinding |
| [Dify](https://github.com/langgenius/dify), [README](https://github.com/langgenius/dify/blob/main/README.md) | 161.8k | Install requirements first, self-host/cloud distinction, capability-specific media and operational docs |

These are highly starred examples selected for relevance, not an exhaustive
global top-star list. Stars change and are not evidence that a README caused
adoption. Adapt information hierarchy; do not copy their copy, brand, screenshots,
customer counts, badges or license model. In particular n8n describes fair-code,
not an interchangeable license for FORGE's planned open-source local core.

## DOC-R01 deliverables

- Rewrite the root README in professional English throughout, including the
  quickstart, current-status disclosure, diagram labels, tables, captions and
  image alt text. Link the Thai setup/UAT guides as an additional language.
- Lead with a precise product statement, real current product image and direct
  installation/workflow links. Keep detailed internal history in linked handoff
  documents rather than a long historical payload in the main reading path.
- Show actual capabilities with short descriptions and supported-status wording.
  Separate implemented/developer-verified from live account/macOS/home checks.
- Include Windows GUI launcher instructions, tested prerequisites, localhost,
  stop/restart and data/credentials/backup boundaries. Document macOS accurately.
- Include repository-native architecture and software-delivery diagrams:
  Mission/decision → canonical plan → scoped execution → evidence → QA/Owner;
  also explain Chat↔Visualization and Executor/Asst roles without another planner.
- Provide navigation to detailed guides, contribution/development, security,
  support, license/notices and an evidence-based roadmap. No fake badges or links.

## Required screenshots

Capture fresh built App with labelled nonsecret engineering records, English UI,
consistent default theme and useful crops. Keep full-resolution source captures.

1. Overview / workspace and project selection.
2. Team + group chat switching to Node–Edge Workspace and selected run evidence.
3. Plan/tasks/dependencies and software execution/preview/test results when ready.
4. Docs/Sheets and Report Studio with actual readable outputs.
5. Memory/explicit Owner sharing, Compute/Artifacts and relevant recovery views.

Only show a claimed function after exercising that function. If a flow uses
injected provider observations, label that exact limitation next to the image;
do not present it as a live model run. Never put keys, cookies, auth URLs/device
codes, personal conversations or private machine paths into public assets.

## Required step-by-step GIF walkthroughs

Record actual interactions with English step captions and matching numbered text:

| Walkthrough | Steps to show | Gate |
|---|---|---|
| Start FORGE | Launch → readiness → project → setup/first usable workspace | Clean-install/startup checks |
| Software mission | Idea → reviewed plan → code execution → preview → test evidence → Delivery Pack | End-to-end software journey implemented and checked |
| Visualization | Group chat → Workspace → inspect agent/run/tool → existing approval/Stop/recovery controls → Chat draft | Real graph/projection/identity tests |
| Office/report | Edit → save → generate → preview/download → reopen | Actual native source and output verification |

Keep clips short and task-specific, readable without audio; disclose speed-up or
removed idle time. Use genuine screen recordings, not a simulated successful UI.
Provide a static screenshot and numbered instructions alongside every GIF for
accessibility/reduced-motion readers. Aim for <=8 MiB per GIF and a lightweight
README first view; optimize dimensions/frame rate/palette without obscuring labels.
No external upload/hosting is required by this task.

## Asset provenance and acceptance

Keep intended public assets under `docs/media/` (create when captured) with a
manifest: filename, source recording, git revision/dirty-tree qualification,
build/platform/browser, capture date, viewport/theme, walkthrough steps,
engineering/live scope, editing/speed changes and checksum. Internal review images
under `.impeccable/review` are evidence, not automatically approved public media.

Acceptance requires English editorial review, exact command/link/image checks,
GitHub-compatible diagram rendering, readable GIF frames/screenshots, no sensitive
content, verified file sizes and consistency with the final acceptance ledger.
Do not mark this task complete from the current first Visualization slice.

Status: **ENGLISH_REWRITE_AND_MEDIA_PREPARED / FINAL_MERGED_REFRESH_REVIEW_PENDING**.
Prepared media47fba99 contains21 actual screenshots, four real step-by-step GIFs,
source video, captions and provenance. Root English README is rewritten and P11
history archived. Capture revision remainsf8dbd0d; do not claim the final release
documentation gate passed before merged runtime verification and media refresh.
