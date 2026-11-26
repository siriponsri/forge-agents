# Security and verification scope — 26 November 2026

This is a bounded developer review, not a penetration-test certificate or a
claim that all training/cloud/provider paths are secure or complete.

## Confirmed defect corrected

The ordinary POST router used an allowlist to require a browser session/CSRF.
Several effectful families were omitted: generic domain commands, jobs,
artifacts, storage, desktop, serving, reports and other legacy routes. Host and
Origin checks already existed, but these commands lacked the consistent Owner
browser boundary used by newer services.

All ordinary POST routes now check the real browser session before reading the
body and again after the await, before dispatch. The browser API helper attaches
the session token for all API writes; direct Office image uploads and launcher
shutdown use the same handshake. Private MCP and signed relay handlers retain
their separate authentication and cannot acquire run authority from this change.

Executable regression: `node --test tests/product-browser-command-auth.test.mjs`.
It exercises absent cookie/token, mismatched sessions and hostile Origin across
26 command routes, asserts no canonical mutation, and verifies authenticated
command/replay. Existing upload/report/job/restart/protocol tests use explicit
authenticated positive-path fixtures. Restore's partial-body race must remain
authenticated so it reaches the post-await restore gate.

An independent read-only review at `d557b8c` confirmed a P2 in older test clients:
their positive setup POSTs lacked CSRF. Those helpers are updated rather than
weakening production admission. The review found no concrete production P1/P2
bypass in the assigned auth/dependency scope; it did not certify the whole app.

## Threat model and residual limits

- A loopback browser session is not authentication against hostile processes
  already running as the same OS user. Such a process can request a local
  session. Never expose this app behind a public proxy as if it had remote-user auth.
- User-approved Python, notebook and model deserialization can execute code.
  Environment separation is dependency isolation, not a security sandbox.
- Package hashes establish exact bytes after resolution, not package safety.
  Inspect licenses/advisories and use trusted package sources; do not install
  arbitrary requirements obtained from model output without review.
- API keys remain purpose-scoped references in existing secret owners. No
  migration, dump, account login or credential transfer was performed.
- SSH uses strict host checking. The home host, cloud resources, managed Colab,
  network paths and actual account permissions remain unqualified.
- Public ZIPs are unsigned development source launchers. Website deployment,
  signing/notarization and macOS runtime parity are not implied.

## Checks recorded this round

- `npm audit --omit=dev --json`: zero known advisories returned for the current
  root lock on 26 Nov 2026. This does not cover Python candidates, native tools,
  future advisories or prove the absence of source vulnerabilities.
- Initial HTTP/job/upload/report/session/protocol set: 9/9 PASS.
- Python worker: 11 actual offline Windows CPython 3.12.10 tests PASS with tiny
  generated wheels; no scientific frameworks, model weights or cloud instances.
- Independent review: 10 Python unit tests and 7 focused Node tests PASS, all
  four MCP paths reject browser credentials, disposable launcher shutdown PASS.
- Final assembled checks and any later corrections belong in
  [round evidence](verification.json); do not infer their outcome from this list.

## Home security checks still required

Verify remote host keys, key permissions, credentials scope, resource ownership,
network allowlists, lifecycle timeout/reconcile/cleanup and artifact hashes.
Exercise denied/expired approvals, lost response, app restart, stop while running,
corrupt model, wrong task and restricted-data export. Actual patient data stays
outside public services/LLM tools under the supplied project governance.
