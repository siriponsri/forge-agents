# Compute and notebook MCP research for FORGE

Research snapshot: **2026-11-24 UTC**. This document records source inspection and a proposed integration design. It does not report an installed connector, a successful cloud login, a provisioned GPU, or a completed training/inference run. No account, paid resource, model, or remote notebook was accessed during this audit.

## Decision

FORGE can reuse existing MCP servers for most of the requested compute workflow. **Compute, notebook, serving, and MCP connections remain selectable per project.** The owner's current reference project uses the main Windows machine for public-data preparation and CPU checks, **Google Colab for training**, and a requested **LitServe serving/MCP integration**. This supersedes Runpod as that project's selected training location; it does not remove Runpod or other backends from FORGE's catalog, and it is not permission to provision or execute the reference project.

Google now documents **two distinct official Colab integrations**: a hosted runtime-management MCP at `https://colaboratory.googleapis.com/mcp`, and the existing `googlecolab/colab-mcp` browser notebook bridge. The hosted service is a candidate for repeatable training jobs; the bridge serves visible notebook editing and execution. Account eligibility, authentication, exact harness compatibility, and real execution remain untested. For other projects, official Runpod MCP, Datalayer's Jupyter MCP on an owner server, and narrowly configured SSH remain reusable choices. Vast has a verified first-party SDK, CLI, and agent skills; a small FORGE MCP wrapper over that SDK remains a proposal. [Colab remote MCP][colab-remote-mcp] [Colab browser bridge][colab-readme]

**Owner tier/storage update:** the reference project currently uses **Colab Free** and the owner selected **Google Drive + local Windows + a Git repository** together. Begin from current compute without making an upgrade a prerequisite; this is not a permanent free-only product restriction. Propose qualifying the official browser-notebook path first, while checking hosted API enablement/auth/eligibility separately. Save completed experiment artifacts promptly, use checkpoint resume only where the model supports it, and wait or use an explicitly configured compatible fallback when resources are unavailable. GPU type, session duration and uninterrupted execution are not guaranteed. Propose Drive for checkpoints/model bundles, Windows for working/inference copies and the project's Git for source/notebooks/config/manifests. These mappings are editable through per-project Settings; only concrete account/folder/path/remote bindings and retention remain to be set up. See [storage settings](../PROJECT_STORAGE_SETTINGS_TH.md). [Colab FAQ](https://research.google.com/colaboratory/faq.html)

MCP provides an agent-facing interface. FORGE still needs its own run records, resource ownership, spending policy, cancellation, artifact retention, and connection UI. These are product responsibilities that the inspected servers do not collectively solve.

| Target | Reuse choice | Provenance and license | Connection | Main limitation |
| --- | --- | --- | --- | --- |
| Owner GPU server | Jupyter MCP plus narrowly configured SSH | Datalayer Jupyter MCP: BSD-3-Clause; n0madic SSH MCP: MIT | Local stdio, or authenticated HTTP; SSH to the owner's machine | Executing code is not a durable training scheduler |
| Google Colab runtime jobs | Official Colab API MCP | Google-managed service; no OSS server redistribution license inferred | Authenticated remote HTTPS MCP | Eligibility, OAuth setup, quota, and ephemeral runtime lifecycle must be checked; no guaranteed GPU or permanent server |
| Google Colab notebook editing | `googlecolab/colab-mcp` | Google-owned, Apache-2.0 | Local stdio bridge to an open Colab browser session | Dynamic tools require a compatible client and live browser connection |
| Runpod Pods / Serverless | `runpod/runpod-mcp` | Runpod-owned, Apache-2.0 | Hosted Streamable HTTP/OAuth or local stdio/API key | Very broad account capabilities; paid creation is not necessarily marked destructive |
| Vast.ai | Official `vastai` SDK/CLI behind a small FORGE adapter | Vast-owned, MIT | Bearer-authenticated API, SSH/Jupyter for workload execution | FORGE wrapper is proposed, not already implemented |
| Colab Enterprise | Separate optional GCP execution adapter | Google-managed API/product | IAM, runtime templates, notebook execution API | Different product, billing, quotas, and auth from ordinary Colab MCP |

Primary evidence: [Colab API MCP][colab-remote-mcp], [Colab README][colab-readme], [Runpod README][runpod-readme], [Jupyter README][jupyter-readme], [SSH README][ssh-readme], [Vast SDK/CLI README][vast-readme], [Colab Enterprise notebook execution][colab-enterprise].

## 1. Source and license inventory

These are inspected commits, not a promise that every package release maps exactly to the checked commit. Pin source and package artifacts separately when packaging FORGE. A license statement in package metadata is recorded as such and is not treated as a verified redistribution bundle.

