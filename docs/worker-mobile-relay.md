# Mobile relay worker handoff — 2026-11-24

Actual execution: **gpt-6.1-sol, xhigh**, inherited from the T3 child runtime. Branch
`t3/mobile-relay-inbox-approval`. Only new `app/relay/**`, `app/relay-bridges/**`,
`tests/relay*.test.mjs`, and this note are owned here. No central contracts,
migrations, root manifests/lockfiles, frontend, main, legacy or protected payload
changes. The new manifests inside the native plugin directory are plugin loading
metadata only. `docs/MOBILE_RELAY.md` was absent in this isolated checkout; the
lead's assignment includes the authoritative confirmed Owner correction.

## Coverage and qualification

Implemented supplemental backend: scoped durable Inbox; explicit originating
channel approval/denial; immutable task/plan/profile/bot/dependency snapshot hash;
one durable start reservation; Stop; uncertain-start reconciliation; durable
report outbox, leased delivery and receipts. Normal T3 execution remains the
only turn owner. Inbound WORK/APPROVE never calls a provider or starts a run.

Implemented native bridges for **Telegram through either Nous Research Hermes
Agent or OpenClaw**. Other platforms are explicitly unsupported. Both bridges
consume native events, sign local bridge requests, poll reports, send through
the gateway's native transport, and return observed remote message IDs. No LLM
tool exposes signing, approval or receipt creation. No direct Hermes/OpenClaw
webhook payload is accepted as human identity.

Developer verification: `node --test tests/relay*.test.mjs` **24/24 PASS**.
Real SQLite plus existing domain commands are exercised; T3 execution is
injected. OpenClaw's official native-context shape and an actual loopback HTTP
fixture exercise signing, routing, sends and receipts. Hermes's Python fixture
uses a labelled SDK-shape `telegram.Message` class; **the actual gateway SDKs
are not installed and were not invoked**. No account, credential, external
message, cloud/provider run or prototype was created.

**IMPLEMENTATION_INCOMPLETE at product level until lead integrates the API,
review/Settings/Inbox UI, T3 admission shim and report lifecycle feed below.**
These are implementation gaps, not missing-credential excuses. Separately:
`LIVE_HERMES_NOT_RUN`, `LIVE_OPENCLAW_NOT_RUN`, `HOME_UAT_NOT_RUN`. Native plugin
loading against installed SDKs and live mobile sends need qualification.

## Exact lead-owned admission seam

Exports from `app/relay/index.mjs`:

```js
createRelayService({store, t3, resolveSecret, clock?})
validateRelayAdmission(state, startInput)
signBridgeBody(rawBody, machineSecret)
```

`store.read()` and `store.transaction(fn)` use the existing FORGE store. The
supplemental `state.relay` version 1 is initialized inside transactions; its
arrays are `bindings,inbox,events,nonces,outbox`. This worker does not change
the lead's schema/migrations. Do not export/import/restore relay approval,
binding, event, nonce, reservation or delivery authority as portable project
data. Machine recovery of the same database is distinct from project import.

`t3` must expose `relayContextVersion:1`, `startRun(input)`, and `stop(runId)`.
Do not advertise version 1 until this is actually wired:

1. In **every normal T3 startRun transaction before creating a run**, call
   `const relayContext = validateRelayAdmission(s,input)` unconditionally.
2. Persist returned non-null `relayContext` verbatim on the real run. The shim
   checks the durable reservation, enabled binding, approved native event,
   original project/task, Stop and current snapshot. No actor/approved boolean
   replaces it. Keep normal approved-plan, dependency, workspace, policy,
   ownership and selected-provider checks and `runtimeMode:'approval-required'`.
3. Include `relayContext` in operation replay fingerprint equality. For an
   already persisted run compare the original context; do not re-hash the task
   after the normal run reservation has changed task history. Never silently
   strip incoming relay context. Calls without context that reuse a relay
   reservation's operation ID must fail. A fresh generic operation ID also
   cannot bypass mobile approval on an already mobile-linked project/task:
   `RELAY_TASK_CHANNEL_REQUIRED`. Denied/stopped/terminal mobile linkage remains
   governed by its originating channel. A later attempt needs a new Inbox
   approval or an explicitly reviewed new task; this worker supplies no silent
   detach/bypass operation.
