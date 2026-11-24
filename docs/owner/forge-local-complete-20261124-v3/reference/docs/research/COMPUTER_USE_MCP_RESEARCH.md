# FORGE computer-use MCP research

Reviewed 2026-11-24. Scope: current Windows desktop, a separate desktop, and browser QA. Documentation/source audit only; no installs, account connections, control actions, benchmarks, or application edits. Default-branch sources were reviewed; implementation must pin tested releases.

Source correction: search-index copies of root `LICENSING.md` and `libs/cua/skills/cua-driver/WINDOWS.md` were stale (direct opens returned 404). This memo instead uses the directly reopened `legal/LICENSING.md`, current Driver runtime guide, and quickstart. It does not rely on the stale guide's exact Windows pipe command.

## Recommendation

**Use Cua Driver's existing MCP server for native desktop control and Microsoft Playwright MCP for browser QA.** Keep CursorTouch Windows-MCP as a Windows-specific alternative to qualify, not a second simultaneous controller on the same desktop. These are complementary roles; Playwright alone cannot satisfy the full desktop requirement.

FORGE should own target selection, connector setup, bot admission, stop/takeover UX, and evidence capture. Reuse the existing desktop MCP protocol instead of inventing a wrapper solely to translate an SDK into MCP. This remains a proposed integration, not working FORGE functionality.

## Top three reuse candidates

| Rank | Source owner / license | Actual interface and documented scope | Role and limit |
| --- | --- | --- | --- |
| **1 — desktop default** | **trycua / Cua Driver; MIT** [2][5] | Actual `cua-driver mcp` server; separate CLI and typed Python/TypeScript SDKs. Native apps and browser support across Windows, macOS, Linux. | Use one runtime per selected desktop. Windows requires an interactive user session. Background delivery varies by app/action; it does not guarantee undisturbed simultaneous human work. |
| **2 — Windows alternative** | **CursorTouch / Windows-MCP; MIT, independent of Microsoft** [9][10] | Actual `windows-mcp serve`; stdio, SSE, or Streamable HTTP. Windows 10/11, UI state/capture, native input, app/window control. | Useful Windows-focused candidate with built-in control-status/takeover UX. Its current README requires Python 3.14+. It controls a desktop; it does not provision a VM. |
| **3 — browser companion** | **Microsoft / Playwright MCP; Apache-2.0** [1][12] | Actual `@playwright/mcp`; stdio or HTTP MCP. Structured browser accessibility snapshots, browser actions, existing tabs through its extension, and isolated browser contexts. | Prefer for generated web-app/inference-UI testing. Its isolated context separates browser state; it is not a separate Windows desktop and cannot operate arbitrary native apps. |

## Cua Driver: verified integration boundary

The official integration guide explicitly lists **T3 Code: register Cua Driver in the harness that T3 Code launches** [3]. Thus native MCP reuse is documented, but a FORGE/T3 connector-management GUI still requires implementation and per-harness validation. The SDK package is not itself an MCP facade; the documented agent endpoint is the Driver executable [2].

On Windows/Linux, bare `cua-driver mcp` owns its runtime; `serve` with `mcp --socket` shares a daemon. Connections have owned sessions, but their labels are not credentials. Sessions share the desktop, and native actions are serialized [4]. This is not a task-level lease for a whole multi-step workflow.

Windows control requires a daemon in the interactive user session; an SSH process in Session 0 cannot see that desktop [4]. The standalone installer is documented as not requiring administrator access [6]. Successful service startup alone does not prove working GUI control.

The optional HTTP MCP listener is off by default and requires a bearer token [4]. FORGE must qualify transport and lifecycle. No Windows packaging or network deployment was tested here.

Background support must be checked per operation. The official action matrix lists Windows Electron/Tauri/native-control successes alongside unsupported keyboard, drag, and other paths. It explicitly marks some elevated-integrity coverage unproven [7]. Proposed FORGE behavior: show the target's actual capability and require the appropriate control mode before retrying a refused background action in foreground.

## Main Windows versus a separate desktop

| User-facing target | Proposed FORGE arrangement | What is established / outstanding |
| --- | --- | --- |
| **This Windows computer** | Driver in the owner's interactive session; selected apps/workspace; visible controller identity and Stop/Take over | Local Windows MCP path is documented. Packaging, app compatibility, lock/disconnect behavior, and user takeover need a real Windows acceptance pass. |
| **Separate desktop** | A distinct VM or remote interactive desktop with its own Driver/runtime, connection identity, and task lease | Running the controller inside that guest is the proposed composition. Provisioning, streaming/viewing, reset/snapshot, and Windows guest licensing are separate decisions; the Driver alone does not supply them. |
| **Browser test session** | Playwright with a per-run isolated context or distinct persistent profile | Browser isolation is documented. It must not be labeled “isolated desktop.” A persistent profile can only be used by one browser instance at a time [1]. |

