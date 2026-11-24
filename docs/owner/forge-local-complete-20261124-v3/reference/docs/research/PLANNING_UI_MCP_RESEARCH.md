# FORGE planning UI and MCP research

Research date: 2026-11-24. Status: architecture recommendation, not an implemented integration. No application code, dependencies, or external accounts were changed for this research.

## 1. Product direction and recommendation

The confirmed direction is a T3 Code based, no-code AI coding workbench focused on AI training and inference/deployment. It needs to show a big-picture plan before starting, then track the work through a canvas, a board, and detailed task results. Persistent named bots and temporary helpers share FORGE's own rooms and task tracking in the first release. References to Miro and Jira describe the desired experience; they do not require those external products.

**Recommended foundation: React Flow for the structured plan canvas, T3's existing dnd-kit packages for the board, and T3's existing UI primitives, thread views, and artifact review panels.** The three views should use one original FORGE plan/task model. Users should not have to decide between JavaScript libraries or reconcile three trackers.

The recommendation is an engineering judgment based on the source evidence below. It is not a claim that the libraries already provide a training orchestrator, that FORGE has integrated them, or that runtime compatibility has been tested.

### One plan, three views

| View | User's question | Shared records it displays |
| --- | --- | --- |
| Plan canvas | What will happen, in which order, and why? | Phases, tasks, dependencies, responsible bots, resource choices, expected outputs |
| Board | What is waiting, running, blocked, or ready for me to review? | The same task IDs, status, owners, priorities, and blockers |
| Task detail | What happened, what did it produce, and what can I do next? | Attempts, T3 threads, notebook/job references, logs, artifacts, evaluation evidence, approvals |

Canvas coordinates are presentation state. They must not become a second execution graph. A board drag submits a validated task command; it does not prove that a training run succeeded or silently start a paid GPU job. Execution events and evidence determine actual completion.

## 2. Top three practical approaches

| Rank | Approach and actual reusable pieces | License evidence | Fit for FORGE | Integration limits |
| --- | --- | --- | --- | --- |
| **1 — recommended** | **Structured canvas + synchronized Kanban:** `@xyflow/react` (React Flow), T3's existing `@dnd-kit/core` / `@dnd-kit/sortable`, and T3 UI components | React Flow MIT; dnd-kit MIT; T3 MIT | Interactive phase/task nodes, dependency edges, status, selection, zoom, and custom React content fit a plan that later becomes executable work. Existing board primitives can share task records with the graph. | FORGE still owns task semantics, persistence, validation, scheduling, permissions, and synchronization. Layout is a separate concern; the advanced auto-layout example is Pro content, while basic layout examples are public. Keyboard movement and Thai announcements require deliberate implementation. |
| **2** | **Whiteboard + structured board:** embedded `@excalidraw/excalidraw`, plus the same task board/detail service | Excalidraw MIT | Strong for freeform brainstorming, explanations, notes, and annotations around a training plan. | Freeform shapes are not task records. FORGE must maintain explicit shape-to-task links and decide how edits become plan changes. The embeddable package does not include the hosted application's collaboration backend. Styling, assets, persistence, and collaboration are separate integration work. |
| **3 — smallest first slice** | **Board first + generated plan diagram:** T3's existing `MermaidDiagram.tsx` and dnd-kit | T3 MIT; the actual diagram renderer used by that component, **Pele**, is MIT | Reuses a working T3 diagram display path and delivers a readable overview with synchronized task details quickly. Useful if canvas editing is deferred. | This is a rendered diagram, not a draggable structured planning canvas. In the inspected component, diagram links, images, and zoom are disabled, and SVG output is sanitized. Changing the plan should use task/plan controls and regenerate the diagram. |

### Primary sources for the comparison

