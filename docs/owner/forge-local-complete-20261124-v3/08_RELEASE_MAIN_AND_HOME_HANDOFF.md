# Main Release and Home Handoff

## Intended outcome

Complete the agreed FORGE implementation, verify it in the development environment, then deliver the selected revision through `main`. The owner pulls that revision at home and tests system flows. This document does not activate CA-EWS or another prototype project.

Preparing this docs package does not publish source code. The owner can push manually or send `prompts/RELEASE_MAIN.txt` to delegate the already-described release operation. An agent acting under that prompt should finish the necessary checks and execute the normal authorized push without another routine confirmation question.

## Before selecting the release revision

Resolve material implementation defects and missing required functionality. Complete the integration ledger for all named services with actual implementation paths, supported operations and the difference between local checks and live qualification. A menu or placeholder is not implementation. Missing external authentication can be documented for home qualification when the adapter and setup path are complete.

Build and start the combined tree; exercise the primary local UI and persistence paths. Verify installation/build/start from a clean checkout or an isolated equivalent that does not rely on unpublished files. Check migrations, restart/data persistence, dependency setup and useful diagnostics. Broad testing is needed only for affected risks or the defined acceptance criteria, not to inflate a test count.

Keep product startup independent of paid compute or a logged-in training provider. Missing optional connections should lead to a usable setup screen. The ordinary local entry point should open the browser after readiness and show an understandable action if it cannot start.

## Release contents

Include the implemented source, matching lockfiles, build/start/setup paths, migrations, dependency/license notices, clear local quickstart, integration status and home UAT instructions. Keep version/commit visible in the application and release record.

Include the AG-UI adapter, embedded office facilities, report-engine integration and their actual tests in coverage. Record pinned engine/protocol/SDK versions, supported Windows artifacts, acquisition/checksum mechanism, fonts and third-party notices. If executable releases are delivered separately from Git, the clean-clone setup must retrieve the qualified artifacts through the documented path. Do not require normal users to compile native engines. Record optional LibreOffice/Office Exchange setup and any output quotas or watermarks separately from the baseline report path. Replacing upstream branding in a modified distribution and preserving applicable notices must be part of release packaging.

Exclude credentials, tokens, provider sessions, personal data, developer databases, caches, dependency directories, generated checkpoints and other machine-specific state. Do not commit a developer's absolute workspace path as an application default. Include only fixtures required for repeatable engineering checks and label them clearly.

Inspect the staged diff by path. Do not use a blind stage-all command that includes unrelated dirty work. Preserve valid legacy portable payloads/manifests and verify them when the release touches those boundaries.

## Controlled integration and push

1. Inspect repository root, current branch/worktree, status, remotes and the target remote's `main`. Fetch current remote state when authorized and available. Do not assume `origin` points to the intended FORGE repository without checking.
2. Integrate reviewed worker changes on the lead's integration branch. If remote main has advanced, reconcile the actual changes and rerun affected checks on the resulting tree.
3. Prepare scoped commits and a release report. Advance local `main` to the tested integrated revision through the applicable normal merge workflow. Do not switch or overwrite a main worktree that contains another actor's work.
4. Push to the confirmed FORGE remote's `main` when the owner performs or delegates that step. Do not force-push, erase history or bypass branch protection. If protection requires a PR, use the authorized route and record its state; do not label an open PR as a completed main push.
5. Verify the observed remote revision and report local commit, remote main commit, release evidence and pending home checks. A successful local commit is not proof of a successful push.

If a material code gap remains, continue implementation and report `IMPLEMENTATION_INCOMPLETE`; do not ship it as complete simply to meet a phrasing target. If only an unavailable external service or second-machine acceptance remains, list those checks specifically as pending.

## Required release report

The lead records:

- Intended FORGE repository/remote and final commit/branch.
- Product scope implemented and any remaining implementation gaps.
- Build/start/check commands actually run and their outcomes.
- Working Windows setup/start instructions and observed local URL behavior.
- Integration ledger summary: implemented, locally checked, live-qualified or not run.
- AG-UI recovery evidence, office save/reopen and agent-edit evidence, report artifact/fidelity evidence, engine dependency readiness and the source revisions used.
- Actual provider/model discovery status; distinguish a FORGE catalog fix from the separately installed T3 and from an open upstream PR.
- Data/configuration migration and per-machine sign-in expectations.
- Home UAT steps and pending target-specific checks.
- Actual commit/push result, without credentials or secret values.

Use `READY_FOR_HOME_UAT` only when the complete agreed implementation and required developer checks support it. Keep `HOME_UAT_NOT_RUN` until the home test actually happens. Describe any limited qualification clearly rather than using an unconditional “everything verified” label.

## Home-machine flow

The home installation may have a different directory, username, installed dependencies and provider sign-in. It must initialize from the delivered source and public dependencies through the prepared setup path.

The owner or delegated agent checks local Git status before updating. A clean main checkout can fast-forward to the delivered remote revision. If the home clone has changes or divergent commits, preserve them and resolve the specific situation; do not prescribe `reset --hard` as the default update path.

After pull, use the shipped setup/start entry point. Verify the displayed revision, complete needed account/destination bindings through the GUI and follow the UAT guide. Credentials and app databases are not transferred by Git; configure this machine through supported flows. Existing local app data should survive source updates and migrations.

Home UAT covers actual FORGE usage: onboarding, project/workspace selection, bots and chat, planning/board/task consistency, AG-UI events/recovery, available coding execution, office editing, report export/PDF operations, notebooks/jobs/artifacts, Settings and connections, storage controls, inference/monitoring facilities, desktop target operation, stop/retry/restart and TH/EN. Use small disposable engineering inputs. Do not start a separate owner prototype by default.

Record failed steps with reproduction information, affected version and logs with secrets removed. Fix product defects on a branch, verify, deliver the new main revision and repeat only the affected checks plus a necessary regression smoke.
