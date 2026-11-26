# Studio resume — 26 November 2026

Base: `6590cf6` (verified ancestor and initial HEAD). Worktree:
`t3-f9b0d324-3de82934d980cdf8`. No push. Only assigned Studio paths,
new `tests/studio*.mjs`, this note, and one mounting prop in App.jsx changed.
The interrupted checkout `t3-c5aa488f-3f86a6dae177d887` was read/copied only.

## Delivered behavior

Open FORGE → สร้างผลิตภัณฑ์ AI, or send a description from the home composer.
The deterministic interview supports eight task categories and six data types.
It offers editable recommendations, custom answers, dependency-aware re-answering,
and a small glossary. Saving each round persists a real Workflow Presets brief.
Reopen the project brief to continue after navigation/reload. Review and edit the
five brief sections, save, then explicitly create a draft planning mission.
The linked mission uses the existing Plan and Tasks; its approval/run controls
remain in Missions. The Studio page never invokes a model/provider or compute job.

The four planned deliverables cover data preparation, training approach,
evaluation, and model usage. They are **plans**, not generated datasets, trained
weights, measurements, or deployed services. File/test paths in the mission are
proposals, not files claimed to exist. All reviewed acceptance/dependency/risk
text is retained in Mission constraints; oversized combined text is refused
instead of silently truncated. Privacy/compute conflicts are called out.

Plain Thai is default; English chrome and proposals are supported. Saved authored
text stays in its saved language. Orange is the only authored Studio accent;
named themes, bundled fonts and existing shell remain intact. The parent owns
shell/theme accent changes (the base shell still has blue active-tab/navigation
states outside this worker's paths).

## Exact API seams and authority

- `POST /api/playbooks/state` reads existing canonical briefs/workflows.
- `POST /api/playbooks/create` uses compiled `bounded-improvement` preset, title,
  the existing five brief fields and at most 12 decisions. No new preset schema.
- `POST /api/playbooks/revise` uses workflow ID and the editor's pinned revision.
  Concurrent changes block overwrite and expose loading the current saved version.
- `POST /api/playbooks/materialize` receives the exact saved objective/decisions
  and planning-only definition. It returns the existing mission/plan/task IDs.
  Draft creation does not approve a plan or start execution.
- Existing `useStrategy`/`api.mjs` supplies Owner session/CSRF and a transport
  intent journal. Unknown outcomes expose an explicit same-operation retry;
  there is no automatic mutation on reload and no second planner/store.
- App.jsx only adds `onNavigate={openPage}` to the existing Studio mount.

Root's subsequent all-POST CSRF hardening is compatible: this page uses the
shared API wrapper for every mutation. HTTP fixtures explicitly obtain a browser
session and send cookie + CSRF for setup and domain POSTs. The Vite test proxy
preserves Host and Origin (`changeOrigin:false`); it does not strip security headers.

## Developer verification

`node --test tests/studio.test.mjs tests/studio-resume.test.mjs tests/studio-http.test.mjs`
passed **13/13**. Includes 960 standard interview paths, custom task convergence,
dependency invalidation, serialization, canonical contract/path checks, bounded
provider-output parsing helpers, declared-only backend rejection, synthetic data
reproducibility, and actual disposable SQLite/HTTP flows. HTTP checks cover
missing Owner session rejection, stale revision, objective mismatch, project
isolation, replayed create/materialize without duplicates, and zero runs/jobs.

Full production Vite build passed, with isolated temporary output/cache. Initial
build reported existing dependency `use client` and large-chunk warnings. No
manifest, lockfile or dependencies changed. Existing root node_modules was reused
through an ignored local junction; test Vite caches live in disposable temp dirs.
`git diff --check` passed. Impeccable context loaded from the explicit requested
skill; the required changed-file detector returned `[]`. No setup repair performed.

Actual T3 preview UI verification used only disposable project state, on port
54331 (earlier fixture startup ports 54329/54330 were replaced to correct fixture
font access/proxy configuration). Checked:

1. Thai start → recommendation rounds → editable five-part review.
2. A real revise committed, then its response was deliberately lost in the
   browser transport. UI displayed unknown outcome. Explicit recovery kept one
   workflow and four brief versions; no extra version or workflow appeared.
3. Explicit reviewed materialization produced exactly one draft mission, one
   unapproved plan, four tasks, **zero runs and zero jobs**.
4. Reload/reopen recovered the saved brief and linked mission. Open Missions
   navigated into the actual existing Missions surface with the saved title.
5. Thai at 390×844 and English at 1440×1000: fonts loaded, no horizontal overflow;
   the narrow layout stacks saved briefs above the working area. Long sidebar
   titles wrap within their button after the final layout correction.

Screenshots are local browser evidence, not tracked product assets:

- Thai review: `C:/Users/siripon.sri/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwx9pthl-16e32997.png`
- Thai mobile linked mission: `C:/Users/siripon.sri/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwx9tad7-1b99eaa0.png`
- English linked mission: `C:/Users/siripon.sri/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwx9v4hh-ee634249.png`
- Final 1280×800 title-wrap confirmation: `C:/Users/siripon.sri/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwx9y4lm-e30d972d.png`

Impeccable was applied as an extension of the existing Operate surface. The
task explicitly forbids nested agents, so design checking stayed in this thread;
no independent finish-reviewer verdict is claimed. Parent integration review
remains separate from these implementation checks.

## Implementation limits versus HOME checks

**IMPLEMENTATION LIMIT:** universal executable ML recipes/backends are not
implemented here. The recovered backend descriptors are declared-only, and
`run()` rejects. Recovered provider drafting/validation helpers are not mounted
or called by this UI. No claim of trained quality, automatic deployment, free GPU,
automatic budget cutoff, or universal model support is made.

**HOME/LIVE NOT RUN:** dr-train SSH, actual cardiac research, real datasets,
remote compute accounts, model/provider calls, Cloudflare deployment and home
UAT. These are separate from the implementation limit above and were not
activated. No credentials migrated, no compute purchased, no public service,
no protected legacy edits, no repository push.

Reproduce browser verification with `node tests/studio-fixture.mjs` (default
loopback port 54329; optional `STUDIO_TEST_PORT`). The fixture creates its own
temporary SQLite/workspace/machine directory and disposes it on SIGINT/SIGTERM.
