# T3 Model Discovery and Missing GPT-6.2

Reviewed: **2026-11-24, UTC**. Research used the selected GitHub connector for issues, PRs, releases and source. This is a source-based diagnosis guide, not a diagnosis of the owner's Windows installation. No local T3 setting, account, cache, source code or remote repository was changed.

## 1. Finding and immediate recommendation

There is an **exactly matching upstream report**: [T3 issue #38609](https://github.com/pingdotgg/t3code/issues/38609) describes `gpt-6.2-sol` missing from the model picker and agent capability catalog while an old Codex model cache is served. Its reported environment is T3 **0.1.10**, Codex CLI **0.169.0**, macOS arm64, with ChatGPT sign-in. This supports investigating a stale catalog; it does not establish the cause on the owner's Windows machine.

The issue was **open** when checked. Its linked [fix PR #38889](https://github.com/pingdotgg/t3code/pull/38889) was also **open and not merged**, at head `c880f7c759266f3930849012814a4373fd66516f`. The proposed change allows a slow catalog refresh to finish and publish later. It is a proposal under review, not a released fix.

**Keep developing FORGE with the model that actually works, such as the owner's reported GPT-6.1 xhigh.** Confirm its exact provider model ID instead of inferring a Sol/Astra variant from that description. Use an available Astra for lead/review if accessible. Switch to 6.2 only after the selected provider instance lists or accepts the intended model and a small real request succeeds. FORGE completion must not depend on repairing the development application's model picker first.

## 2. What current source confirms

The inspected main revision was [`8a9e8d12a86fd5640a609ea277afba948a9470dd`](https://github.com/pingdotgg/t3code/commit/8a9e8d12a86fd5640a609ea277afba948a9470dd).

In [CodexProvider.ts at that revision](https://github.com/pingdotgg/t3code/blob/8a9e8d12a86fd5640a609ea277afba948a9470dd/apps/server/src/provider/CodexProvider.ts), native ChatGPT model discovery calls `model/list`, waits for `models_cache.json` to have a sufficiently recent timestamp, and bounds that wait with `CODEX_CATALOG_REFRESH_TIMEOUT_MS = 3_000`. If freshness does not arrive, it logs a warning and returns the earlier model list. The constant and fallback were still present in the inspected main code.

The [latest release endpoint](https://api.github.com/repos/pingdotgg/t3code/releases/latest) returned [v0.1.11](https://github.com/pingdotgg/t3code/releases/tag/v0.1.11), published November 20. The inspected issue/PR state and main code do **not** support saying that installing v0.1.11 fixes #38609. Recheck the actual release containing a merged fix before making that recommendation.

The proposed PR itself contains regression-test claims, but those were not run by this research task. Do not copy its branch into the owner's installed T3 application merely because the PR exists. For the T3-derived FORGE implementation, review an eventual compatible fix or implement a scoped, independently tested solution in FORGE's own source.

## 3. A second cause: different authentication/catalog routes

T3's [Codex setup guide](https://github.com/pingdotgg/t3code/blob/8a9e8d12a86fd5640a609ea277afba948a9470dd/docs/user/providers-codex.md) distinguishes managed **Connect with ChatGPT** from **Use an existing Codex login**. Running a CLI login does not replace the managed connection; a manually configured provider instance must be selected in the thread.

The current [CodexManagedProvider.ts](https://github.com/pingdotgg/t3code/blob/8a9e8d12a86fd5640a609ea277afba948a9470dd/apps/server/src/provider/Drivers/CodexManagedProvider.ts) replaces native model choices with the result of its account catalog request. [CodexChatGptModels.ts](https://github.com/pingdotgg/t3code/blob/8a9e8d12a86fd5640a609ea277afba948a9470dd/apps/server/src/provider/CodexChatGptModels.ts) reads the managed catalog and includes entries whose visibility is `list`; native entries can contribute capability metadata. Therefore an entry in a standalone CLI cache does not prove availability through managed subscription sharing.

Historical [issue #14321](https://github.com/pingdotgg/t3code/issues/14321) reports fewer choices through the managed route; it is closed as **not planned**, not as a verified fix for GPT-6.2. [Issue #16004](https://github.com/pingdotgg/t3code/issues/16004), about custom managed models appearing without reasoning controls, is closed as **duplicate**. These are related diagnostic distinctions, not evidence that the owner's problem is already solved.

The current [composer documentation](https://github.com/pingdotgg/t3code/blob/main/docs/user/composer.md) allows custom model entries where supported, but only supported provider options affect execution. A custom label cannot grant model access, alter account eligibility or guarantee reasoning controls. Avoid a blanket instruction to add `gpt-6.2-sol` and assume it works.

## 4. OpenAI prerequisite and its limits

OpenAI's [ChatGPT Work and Codex guide](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex), checked on the research date, requires Codex CLI **0.166.0 or later** for GPT-6.2 Astra/Sol and states that visibility depends on plan, seat and workspace settings.

Check the binary/runtime used by the **selected T3 provider**, not only whichever executable the terminal resolves. A managed connection may use a T3-managed installation. An adequate CLI version is necessary for that route but is not sufficient to rule out the cache issue: #38609 was reported with 0.169.0.

## 5. Practical diagnostic decision tree

1. **Identify the actual environment.** Record T3 desktop and server versions, local versus remote environment, selected provider instance, managed versus manual setup, actual Codex path/version, and account/workspace identity without secret values. Do not read tokens or copy credential files. A model name written in a prompt is not proof of the active model.
2. **If the actual CLI is older than the documented prerequisite**, update that installation through its supported installer/update mechanism and restart the affected provider/session. Preserve existing accounts and data. Do not update an unrelated global executable and assume T3 changed.
3. **If the runtime is current but the native catalog looks stale**, refresh the selected provider status, allow an in-flight refresh to complete and retry. Inspect relevant sanitized warnings and freshness timestamps if available. A refresh may help; it is not a guaranteed fix. Do not delete caches or credentials as the first response.
4. **If using managed ChatGPT**, compare the correct route and workspace before blaming cache staleness. An available existing CLI login can be added as a separate manually configured instance through the documented wizard, preserving the managed instance. Select that instance explicitly and test a tiny request. Do not move credentials between homes.
5. **If standalone native Codex accepts 6.2 but T3's corresponding native instance does not list it**, investigate catalog refresh and picker behavior. A supported custom-model entry is a conditional diagnostic/workaround, followed by an actual request and verification of supported options. It is not a universal managed-connection fix.
6. **If neither route lists or accepts 6.2**, inspect account/workspace entitlement and provider errors. Distinguish unavailable access, stale discovery and rejected execution. Continue FORGE implementation on the working model and record this as a development-environment issue.

The documented `T3CODE_CODEX_PROBE_TIMEOUT_MS` setting addresses the broader provider check deadline. The inspected native catalog freshness wait has its own three-second cap. Raising the general timeout must not be presented as a proven fix for #38609.

## 6. Nonblocking development configuration

Use the currently selectable GPT-6.1 xhigh as the immediate coding baseline, recording the exact model ID exposed by its provider. If Astra is already available in T3, let it own integration and review in a separate worktree. An Astra outside T3 can coordinate only through an explicitly available, authenticated orchestration connection or through reviewable files; this chat has not been connected to the owner's local T3 server.

GPT-6.2 Astra plus GPT-6.2 Sol remains an optional configuration after capability checks succeed. Record desired model, selected provider/model and observed execution separately. Do not silently substitute a model or claim a switch merely because the UI label changed. Discover actual reasoning-option IDs from the provider; do not reuse another provider's option names by assumption.

Keep one writer per worktree, a single integration owner and the full no-code localhost product scope. Neither a missing 6.2 picker entry nor the future home UAT activates CA-EWS or another prototype project.

## 7. Implications for FORGE's own model discovery

The following are proposed FORGE requirements, not existing T3 fields or AG-UI guarantees:

- Expose catalog source, observed freshness, last successful refresh and refresh errors independently from authentication and basic provider readiness.
- Retain a usable last-known catalog while clearly labelling it stale; missing from an old list must not be reported as proof that a model does not exist.
- Use bounded background refresh/retry and publish a late catalog only if its provider/account/settings generation is still current. Avoid duplicate probe storms.
- Keep model-catalog updates separate from usage observations so a late model result cannot overwrite newer quota data.
- Keep desired selection and effective execution visible, and require explicit policy for fallback.
- Add regression checks for a catalog arriving after the initial wait, refresh failure with cached data, account change while refreshing, custom-model options and cancellation. Tests must prove these failure modes rather than merely mirror the implementation.

These behaviors can flow through the planned FORGE harness/UI event bridge, with project/provider scope and truthful status. They do not grant access to an unavailable model or replace the underlying provider's authentication rules.