| Repository | Inspected commit | Version evidence | License evidence |
| --- | --- | --- | --- |
| `runpod/runpod-mcp` | `6f1cb5729bd1d5dc835f7f80b18066d40f400978` | Root package `@runpod/mcp-server` 5.0.0; commit 2026-11-23 | Root Apache-2.0. The separate TypeScript API SDK has its own MIT license |
| `googlecolab/colab-mcp` | `b9ab3899e0f1fa493390b1fd6d54aa2e464ecdf1` | `pyproject.toml` 1.0.1; commit 2026-04-01 | Apache-2.0 |
| Colab hosted API MCP | Managed endpoint; no source commit claimed | Official reference updated 2026-11-20; inspected 2026-11-24 | Service/API terms apply; do not assign the browser bridge's Apache license to this hosted service |
| `googlecolab/google-colab-cli` | `33eacf1116968ef4e053b15f23cddd54d5288d02` | Inspected source commit 2026-11-24; release artifact not selected | Apache-2.0; README explicitly supports Linux/macOS, not Windows |
| `datalayer/jupyter-mcp-server` | `cdf49eb7ced881553a32ea332882a0744ab0f62a` | `__version__.py` 2.2.6; commit 2026-11-21 | BSD-3-Clause |
| `n0madic/ssh-mcp` | `abd195efc633d6b61891be00b28c1e07c2e60098` | Inspected source commit 2026-08-17; release artifact not selected | MIT |
| `vast-ai/vast-cli` | `4ee6a0adbe8cc4df519f8f9fc4e25b1ce370589b` | Dynamic Git-derived package version; commit 2026-11-23 | MIT |
| `vast-ai/vast-codex-plugin` | `3ae27d8be8649a0913105f67c7c8dced3ee3ec4b` | Agent skill/plugin source; commit 2026-06-16 | MIT |
| `vast-ai/docs` | `138c1ddd5cfe5761c6391075c1fd0b6c517e059d` | Current OpenAPI source, commit 2026-11-23 | OpenAPI names Vast terms; do not assume SDK MIT covers the service or all documentation |
| `nikitatsym/vastai-mcp` | `813c777e8c6229d48fbc1b6b3e5f605c5c8fa3b3` | Package metadata 1.0.0; commit 2026-10-10 | Metadata declares MIT, but no root LICENSE was present in the inspected root listing |
| `jrmdev/ssh-mcp` | `2f03597c7aa021e87872248abbba20dc044eddfb` | v0.1.4 / commit 2026-11-16 | No root LICENSE or Cargo license field found in the inspected source; redistribution clearance unresolved |

Source links: [Runpod package][runpod-package] / [license][runpod-license] / [SDK license][runpod-sdk-license]; [Colab bridge package][colab-package] / [license][colab-license]; [Colab remote MCP][colab-remote-mcp]; [Colab CLI README][colab-cli-readme] / [license][colab-cli-license]; [Jupyter version][jupyter-version] / [license][jupyter-license]; [SSH license][ssh-license]; [Vast package][vast-package] / [license][vast-license]; [Vast plugin][vast-plugin] / [license][vast-plugin-license]; [Vast OpenAPI][vast-openapi]; [community Vast metadata][community-vast-package]; [jrmdev Cargo manifest][jrm-cargo].

### Packaging consequences

The inspected Colab **browser bridge** requires Python **3.13+**, FastMCP **2.14.5**, and MCP SDK **1.20+**. These are not dependencies of connecting directly to Google's hosted MCP endpoint. The inspected Datalayer package requires Python **3.10+**, MCP SDK **2.x**, Jupyter collaboration components, and several sandbox/reactor dependencies. Runpod MCP requires Node **20+**. Vast's actual package manifest requires Python **3.10+**, although a skill header still says 3.9+. Use separate managed connector environments rather than merging all Python dependencies into one installation. These dependencies describe the current sources, not an installer that FORGE has already delivered. [Colab dependencies][colab-package] [Jupyter dependencies][jupyter-package] [Runpod engines][runpod-package] [Vast package][vast-package]

## 2. Owner SSH GPU server and Jupyter

### What exists

Jupyter Server already exposes file/notebook CRUD, kernel/session management, and WebSocket channels for execution. Its default token authentication can be used through an SSH tunnel to an owner-controlled server. Connecting to an existing server does not require renting a cloud instance. Notebook execution uses the server user's permissions; a notebook is not an independent permission boundary. [Jupyter REST API][jupyter-api] [Jupyter authentication][jupyter-security]

`n0madic/ssh-mcp` is a useful **community** adapter candidate, not an official OpenSSH MCP. Its inspected surface includes `ssh_connect`, `ssh_execute`, `ssh_disconnect`, `ssh_list_sessions`, `ssh_upload`, `ssh_download`, `ssh_edit_file`, and `ssh_read_file`. PTY and port-forwarding tools are separately enabled. Its server source exposes tool annotations, but those annotations do not replace FORGE's own assessment of local and remote effects. For example, downloading a file writes locally even if a server considers it read-only in relation to the remote machine. [SSH README][ssh-readme] [SSH tool registration][ssh-server]

Relevant defaults are host-key verification enabled, sudo disabled, stdio enabled, and a 60-second command timeout. HTTP is localhost-only with an optional bearer token whose default is empty. Timeout handling sends SIGTERM, allows a grace period, and escalates to SIGKILL. The example Claude configuration disables host-key checking, so FORGE should use the documented verified-host default instead of copying that example. [SSH options and execution behavior][ssh-readme]

### Recommended FORGE integration — proposal

Use an owner-selected SSH host profile and OS-managed key/agent reference. Verify the known host before execution. Start with stdio, bounded output, a workspace directory, a named host allowlist, and only the tools needed by the current task. Enable a local Jupyter tunnel when needed. Do not send raw private keys to the model or assume that a command regex makes arbitrary remote code sandboxed.

For long training, submit a remote job that has a stable ID, logs, an exit record, checkpoint paths, and a cancellation operation. A systemd service, an existing scheduler, or an explicitly installed small worker can supply this; the final choice depends on the owner's server. A long SSH/MCP call alone does not provide reconnection or durable state. A timeout, a dropped SSH session, and actual process termination must remain separate run states.

`jrmdev/ssh-mcp` is an alternative with OpenSSH configuration, SFTP, async command jobs, and cancellation. Its documentation describes job output retained in the local server process. The unresolved license bundle prevents recommending that FORGE vendor it now, regardless of its functional appeal. [jrmdev README][jrm-readme] [manifest][jrm-cargo]

## 3. Datalayer Jupyter MCP

### Verified capabilities

This server is maintained by Datalayer and can connect to the owner's Jupyter/JupyterHub. It is not a Project Jupyter-owned MCP and does not require buying Datalayer hosting. It supports stdio and Streamable HTTP, with an optional Jupyter server extension. Document storage and execution can be configured independently through document-provider and sandbox settings. [Jupyter MCP README][jupyter-readme]

The inspected server implements these useful groups:

