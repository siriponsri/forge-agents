# Hermes-inspired adaptation in FORGE

FORGE uses an original, dependency-free Node module at `workbench/src/adaptive.mjs`
to select a small instruction bundle and an available execution adapter. It does
not install Hermes, read its configuration or authentication, copy its memory,
or import its runtime.

## Source and terminology

Research snapshot: 24 November 2026. Upstream repository:
https://github.com/NousResearch/hermes-agent

Inspected commit: `a15b9710395aa1c4858fb6dd9e4c5014c5ced4e9`.
Upstream license: MIT, Copyright (c) 2025 Nous Research.
No upstream code is copied into the adaptive module.

Hermes documents on-demand skills, progressive disclosure, platform/tool
availability filters, skill creation and editing, memory, and configurable
execution environments. FORGE's labels “adaptive skills” and “adaptive harness
selection” describe its own design. They are not claims that Hermes supplies an
algorithm with those names or a learned optimal coding-agent selector.

Primary references at the inspected commit:

- [Skills system](https://github.com/NousResearch/hermes-agent/blob/a15b9710395aa1c4858fb6dd9e4c5014c5ced4e9/website/docs/user-guide/features/skills.md)
- [Skill availability helpers](https://github.com/NousResearch/hermes-agent/blob/a15b9710395aa1c4858fb6dd9e4c5014c5ced4e9/agent/skill_utils.py)
- [Skill loading tools](https://github.com/NousResearch/hermes-agent/blob/a15b9710395aa1c4858fb6dd9e4c5014c5ced4e9/tools/skills_tool.py)
- [Memory and background review](https://github.com/NousResearch/hermes-agent/blob/a15b9710395aa1c4858fb6dd9e4c5014c5ced4e9/website/docs/user-guide/features/memory.md)
- [Terminal backend interface](https://github.com/NousResearch/hermes-agent/blob/a15b9710395aa1c4858fb6dd9e4c5014c5ced4e9/agent/terminal_env_provider.py)
- [Terminal backend registry](https://github.com/NousResearch/hermes-agent/blob/a15b9710395aa1c4858fb6dd9e4c5014c5ced4e9/agent/terminal_env_registry.py)
- [Architecture](https://github.com/NousResearch/hermes-agent/blob/a15b9710395aa1c4858fb6dd9e4c5014c5ced4e9/website/docs/developer-guide/architecture.md)
- [License](https://github.com/NousResearch/hermes-agent/blob/a15b9710395aa1c4858fb6dd9e4c5014c5ced4e9/LICENSE)

Hermes' terminal registry explicitly states that there is no active-provider
resolution: the backend is named by `TERMINAL_ENV` / `terminal.backend`.
Local, container and remote terminal environments are a separate choice from
the coding harness and from the model/provider route. FORGE preserves these
distinctions.

## Implemented module contract

`skillCatalog()` returns metadata without full instructions. `loadSkill(id)`
returns a declared local record. Unknown names and file-like paths cannot load
arbitrary files. No `.md` skill files or external skill registries are needed.

`planAdaptiveRun({ goal, templateId, requestedHarness, harnesses, platform,
requiredCapabilities, requestedSkillIds })` selects at most three local records.
Selection uses an explicit template and matching goal keywords; required
capabilities filter unavailable instructions. User-selected skill IDs take
precedence. This is deterministic rules-based selection, not semantic retrieval,
reinforcement learning or a model-quality estimate.

The harness registry is supplied by the caller. It must contain usable adapter
readiness, not just the presence of an executable. The canonical capabilities
are `writeIsolation`, `interruption`, `structuredOutput`, and `review`.
An omitted capability remains unsupported. Installation and authentication are
not inferred from a product name. This module never reads credentials.

Automatic selection follows the declared preference order Codex, Claude, AO,
Paseo, T3, Hermes among adapters marked available and capable. Listing an ID
does not implement an adapter. The caller must mark unsupported integrations
unavailable or `implemented: false`. Demo is excluded from real-work selection.
An unavailable explicitly requested harness produces `NEEDS_SETUP` and lists
alternatives; it is not silently replaced.

The returned `performanceEvidence` is `NOT_MEASURED`. There are no fabricated
success rates, costs, latency scores or claims that one model is superior.
Model selection remains with the configured provider/harness.

## Learning proposal boundary

`draftSkillImprovement()` requires a verified outcome, run identity, concrete
lesson and evidence references. A process merely reporting `COMPLETED` is not
accepted as verification. The result is an inactive `DRAFT`, marked
`NOT_EVALUATED`, with no file writes or automatic activation.

Hermes can write skills freely by default; its optional skill-write gate covers
the skill tool, while its separate lock mechanism has broader coverage. FORGE
does not adopt unrestricted self-modification. The small module exposes a draft
record only. A later review-and-evaluation feature can promote a candidate
without allowing it to modify runtime code or provider authentication.

## Verification and limits

Run `node --test workbench/tests/adaptive.test.mjs` for deterministic module
checks. These verify selection, explicit-choice preservation, missing
capabilities, platform restrictions, demo exclusion, bounded loading and draft
semantics. They do not measure model quality or prove a remote integration.

The module itself does not spawn agents, provide an OS sandbox, create
worktrees, install dependencies, select a terminal backend or manage secrets.
Those responsibilities remain with the executable FORGE adapters and runtime.