- React Flow [project documentation](https://reactflow.dev/), [MIT license](https://github.com/xyflow/xyflow/blob/main/LICENSE), [React package manifest](https://github.com/xyflow/xyflow/blob/main/packages/react/package.json), and [custom nodes](https://reactflow.dev/learn/customization/custom-nodes).
- React Flow [basic Dagre layout example](https://reactflow.dev/examples/layout/dagre) and [advanced auto-layout example](https://reactflow.dev/examples/layout/auto-layout). Do not assume subscription-gated example code is part of the freely available core source.
- dnd-kit [MIT license](https://github.com/clauderic/dnd-kit/blob/main/LICENSE), [sortable guide for the core/sortable API](https://github.com/dnd-kit/docs/blob/master/presets/sortable/README.md), and [accessibility guide](https://github.com/dnd-kit/docs/blob/master/guides/accessibility.md).
- Excalidraw [MIT license](https://github.com/excalidraw/excalidraw/blob/master/LICENSE), [package manifest](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/package.json), and [embedding FAQ](https://github.com/excalidraw/excalidraw/blob/master/dev-docs/docs/@excalidraw/excalidraw/faq.mdx).
- T3 [pinned diagram component](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/apps/web/src/components/chat/MermaidDiagram.tsx), and Pele [MIT license](https://github.com/obsidianmd/pele/blob/main/LICENSE).

### Why tldraw is not the default

The current tldraw SDK is source available and is not a permissive open-source SDK. Its default terms permit development use; production use requires an active qualifying license key. The official policy describes commercial licenses, a trial, and discretionary noncommercial hobby licensing. This is a material distinction while FORGE's commercial direction is undecided. Do not label current tldraw MIT or assume its repository visibility grants unrestricted production use.

Sources: [official licensing guide](https://tldraw.dev/community/license), [official licensing FAQ](https://tldraw.dev/community/faq), and [current repository license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md). The exact commercial terms would need checking again if tldraw were selected.

## 3. T3 reuse and version boundary

The inspected stable T3 baseline is **v0.1.11**, published 2026-11-20, pinned to **`59651c1761f6c63e9b6056839067066968e6a406`**. Some package manifests still contain 0.1.10, so the immutable commit is the useful source boundary. Other library links above describe the reviewed default-branch sources, not a proposed lockfile. Implementation must select and pin tested releases.

The pinned T3 workspace uses React 19. Its web app already declares `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0`, and `@dnd-kit/modifiers ^9.0.0`. React Flow's reviewed peer range accepts React 18 and later; Excalidraw's reviewed package manifest includes React 19. This is manifest-level compatibility only.

**Avoid mixing dnd-kit generations:** current dnd-kit documentation also covers the newer `@dnd-kit/react` API. T3's existing core/sortable packages use a different API. Reusing the installed family is the smaller first integration.

| T3 source seam | Reuse in FORGE |
| --- | --- |
| `apps/web/src/components/AppSidebarLayout.tsx`, `Sidebar.tsx` | Existing application shell, project navigation, and thread entry points |
| `ThreadRouteView.tsx`, `ChatView.tsx`, `chat/ThreadTimeline.tsx` | Open a task's actual coding conversation and evidence |
| `chat/ChatRightPanel.tsx`, `RightPanelTabs.tsx`, `chat/RightPanelSurfaceContent.tsx` | Host plan/task/artifact views within the existing panel model |
| `DiffPanel.tsx`, `DiffPanelShell.tsx`, `diffs/AnnotatableCodeView.tsx` | Review generated notebook-support code, inference UI, deployment changes, and fixes |
| `files/FileBrowserPanel.tsx`, `files/FilePreviewPanel.tsx` | Project artifacts; add specialized notebook or model artifact presentation separately |
| `chat/MermaidDiagram.tsx` | Existing safe generated-diagram display for chat or a lightweight initial plan view |
| `components/ui/*` | Existing dialog, form, tab, menu, and other visual primitives |

These component paths are relative to `apps/web/src/components/` except where a full prefix is shown. They are source reuse candidates, not claims that a stable public plugin API exists.

Suggested original FORGE additions are a `features/forge/planning/` UI module, typed plan/task contracts, and a server-side plan/task service. Preserve T3's provider adapters, event/orchestration boundary, thread lifecycle, checkpoints, and persistence. Do not replace its server with the exploratory workbench REST server. Do not add a second component that also tries to own the same provider turn.

Stable sources: [release v0.1.11](https://github.com/pingdotgg/t3code/releases/tag/v0.1.11), [workspace manifest](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/pnpm-workspace.yaml), [web manifest](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/apps/web/package.json), and [license](https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/LICENSE).

## 4. What MCP should mean in this product

MCP is the agent-facing connector boundary. It does not supply a planning canvas, a task database, or a universal approval interface.

The proposed FORGE plan/task service should back both the GUI's normal typed client operations and model-facing MCP tools. Illustrative original tools are `forge_plan_propose`, `forge_task_list`, `forge_task_update`, and `forge_artifact_attach`. These names are proposals, not existing tools. Both paths must use the same validation, identity, authorization, and durable state transitions.

Keep these concepts separate:

- **Harness adapter:** runs a coding agent and translates its session, approval, cancellation, and event protocol.
- **Model provider:** account, endpoint, model catalog, and billing identity.
- **Tool connector:** MCP server, credentials, discovered tools, transport, connection health, and capability changes.

Changing a model should not silently change a workspace, cloud account, or GPU resource authorization. A bot's selected skills and allowed connectors should be visible in simple terms; users should not edit MCP JSON to complete standard setup.

### T3 MCP host: what is and is not established

T3's official provider documentation puts provider-specific behavior at the adapter boundary. ACP integrations use the shared ACP path; other protocols implement `ProviderAdapterV2`. Capability reporting must describe actual supported behavior. T3 injects its authenticated thread-scoped MCP endpoint into supported agent sessions; this is not proof that it already provides a universal no-code manager for arbitrary external MCP servers.

The official environment-level MCP discussion describes proposed or fork implementations for shared server configuration and OAuth. Those discussion examples must not be presented as merged product capabilities. T3's user documentation also instructs users to restart the agent session after changing MCP servers, plugins, or skills.

The bounded audit did **not** establish end-to-end live tool-list refresh for Colab, shared OAuth handling for every harness, or consistent forwarding of image outputs and approval prompts across every adapter. Those are explicit first-slice integration checks, not accepted assumptions. New pinned-source retrieval became unavailable during this follow-up; the additional MCP observations therefore rely on current official documentation and clearly identified repository discussions, not a new complete source audit.

Source-access qualification: a parallel direct-open check returned 404 for `docs/internals/adding-a-provider.md` and `docs/orchestration-v2/orchestrator-mcp-server.md`, although search results exposed their content. Treat those two paths as indexed documentation pending revalidation against the selected commit. The [ACP provider guide](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-acp.md) was directly reachable. Do not turn indexed examples or discussion snippets into an unqualified claim about the shipped build.

Sources:

- [Adding a provider](https://github.com/pingdotgg/t3code/blob/main/docs/internals/adding-a-provider.md).
- [Provider constraints](https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md).
- [Orchestrator MCP documentation](https://github.com/pingdotgg/t3code/blob/main/docs/orchestration-v2/orchestrator-mcp-server.md).
- [Composer and session restart documentation](https://github.com/pingdotgg/t3code/blob/main/docs/user/composer.md).
- [Environment-level MCP discussion #14118](https://github.com/pingdotgg/t3code/discussions/14118), which is proposal/discussion evidence, not proof of shipped functionality.

### Dynamic discovery is a concrete compatibility gate

Notebook connectors can expose tools only after a browser or notebook session connects. A successful initial `tools/list` therefore does not prove the connector works for the full workflow.

The MCP protocol version matters: the 2025-06-18 schema allows `notifications/tools/list_changed` without a prior subscription. The 2026-07-28 specification requires a `subscriptions/listen` stream requesting `toolsListChanged: true` for change delivery. A client must follow the version actually negotiated with the server, then refresh its model-visible tool inventory. Merely finding a notification handler in a dependency is insufficient evidence.

Test the chosen harness and connector together for: connection before tools exist; tools appearing after the user connects; removal/reconnection; image and structured outputs; cancellation; approval/error presentation; and account isolation. If live refresh is unsupported, make reconnect/restart explicit in the GUI instead of showing the connector as fully ready.

Sources: [2025-06-18 notification schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/schema.mdx), [2026-07-28 tools specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx), and [official TypeScript SDK subscription guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/subscriptions.md).

## 5. Miro and Jira: optional external views

Neither service is required for the requested Miro/Kanban/Jira-like experience. Their official MCP endpoints can be useful optional connectors, but they are hosted product integrations rather than reusable OSS canvas/board components.

| Service | Verified current integration shape | Authentication and limits | Appropriate FORGE role |
| --- | --- | --- | --- |
| **Miro MCP** | `https://mcp.miro.com`; current tools include `canvas_create_from_svg`, `canvas_read_as_svg`, `canvas_update_from_svg`, `board_create_format`, and content search. The format tool supports formats including diagrams and Kanban. | OAuth 2.1 with existing user/team permissions. Official daily quotas: Free 100, Starter 500, Business 2,000, Enterprise 10,000 tool calls; all calls count. Enterprise administration can affect availability. | Export an approved plan, publish a visual snapshot, or maintain a deliberate outbound mirror for collaborators who already use Miro. |
| **Atlassian Rovo MCP / Jira** | Recommended endpoint `https://mcp.atlassian.com/v2/mcp`; supports Jira work-item operations. Current v2 offers tool discovery and `executeRead` / `executeWrite` / `executeDestructive`, with a flattened tool-list option for some clients. | OAuth 2.1 is the normal interactive path. API tokens/service accounts depend on organization settings, scopes, and tool availability. Ordinary single-product lookup/update and enriched cross-product tools have different usage treatment. | Optional Jira task links or an outbound issue mirror for a team that already manages work in Jira. |

### Current compatibility and licensing details

**Miro:** Recent official changes removed older `table_create`, `table_sync_rows`, and `prototype_*` tools in favor of the canvas/format tool set. Do not implement from old snippets without discovery. The current composer workflow asks clients to obtain its format guidance. Miro account access and service terms are separate from the licenses of React Flow or FORGE; using its MCP endpoint does not grant a self-hostable Miro editor.

Sources: [Miro MCP FAQ](https://developers.miro.com/docs/miro-mcp-server-frequently-asked-questions), [current tools](https://developers.miro.com/docs/miro-mcp-tools), [usage limits](https://developers.miro.com/docs/mcp-usage-and-daily-limits), and [tool-removal changelog](https://developers.miro.com/changelog/table-and-prototype-mcp-tools-removed).

**Atlassian:** Installing/connecting the MCP server and ordinary single-product operations are described as free in current usage guidance; enriched Teamwork Graph/context operations consume Rovo credits. Official support documentation announces pay-as-you-go billing taking effect **2026-12-03**, after this research date. Do not promise that every MCP call is free, and do not imply every Jira write consumes paid credits. The public `atlassian-mcp-server` repository is Apache-2.0 licensed, but its materials describe a cloud-hosted bridge; that does not make Jira Cloud or the hosted Rovo service a self-hostable OSS product.

Sources: [authentication](https://developer.atlassian.com/cloud/rovo-mcp/guides/authentication-and-authorization/), [supported tools](https://developer.atlassian.com/cloud/rovo-mcp/guides/supported-tools/), [getting started](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/), [Rovo licensing](https://www.atlassian.com/licensing/rovo), [usage guidance](https://www.atlassian.com/resources/usage), [usage limits and billing date](https://support.atlassian.com/rovo/docs/rovo-usage-limits/), [repository license](https://github.com/atlassian/atlassian-mcp-server/blob/main/LICENSE), and [repository README](https://github.com/atlassian/atlassian-mcp-server/blob/main/README.md).

### Synchronization policy recommendation

FORGE should remain the authoritative source for plan versions, task execution, and artifact evidence. Start with manual export or explicit outbound synchronization. Store external object IDs, revision information, last successful sync, and a visible error state. External unavailability must not stop the core local workflow.

If importing edits is added later, represent conflicting or execution-affecting changes as proposed plan revisions. Avoid two-way last-write-wins synchronization between a live GPU workflow and a whiteboard or issue tracker. An external item being marked done is not evidence that its associated model evaluation passed.

## 6. No-code workflow implications for AI training and deployment

The following is a proposed product flow for validation with the user, not an additional confirmed requirement:

1. **Describe the outcome.** The user selects an existing project or starts one, describes the model/application goal, and adds data or weights through understandable controls.
2. **Review the plan.** FORGE shows the phases, deliverables, proposed bots, compute target, dependencies, and open questions. Unknown time/cost estimates are labeled as unknown. A reviewed plan version becomes the execution reference.
3. **Follow one live workspace.** Canvas and board show the same phase/task state. Opening a task exposes its coding thread, notebook, run, or deployment output.
4. **Review concrete results.** Show actual notebook execution, evaluation results, checkpoints/weights, inference preview, endpoint checks, and monitoring evidence. Failures and blocked decisions remain visible.
5. **Revise and continue.** A change in goal, data, compute resource, or evaluation target creates an explicit revision instead of silently invalidating previous results.

Suitable top-level phases are data preparation, notebook/environment, training, evaluation, inference/deployment, and monitoring. They should collapse into a readable overview. Experiment repetitions and individual tool calls belong inside phase detail rather than overwhelming the canvas.

A task record should link to concrete IDs for its bot, T3 thread, execution attempt, compute resource, notebook/code revision, artifacts, and evaluation evidence where applicable. Monitoring must show real observations and their timestamps. Do not derive a fake percentage complete from the number of visible cards.

### Notebook and monitoring presentation boundary

Creating and running `.ipynb` files does not require embedding the entire JupyterLab application. This audit has not confirmed a rich notebook editor in T3. The smaller proposed first slice is a notebook artifact with useful metadata/output preview, execution state, and an **Open in Jupyter / Open in Colab** action for the configured environment. A richer embedded cell editor can be scoped separately after the create/run workflow works. Never present a plain JSON/code preview as if it were a complete interactive notebook interface.

Likewise, a connector returning MCP Apps content is not proof that the selected T3 host can render its interactive charts. W&B MCP Apps presentation remains an unverified host capability in this audit. Promise native FORGE charts only when real structured metric data is available, and use the provider's existing page as an explicit fallback. Confirm resource loading, rendering, account context, and host support before promising embedded third-party app views.

For accessibility, retain a keyboard-operable list/board path, localize drag announcements and ARIA instructions, and provide a usable mobile task detail view. A canvas is an optional way to understand the plan, not the only way to operate the product.

## 7. Minimum implementation slice after the remaining product decisions

Use one sample training-to-inference project and one verified compute connector before expanding the catalog. The slice should demonstrate a persisted proposed plan, consistent canvas/board/task detail, a named bot's real T3 thread, an actual notebook/job result, a reviewable inference UI or endpoint artifact, and honest failure/retry handling. Select one harness for that acceptance workflow and verify its MCP behavior end to end.

Miro and Jira synchronization, a full collaborative whiteboard, and universal provider/connector parity should remain separate optional work. None is needed to prove that a no-code user can understand the plan, run the approved workflow, and inspect real results.