| Group | Representative current tools | Effect |
| --- | --- | --- |
| Discover and inspect | `list_files`, `list_kernels`, `list_notebooks`, `read_notebook`, `read_cell` | Read server/notebook state |
| Select session | `use_notebook`, `use_notebook_by_name`, `unuse_notebook`, `connect_to_jupyter` | Change connection/session context |
| Edit notebook | `insert_cell`, `overwrite_cell_source`, `edit_cell_source`, `delete_cell`, `move_cell`, `clear_cell_output` | Modify notebook content |
| Execute | `execute_cell`, `insert_execute_code_cell`, `execute_code` | Run code with kernel permissions |
| Control kernel | `restart_notebook` | Interrupt/reset current computation and state |

The source also integrates optional JupyterLab tools and a sandbox extension with launch/list/use/terminate operations. Those optional providers have their own credentials and resource effects. Their presence in a dependency or README does not establish that FORGE can already provision every advertised backend. [Tool definitions and extensions][jupyter-server]

### Practical boundary

Use this connector for notebook creation, execution, inspection, and user-visible editing. Keep cloud account credentials in FORGE's control plane, outside notebook kernels unless the workload specifically needs scoped credentials. Otherwise a normal code cell could bypass a separate cloud-tool spending policy.

Current configuration uses `--document-provider` and sandbox variants such as `jupyter-server`. Older examples that use an undifferentiated provider argument or an old variant name should not be copied without version matching. Real-time collaboration also requires compatible Jupyter collaboration components. The hosted Datalayer service and its durability claims are separate from a locally started OSS MCP process. [Current README][jupyter-readme] [dependencies][jupyter-package]

FORGE still needs durable training-job state and a versioned artifact manifest. An `.ipynb` file plus a successful cell response is not proof that a long job will survive a desktop restart or that its weights were exported.

## 4. Official Colab integrations: remote runtime API and browser notebook bridge

### Remote Colab API MCP — newly verified documentation

Google's current reference documents `https://colaboratory.googleapis.com/mcp`, with runtime, session, and Python-execution tools. This is a separate integration from the OSS browser bridge. The reference is dated 2026-11-20. Its documented catalog contains `get_subscription`, `list_runtime_specs`, `list_runtimes`, `get_runtime`, `create_runtime`, `delete_runtime`, `create_session`, `list_sessions`, `delete_session`, and `execute_code`. The old claim that Colab offers only a browser-mediated MCP is therefore no longer accurate. [Official remote MCP reference][colab-remote-mcp]

`get_subscription` reports free/Pro/Pro+ tier, while `list_runtime_specs` reports eligible runtime variants, accelerators, and shapes. A tier name does not prove that a particular GPU or this owner's API configuration will work. Runtime eligibility must be discovered before a concrete execution plan is offered. [Subscription tool][colab-subscription] [Runtime-spec tool][colab-runtime-specs]

### Remote authentication and onboarding qualification

The Colab reference links Google's remote-MCP enablement and authentication guides. The enablement guide calls for a Google Cloud project, product API enablement, required permissions, and billing setup. The authentication guide supports methods according to each service, including OAuth client configuration or bearer tokens/ADC; it explicitly does **not** support Dynamic Client Registration or OAuth Client ID Metadata Documents. Do not advertise a universal paste-an-API-key flow or automatic client registration. The exact Colab account/app configuration has not been tested here. [Enablement][google-mcp-enable] [Authentication][google-mcp-auth]

Colab's underlying runtime-create REST method requires the `https://www.googleapis.com/auth/colaboratory` OAuth scope and has per-project and per-user request quotas. Read methods also list `colaboratory.readonly`. Generic Google Cloud instructions do not establish that this consumer-runtime API is Colab Enterprise, or that every free account already satisfies onboarding. [Runtime creation REST][colab-rest-create] [Runtime read REST][colab-rest-get]

**FORGE design:** provide account selection and consent in the owner's browser, keep refresh/access credentials in the host credential store, and show separate connection states for configured, authenticated, eligible, and execution-tested. Inspect read-only subscription/spec/runtime information before offering resource creation. Do not put Google passwords, access tokens, or runtime connection tokens into model context. An API-enable/billing prerequisite should be explained when actually required by the selected connection; no such account change was made in this audit.

### Remote execution, retries, and lifecycle

Creation can be slow. Reuse an appropriate existing runtime, choose an eligible spec, and persist a new UUID `requestId` for each intended creation. On `DEADLINE_EXCEEDED`, the same creation request waits for the existing operation; a new request can duplicate provisioning. Capacity/quota failures are distinct from rate limiting. Runtime image version is also selectable; record the resolved version rather than assuming an unpinned default is reproducible. [Create runtime][colab-create-runtime]

The execution contract needs explicit adapter logic:

- Use one session per task; calls within a session execute serially. Supply only `session` or `runtime`, not both.
- Give each new session execution a new UUID `executionId`. After a 600-second timeout, code can still be running; repeat the identical session, ID, and code to reattach after `DEADLINE_EXCEEDED` or `UNAVAILABLE`.
- **After a result has been returned, reusing that ID executes again.** It is not a permanent deduplication key. Missing IDs or runtime-target retries can also duplicate execution.
- MCP cancellation interrupts the session kernel, potentially affecting another caller. Give each FORGE task exclusive ownership of its session.
- Results are text only and can be truncated. Collect plots, weights, and complete logs as files.

These are documented semantics, not behavior verified by a live FORGE call. [Execute code][colab-execute]

Closing a session aborts its executing code and discards kernel state, but preserves runtime files and leaves the runtime running. Deleting the runtime removes its files and all sessions irreversibly. FORGE should distinguish task interruption, kernel closure, and compute deletion, and limit cleanup to owned resources under the recorded project policy. Existing owner notebook sessions are not cleanup targets. [Delete session][colab-delete-session] [Delete runtime][colab-delete-runtime] [List sessions][colab-list-sessions]

### Direct artifact transfer

