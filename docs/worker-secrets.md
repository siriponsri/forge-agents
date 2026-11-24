# Machine-only connection secrets — worker handoff

Date: 2026-11-24. Branch: `t3/implement-secret-manager`.
Runtime: inherited `gpt-6.1-sol`, xhigh. No nested delegation.

## Scope and implementation

New files only: `app/secrets/index.mjs`, `app/secrets/native-store.mjs`,
`app/web/src/SecretManager.jsx`, `tests/secrets*.test.mjs`, this handoff.
No manifests, shared domain schemas, integrations, main server, existing UI,
progress files or protected portable/legacy paths changed.

The async `createSecretService(options)` factory returns `status`, `list`, `set`,
`remove`, and **host-internal only** `resolveEnv` and `resolveRef` methods.
It does not read a vault, create a directory, start a process, contact a provider,
launch a server or access an existing credential during construction.

Default storage is `%LOCALAPPDATA%/FORGE/secrets/connections/connections.dpapi`.
Windows uses DPAPI `CurrentUser`, with a protected directory/file ACL permitting
the current account and SYSTEM. Both values and scope/revision/operation metadata
are encrypted. Encryption follows the repository's `app/storage/auth.mjs`
(imported by the Drive and MCP OAuth paths); access-only .NET ACL writes adapt
`app/office/agent-mcp.mjs`. These repository helpers are credited here and in source.
Neither the Drive vault nor MCP OAuth vault is read, migrated or changed.

Plaintext is held in process memory and native child stdin/stdout **pipes only**.
The child executable is the absolute Windows PowerShell path; scripts/argv are
fixed, shell execution is disabled, and the child receives only SystemRoot/WINDIR.
Native stderr is drained without forwarding it. No key values, raw request bodies,
secret-body SHA digests or process diagnostics enter canonical domain data,
events, receipts, public errors or config exports. Secret writes deliberately do
not use generic `domain.command` or `store.transaction`.

The encrypted snapshot uses a private random HMAC key for replay fingerprints;
that key and the fingerprints stay inside DPAPI encryption. Replay history stores
safe result metadata only. Writes use an OS-exclusive machine-local `write.lock`,
encrypted temp file, fsync and atomic replacement. A process crash leaving the
lock fails closed with `SECRET_BUSY`; close all FORGE instances before manually
removing **only** this vault's stale `write.lock`, then retry the same operation ID.
Never delete or recreate `connections.dpapi` as an automatic recovery action.
The encrypted store has a bounded size/operation history and reports capacity
errors rather than silently dropping replay history. Removal deletes the current
value and writes an encrypted tombstone; it does not claim physical disk erasure.

Directory ancestors reject links/junctions; credential files reject hard links.
The source root, supplied portable `dataDir`, and canonical project workspaces
cannot contain the machine vault. Root must supply its actual `dataDir`.

macOS Keychain entry is explicitly **IMPLEMENTATION_INCOMPLETE / unsupported**:
there is no plaintext-file fallback, insecure `/usr/bin/security -w <value>`
invocation, keyring probing or invented qualification. `status` gives an
actionable supported-Windows message. Explicitly selected legacy environment
references can still resolve internally on unsupported hosts.

## Factory options

```js
import { createSecretService, dispatchSecretRequest } from '../secrets/index.mjs';
const secrets = await createSecretService({ store, dataDir });
```

- `store?`: canonical store with `read()`; read only, validates exact project UUIDs
  and prevents vault placement beneath project workspaces. Supply in production.
- `machineDir?`: absolute machine-private directory, default above. Never take it
  from request bodies. Tests use disposable OS temp directories outside app state.
- `dataDir?`: actual canonical/portable application state directory.
- `platform?`: trusted host selection; the native adapter also checks the actual
  runtime platform, so spoofing `win32` cannot turn on DPAPI on another OS.
- `nativeStore?`, `env?`, `clock?`: trusted host/test fixtures only. Production uses
  the native DPAPI store, current host env, and ISO timestamp clock by default.
  `nativeStore` implements `{supported, status(), read(), transaction(fn)}`; `fn`
  returns `{next?,result}`. The in-memory test backend is never a production fallback.

## Exact HTTP setup boundary for the lead