Cua's MIT SDK can manage sandbox runtimes, but current sandbox documentation also describes the `cua-spacesd` data plane [13]. Do not assume selecting the MIT SDK makes every bundled guest/streaming component MIT. A minimal alternative is a separately provisioned guest containing the MIT Driver, reached through an authenticated connection; this architecture has not been exercised in FORGE.

## One controller and human takeover

FORGE needs one active **task-level control lease per desktop target**, above any driver's per-action serialization. Other bots queue or use another guest. Read-only observation may be shared when supported. Persistent bot identity, task/run identity, desktop identity, and transport-session identity remain separate.

Proposed Stop/Take over behavior: revoke admission first; invalidate queued actions and the old connection generation; request cancellation/session teardown; release held input; show when the user owns the target. Do not automatically resume after a short idle period without the FORGE workflow allowing it. A stopped task must not report that completed side effects were undone.

Windows-MCP documents `ControlStatus(release=true)`, a visible control indicator, a takeover hotkey, and an ownership gate. Its README explicitly says takeover is best-effort: an already-running external command may continue, and the gate is not a security boundary [9]. Do not inherit its idle reacquisition behavior as FORGE's product policy without making that choice explicit. Recent repository activity supports considering it for qualification, not a promise of long-term maintenance [11].

Cua's `standard` permission mode permits ordinary observation/input. Its documented `bounded` mode requires a capability manifest and limits tools/resources at launch [8]. FORGE should translate an approved task scope into connector constraints where supported; a session label or disabled button is not equivalent to enforcement. No claim is made that every harness exposes these settings or cancellation identically.

The current guide documents `cua-driver revoke --session <id>` and `cua-driver revoke --all`; the latter suspends runtime calls until restart [8]. These are existing integration seams for Stop. Their behavior with in-flight Windows actions still needs the acceptance test; do not claim undo or instantaneous process cancellation.

## License separation and minimum acceptance evidence

Cua Driver, its SDKs, and Lume are MIT. Cua Spaces apps, `cua-spacesd`, and streaming client/viewer components have separate FSL-1.1-MIT terms. Optional perception artifacts also have separate terms, including AGPL components; they are not required to choose the basic MIT Driver [5]. Reuse the exact components whose licenses were checked, not the entire Cua product under one assumed license.

Before advertising support, demonstrate a real native-app action plus observed postcondition on current Windows, the same task on a separate target without touching the main desktop, two bots queued on one target, and Stop/Take over preventing further queued input. Also verify stale-element recovery, disconnect/reconnect, image output in the chosen T3 harness, and failure reporting. Browser-only success does not satisfy the native desktop test.

## Primary sources

1. [Microsoft Playwright MCP README](https://github.com/microsoft/playwright-mcp) — browser scope, profiles, extension, HTTP MCP.
2. [Cua Driver README](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md) — actual MCP/CLI/SDK entrypoints.
3. [Cua: connect your agent](https://github.com/trycua/cua/blob/main/docs/content/docs/cua-driver/guides/connect-your-agent.mdx) — T3 and harness registration.
4. [Cua: how Driver works](https://github.com/trycua/cua/blob/main/docs/content/docs/cua-driver/concepts/how-cua-driver-works.mdx) — runtime/session ownership and HTTP endpoint.
5. [Current Cua licensing map](https://github.com/trycua/cua/blob/main/legal/LICENSING.md) and [repository license](https://github.com/trycua/cua/blob/main/LICENSE.md); earlier recorded source pin: `f7a7a2f1d7f0915f5d2e63c5164f42bd547de580`, `legal/LICENSING.md`.
6. [Current Cua quickstart](https://github.com/trycua/cua/blob/main/docs/content/docs/cua-driver/quickstart.mdx) — standalone installation; Windows runtime/session mechanics are in source 4.
7. [Cua action-support matrix](https://github.com/trycua/cua/blob/main/libs/cua-driver/docs/action-support.md) — documented successes and gaps.
8. [Cua permission modes and revocation](https://github.com/trycua/cua/blob/main/docs/content/docs/cua-driver/guides/permissions.mdx).
9. [Windows-MCP README](https://github.com/CursorTouch/Windows-MCP) — platforms, transports, ownership and takeover limits.
10. [Windows-MCP actual license](https://github.com/CursorTouch/Windows-MCP/blob/main/LICENSE.md) — MIT, copyright Jeomon George.
11. [CursorTouch repository activity](https://github.com/orgs/CursorTouch/repositories) — Windows-MCP listed updated 2026-11-22 at review.
12. [Playwright MCP actual license](https://github.com/microsoft/playwright-mcp/blob/main/LICENSE) — Apache-2.0.
13. [Cua sandbox README](https://github.com/trycua/cua/blob/main/libs/python/cua-sandbox/README.md) — SDK, runtime, and spacesd composition.