4. Preserve the task's single normal run/attempt mapping. Never call a direct
   harness/CLI or create an independent mobile execution owner.

Start body sent internally by relay:

```js
{
  operationId: 'relay-start:<inboxId>', projectId, taskId,
  relayContext: {
    version: 1, inboxId, reservationId, bindingId,
    approvalEventId, taskDigest
  }
}
```

Without this shim `dispatch` throws `RELAY_ADMISSION_SHIM_MISSING` **before**
making a reservation. Once reserved, any failed/lost/uncertain start becomes
`unknown`; even a definitive downstream rejection is not redispatched. Fix
and re-review new work explicitly rather than reusing the old reservation.
`reconcile` finds the real run by operation ID and exact saved relay context.
Unknown without an observed run remains unknown. No automatic restart retries.

## Trusted local service methods

| Method | Input / behavior |
|---|---|
| `state` | `{projectId}` → `{version,projectId,bindings,inbox,outbox,readiness}`; excludes vault refs in binding projection; project-scoped. Readiness distinguishes missing admission/secret resolver from supported native platforms and not-run qualification. |
| `readiness` | Async `{projectId}`: actually resolve/validate machine secrets without returning/logging values, return per-binding setup actions and last authenticated event/delivery receipt times. Does not contact an external account or infer an authenticated mobile user from a configured token. |
| `configure` | `{projectId,bindingId,expectedRevision,gateway,gatewayId,accountId,platform,chatId,threadId,ownerId,secretRef,enabled}`. `gateway` is `hermes` or `openclaw`; `platform` is `telegram`; `threadId` is string or explicit null; `secretRef` is `vault:...`; create revision is 0. A native route cannot be shared across projects. After the first Inbox item, binding identity/ref is immutable so historical reports cannot move to another recipient; disable always revokes new starts. Use a new binding and distinct native chat/topic for another project/route. |
| `linkTask` | `{projectId,inboxId,taskId,expectedRevision}`. Local Owner review links the Inbox request to an existing concrete task with an approved plan. Emits title, description, IDs, digest and 15-minute challenge to the original channel through outbox. Re-link rotates challenge. It does not create or approve a plan. |
| `bridge` | `{body:rawJSONString,signature:hexHmac}`; authenticated machine-only API described below. |
| `dispatch` | `{projectId,inboxId}`. After genuine native approval, reserve once, call normal T3 startRun once, retain actual run and attempt IDs. Repeated calls return existing reservation state without redispatch. |
| `reconcile` | `{projectId,inboxId}`. Observe already persisted T3 run/context; never launches. Retained Stop is delivered once to a reconciled matching run. |
| `report` | `{projectId,inboxId,runId,attemptId,eventId,kind,content}`; `kind` is `progress` or `final`. Trusted lifecycle feed only. Cross-project/run/attempt mismatches fail; final requires observed terminal status. Stable event ID plus fingerprint deduplicates identical reports and rejects mutation. |
| `recover` | **Startup only**, before new requests/dispatch. Marks crashed `dispatching`/`delivering` and cancellation submissions unknown. Do not call as periodic health check. |
| `close` | Stops admitting work. It does not stop T3 or claim remote cancellation. Lead controls service lifecycle. |

Lead work: mount private local service endpoints and authenticated local Owner
UI actions; provide machine vault resolution; configure binding from native
gateway observations, not mobile content; display Inbox → local review/link →
awaiting mobile approval → approved/running/unknown/review states; invoke
`dispatch` only for an already approved item; feed observed T3 progress/final
results through `report`, using stable lifecycle IDs. **Do not expose
configure/linkTask/report/recover/signing as model-callable tools or accept
`actor:{kind:'human'}` as their authorization.** Keep untrusted agent access
outside these trusted local Owner/control interfaces.

## Private bridge wire API