All endpoints below are **POST**. Authenticate Owner + originating session + CSRF
before `dispatchSecretRequest(secrets, action, body)`. Apply bounded request parsing,
`Cache-Control: no-store` and JSON error encoding. Exclude request bodies and value
fingerprints from generic logging/audit/command/event pipelines. The dispatcher
allowlist is exactly `status`, `list`, `set`, `remove`; constructor/prototype and
plaintext resolver names are rejected. Do not mount runtime resolvers on HTTP or MCP.

| Endpoint | Request body | Response |
| --- | --- | --- |
| `/api/secrets/status` | `{projectId}` | `{supported,backend,status,message?,purposes,machineOnly:true,portable:false}` |
| `/api/secrets/list` | `{projectId,purpose?}` | `{secrets:[SafeSecret]}` |
| `/api/secrets/set` | `{projectId,purpose,name?,value,reference?,operationId,expectedRevision}` | `{secret:SafeSecret,replayed:boolean}` |
| `/api/secrets/remove` | `{projectId,purpose,reference,operationId,expectedRevision}` | `{removed:true,secret:SafeSecret,replayed:boolean}` |

`SafeSecret` has only:

```ts
{
  id: string;                // generated UUID
  reference: `vault:${string}`;
  projectId: string;         // exact canonical UUID
  purpose: 'provider' | 'mcp' | 'compute' | 'relay' | 'storage';
  name: string;              // selected/generated literal env name
  envName: string;           // same literal name for existing setup fields
  revision: number;          // increments on rotation/removal
  generation: number;        // machine-vault monotonic change counter
  updatedAt: string;         // ISO timestamp
}
```

New saves require `expectedRevision:0`, no reference, and a fresh UUID operation ID.
`name` matches `[A-Za-z_][A-Za-z0-9_]{0,127}`; omitting it generates
`FORGE_<PURPOSE>_<random hex>`. Value is a nonempty single line of at most 16 KiB;
NUL/CR/LF are rejected, without trimming otherwise significant bytes.
Rotation requires the saved `reference` and exact `revision`; name/scope cannot
be changed in place. Removal requires the same gates and returns no old value.
Duplicate project+purpose+name creation conflicts. The same literal name may be
saved for separate purposes/projects, which remain independent grants.

Exact replay returns its original safe metadata and `replayed:true`, even after a
later rotation/removal; it **does not undo** later changes. Reusing an operation ID
with a different body fails. Always fetch current list metadata before configuring
a new runtime from an old replay result.

Errors are static safe messages with `code` and `statusCode`. Relevant codes:
`SECRET_INPUT` (400), `SECRET_SCOPE` (403), `SECRET_NOT_FOUND` (404),
`SECRET_SETUP_REQUIRED`, `SECRET_REVISION_CONFLICT`, `SECRET_OPERATION_REUSE`,
`SECRET_STORAGE`, `SECRET_UNSUPPORTED`, `SECRET_LOCATION`, `SECRET_BUSY`,
`SECRET_CAPACITY` (409). No request values or filesystem paths appear in errors.

## Host-only runtime resolution and revision fence

```js
const value = await secrets.resolveEnv({
  projectId, name: selectedLiteralName, purpose: 'provider',
  expectedRevision: selectedMetadata.revision,
  generation: selectedMetadata.generation,
});
// Only an in-memory process environment passed at the actual execution boundary:
const selectedEnvironment = { [selectedLiteralName]: value };
```

`resolveRef({projectId,reference,purpose?,expectedRevision?,generation?})` accepts
an exact `vault:<UUID>` or an explicitly selected `env:<literal-name>` reference.
`resolveEnv({projectId,name,purpose?,expectedRevision?,generation?})` accepts a
literal selected name. Both return the plaintext **string**, for trusted host use
only. With an exact vault reference, missing/foreign project or purpose always
fails. A name with multiple active purposes requires an explicit purpose.
Pass purpose in every integration; never infer permission from bot identity.

Vault-backed values take precedence over an explicitly selected machine env name.
There is no fallback key-name discovery or implicit OPENAI/KOB/etc. default.
Missing/empty selections fail clearly. Removed scoped names and purpose mismatch
block fallback to stale machine env values. Corrupt/inaccessible native storage
also fails closed. An explicitly selected legacy env name may resolve only when no
matching vault grant/tombstone exists. `expectedRevision`/`generation` prohibit
env fallback and reject stale vault entries.

