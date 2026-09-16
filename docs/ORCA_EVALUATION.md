# Orca execution-substrate evaluation

P11.5 evaluated [stablyai/orca](https://github.com/stablyai/orca) as an execution-plumbing candidate. It did not reopen P11, change canonical production, adopt Orca, or start P12.

## Immutable target

| Field | Value |
|---|---|
| Release | `v1.4.204` |
| Commit | `4f7baefc4f5c49181d54046763e083a4628662d8` |
| License | MIT |
| Windows artifact | `orca-windows-setup.exe` |
| Artifact SHA-256 | `87b877ec7472f664e5264dc5367a5f18f4484aea67a08b4eca76f9a65729206c` |

The published GitHub digest and downloaded artifact hash matched. The Windows executable was Authenticode-valid and reported product version 1.4.204.

## What maps well

Orca's structured CLI exposes durable runs, tasks, dependencies, dispatches, worker terminals, messages, decision gates, receipts and recovery. The closest safe mapping treats an Orca Run as an execution namespace—not as the FORGE plan—and maps a FORGE attempt to exactly one Orca dispatch.

Its worktree, terminal, browser and worker lifecycle surfaces are relevant to execution plumbing. Receipt and request-recovery semantics are particularly useful reference patterns.

## Authority conflict

The pinned documentation labels orchestration experimental and includes coordinator behavior, skill installation and worker instructions. Enabling it as another orchestrator beneath FORGE would create dual planning authority. A future adapter would have to suppress that layer and expose only bounded worker primitives.

## Provider boundary

Source inspection found Orca-managed Codex homes and account registration that can import authentication state into a managed home. Authentication-presence and quota paths can inspect `auth.json`. Those capabilities are legitimate for Orca's product, but they are outside the FORGE provider policy.

For FORGE-managed providers, all Orca account add/list/switch/remove/import, quota-auth inspection, base-URL mutation and real-home discovery would have to be hard-disabled. Separate runtime/user-data/CODEX_HOME boundaries per provider would be mandatory; source structure alone is not proof that this isolation works end to end.

## Windows qualification

The native CLI shim returned version `1.4.204` and a stable JSON status envelope. The official package was unpacked locally without a global install. Repeated clean-profile launches of the packaged app exited with Windows exception `0x80000003`, so terminal, worktree, orchestration and browser lifecycle tests could not safely proceed.

Source also shows that `orca serve` sets network exposure by default. `--no-pairing` disables the pairing offer but does not convert this path into a loopback-pinned headless contract. P11.5 therefore did not use `orca serve`.

A diagnostic invocation of the Electron executable with `--version` opened a desktop runtime instead of behaving as a read-only version command. It was stopped, all observed Orca processes and listeners were cleared, and no credential content was read. This incident is included in private P11.5 evidence and is an additional reason not to qualify the pin.

## Decision

```text
KEEP_AO_LIMITED
```

No Orca adapter is published. Orca is retained as a source-level reference candidate only. Re-evaluation requires all of the following:

1. a clean temporary-profile Windows runtime that starts and stops deterministically;
2. a documented loopback-pinned headless control surface;
3. provider-account management that can be disabled structurally;
4. two isolated fixture-provider runtimes with no cross-home discovery;
5. terminal, worktree, browser and process cleanup receipts without model calls;
6. a bounded experimental adapter that preserves FORGE authority and native fallback.

Current OWNER-approved architecture remains `ADOPT_AO_LIMITED`.
