# Integrated controller review and corrections

## Research/lifecycle re-review of5a94b52

A new independent reviewer reproduced two P2 defects: shutdown returned before
an admitted Drive token exchange finished its vault write, and Research did not
settle native cancelled/rolled_back outcomes, retaining an unnecessary restore
fence. Lead now drains both ordinary admitted mutations and a separately tracked
restore lease before shutting down services/store; restore excludes its own lease
from its drain. Research uses the existing canonical terminal set for both normal
and stop reconciliation while preserving completed-to-validation behavior.

Actual regressions: production final-admission/shutdown20 PASS, including a real
Drive auth module with a gated, injected token response and counter-only vault,
and an admitted held metadata restore. Cancelled/rolled-back Git/SQLite/Context
bridge regressions2 PASS; actual deadline-during-setup1 PASS. Native execution
and qualification remain explicitly injected; no provider/account call occurred.
The deadline test now has a realistic admission window, bounded timeout and an
early-dispatch failure race so a slow Git check cannot leave an unreached gate
waiting forever. A third P2 finding showed that the production Research service
blocked the GUI's Recheck after PASSED/FAILED. Eligible evaluated trials now
reach the same independent checker; its exact completed, unstopped attempt and
receipt/ownership gates remain mandatory. A real service regression verifies
PASSED -> changed bytes -> FAILED -> restored correct bytes -> PASSED, with all
three prior evidence snapshots retained and one execution only. Stop prevents
further recheck. This regression1 PASS; independent fix recheck is pending.

Independent read-only review of `71fd27e`, 25 November2026. Reviewer actual runtime
`gpt-6.1-sol`, `xhigh`; disposable SQLite/HTTP/native-wire reproductions, no real
provider turn or account access. Review found five defects; it did not approve
the release. The lead applied these corrections afterward:

| Finding | Correction and executable evidence |
|---|---|
| Relay Stop/disabled binding during awaited setup still launched | `validateRelayDispatch` repeats current same-channel approval checks; only the exact run's known task revision/timestamp/run-ID insertion is normalized. Valid case launches once; Stop, disabled binding and task edits launch zero times. |
| Chat used bot/project/conversation authority captured before setup | Final synchronous canonical checks cover bot lifetime/content, workspace/profile revision, conversation visibility/binding, provider catalog and shared workspace admission. Async drift produces no launch. |
| Failed continued chat retained a new budget hold because its old thread existed | Canonical `inheritedThreadId` identifies the previous binding. Host no-dispatch proof applies only to the new terminal attempt without a provider-run identity or accounting observation. A lost send acknowledgment remains unknown/held. No billing finality is invented. |
| Old metadata erased proactive dedupe/consumed task/run accounting | `mergeProactiveSafety` preserves current effect/command/run history and invalidates grants in the restore transaction. Same event after restore retains its identity; consumed run budget prevents another start. |
| A body started before restore could complete and dispatch during it | Recheck lifecycle state after both browser and raw relay body reads. Track admitted commands, suspend controllers, drain admitted HTTP/mobile work and repeat busy checks before metadata swap. Office MCP participates in the admission barrier. |

`tests/product-final-admission.test.mjs` contains14 meaningful regressions with
real canonical services/SQLite and real HTTP split-body/drain races. Native and
provider effects are labelled injected counters; there are no paid model turns.

Validation:

- Related regression run including budgets, providers, relay, proactive and both
  previously failing browser fixtures: **116 PASS**, no failures/skips.
- After final restore barrier changes, `product-final-admission`,
  `product-missions-proactive` and `product-shutdown`: **19 PASS**, no failures.
- These subsets overlap. They are not summed into a unique coverage count.
- Broad run started at71fd27e: **565 entries,554 PASS,2 FAIL,9 SKIP**,573.8s.
  Memory fixture initial navigation exceeded12s; it now separates DOM readiness
  from bounded module startup. Secret fixture lacked the real request helper's
  session bootstrap; it now supplies and checks the CSRF contract. Both passed
  in the116 subset. The broad result remains a failed historical run until the
  complete merged suite is rerun.
- Graph browser captures now go into their disposable fixture directory; the
  test no longer modifies versioned review assets during routine verification.

Fresh independent re-review of14a8424 confirmed the focused14 checks and found
two remaining HTTP-barrier defects: mutating OAuth GET callbacks were outside
admission, and a normalized Office path could leak its first admission token
when the raw-path handler declined it. Lead added both credential callbacks to
the same lifecycle/drain barrier and releases a declined handler's token before
fallback routing. Actual new/previously admitted callback, normalized raw path,
restore and shutdown regression subset: **18 PASS**, no failures/skips. Review
did not find another concrete defect in the other four original corrections;
the final two corrections are lead-tested, not a new independent release pass.

Independent review of `10e536b` found one P2 accounting presentation defect:
Budget selected the last valid immutable receipt even when the latest canonical
native read was unavailable. The lead now gates current counters on canonical
qualification and matching receipt identity. Earlier receipts remain explicitly
historical evidence; rejected regression clears both current display cells.
The built production App and authenticated Budget endpoint reproduce 14 tokens,
then reject input 10 -> 9 and show two Unknown cells with recovery text. API
regression retains the historical 40-token receipt. Build and both targeted tests
PASS; the 375px rendered result was inspected. This correction is lead-tested.
The independent review's other 46 existing checks passed without another P0/P1
finding in its scoped Memory/usage/navigation/media review; it is not release
approval and does not cover subsequent Guarded activation.

Native all-action
automation qualification, authoritative billing ingestion, live provider/mobile
checks and **HOME_UAT_NOT_RUN** remain separate from these corrected defects.

## Bounded route activation review — 2026-11-25

Independent immutable review of `fc8867e` found two P1 corrections required.
First, a matching first-running native event could adopt an Owner-edited task
as its new snapshot. `60116c6` seals the exact reservation task and promotes it
only after comparing unchanged bytes. A blocked Owner task remains blocked;
current/action admission refuses and a late terminal preserves the Owner edit.
The regression uses real SQLite, production task.update, matching injected native
projection and zero counter-only effects. Guarded Stop also shares its private
in-flight promise to prevent duplicate interrupt requests.

Second, the old five-second private acknowledgment window could report denied
after a completed file edit under build contention. Native patch `b369790`
(merged `e2922cb`) uses 30 seconds without extending the canonical deadline or
retrying. Aborted/lost acknowledgments are outcome unknown; explicit policy403
remains denied. Exact new-image tests exercised delayed6500ms acknowledgments,
dropped/31-second acknowledgments after durable completion and no effect replay.
The original images were preserved. Production installer source/patch/image pins
are updated to the separately built and checked generation.

Lead production application/native recheck overlapped Vite build and passed in
112.9 seconds: four loopback protocol requests, three acknowledged receipts and
real edit, one canonical run, Context and AG-UI. Related installer/DPAPI/policy/
HTTP/shutdown subset **36 PASS**, no skips. These overlap earlier checks. The
new image's complete bridge subset and fresh independent correction review remain
pending. External account/model-quality checks and Home UAT remain NOT_RUN.
