# FORGE v3 implementation architecture

Inspection base: efcd132, main, only one worktree; owner v3 docs untracked.
No applicable AGENTS.md existed in root or ancestors. Legacy package is P11.5,
Node >=20, AO test only; no T3-derived product or product lockfile was present.
Node on developer Windows: 24.19.0; npm 11.17.0; Bun absent.

```
Thai/English FORGE workbench ── commands/revisions ── durable domain service
       │ Univer Sheets/Docs                            │
       │ report source / artifacts                    ├── AG-UI projections
       └── pinned T3 GUI + matching runtime            ├── local jobs/storage/MCP
                └── sole provider turn owner          └── WordCraft / PdfCraft
```

T3 release v0.1.11 source pin: 59651c1761f6c63e9b6056839067066968e6a406,
MIT. Release npm launcher inspected; it retrieves a platform release with SHA256SUMS
and validates executable version. Product T3_HOME is isolated from development T3.
The matching GUI/runtime distribution is used together rather than mixing server
contracts across main/release. Source/API integration evidence must be qualified.

Lead model: codex / gpt-6.1-sol / reasoningEffort=xhigh, confirmed by T3 capabilities
and this successful running thread. Catalog advertises 6.2; no execution claim is
made for it. Worker model stays on this known route.

Initial gaps: all A01–A30 product criteria require new implementation/qualification;
legacy P11.5 evidence is not evidence for v3. Work: shared persistent contracts;
GUI+Univer; report adapters; T3/AG-UI; local notebook/artifacts/connections/storage;
desktop/adaptation; startup and integrated acceptance. G1 is not a release endpoint.

Protected legacy: bootstrap payload and package manifest, runtime, AO adapter and
contracts. No edits planned there. No prototype creation, cloud purchase, credential
migration or publication. Main is advanced only after required implementation and
verification; this assignment prepares release but does not delegate push.