Lead integration remaining:

1. Instantiate once with canonical `store` and actual `dataDir`; mount the guarded
   setup endpoints as above and render the default component in project Settings.
2. Preserve env-name config fields in ProviderSetup/MCP/compute/relay forms. Supply
   the selected names to `resolveEnv` with the exact project/purpose. Map each
   selected name to its resolved value only at the trusted host runtime boundary.
   Direct vault references work through `resolveRef` for hosts that already have
   reference fields. Existing provider configuration exports keep only names/refs.
3. Root owns the last-moment connection+credential revision fence and invalidation
   of cached clients after successful set/remove. Capture safe metadata, resolve
   with its revision/generation, recheck connection/selection and credential
   generation immediately before dispatch; rotate/revoke existing clients as needed.
   Do not persist the returned value or pass it through provider-management RPC
   payloads/config files that persist environment settings. Do not add a resolve
   route just to inject from a browser/client process.
4. The existing dedicated MCP OAuth vault remains separate; these routes do not
   create OAuth grants or migrate OAuth tokens. Provider turns, connection checks,
   KOB catalog calls and Hermes requests remain explicitly initiated elsewhere.

## Component contract

Default export from `SecretManager.jsx` takes `{t,state,projectId,run,busy}` and an
optional `onSaved(SafeSecret)` callback. Existing Field/Badge/Empty and theme CSS
are reused. Thai/English copy, purpose select, name field, password-only input
(`autocomplete=off`), safe metadata list, explicit save/rotate/remove are implemented.
The secret is not stored in React state, local/session storage, query strings or
DOM text. The native password input and an in-memory pending-operation ref hold
it until success, explicit clearing or unmount. Successful writes clear the input
before refreshing the list. Uncertain writes retain the same operation ID for an
explicit retry; project switch clears the draft/pending operation. Automatic
requests only read localhost secret status/list, with no provider/account calls.

## Developer evidence and pending qualification

On Windows, Node v24.19.0, 2026-11-24:

```text
npm.cmd ci --ignore-scripts --no-audit --no-fund
node --test tests/secrets.test.mjs tests/secrets-native.test.mjs tests/secrets-ui.test.mjs
9 tests passed, 0 failed, 0 skipped (about 11 seconds)
npm.cmd run build
Vite production build passed (about 27 seconds)
```

The production build retains existing dependency `use client` and chunk-size
warnings. SecretManager is intentionally not mounted in the worker branch; its
actual import/JSX compilation is exercised by the Chromium component test.

Actual DPAPI test: disposable key written as encrypted binary, no plaintext value
or scope/name metadata on disk; resolved in a **fresh Node process** with durable
replay; actual ACL inspected as protected with only current SID/SYSTEM; deletion
survives restart; corrupted ciphertext refuses env fallback. Arg/env instrumentation
confirms no key or base64 key enters native process args/env. Junction ancestors
are rejected before target credential access. All disposable fixture directories
are checked against their intended OS temp prefix before cleanup.

Service tests: project/purpose isolation, exact selected environment fallback,
ambiguous-purpose rejection, empty/missing/config-extra validation, concurrent
revision conflict, replay/rotation/generation fences, credential-free deletion,
corrupt/empty stored value rejection, canonical state unchanged, HTTP resolver and
prototype exclusion, private placement/unsupported-platform behavior.

Actual Chromium: real component with real service and an injected labelled
in-memory fixture backend; save/rotate/remove, password clear/no rendered echo,
lost acknowledgement after commit and exact operation retry, TH/EN, labels on
mobile size, project switch clear, no automatic writes/provider routes.
This browser fixture does not qualify root's authentication or real provider wiring.

Worker implementation complete for Windows service/form scope. **Root integration
is pending** (existing paths intentionally untouched). macOS native key entry is
an explicit implementation gap. No live provider/KOB/MCP/compute/Hermes credentials
were used, so those end-to-end account checks are **NOT_RUN**. **HOME_UAT_NOT_RUN**.
No main push, PR, public service, new prototype or account migration performed.

Existing repository ignore rules match `*secret*`, including these source filenames.
Only the assigned source/test/handoff files are force-added for the commit;
ignore rules remain unchanged so actual machine secret state remains excluded.