`get_runtime` returns `connectionInfo.url`, a token, and expiry. Use `X-Colab-Runtime-Proxy-Token` for direct HTTP file transfer: GET `/files/{path}` supports ranges; PUT `/api/contents/{path}` uploads text or base64 file content, with existing parent directories. Each request must contain less than 50 MB of file data; larger files use numbered chunks and a final `chunk: -1`. Tokens last about an hour; refresh through `get_runtime`. A missing/expired token can appear as HTTP 404. [Runtime and file-transfer reference][colab-get-runtime]

**FORGE design:** transfer bytes through the host adapter, not through an LLM tool transcript; redact connection credentials, verify checksums, and retain local artifact manifests. A saved notebook is not a durable model checkpoint. Record which checkpoint was successfully exported before any VM deletion or retry from a fresh runtime.

### Local browser notebook bridge

The Google-owned `googlecolab/colab-mcp` server proxies into an open Colab browser session. Its bootstrap tool is `open_colab_browser_connection`; the notebook tool catalog arrives dynamically from the frontend. The README requires a local MCP client supporting `notifications/tools/list_changed`. The browser and bridge belong on the same user workstation for this local-connection flow. [Bridge README][colab-readme] [Session implementation][colab-session]

The bridge binds a localhost WebSocket on an ephemeral port, checks Colab origins, uses a generated connection token, and accepts one browser connection. It opens a notebook page and waits for connection. Google describes notebook creation/editing, cell execution, and dependency installation. Account/runtime/Drive handoffs remain user-facing Colab actions; this is not a reason to collect the owner's password in FORGE. [WebSocket source][colab-websocket] [Google announcement][colab-blog]

The actual T3/harness, negotiated protocol, and bridge version must pass a focused acceptance check: discover the bootstrap tool, connect the browser, refresh dynamic notebook tools, execute one harmless cell, show its actual output, and reconnect without stale calls or duplicate work. T3's parallel audit did not establish that the complete no-code flow already works. A generic tool-list handler is insufficient evidence. The remote runtime API's static documented tools and the bridge's dynamic notebook tools require separate capability tests.

### Runtime limits and policy

Consumer Colab remains ephemeral: idle behavior, availability, hardware, and quotas vary. The FAQ describes a general maximum of 12 hours, and Pro+ continuous execution up to 24 hours with sufficient compute units; these are not uptime guarantees. Exhausted paid units can terminate the backend. Free managed runtimes without a positive compute-unit balance restrict SSH/remote-desktop control and primarily external web-UI use. Paid plans remove those listed free-tier restrictions while other policies remain. Unrelated file hosting/media/web-service offerings are prohibited on managed runtimes. [Colab FAQ][colab-faq]

Do not reinterpret these restrictions as a blanket ban on Google's documented MCP/API integration. Conversely, official API access does not promise a permanent inference server. **FORGE design:** checkpoint periodically outside the runtime, reconcile disconnections against remote state, and offer resume from a verified checkpoint. No keepalive workaround or automatic paid upgrade is part of the proposal. The reference project's LitServe placement is a separate serving choice; Windows serving is a candidate, not a fact established by this compute audit.

### Other Colab modes and Windows packaging

Google also publishes `googlecolab/google-colab-cli` for headless runtime provisioning, execution, transfers, and shutdown. Its inspected README explicitly supports **Linux/macOS only**. It is reusable as an implementation reference or an optional compatible worker tool, but it is not a native Windows no-code launcher. The current source is Apache-2.0. [Pinned CLI README][colab-cli-readme] [CLI license][colab-cli-license]

Colab can use a local/remote owner runtime through Jupyter and forwarding. That mode supplies a notebook frontend, not hosted GPU capacity. Its demonstration container should not automatically become FORGE's production training image. [Colab local runtimes][colab-local]

Colab Enterprise remains a distinct GCP product with IAM, runtime templates, and scheduled/one-off notebook execution writing outputs to Cloud Storage. Its APIs, billing, and quotas must be selected explicitly. Neither the browser bridge nor the new consumer-runtime API implies Enterprise adoption. [Enterprise execution][colab-enterprise] [Enterprise runtime management][colab-enterprise-runtimes]

## 5. Official Runpod MCP

### Transport and identity

Runpod's hosted control server is `https://mcp.runpod.io/`, using Streamable HTTP and OAuth. A local stdio installation can instead receive `RUNPOD_API_KEY`. The OAuth flow follows the selected Runpod account/team context; FORGE should show that identity before resource actions. The older hosted URL should not be registered as an additional duplicate connector. Supported callback behavior and account selection must be checked with the actual client. [Runpod README][runpod-readme] [official MCP guide][runpod-guide]

`https://docs.runpod.io/mcp` is a separate documentation server. Reading its docs does not give permission or ability to create Pods. FORGE should label documentation search and resource control as different connections. [Official MCP guide][runpod-guide]

### Current operation surface

The inspected 5.0.0 server generates a broad catalog from REST v2 and adds curated job tools. It can inspect GPU offerings, accounts, limits, balances, billing, Pods, endpoints, workers, and volumes. Mutations extend beyond workloads into secrets, registries, teams, and other administration. FORGE should select a small per-task subset rather than exporting the entire account surface to every bot. [Generated tools][runpod-tools] [operation registry][runpod-ops]

| Needed function | Current examples | Policy consequence |
| --- | --- | --- |
| Inspect compute and cost | `list-gpu-types`, `list-pods`, `get-pod`, `get-balance`, billing tools | Read-only account data can still contain sensitive fields |
| Rent or resize resources | `create-pod`, `update-pod`, `create-endpoint`, `update-endpoint` | May start or increase billing |
| Keep data | `create-network-volume`, `update-network-volume` | Storage continues to cost money independently of a running job |
| Control Pod lifecycle | `pod-action`, `delete-pod` | Stop, restart, and delete have different data/cost effects |
| Submit inference | `run-endpoint`, `runsync-endpoint` | New billable work; retries may duplicate work |
| Inspect/cancel jobs | `get-job-status`, `cancel-job`, `endpoint-health` | Cancel is distinct from a client timeout |

