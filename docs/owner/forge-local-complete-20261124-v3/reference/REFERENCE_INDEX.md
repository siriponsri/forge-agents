# Reference index

These are dated input snapshots for the local coding agent. Read the v3 handoff's core documents first, then open only the reference needed for the current implementation goal. None of these reports proves that a connector is installed, signed in or working in the owner's checkout.

**Latest owner correction supersedes the execution scope in these snapshots:** complete the general FORGE no-code localhost product now, verify it in development, deliver through main, then perform home UAT. Do not create or execute CA-EWS or any other prototype product in this round. Retain the reports as requirements and component research, not active prototype instructions.

## Original product requirements and research inputs

| File | Use |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Prior product context and operating model, subject to the complete-product scope correction and v3 additions |
| [REQUIREMENTS_INTERVIEW_TH.md](docs/REQUIREMENTS_INTERVIEW_TH.md) | Owner-confirmed decisions R01–R27, with superseded choices marked |
| [PROJECT_STORAGE_SETTINGS_TH.md](docs/PROJECT_STORAGE_SETTINGS_TH.md) | Drive + Windows + project Git and independently configurable Storage & Sync |
| [FORGE_AI_MCP_RESEARCH_TH.md](docs/FORGE_AI_MCP_RESEARCH_TH.md) | Integration catalog, product direction and links to primary sources |

## Open when implementing the relevant capability

| File | Goal it supports |
|---|---|
| [PLANNING_UI_MCP_RESEARCH.md](docs/research/PLANNING_UI_MCP_RESEARCH.md) | T3 reuse, plan canvas, board and shared task model |
| [PROVIDER_MCP_RESEARCH.md](docs/research/PROVIDER_MCP_RESEARCH.md) | Native coding harnesses, ACP, model APIs and provider-specific qualification |
| [COMPUTE_MCP_RESEARCH.md](docs/research/COMPUTE_MCP_RESEARCH.md) | Colab browser bridge versus hosted API, actual lifecycle contracts, other compute candidates |
| [TRAINING_MONITORING_MCP_RESEARCH.md](docs/research/TRAINING_MONITORING_MCP_RESEARCH.md) | Notebooks, experiments, artifacts, LitServe MCP and observability |
| [COMPUTER_USE_MCP_RESEARCH.md](docs/research/COMPUTER_USE_MCP_RESEARCH.md) | Native Windows, guest desktops, target ownership and browser companion |

Source URLs, versions, license findings and tool signatures in these reports are research snapshots. Recheck the specific source/dependency you integrate. Do not claim all candidates are shipped or re-run the full research program before beginning the first working slice.

## New v3 protocol, office/report and model-discovery research

| File | Implementation use |
|---|---|
| [AGUI_INTEGRATION_RESEARCH.md](research/AGUI_INTEGRATION_RESEARCH.md) | AG-UI 1.0 source/SDK pins, actual event and transport semantics, T3/MCP/domain boundaries |
| [UNIVER_INTEGRATION_RESEARCH.md](research/UNIVER_INTEGRATION_RESEARCH.md) | Embedded Sheets/Docs, public agent APIs, snapshots, optional Exchange terms and explicit report mappings |
| [REPORT_ENGINES_RESEARCH.md](research/REPORT_ENGINES_RESEARCH.md) | WordCraft/PdfCraft native CLI/MCP interfaces, current source versus stale docs, Windows/Thai and packaging requirements |
| [T3_MODEL_DISCOVERY_RESEARCH.md](research/T3_MODEL_DISCOVERY_RESEARCH.md) | Issue #38609 and open/unmerged PR #38889, actual provider routes and safe local diagnosis |

Use [specification 10](../10_AGUI_HARNESS_PROTOCOL.md) and [specification 11](../11_OFFICE_AND_REPORTS.md) as implementation requirements. Source inspection is not runtime qualification. The T3 report does not diagnose the owner's installed Windows application. Default to an actually runnable model; 6.2 is optional pending route verification.

[UPSTREAM_REFERENCE_PINS.json](../UPSTREAM_REFERENCE_PINS.json) records inspected commits/manifests and source URLs for the new research. These pins support traceability, not a demand to install development-branch packages or copy whole upstream applications.

## Deferred reference project — do not execute now

1. [CA_EWS_FORGE_PILOT_TH.md](docs/projects/CA_EWS_FORGE_PILOT_TH.md) applies the latest owner choices to the reference project.
2. [CA_EWS_FORGE_UX_REQUIREMENTS.md](docs/research/CA_EWS_FORGE_UX_REQUIREMENTS.md) maps that project into FORGE screens and acceptance.
3. [CARDIAC_ARREST_MASTER_PLAN.md](source/CARDIAC_ARREST_MASTER_PLAN.md) is the original owner-supplied plan, preserved unchanged.

The source master plan's SHA-256 is `494f1c2634a3d3529e3992e5188c4068acd4b8e1f31b48e7dc125dff665b2ec5`. For that future project, its original all-local/no-cloud training default was superseded by **Windows CPU + Colab Free**; storage was selected as **Drive + Windows + project Git**, with LitServe MCP requested. Keep these as optional project-specific settings. Do not instantiate the profile, acquire data or train models in this round.

The embedded execution prompt in the original plan is inactive reference content. Implement the complete FORGE product and its generic capabilities. A later owner instruction is needed to activate a prototype project; reaching G6 does not activate it automatically.

## Historical provenance included for traceability

- [COMPONENTS.md](docs/COMPONENTS.md): explicitly describes an exploratory standalone workbench. Its inspired-by-T3 implementation is superseded by the selected actual T3 foundation.
- [HERMES_ADAPTATION.md](docs/HERMES_ADAPTATION.md): contains useful source references plus an exploratory implementation description. The referenced `workbench/` module and tests are not included in this ZIP and may not exist in the owner's clone.

These two files are not current API contracts and do not override the handoff brief. Original content is preserved so source hashes remain useful. The root README/package files, standalone workbench implementation, legacy launcher documents and runtime payloads are intentionally not overlaid by this docs pack.

## Provenance files

[REFERENCE_MANIFEST.json](../REFERENCE_MANIFEST.json) records the original source filename, classification and hash of each copied reference. The package-level manifest records all delivered files. Neither manifest is a release attestation for the FORGE application.
