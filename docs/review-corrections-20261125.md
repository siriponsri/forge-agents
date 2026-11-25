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

## Snapshot interoperability follow-up

The fresh532353f review verified UNKNOWN/file-change behavior and found one remaining argument ordering defect: a preliminary snapshot containing `{}` was followed by an appending delta before END. The producer now projects incomplete placeholder arguments as the empty string, so a standard snapshot-plus-append consumer parses the actual JSON at END. Both the SQLite protocol test and actual production activation fold the complete event stream and assert parsing before any later repair snapshot. The production check passed in160.5 seconds (4 loopback requests,3 observations/receipts,1 edit,1 run); no external model was called. The bilingual graph browser check also passed after correcting the Thai file-change label.

The review also found the original transport staging command copied a byte-identical engineering driver into the cache. The helper now writes its driver only in its unique disposable fixture directory and uses the same compiled T3 graph's exported Effect/services with a deny-only private ProviderHost. The standalone actual native callback-loss reproduction passed, with no source/dependency installation or cache driver write. Earlier evidence is not reclassified as cache-read-only.