Current default-profile Pod lifecycle is `pod-action`; a directory-oriented profile also exposes split transition names. Do not assume that names from an old tutorial match the selected server profile. Endpoint creation now uses current image/GPU-pool/type/scaling schemas, so old template-only examples need revalidation. [Generated tool schemas][runpod-tools] [Pod transitions][runpod-pods]

### Cost and lifecycle findings

**A tool marked `destructiveHint: false` can spend money.** The inspected creation tools and asynchronous inference submission include this case. Read-only, destructive, idempotent, and billable are separate attributes; FORGE needs a cost category in addition to MCP annotations. Creation starts resource billing, while deletion and stop actions have distinct storage behavior. [Annotations][runpod-annotations] [Generated tools][runpod-tools]

The job wrapper bounds waiting differently for hosted HTTP and local stdio. Reaching a polling deadline can return while the remote job continues. Persist the returned job ID, then inspect/cancel that ID; do not resubmit to find out what happened. `retry-job` requeues work and can spend again. `purge-endpoint-queue` affects queued work, not all work already running. `stream-job` consumes stream state and is not necessarily a repeatable read. Results also have retention limits, so save required outputs into the artifact store. [Job implementation][runpod-jobs]

Stopping compute can leave billed storage. Pod transitions and deletion affect container-local versus retained volume data differently. FORGE should copy/checkpoint required artifacts first, then stop/delete only the resources belonging to its run, and report remaining retained storage. Treat a worker reported as running as infrastructure state; application readiness still needs a model-level health/inference check. [Pod transition descriptions][runpod-pods] [Runpod storage billing][runpod-storage]

The current endpoint update schema also warns that environment updates replace the set rather than merging arbitrary redacted values back. Store secret references separately and avoid reconstructing an update from masked output. [Endpoint update schema][runpod-tools]

Runpod also has native account-level controls: its billing documentation describes hourly account spend limits, prepaid-balance behavior, and optional automatic credit reload. These are not a per-run FORGE budget. At zero balance, the documented handling can stop or terminate Pods depending on attached storage, and unpaid storage can eventually be removed. Organization billing can differ from prepaid accounts. Read the actual account limits, show the account context, and do not rely on exhausting the balance as a controlled checkpoint-and-shutdown mechanism. [Runpod billing policy][runpod-billing]

## 6. Vast.ai: first-party SDK/skills and community MCP

### First-party foundation

The current `vast-ai/vast-cli` repository provides both the `vastai` CLI and Python SDK, plus a serverless client. The SDK exposes searching offers, creating/starting/stopping/destroying instances, account/billing operations, and serverless operations. The Windows installation path is the Python package; the standalone shell installer targets Linux/macOS/WSL. FORGE can manage the package in its own connector environment so the owner does not have to type these commands. [Official README][vast-readme] [package manifest][vast-package]

The official `vast-ai/vast-codex-plugin` and the newer CLI/SDK skill files are **agent instructions around these tools**. They are not a first-party resource-control MCP service. No first-party control MCP was verified in this audit. That is a bounded research finding, not proof that no such service can ever exist. A docs-site MCP, if provided, must have its catalog inspected before treating it as resource control. [Official plugin][vast-plugin] [CLI skill][vast-cli-skill] [SDK skill][vast-sdk-skill]

### Important source conflicts and implementation details

Use the pinned implementation and endpoint schema when prose disagrees:

- The SDK uses **PUT** to `/asks/{id}/` for one offer. The OpenAPI path likewise declares PUT, while its introductory quick-start prose says POST. Do not copy that prose into a wrapper.
- The instance ID returned after rental is `new_contract`; an offer ID is not the rented instance ID.
- Start/stop use the instance state API; destroy uses DELETE. Keep these as separate operations.
- The CLI implementation describes its `execute` operation as constrained commands such as `ls`, `rm`, and `du`. A skill example says `nvidia-smi`. The audit did not execute a live call to resolve server-side behavior; use SSH/Jupyter for training and normal process control rather than promising a general shell from this API.
- `gpu_ram` units differ between the human-facing CLI query and REST schema. Normalize memory units in the adapter.
- Searching spot offers does not by itself guarantee a spot rental: the current SDK skill explains that omitting `bid_price` can create an on-demand instance.

Evidence: [SDK instance methods][vast-instances], [CLI constrained execution][vast-execute], [OpenAPI][vast-openapi], [CLI skill][vast-cli-skill], [SDK spot behavior][vast-sdk-skill].

The latest inspected CLI commit removes network-volume/network-disk/cluster/overlay commands. Ordinary local volume support remains in instance creation. Do not infer a portable network volume from the generic word “volume”: Vast documents local volumes as tied to a physical host. For migration or interruption recovery, export artifacts to an independent store. Stopping preserves instance data and can leave storage charges; destroying an instance is a separate destructive action. [Pinned commit][vast-commit] [instance implementation][vast-instances] [Vast storage documentation][vast-storage]

### Community server audit

`nikitatsym/vastai-mcp` is an inspectable recent community candidate. It exposes four broad tool groups—read, write, execute, delete—and operation-specific help/schema. Stdio is the natural local connection. Its optional localhost HTTP mode does not add authentication in the inspected configuration. It uses `VASTAI_API_KEY`, whereas the first-party SDK documents `VAST_API_KEY`; connector configuration must not silently confuse these. [Community README][community-vast-readme] [tool source][community-vast-tools]

Several details prevent treating this as a default production connector without additional work: package metadata declares MIT but a root license file was not found; creation under the write group can be billable despite non-destructive classification; API-key/account operations broaden authority; some instance responses include a Jupyter token and require redaction; installation instructions use an additional package index. Its live tests must not be run as a harmless verification step because they can create resources. [Metadata][community-vast-package] [README][community-vast-readme] [source][community-vast-tools]

