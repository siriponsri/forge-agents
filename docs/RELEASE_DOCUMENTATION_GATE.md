# Final documentation gate before main delivery

Owner instruction, 24 November 2026: update the documentation to the implemented
and verified product, then finish a professional README with clear, attractive
architecture and workflow diagrams. This is the **last work item before push**,
after integrated developer verification and release preparation.

The gate does not itself authorize a push or public deployment. The existing
release guide and active authorization still govern those actions.

Owner extension, 25 November 2026: the root README must be professional English,
informed by highly starred repositories, with actual function screenshots and
step-by-step usage GIFs. Reference research and the media/acceptance task are in
`docs/requirements/README_MEDIA_RELEASE_TASK.md`. All illustrated functions must
match verified delivered behavior; real recordings and asset provenance are
required. This remains the last documentation task before a complete release push.

Before marking this gate passed:

- Reconcile the acceptance matrix, current status, integration ledger, release
  report, setup instructions and home UAT with the final integrated commit.
- Rewrite README around the actual product, installation, core workflows,
  requirements, screenshots, architecture and evidence. Link detailed guides.
- Add repository-native diagrams (Mermaid and/or accessible SVG with text
  alternatives) explaining GUI → canonical services → supervised T3/adapters,
  Executor/Asst assistance, and evidence/QA/Owner acceptance.
- Label missing implementation, live checks not run, platform qualification and
  home UAT separately. Do not turn fixture checks into production claims.
- Verify links, diagram rendering/source, download destinations and commands.
  Include the exact tested revision and actual model/options in release evidence.

Owner override: stop work and push a **machine-transfer checkpoint** now. See
`docs/handoff/MACHINE_TRANSFER_20261124.md`. This is explicitly not the complete
product release. README now leads with actual checkpoint status and architecture;
the full final documentation gate remains pending for the resumed release work.

Current state: **PENDING_FINAL_INTEGRATED_VERIFICATION**. Do not complete this
gate from a worker-only test result or an intermediate implementation checkpoint.