Suggested lead endpoint `POST /api/relay/bridge`. This worker starts no FORGE
listener. It must accept the exact UTF-8 raw body before JSON normalization and
the `X-Forge-Relay-Signature` header, then call `relay.bridge`. MAC is HMAC-SHA256
over `forge-mobile-relay-v1\n` followed by the **raw body bytes**, hex lowercase.
Five-minute clock tolerance; durable binding-scoped nonces; exact schema, no
unknown `actor`, `approved` or arbitrary project fields. Limit body to 64 KiB.

```js
{
  version: 1, kind: 'event' | 'poll' | 'receipt',
  bindingId, gatewayId, accountId,
  issuedAt: 1795490000000, // integer epoch milliseconds from native bridge
  nonce: '<fresh random UUID>',
  // event only:
  native: {platform:'telegram',chatId,threadId:null,ownerId,messageId,text}
  // receipt only:
  // receipt: {outboxId,lease,status:'delivered'|'unknown'|'rejected',remoteMessageId?}
}
```

`native` is built from native transport context by the installed bridge, never
parsed from a webhook caller's actor fields or from an LLM reply. All configured
gateway/account/platform/chat/thread/Owner coordinates must match. The stable
native message ID plus fingerprint deduplicates platform retries with fresh
wire nonces; changed content under the same ID is rejected. An exact nonce
replay returns `RELAY_REPLAY` rather than performing another effect.

Mobile commands are plain messages, **not the gateways' `/approve` commands**:

```text
FORGE WORK <requested work, may span lines>
FORGE APPROVE <inboxId> <challenge received after local review>
FORGE DENY <inboxId>
FORGE STOP <inboxId>
```

Event response `{inboxId,projectId,status,revision,duplicate?}`. Approval only
persists approval; it never invokes start itself. Another channel/account/Owner
cannot approve this Inbox item, even if it knows the challenge. Denial/Stop
revokes pending authority; Stop during uncertain dispatch is retained and
applied after a matching actual run appears. Cancellation stays a request
until normal T3 lifecycle confirms it; no claim of cancellation on timeout.

Poll returns `{delivery:null}` or `{delivery:{id,lease,content,correlation,route}}`.
Each claim is durable **before** sending. Its 60-second expired lease becomes
unknown on a subsequent poll, never pending; startup also recovers uncertain
claims. A late authenticated matching receipt can settle an unknown lease.
Reports carry project/task/inbox/run/attempt/status/event correlation in text
and data. An ack requires the exact binding, outbox ID, lease and observed
native message ID. Duplicate identical receipts are safe; conflicting ones fail.

**No remote exactly-once guarantee.** Neither native Telegram send path accepts
FORGE's report idempotency key. Gateway/platform internal retries, splitting
and response loss can cause uncertainty. This implementation never resends an
unknown claim and never promises that Telegram itself cannot duplicate a
physical send. If delivery is unknown, inspect native chat/receipt before
creating a deliberate new report; the GUI must disclose duplicate risk.

## Local setup/readiness actions (no provisioning performed)

1. Run the intermediary on the **same trusted machine** as FORGE, with an
   already configured native Telegram account and Owner chat. Use the pinned
   source versions below or re-qualify their contracts. Observe native numeric
   Owner/chat IDs and account context locally; do not infer from display names.
2. Register a machine-only random secret (32+ bytes) in FORGE's local vault.
   Save only its `vault:` ref in binding config. Inject the matching secret
   into the native gateway process using a dedicated `FORGE_RELAY_*` env name;
   save only that env **name** in plugin config. Both bridges remove the value
   from the environment on loading, so future child processes do not inherit it.
   Do not paste values into domain records, logs, prompts or portable exports.
3. Keep the signer/key inaccessible to agent tools. Native plugins and the
   local machine are a trusted computing boundary, **not an OS sandbox**.
   Removal from child environments alone does not isolate same-user arbitrary
   code or a compromised gateway. Use supervised tool policy and an isolated
   tool execution principal/sandbox; if agents can inspect gateway memory,
   vault or same-user startup secrets, this deployment is **NOT_READY** for
   human-identity assurance. Do not enable approval based only on possession
   of a webhook/API token. No extra model permission is granted by this relay.