The older `CryDevOk/vastai-mcp` was also inspected at `b01b1c5ca5bf27a108cbc2860db253f6997f8a64` (2025-07-04). Its broad SSH/passwordless-sudo surface, old examples, and unverified root license make it a weaker starting point. No credential values were fetched or used. [Repository at inspected commit][older-vast]

### Recommended wrapper — proposal

Build a narrow FORGE MCP facade over the pinned official SDK: offer search, cost estimate, create a specific quoted offer, inspect owned instance, stop/start an owned instance, destroy an explicitly selected instance, and report retained volumes. Use a structured SDK call instead of a free-form CLI string. Keep SSH/Jupyter workload tools separate. Do not expose a generic raw HTTP escape hatch, account-key management, or automatic “rent the first offer” behavior to a normal training bot.

## 7. FORGE control layer that remains necessary

The following is a proposed product design, not an upstream feature claim.

### Connection registry

Each connector record should contain provenance, pinned version, transport, credential reference, account/team identity, declared capabilities, current discovered tools, and the time of last successful validation. Track whether tools are static or can change after browser connection. Keep secrets outside prompts, notebook outputs, project files, and exported run bundles. A local installer should select separate environments for incompatible dependency sets and verify package/artifact identity before launch.

T3 can remain the conversation/workbench foundation. FORGE should add a single connection experience above the selected harness rather than installing conflicting MCP configurations in several places and assuming they stay synchronized. A connector capability is available only after the actual harness/transport combination passes its acceptance check.

### Cost and authority

Use operation classes such as read, edit, execute, provision, resize, stop, and delete. Model-visible tool annotations are hints; the broker must enforce policy before dispatch. Preparation should produce a concrete plan: chosen provider/account, resource offer, current rate, storage/network assumptions, maximum runtime, retry allowance, and teardown/retention choice. The owner can authorize that plan or a persistent budget policy; FORGE should not repeatedly ask for actions already covered by that authorization.

A spend estimate is not a provider-enforced hard cap. API billing can lag, teardown can fail, and retained storage can continue to bill. If FORGE promises automatic shutdown, the responsible watcher must remain active independently of the local Windows application closing, or the UI must state that the protection is unavailable. Prefer native provider quotas or time limits where actually supported, but do not invent a universal spending-limit API.

### Durable run record

Persist a stable run ID, project and bot IDs, provider/account identity, remote resource IDs, creation ownership, pricing snapshot, job IDs, notebook/model/data revisions, log cursors, artifact locations/checksums, cancellation state, and remaining retained resources. Keep existing owner resources distinct from resources newly created for a run. Never turn “cancel this task” into deletion of all resources in an account.

Useful states are prepared, waiting for connection, quoted, authorized, provisioning, running, checkpointing, cancelling, collecting artifacts, stopping, completed, failed, and cleanup pending. A tool timeout or lost transport should produce an uncertain/reconciling state until the remote job/resource is queried. Retrying a create or submission call requires reconciliation first; blind retry can produce duplicate charges.

### Workload execution and artifacts

Use Jupyter for notebook operations and a supported job/runtime API or supervisor for long-running training. Apply each provider's actual resume/cancellation contract; the Colab remote API's session/execution reattachment does not need an invented SSH supervisor. Connect logs and metrics to the run ID. Store model/checkpoint revision, precision settings, dataset provenance, split, environment, and evaluation settings with resulting weights. Where relevant, also retain adapter and tokenizer revisions. A later inference UI must load the recorded artifacts rather than silently substituting a different model.

Model/artifact and monitoring choices are audited separately. The root research identified official Hugging Face Hub/Jobs and Inference Endpoints integrations, plus Trackio, MLflow, and W&B MCP candidates. Their precise capability and license evidence belongs to that separate audit; this document does not independently certify those versions.

## 8. Selected reference project and additional acceptance examples

The current owner-selected reference project is **Windows public-data CPU work → Colab training → exported artifacts → inference/replay through a requested LitServe integration**, with **Drive + Windows + project Git** storage. FORGE should create the notebook and reproducible project files, perform a bounded local smoke check, run actual fitting/evaluation in the chosen Colab runtime, export its artifact and provenance, then verify that the downstream app loads that artifact. Merely generating a notebook or demonstrating inference with unrelated pretrained weights would not satisfy this project's training requirement. Serving placement, account access, concrete storage bindings, time limits and retention remain setup details; the storage types are settled and no project execution is reported here.

The following three workflows remain reusable catalog examples for other projects. Their ordering is not a new priority decision for the reference project, and none selects Runpod instead of the owner's chosen Colab target.

### Pilot 1 — existing model inference on existing compute

Connect an owner server or an already available Pod, create a notebook, inspect the actual GPU/runtime, load a pinned model revision, execute a real inference, and build a small UI against that same loaded model. Test both the inference API and the UI using FORGE's GUI-testing layer. Record output, latency, GPU observation, logs, and artifact identifiers. Stop only the process created by the run and retain the selected weights.

This validates the core promise: a no-code owner can request an AI app and see it use real weights on real compute. A generated notebook file, mock response, static UI, or an infrastructure “running” status alone does not pass.

### Pilot 2 — bounded LoRA training and reuse

On existing compatible compute, use an owner-approved dataset, a pinned base model, and a small fixed training budget. Produce a checkpoint, export the adapter with its manifest, run a held-out comparison, and load it in the inference UI. Show the difference between a smoke test that proves training ran and an evaluation that supports a quality claim. Preserve artifacts before stopping the run.

The model, dataset, and VRAM requirement remain choices to resolve; this audit does not invent a suitable model size or claim every notebook backend can fit it.

### Pilot 3 — rented training to managed inference

