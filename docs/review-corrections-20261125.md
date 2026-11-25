# Native observation and acknowledgment corrections

Independent review of immutable `bc17a09` verified both prior P1 corrections and found three P2 defects. This checkpoint addresses all three:

- A failure of the canonical receipt callback after durable broker completion now reports `OUTCOME_UNKNOWN`. A failed commit acknowledgment is also uncertain. Pre-effect policy denial remains distinct. The original durable operation and receipt are retained; no retry is granted.
- Native `file_change` items retain their exact ID, status and path in Run tools and the conversation graph. They produce a named custom observation and state update, without a fabricated tool call or result.
- Preliminary empty tool inputs remain pending. Actual inputs complete the argument stream once. Later authoritative corrections use a custom replacement plus the existing message snapshot rather than appending a second JSON object.

Verification: 36 protocol/graph/broker/policy checks passed, including a real HTTP gateway with a coded postcommit callback failure; the production graph browser check passed. The production native application test passed in 109.8 seconds with four loopback requests, three observed operations/receipts, one edited file and one canonical run. Its new assertions check actual argument content and file-change visibility. The production build passed in 23.73 seconds. Counts overlap with broader suites.

The actual compiled T3/OpenCode callback-failure fixture passed with three requests/operation IDs/receipts, one edit, exact native `FORGE_BOUNDED_ACTION_OUTCOME_UNKNOWN`, zero retries, and 17 zero-effect native negatives. The separate scripted model protocol made 15 loopback requests; no external provider/account was called. [Sanitized evidence](evidence/guarded-postcommit-20261125.json).

Reproduce the injected postcommit case without altering the approved binary cache:

```powershell
node tools/guarded-runtime/stage-transport-fixture.mjs $PWD.Path "$env:TEMP/forge-ack-review-unique"
$env:FORGE_TRANSPORT_FIXTURE_MODE='owner-lost'
node "$env:TEMP/forge-ack-review-unique/transport-fixture.mjs" "$env:TEMP/forge-guarded-timeout30s-20261125" t3
```

Choose a new absolute output directory; staging refuses to replace an existing script. Reports are written there, and the binary cache is read-only. The same fixture supports `delay`, `drop`, `timeout` and `policy` modes. Its evidence is an engineering check, not runtime proof or external model-quality qualification.

The earlier serial full-suite run was stopped after these additional findings, before changing source. It is not reported as passed. A fresh independent correction review, complete merged-suite run, final media refresh and release checks remain required. Home UAT remains `NOT_RUN`.
