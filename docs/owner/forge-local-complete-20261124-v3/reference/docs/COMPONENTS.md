# Component choices for the no-code workbench

Research and implementation snapshot: 24 November 2026.

**Scope of this older implementation map:** the table below describes the
exploratory standalone workbench. The owner subsequently chose actual T3 Code
reuse and refined the product to AI training/inference/deployment. The current
target architecture and connector recommendations are in
[the AI/MCP research](FORGE_AI_MCP_RESEARCH_TH.md). In particular, the original
inspired-by-T3 UI listed here is not the selected final GUI foundation.

This document distinguishes direct code reuse, original adaptations of design
patterns, existing adapters, and future integrations. A reference is not an
installed dependency or a claim that its full functionality ships in FORGE.

| Source | Selected component or pattern | What is in this change | Integration type |
|---|---|---|---|
| T3 Code | Project/thread/diff workflow; explicit execution ownership | Project and run workbench, local authenticated API, separate result views | Original implementation inspired by architecture and UX |
| Orca | Separate task attempts and truthful worker lifecycle; focused result review | Persisted attempt state, cancellation, isolated workspace, diff/artifact review | Original implementation; no Orca runtime |
| Paseo | Client–daemon split; declared capabilities | Browser client separated from local engine; provider readiness capabilities | Original implementation; its SDK/relay is not connected yet |
| Happy | Durable session/run state and explicit restart recovery | Persisted projects, runs and ordered events; interrupted runs need explicit resume | Original implementation; no Happy harness or phone client |
| Agent Orchestrator | Worker-only integration and worktree ownership | Existing AO Limited adapter retained; new native execution uses isolated workspaces | Existing adapter plus original workspace management; AO is not a selectable workbench executor yet |
| Anthropic single-agent-loop-kit | One coordinator, selective skills, bounded review/repair; before/after evaluation | Native worker task with selected skill instructions and separate read-only reviewer; four vendored evaluation scripts and result schema | Apache-2.0 utility reuse plus original Node implementation |
| Nous Research Hermes Agent | Metadata-first skills, availability filters and skill curation | On-demand instruction loading, capability-based harness choice, inactive evidence-backed skill proposals | Original adaptation; no automatic self-modification or learned optimizer |

## Source pins

- T3 Code: `pingdotgg/t3code`, release `v0.1.11`. [Overview](https://github.com/pingdotgg/t3code/blob/v0.1.11/README.md), [external MCP interface](https://github.com/pingdotgg/t3code/blob/v0.1.11/docs/user/outside-agents.md).
- Orca: `stablyai/orca`, release `v1.4.272`. [Orchestration model](https://github.com/stablyai/orca/blob/v1.4.272/docs/site/content/docs/cli/orchestration.mdx). Prior FORGE evaluation remains pinned separately at v1.4.204.
- Paseo: `getpaseo/paseo`, commit `e03fe0d8e7da367989a512ee82b9db6e07e06eec`, release `v0.17.4`. [SDK](https://paseo.sh/docs/sdk), [plugins](https://paseo.sh/docs/plugins).
- Happy: `slopus/happy`, commit `7b5683b70f60b4d4c719f403ae2f7487994edf8b`; current runtime documented separately at [How Happy Works](https://happy.engineering/how-it-works/).
- AO: current review at `86e46e5e13ce9b24e08de8cbfb779f462320971c`, release `v0.15.5`; existing FORGE adapter qualification remains `15e9ea971f1711ec8b50e157d6eb300db6cbe0d6`, v0.13.0. Repository moved from Untrivial-ai to OrchestratorInc; that is the same upstream project.
- Single agent loop kit: `anthropics/single-agent-loop-kit`, `c43796287b83bec847db923f07131d1cc8de750d`, Apache-2.0. Exact reused-file hashes are in `tools/evaluation/single-agent-loop-kit/UPSTREAM.json`.
- Hermes: `NousResearch/hermes-agent`, `a15b9710395aa1c4858fb6dd9e4c5014c5ced4e9`. [Adaptation details](HERMES_ADAPTATION.md).

## Runtime boundaries

The workbench owns project/run state and the user workflow. A native provider
owns its own login, model selection and inference. FORGE starts the selected
adapter with explicit working-directory and permission constraints. It does
not read, copy or consolidate provider credential files.

The first executable providers are Codex and a restricted, file-editing Claude
profile. Claude's restricted profile cannot run build or test commands; that
limitation is reported rather than counted as a passing test. A provider must
be detected, compatible and authenticated before a real run can start.

The adaptive registry can describe other names, but that alone never marks
them executable. Demo is excluded from automatic real-work selection. Model
quality, exact costs and quota balances remain unknown when not reported.

## What should be evaluated next

Use one bounded real project to compare the workbench with the existing
workflow: completion, owner interventions, duration, observed token usage and
repair attempts. Keep independent review and useful parallel workers when they
earn their separate context. The Anthropic kit does not prove that a single
agent is always better, and FORGE makes no such claim.

Remote control via Paseo/T3, AO worker execution in the new workbench, native
mobile apps and provider-independent sandboxing are separate integrations.
They are not silently implied by this component map.