Quote a specific cloud configuration, obtain authorization under the owner's chosen policy, provision, train, export artifacts, deploy an inference endpoint, test it, and monitor health/cost. Then execute the recorded retention/teardown plan and report any remaining paid storage or endpoints. For projects selecting those providers, Runpod has an official resource-control MCP and Vast can use the proposed SDK wrapper. Colab's remote API is also a runtime-management option, subject to its distinct account, quota, and ephemeral-session constraints; this does not make Colab a permanent serving host.

### Smallest real first acceptance

For the selected reference project, use one public-data slice and frozen split, one versioned notebook/training configuration, one actual bounded fit in Colab, one exported model/checkpoint with metrics and checksums, and one verified local app/replay that loads it. Include session interruption/reconciliation and checkpoint recovery before claiming robust no-code training. The separate inference-only catalog example can use an existing model, but it does not replace this acceptance requirement. Expensive resources or account upgrades require a concrete policy covering them; Colab selection alone does not establish a budget.

## 9. Gaps to close before claiming no-code support

- Package and launch the actual chosen connector environments on Windows, including paths with Thai characters.
- Confirm T3/harness external-MCP configuration ownership, Google OAuth handoff, runtime eligibility, direct artifact transfer, and the browser bridge's separate live-tool refresh with the exact shipped versions.
- The owner has answered **Colab Free** and **Google Drive + Windows + Git storage**. Resolve actual accounts/API access, folder/path/project remote bindings, sync/retention, time/retry limits and allowed hardware fallback during setup; do not ask the owner to repeat provider/tier/storage choices.
- Test credential redaction in provider responses, notebook outputs, errors, and exported diagnostic bundles.
- Confirm each selected provider's current price, quota, storage retention, cancellation, and shutdown behavior using an authorized test account.
- Exercise reconnect, duplicate-submission reconciliation, job cancellation, checkpoint export, and cleanup failure states.
- Verify the chosen model/data license and resource fit when the first workload is selected.
- Resolve community license gaps before redistributing those candidates. Pinning and a package metadata label do not complete that step.

No installation, live integration test, paid action, or provider authentication has been performed for this report. These gaps are concrete implementation/acceptance tasks, not reasons to rebuild already available upstream MCP servers.

## Sources

