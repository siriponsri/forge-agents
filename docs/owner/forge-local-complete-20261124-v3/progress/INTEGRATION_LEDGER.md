# Integration Ledger

Initial state: **NOT_AUDITED_IN_OWNER_CHECKOUT** for every row. This is a coverage list, not an installed or shipped connector catalog.

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
