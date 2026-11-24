# Acceptance evidence — developer checkpoint 2026-11-24

This is a coverage map, not a completion declaration. **IMPLEMENTATION_INCOMPLETE**;
all home checks **HOME_UAT_NOT_RUN**. Paths below are repository-relative.

| Criteria | Implementation coverage | Developer evidence / remaining work |
|---|---|---|
| A00 | Implemented preservation boundary | efcd132 inspected; scoped integration commits, protected legacy files untouched; AO fixtures pass |
| A01 | Partial real T3 reuse | MIT source loader + matching v0.1.11 GUI/server; supervised MCP/live run passed; unified shell still incomplete |
| A02 | Implemented domain subset | tests/product-domain.test.mjs persists two projects, bots/chat/doc/task revisions across restart; full UI integration pending |
| A03 | Worker GUI in progress | Thai/EN and keyboard/mobile checks reported by worker; lead combined UI check pending |
| A04 | Partial | Durable bots/resident/helper metadata and scoped local messages; provider-backed private/team routing and handoff incomplete |
| A05 | Partial | Persistent plan/phase/task dependency/evidence checks; worker cross-view UI evidence; scheduler/isolation expansion pending |
| A06 | Implemented bounded T3 route | Live read-only Codex smoke completed and run/thread/attempt linked; full diff/change review integration pending |
| A07 | Partial | Full provider inventory in INTEGRATION_LEDGER; per-provider setup/model-API adapters unfinished |
| A08 | Partial | Actual MCP SDK transports/discovery/call reservation; no-code server installation/OAuth/cancellation recovery incomplete |
| A09 | Partial | Independent project profiles; local compute only; remote adapters and phase override validation incomplete |
| A10 | Implemented local subset | Real Python script logs/status/cancel API, notebook records/import; worker UI actual execution; cell-kernel semantics incomplete |
| A11 | Partial | Restart marks jobs interrupted, T3 read reconciles actual sessions; checkpoint-capable remote resume not implemented |
| A12 | Incomplete | Artifact SHA256 verification works; model/preprocessor/LitServe lifecycle missing |
| A13 | Incomplete | Actual run/job monitoring records; inference UI/serving metric workflow missing |
| A14 | Partial | Local metadata/artifact and output Git selected-file commit/push verified; Drive missing |
| A15 | Partial | Artifact tamper/metadata backup checksum/restore checks; transfer retries/conflicts/retention missing |
| A16 | Incomplete | Target ownership/dispatch boundary fixture checked; native driver/setup/effective in-flight stop missing |
| A17 | Incomplete | Separate target kinds persisted; real guest/browser drivers and native actions NOT_RUN |
| A18 | Partial | Capability filtering and versioned skill records; evidence-based promotion/evaluation and harness routing missing |
| A19 | In progress | Start/Stop/Restart CMD + Node launcher written; combined clean install/port/restart/browser checks pending |
| A20 | In progress | Exact lockfile, machine data outside source, version/commit health; release/main/portable bundle checks pending |
| A21 | Partial actual integration | T3 provider run emits schema-validated AG-UI start/messages/finish; docs/evidence/t3-live-smoke.json |
| A22 | Incomplete | Persisted display replay/operation receipts; full tool lifecycle/frontend results/dropped stream/stop live tests missing |
| A23 | Worker implementation in progress | Reports native Sheets+Docs edit/save/reopen/formula/lifecycle checks passed; lead combined verification pending |
| A24 | Worker implementation in progress | Reports Facade agent edit/undo/redo/stale-write tests; human interleaving and integrated restart review pending |
| A25 | Worker implementation in progress | Reports actual official Windows DOCX/PDF outputs with version/hash; lead review/download pending |
| A26 | Worker implementation in progress | Reports native preview/rotation and failure/recovery fixture checks; lead combined verification pending |
| A27 | Partial qualification | Worker reports Thai/English embedded Tahoma and strict glyph failure; representative layout/fidelity findings pending |
| A28 | Worker implementation in progress | Windows qualified archive/hash acquisition/discovery; clean integrated no-code setup pending |
| A29 | Implemented catalog subset | product-catalog test verifies slow/error last-known preservation; development installed-T3 issue diagnosis not inferred |
| A30 | Partial boundary | Native snapshot versus ReportSpec/output separate; optional Exchange/LibreOffice absent and not claimed ready |

Run commands from repository root: `npm test`, `npm run check`, `npm run build`,
`node tests/live-t3-smoke.mjs` (explicit live engineering check). Build and launcher
checks are not marked passed before the combined tree is actually verified.