[runpod-readme]: https://github.com/runpod/runpod-mcp/blob/6f1cb5729bd1d5dc835f7f80b18066d40f400978/README.md
[runpod-package]: https://github.com/runpod/runpod-mcp/blob/6f1cb5729bd1d5dc835f7f80b18066d40f400978/package.json
[runpod-license]: https://github.com/runpod/runpod-mcp/blob/6f1cb5729bd1d5dc835f7f80b18066d40f400978/LICENSE
[runpod-sdk-license]: https://github.com/runpod/runpod-mcp/blob/6f1cb5729bd1d5dc835f7f80b18066d40f400978/packages/typescript-api-sdk/LICENSE
[runpod-tools]: https://github.com/runpod/runpod-mcp/blob/6f1cb5729bd1d5dc835f7f80b18066d40f400978/src/specgen/generated/tools.gen.ts
[runpod-ops]: https://github.com/runpod/runpod-mcp/blob/6f1cb5729bd1d5dc835f7f80b18066d40f400978/src/specgen/ops.ts
[runpod-jobs]: https://github.com/runpod/runpod-mcp/blob/6f1cb5729bd1d5dc835f7f80b18066d40f400978/src/specgen/tools/jobs.ts
[runpod-pods]: https://github.com/runpod/runpod-mcp/blob/6f1cb5729bd1d5dc835f7f80b18066d40f400978/src/specgen/tools/pod-transitions.ts
[runpod-annotations]: https://github.com/runpod/runpod-mcp/blob/6f1cb5729bd1d5dc835f7f80b18066d40f400978/src/specgen/tools/annotations.ts
[runpod-guide]: https://docs.runpod.io/get-started/mcp-servers
[runpod-storage]: https://contact.runpod.io/hc/en-us/articles/57370686866707-Why-You-re-Still-Being-Charged-After-Stopping-Pods-and-Services
[runpod-billing]: https://github.com/runpod/docs/blob/f1803c4438f689fd05a79ba9965c5fe8ef971f20/accounts-billing/billing.mdx
[colab-readme]: https://github.com/googlecolab/colab-mcp/blob/b9ab3899e0f1fa493390b1fd6d54aa2e464ecdf1/README.md
[colab-package]: https://github.com/googlecolab/colab-mcp/blob/b9ab3899e0f1fa493390b1fd6d54aa2e464ecdf1/pyproject.toml
[colab-license]: https://github.com/googlecolab/colab-mcp/blob/b9ab3899e0f1fa493390b1fd6d54aa2e464ecdf1/LICENSE
[colab-session]: https://github.com/googlecolab/colab-mcp/blob/b9ab3899e0f1fa493390b1fd6d54aa2e464ecdf1/src/colab_mcp/session.py
[colab-websocket]: https://github.com/googlecolab/colab-mcp/blob/b9ab3899e0f1fa493390b1fd6d54aa2e464ecdf1/src/colab_mcp/websocket_server.py
[colab-remote-mcp]: https://developers.google.com/colab/api/reference/mcp
[colab-subscription]: https://developers.google.com/colab/api/reference/mcp/tools_list/get_subscription
[colab-runtime-specs]: https://developers.google.com/colab/api/reference/mcp/tools_list/list_runtime_specs
[colab-create-runtime]: https://developers.google.com/colab/api/reference/mcp/tools_list/create_runtime
[colab-execute]: https://developers.google.com/colab/api/reference/mcp/tools_list/execute_code
[colab-get-runtime]: https://developers.google.com/colab/api/reference/mcp/tools_list/get_runtime
[colab-delete-session]: https://developers.google.com/colab/api/reference/mcp/tools_list/delete_session
[colab-delete-runtime]: https://developers.google.com/colab/api/reference/mcp/tools_list/delete_runtime
[colab-list-sessions]: https://developers.google.com/colab/api/reference/mcp/tools_list/list_sessions
[colab-rest-create]: https://developers.google.com/colab/api/reference/rest/v1beta/runtimes/create
[colab-rest-get]: https://developers.google.com/colab/api/reference/rest/v1beta/runtimes/get
[google-mcp-enable]: https://docs.cloud.google.com/mcp/enable-disable-mcp-servers
[google-mcp-auth]: https://docs.cloud.google.com/mcp/authenticate-mcp
[colab-cli-readme]: https://github.com/googlecolab/google-colab-cli/blob/33eacf1116968ef4e053b15f23cddd54d5288d02/README.md
[colab-cli-license]: https://github.com/googlecolab/google-colab-cli/blob/33eacf1116968ef4e053b15f23cddd54d5288d02/LICENSE
[colab-blog]: https://developers.googleblog.com/announcing-the-colab-mcp-server-connect-any-ai-agent-to-google-colab/
[colab-faq]: https://research.google.com/colaboratory/faq.html
[colab-local]: https://research.google.com/colaboratory/local-runtimes.html
[colab-enterprise]: https://docs.cloud.google.com/colab/docs/schedule-notebook-run
[colab-enterprise-runtimes]: https://docs.cloud.google.com/colab/docs/manage-runtimes
[jupyter-readme]: https://github.com/datalayer/jupyter-mcp-server/blob/cdf49eb7ced881553a32ea332882a0744ab0f62a/README.md
[jupyter-package]: https://github.com/datalayer/jupyter-mcp-server/blob/cdf49eb7ced881553a32ea332882a0744ab0f62a/pyproject.toml
[jupyter-version]: https://github.com/datalayer/jupyter-mcp-server/blob/cdf49eb7ced881553a32ea332882a0744ab0f62a/jupyter_mcp_server/__version__.py
[jupyter-license]: https://github.com/datalayer/jupyter-mcp-server/blob/cdf49eb7ced881553a32ea332882a0744ab0f62a/LICENSE
[jupyter-server]: https://github.com/datalayer/jupyter-mcp-server/blob/cdf49eb7ced881553a32ea332882a0744ab0f62a/jupyter_mcp_server/server.py
[jupyter-api]: https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html
[jupyter-security]: https://jupyter-server.readthedocs.io/en/latest/operators/security.html
[ssh-readme]: https://github.com/n0madic/ssh-mcp/blob/abd195efc633d6b61891be00b28c1e07c2e60098/README.md
[ssh-license]: https://github.com/n0madic/ssh-mcp/blob/abd195efc633d6b61891be00b28c1e07c2e60098/LICENSE
[ssh-server]: https://github.com/n0madic/ssh-mcp/blob/abd195efc633d6b61891be00b28c1e07c2e60098/internal/server/server.go
[jrm-readme]: https://github.com/jrmdev/ssh-mcp/blob/2f03597c7aa021e87872248abbba20dc044eddfb/README.md
[jrm-cargo]: https://github.com/jrmdev/ssh-mcp/blob/2f03597c7aa021e87872248abbba20dc044eddfb/Cargo.toml
[vast-readme]: https://github.com/vast-ai/vast-cli/blob/4ee6a0adbe8cc4df519f8f9fc4e25b1ce370589b/README.md
[vast-package]: https://github.com/vast-ai/vast-cli/blob/4ee6a0adbe8cc4df519f8f9fc4e25b1ce370589b/pyproject.toml
[vast-license]: https://github.com/vast-ai/vast-cli/blob/4ee6a0adbe8cc4df519f8f9fc4e25b1ce370589b/LICENSE
[vast-instances]: https://github.com/vast-ai/vast-cli/blob/4ee6a0adbe8cc4df519f8f9fc4e25b1ce370589b/vastai/api/instances.py
[vast-execute]: https://github.com/vast-ai/vast-cli/blob/4ee6a0adbe8cc4df519f8f9fc4e25b1ce370589b/vastai/cli/commands/misc.py
[vast-cli-skill]: https://github.com/vast-ai/vast-cli/blob/4ee6a0adbe8cc4df519f8f9fc4e25b1ce370589b/vastai/SKILL.md
[vast-sdk-skill]: https://github.com/vast-ai/vast-cli/blob/4ee6a0adbe8cc4df519f8f9fc4e25b1ce370589b/vastai_sdk/SKILL.md
[vast-plugin]: https://github.com/vast-ai/vast-codex-plugin/blob/3ae27d8be8649a0913105f67c7c8dced3ee3ec4b/README.md
[vast-plugin-license]: https://github.com/vast-ai/vast-codex-plugin/blob/3ae27d8be8649a0913105f67c7c8dced3ee3ec4b/LICENSE
[vast-openapi]: https://github.com/vast-ai/docs/blob/138c1ddd5cfe5761c6391075c1fd0b6c517e059d/api-reference/openapi.yaml
[vast-commit]: https://github.com/vast-ai/vast-cli/commit/4ee6a0adbe8cc4df519f8f9fc4e25b1ce370589b
[vast-storage]: https://github.com/vast-ai/docs/blob/138c1ddd5cfe5761c6391075c1fd0b6c517e059d/guides/instances/storage/types.mdx
[community-vast-readme]: https://github.com/nikitatsym/vastai-mcp/blob/813c777e8c6229d48fbc1b6b3e5f605c5c8fa3b3/README.md
[community-vast-package]: https://github.com/nikitatsym/vastai-mcp/blob/813c777e8c6229d48fbc1b6b3e5f605c5c8fa3b3/pyproject.toml
[community-vast-tools]: https://github.com/nikitatsym/vastai-mcp/blob/813c777e8c6229d48fbc1b6b3e5f605c5c8fa3b3/src/vastai_mcp/tools.py
[older-vast]: https://github.com/CryDevOk/vastai-mcp/tree/b01b1c5ca5bf27a108cbc2860db253f6997f8a64