4. Mount the lead's endpoint on loopback. Both shipped clients deliberately
   reject public hosts, DNS aliases, URL credentials and redirects. They do not
   create a tunnel, hosting account or public listener. A gateway on a different
   machine needs a separately reviewed private transport implementation; the
   current clients fail explicitly for that topology.
5. OpenClaw: link the new `app/relay-bridges/openclaw` plugin directory from its
   local CLI (`openclaw plugins install --link <directory> --force`), enable
   `forge-mobile-relay`, set its config and required conversation-hook grant,
   and inspect runtime registered `inbound_claim` plus service. A fresh gateway
   launch must inject the secret again; a hot plugin reload after the value was
   removed from its environment needs fresh vault injection or a process restart.
   Keep repository
   relative imports available; copying just `index.mjs` is insufficient. New
   plugin package/manifest metadata is supplied, no root dependency change.
6. Hermes: install the `hermes` directory files as native plugin
   `forge-mobile-relay` in the active profile's plugin directory. Put settings
   under `plugins.entries.forge-mobile-relay.settings.relay` with the schema
   below; restart/reload the native plugin. Native Telegram `Message` objects
   are required. Webhook, internal, upstream relay, bot, forwarded and edited
   events are rejected. The account ID is the observed Telegram **bot numeric
   ID**, checked via native SDK. The report poller attaches to the actual
   gateway after the first authenticated Owner relay message; after a cold
   restart send a fresh relay message to reattach it. Unload cancels its poller.
7. Keep disabled until admission shim, Owner review UI and secret isolation are
   ready. Readiness checks should show actionable missing shim/vault/native
   context; use a harmless Owner WORK, review/link, mobile APPROVE, supervised
   T3 run, Stop, and report receipt to qualify the complete integrated path.
   Plugin signing authenticates a native bridge process; live mobile receipt
   qualification is separate from a passing local fixture.

Shared plugin config (non-secret example; replace IDs with observed values):

```json
{
  "endpoint":"http://127.0.0.1:4317/api/relay/bridge",
  "bindingId":"owner-mobile",
  "gatewayId":"machine-native-gateway",
  "accountId":"<native account ID>",
  "platform":"telegram",
  "chatId":"<native chat ID>",
  "threadId":null,
  "ownerId":"<native human sender ID>",
  "secretEnv":"FORGE_RELAY_OWNER_MOBILE"
}
```

OpenClaw's account ID is its native hook `ctx.accountId`, not the bot numeric
ID convention used by Hermes. Native `ctx.senderId`, `ctx.conversationId`,
`ctx.messageId`, `ctx.channelId` and `event.threadId` must all be present and
match the configured contract. There is no fallback from an absent context
field to caller-provided body identity. Failed relay commands are consumed,
never forwarded to a model as an approval request. Plugin hooks are privileged;
installing arbitrary third-party hooks is outside this implementation's trust
boundary. See local error codes and pending/unknown outbox state for recovery.

## Primary source pins

`app/relay/PRIMARY_SOURCES.json` records exact URLs, revisions and SHA256 hashes
of the primary files read. No upstream implementation was copied. Both
repositories' inspected licenses are MIT.

- [Nous Research Hermes Agent](https://github.com/NousResearch/hermes-agent/tree/b9b36c933759e536e0f280f67c85f976488b5178): source version
  `b9b36c933759e536e0f280f67c85f976488b5178`; plugin hooks/context, native
  SessionSource/MessageEvent, Telegram adapter `Message`/`SendResult` contracts.
  The webhook and programmatic-integration docs were researched; driving a
  Hermes agent turn through those APIs was deliberately not used for human
  approval or FORGE execution ownership.
- [OpenClaw](https://github.com/openclaw/openclaw/tree/d31463cca15f5eb9aa242ac3d37dcdac32d5dad9): package version `2026.11.7`, source
  `d31463cca15f5eb9aa242ac3d37dcdac32d5dad9`; typed `inbound_claim`, native
  message context, service registration and channel outbound adapter contracts.
  Generic webhook triggering is insufficient human identity evidence and
  would introduce an intermediary model turn; this bridge uses native hooks.

No push, main merge, PR, public service, credential migration or external send
is authorized or performed by this worker.
