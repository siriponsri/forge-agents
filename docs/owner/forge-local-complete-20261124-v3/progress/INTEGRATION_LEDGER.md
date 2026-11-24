# Integration Ledger

## Current integration update — 2026-11-24

Provider install/setup/catalog/selection, scoped supervised MCP, OAuth, Plugins,
Assistance/Adaptive, Goals, Memory, Context and Compute now have production
HTTP/App mounts. Telegram Inbox and signed private bridge/report lifecycle are
mounted; native gateway live checks are still NOT_RUN. Central Owner memory is
private until a current source revision is explicitly shared to a named project.
Runtime key entry/OS-vault integration and standalone public website are active
tasks. Earlier rows below describe the previous inspection and are retained as
history; use CURRENT_STATUS and current evidence to resolve superseded gaps.

Production checks: `controls-integrated-smoke.json`,
`knowledge-integrated-smoke.json`, `visual-integrated-smoke.json`,
`t3-provider-setup-live.json` under `docs/evidence`. Model turns and account login
are expressly NOT_RUN in the latest fresh native setup qualification.

## Earlier inspected ledger

| Route | Implementation/evidence | Live qualification |
|---|---|---|
| T3/Codex | app/vendor/t3 + app/server/t3.mjs; actual matching v0.1.11 GUI/server and supervised MCP thread ownership | PASSED read-only gpt-6.1-sol/xhigh fixture; docs/evidence/t3-live-smoke.json |
| Claude/Gemini/Grok/OpenCode/Kimi/Qwen/DeepSeek | T3 provider registry/ACP route available in selected runtime; FORGE per-route no-code install/setup not yet complete | NOT_RUN per provider; no claim from Codex success |
| OpenRouter | Generic endpoint reachability only; model/harness execution IMPLEMENTATION_INCOMPLETE | NOT_RUN |
| MaxPlus | Prior isolated native-home boundary preserved; product route/setup IMPLEMENTATION_INCOMPLETE | NOT_RUN |
| KOB | API path/licensing distinctions in research; required adapter IMPLEMENTATION_INCOMPLETE | NOT_RUN |
| Custom MCP | SDK1.32.2 stdio/HTTP, discovery, enabled tool calls, durable uncertainty reservations | Local tests only; service-specific OAuth/install not complete |
| Local Windows compute | Real Python notebook job/log/status with selected workspace and timeout | PASSED disposable Python execution |
| Owner server/Colab browser/Colab API/Vast/Runpod | Required lifecycle adapters IMPLEMENTATION_INCOMPLETE | NOT_RUN; no resources provisioned |
| Local metadata/artifacts | Native snapshots, SHA256-verified artifacts and metadata backup/restore | PASSED persistence/tamper checks; artifact bundle backup/retention incomplete |
| Output-project Git | app/server/git-storage.mjs selected-file commit, explicit remote/branch push | PASSED disposable bare-fixture remote; no FORGE remote push |
| Google Drive | Required auth, staged transfer/conflict/retry/retention IMPLEMENTATION_INCOMPLETE | NOT_RUN |
| LitServe/inference/deployment/metrics | Required artifact-bound serving workflow IMPLEMENTATION_INCOMPLETE | NOT_RUN |
| Main Windows/guest/browser targets | Persisted identity/ownership/tool boundary; actual driver setup and in-flight stop incomplete | Fixture ownership only; native actions NOT_RUN |
| Adaptive skills | Versioned skill records/capability filter; evaluation/promotion/loop integration incomplete | Fixture filter only |
| AG-UI | core1.0.5, actual T3 run/message/finish validated; complete tools/delta/frontend result recovery incomplete | Provider smoke PASSED to stated subset |
| Univer | Worker A implementing Sheets/Docs; reports real save/reopen/formula/undo evidence | Lead integrated acceptance pending |
| WordCraft/PdfCraft | Worker B implementing native service; reports actual official Windows outputs/strict checks | Lead integrated acceptance pending |
| Office Exchange/LibreOffice | Optional; not advertised ready, no commercial package installed | NOT_RUN |

The rows below are the original requirement inventory, retained for provenance.

Initial state was **NOT_AUDITED_IN_OWNER_CHECKOUT** for every row.

For each named route, record implementation paths and supported operations separately from dependency/authentication readiness, local contract checks and actual live evidence. A shared compatible adapter can cover multiple services only after the relevant contracts are checked. Unavailable login may defer qualification; missing code remains an implementation gap.

| Family | Target | Actual route / code paths | Supported operations | Implementation / readiness | Local evidence | Live evidence / blocker |
|---|---|---|---|---|---|---|
| Provider/harness | ChatGPT/Codex | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Provider/harness | Claude | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Provider/harness | Gemini | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Provider/harness | OpenRouter | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Provider/harness | Grok | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Provider/harness | OpenCode | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Provider/harness | Kimi | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Provider/harness | Qwen | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Provider/harness | DeepSeek | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Provider/harness | MaxPlus | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Provider/harness | KOB | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Provider/harness | Custom compatible provider | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Compute | Local Windows CPU | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Compute | Owner server | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Compute | Colab browser notebook | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Compute | Colab remote API | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Compute | Vast | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Compute | Runpod | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Serving | LitServe REST/MCP | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Serving | Configurable alternative serving target | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Storage | Local Windows | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Storage | Google Drive | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Storage | Output-project Git | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Tools | MCP registry/custom connection | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Desktop | Main Windows native | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Desktop | Separate desktop/VM | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Desktop | Browser automation | To inspect/select | To verify | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Harness/UI protocol | AG-UI bridge | Source researched; implementation to inspect | Typed events/state, validated commands, recovery | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Office | Univer Sheets/Docs OSS core | Source researched; implementation to inspect | Embedded editing, native snapshots, agent commands | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Office exchange | Optional Univer Exchange or qualified alternative | Select separately from native persistence | Exact import/export formats, fidelity and limits | OPTIONAL_NOT_CONFIGURED | NOT_RUN | NOT_RUN |
| Reports | WordCraft headless CLI/MCP | Source researched; implementation to inspect | Editable reports, DOCX/PDF, scoped files | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Reports | PdfCraft CLI/MCP | Source researched; implementation to inspect | PDF inspection/page operations/postprocessing | NOT_AUDITED | NOT_RUN | NOT_RUN |
| Optional conversion | PdfCraft + installed LibreOffice | Native source route researched | Qualified Office-to-PDF formats | OPTIONAL_NOT_CONFIGURED | NOT_RUN | NOT_RUN |
| Provider discovery | T3/Codex model catalog | Matching upstream issue; local cause unknown | Freshness, slow refresh, same-route model check | NOT_AUDITED | NOT_RUN | NOT_RUN |

## Required evidence per integrated route

Record source/API/MCP version and license where relevant, setup/dependency steps, credential binding method without values, representative structured outputs, failure/cancellation/recovery handling, and qualification target/time. Unknown capabilities must stay unknown rather than being inferred from the provider name.

The future CA-EWS profile selected Windows + Colab Free + LitServe + Drive/local/Git. It is not automatically instantiated or executed by this product implementation. Other project profiles remain independent.
