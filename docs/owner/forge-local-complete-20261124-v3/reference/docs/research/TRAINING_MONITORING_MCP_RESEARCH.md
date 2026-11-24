# Training, artifacts, inference and monitoring MCP research

Research date: **24 November 2026, Asia/Bangkok**. This is a public documentation/source audit and an architectural recommendation. No service was connected, experiment executed, model deployed or paid resource created. A documented upstream tool is not a qualified FORGE integration.

## Recommendation

Use existing model/data, notebook, experiment and deployment integrations. FORGE should own the relationship between the approved plan, code/notebook revision, dataset revision, training run, resulting weights, evaluation and deployment. It should not rebuild an experiment tracker or model-serving engine merely to expose them through MCP.

**Latest reference-prototype choice:** the owner selected Windows public CPU work, **Colab Free** training, LitServe MCP, and **Google Drive + local Windows + a Git repository** storage. Proposed local serving uses LitServe on Windows alongside the supplied FastAPI/React replay app and a shared predictor. These choices belong to CA-EWS; FORGE remains flexible through per-project Settings, with no permanent free-only restriction. Propose Drive for completed model/checkpoint bundles, Windows for verified inference copies and the project's Git for source/notebooks/config/reports/manifests; file routing and sync policy remain editable. Account/API eligibility and actual folder/path/project-remote bindings are setup details, not another storage-choice interview. Use resumable checkpoints only when supported by training. See [storage settings](../PROJECT_STORAGE_SETTINGS_TH.md). No provider, account or experiment has been connected or run.

The earlier **Trackio + Gradio** combination remains a generic option, not the selected prototype stack. **W&B** is an alternative for an existing managed experiment workflow; **MLflow** is an alternative for broader self-hosted tracking/model management. Select a tracker only when it adds value to the project; saved run manifests and metric files can support the small public baseline without introducing an unapproved SaaS dependency.

## Verified reuse map

| Component | Existing integration and provenance | FORGE role | Material boundary |
|---|---|---|---|
| Hugging Face Hub MCP | First-party remote MCP at `https://huggingface.co/mcp`; configurable Hub search, repository, Jobs/sandbox and Spaces tools | Discover models/data/docs; use allowed Hub or job operations | Tool selection, identity and paid job scope depend on account/configuration; not every tool is read-only |
| Hugging Face Inference Endpoints MCP | Separate first-party service with OAuth | Inspect/create/update/pause/resume/delete managed endpoints; inspect logs/metrics and test inference | Distinct from Hub MCP; account/quota/billing and deployment settings remain necessary |
| Trackio MCP | First-party optional MCP alongside its dashboard, Streamable HTTP `/mcp/` | Read project/run/metric/system-metric results and explain experiments | Training must log data; mutation tools require the configured write token; local read access needs an appropriate network boundary |
| W&B MCP | First-party `wandb/wandb-mcp-server`; local server and hosted service | Query experiment/Weave data, compare runs, inspect artifacts, create supported reports | Source and hosted tool versions can differ; MCP Apps rendering in T3 remains unverified |
| MLflow MCP | First-party built-in MCP; current docs expose configurable GenAI/ML tool categories | Existing experiments/runs, trace evaluation, supported model/deployment operations | Explicitly experimental; deployment plugins/targets and authentication still govern actual behavior |
| Grafana MCP | First-party `grafana/mcp-grafana` | Query existing Prometheus/Loki data and supported dashboards/alerts | It does not install collectors or create model instrumentation automatically |
| Gradio | First-party `mcp_server=True` integration | Build an inference interface whose exposed functions can also be called as MCP tools | FORGE must still generate/load/test the actual inference function and chosen weights |
| LitServe MCP | First-party `MCP(...)` on a `LitAPI`; Streamable HTTP `/mcp/`, existing REST retained | Requested for this pilot; optional serving/export adapter for other projects | Current source labels MCP beta; does not supply an external-tool client, training orchestrator, or an automatic rich-file conversion guarantee |
| vLLM | Existing serving APIs, health and Prometheus metrics | Serve compatible LLM workloads; expose real serving observations | No first-party management MCP was qualified in this bounded audit; lifecycle belongs to the compute/deployment adapter |
| FastMCP | Maintained framework with OpenAPI/FastAPI integration | Build small original FORGE wrappers where an existing server is unsuitable | Generated endpoint tools do not supply job durability, artifact handling or permission policy |

Primary sources: [HF Hub MCP][hf-hub], [HF Endpoints MCP][hf-endpoints], [Trackio MCP][trackio-mcp], [W&B repository][wandb], [MLflow MCP][mlflow-mcp], [Grafana MCP][grafana], [Gradio MCP][gradio-mcp], [LitServe MCP][litserve-mcp], [vLLM serving][vllm-serving], [vLLM metrics][vllm-metrics], and [FastMCP OpenAPI][fastmcp-openapi].

## 1. Models, data, skills and managed jobs

Hugging Face's Hub MCP can search models, datasets, papers and documentation, and its configurable tool sets include repository contributions, sandboxes, Jobs and MCP-enabled Spaces. That is a useful existing tool surface; using it does not require making Hugging Face the only compute or artifact backend in FORGE. [Hub documentation][hf-hub]

Inference Endpoints has a separate MCP service covering endpoint configuration/lifecycle, quotas, logs, replicas, metrics and test inference. The distinction between pause and scale-to-zero must remain visible: they have different resumption behavior. FORGE should show the selected model revision and endpoint identity, then verify application inference after infrastructure becomes ready. [Endpoint documentation][hf-endpoints]

The official `huggingface/skills` repository contains reusable instructions for model training, datasets, Trackio and other ML tasks. Skills are instructions; MCP is an execution interface. Curate those instructions for the approved FORGE workflow. In particular, an upstream example saying to submit a paid job immediately or push outputs to a Hub must not override the owner's plan-first workflow, budget or artifact visibility decision. [Skills repository][hf-skills]

Inspected Hub MCP source pin: `df77feaa49795d7fd11dc472f4fa067e7bd2f542` (23 November 2026), MIT. HF skills use Apache-2.0. These licenses do not grant rights to every model or dataset accessible through the service. [Hub source][hf-mcp-source] · [Hub license][hf-mcp-license] · [Skills license][hf-skills-license]

## 2. Experiment tracking: choose a backend, then expose real data

### Trackio — proposed small-project default

Trackio offers an existing dashboard, logged metrics, artifact/registry support and MCP/HTTP access. Its MCP read tools expose projects, runs, metric values, system metrics and summaries; delete/rename/sync operations require a write token. Source inspection identified the maintained repository as `gradio-app/trackio`, MIT, with release `trackio@0.45.1` and inspected main pin `03d804f3bd0277fc855d39f92e3621e6f33faf46`. [MCP][trackio-mcp] · [API][trackio-api] · [Source][trackio-source] · [License][trackio-license]

The product recommendation is to add logging to the generated training code, correlate the tracker run with the FORGE run, and render selected real metrics inside the FORGE dashboard. The MCP connection lets a bot read/explain those observations. It does not infer missing loss, accuracy or GPU measurements. If deployed remotely, use an explicitly appropriate private/authenticated configuration rather than assuming a default public Space is suitable.

### W&B — existing managed experiment workflow

The official repository exposes experiment/run/history queries, comparisons and diagnosis, Weave traces, reports and artifact/registry inspection. A read-only mode limits write operations. Its chart tool can return MCP Apps content, but that is not evidence that the chosen T3/harness host renders it correctly. Native FORGE charts over actual returned metric values and an explicit external dashboard link are acceptable alternatives. [Repository][wandb] · [Hosted service][wandb-hosted]

Inspected source pin: `e841b7e23f7553da26126095418fa35b6a0ac628` (23 November 2026), MIT. The source identified a `0.4.3` candidate; source, package and hosted service catalogs must be qualified separately. The OSS connector's license does not replace W&B service terms. [License][wandb-license]

### MLflow — broader self-hosted option

MLflow's MCP feature is explicitly experimental. The documentation's introductory trace-management description is narrower than its current tool-category section: `genai` includes traces/scorers/experiments/runs, `ml` includes experiments/runs/models/deployments, and `all` enables both. Therefore it is inaccurate to classify the current MCP as trace-only. [Current MCP documentation][mlflow-mcp]

The inspected **v3.18.0** source registers those categories. Model operations include serving/predicting and environment/container preparation; deployment operations depend on the configured MLflow deployment target/plugin. This is useful reuse, but not proof that MLflow can provision any arbitrary cloud service or durably supervise every long-running command through MCP. [Pinned server source][mlflow-server] · [Model CLI source][mlflow-models] · [Deployment CLI source][mlflow-deployments] · [Apache-2.0 license][mlflow-license]

## 3. Training dashboard and serving dashboard answer different questions

FORGE should present three related views backed by different evidence:

| View | Examples of actual data | Owner of the evidence |
|---|---|---|
| Team and phase progress | Assigned bot, waiting task, last completed step, failed attempt, linked artifact | FORGE plan/task/run records and harness events |
| Experiment progress/quality | Loss, validation metric, steps/epochs, learning rate, GPU observations, checkpoint | Instrumented training runtime and selected tracker |
| Deployed-model operation | Health, errors, requests, latency, queue, resource utilization | Inference server, infrastructure and monitoring collectors |

vLLM exports Prometheus metrics for its serving runtime. Grafana's official MCP can work with configured observability sources and dashboards. Neither connection creates missing instrumentation. vLLM is a possible LLM-serving choice; vision/audio/tabular projects may need a different inference stack. [vLLM metrics][vllm-metrics] · [Grafana MCP][grafana]

Grafana MCP's source is Apache-2.0; do not describe the entire Grafana product ecosystem as Apache-2.0 on that basis. The service, server, plugins and connectors can have separate licenses. [MCP license][grafana-license]

## 4. Inference UX/UI can itself become an MCP tool

### LitServe — requested prototype integration and selectable product adapter

`LitAPI` supplies `setup`, `decode_request`, `predict`, and `encode_response`. Passing `MCP(name=..., description=..., input_schema=...)` exposes that API as an MCP tool discovered/called through `tools/list` and `tools/call`; the usual REST route remains available. This feature publishes the project's inference capability to agents. It does not automatically consume other MCP servers or manage notebook training. [Feature guide][litserve-mcp] · [LitAPI source][litserve-api]

Inspected source pin: **`68c4943be1eeabd18561ac6704b6043459d6fa40`**, Apache-2.0. The connector mounts `/mcp/` with a stateless, JSON-response Streamable HTTP session manager and explicitly warns that MCP support is beta. Base installation does not include its optional `fastmcp` dependency; the inspected development constraints use `fastmcp>=2.9.2,<4` because MCP 2 removed helpers this integration imports. Pin and qualify the complete serving environment instead of installing an unconstrained latest dependency. [Connector source][litserve-source] · [Manifest][litserve-pyproject] · [License][litserve-license]

Output handling is a compatibility boundary: the connector delegates to the MCP SDK's `_convert_to_content`; its inspected v1.x implementation flattens top-level lists/tuples into content blocks, handles explicit MCP content/image/audio values, and serializes other non-string values as text. A REST file response is not evidence of a usable MCP attachment. Use a compact JSON object around prediction arrays, convert numerical arrays deliberately, and transfer large artifacts through a separate file path. Test actual client parsing; do not promise automatic binary files, structured-content schemas, or token streaming from this feature alone. [Converter source][mcp-converter]

On Windows, the inspected server disables its ZMQ option and selects threaded API servers. `run` defaults to `0.0.0.0`; explicitly select `127.0.0.1` for the local prototype. MCP calls invoke the endpoint directly; the upstream unit test records empty HTTP headers, so header-dependent REST logic must not be assumed equivalent. These are source findings, not a Windows qualification pass. [Server source][litserve-server] · [MCP test][litserve-test]

Proposed composition: Colab exports the permitted model/preprocessor/config plus run provenance; Windows verifies the package and fixed-input parity; LitServe exposes the shared predictor; FastAPI/React owns replay state and calls inference through REST; approved agents can call the same predictor through MCP. Keep task/model/version checks in that shared boundary. LitServe does not replace FORGE's T3 server, and another project can select another serving backend. Model/data rights remain separate from the serving framework's license.

### Gradio — another project-level option

Gradio can expose application functions through MCP while retaining the normal human interface. Function documentation and parameter types inform tool schemas. This fits the owner's request well: the delivered model can have both a usable preview and a callable tool for other bots. [Gradio guide][gradio-mcp]

FORGE must record the model artifact/checkpoint and required preprocessing/configuration that the inference function loaded, then show a real example result. Include the base model, tokenizer or adapter where applicable; tabular or classical models also need their feature/preprocessing pipeline. For a LoRA output, preserve its relationship to the base model instead of describing the adapter file as a standalone full model. A richer React interface is a separate design choice when a project's UX needs it; it need not be a prerequisite for proving the model works.

The Gradio code license is Apache-2.0. Turning on MCP does not remove application authentication requirements or make a private app publicly accessible. [License][gradio-license] · [Authentication section][gradio-mcp]

## 5. Original FORGE adapters should expose tasks with durable identities

FastMCP can derive tools from OpenAPI/FastAPI and filter routes. That is useful scaffolding for a verified custom API, including compute or an internal inference service. Prefer a small task-level interface over publishing every administrative endpoint. [FastMCP documentation][fastmcp-openapi] · [Apache-2.0 license][fastmcp-license]

Illustrative **proposed** original operations are `submit_training`, `get_training_status`, `cancel_training`, `list_run_artifacts`, `prepare_deployment`, `get_deployment_health`, and `stop_owned_resource`. They should call one shared FORGE service also used by the GUI. They are not tools already implemented by this research.

The current MCP Tasks extension explicitly supports asynchronous task handles, polling, result retrieval and cancellation after capability negotiation. Do not claim that MCP inherently cannot support long-running work. Also do not assume every selected client/server supports the same extension version. Keep FORGE's durable run record and provider job ID even where MCP Tasks is available; where unavailable, expose submit/status/cancel operations with the same underlying state. [MCP Tasks specification][mcp-tasks]

A tool timeout, a cancelled agent turn, a cancelled remote job and a stopped GPU are distinct events. Retry after checking the existing remote job rather than submitting duplicate work. Checkpoint/export policy and continued storage billing belong in the reviewed plan. The detailed compute audit covers these provider-specific behaviors. [Compute audit](COMPUTE_MCP_RESEARCH.md)

## 6. Acceptance evidence for the first AI project

This is the general acceptance contract. The supplied CA-EWS plan and later owner decisions specialize the first reference workflow to public AHE research, Windows public CPU work, Colab training, Windows replay and a verified LitServe MCP inference route; other projects retain their own choices:

1. Review a plan with phases, outputs, compute identity and evaluation criteria.
2. Create and execute a real notebook; preserve notebook/code/environment revisions.
3. Establish run/job identity, status/logs, cancellation, reconnect and resource-state inspection before a remote training run; then perform bounded real training or adaptation and log actual metrics.
4. Export the model artifact/checkpoint with dataset, configuration and required preprocessing provenance; include a base-model revision, tokenizer or adapter relationship where applicable.
5. Evaluate on the agreed held-out/example input set; distinguish a smoke test from a quality claim.
6. Load that artifact in the inference interface and demonstrate a real response.
7. Inspect serving health and relevant observed metrics; a local prototype need not claim a public production deployment.
8. Reconnect to an existing job, cancel an owned run, preserve selected artifacts and verify final resource state.

No measured quality, performance, costs or end-to-end success are claimed by this audit. Existing APIs/MCPs reduce implementation work, while the single coherent workflow remains FORGE's responsibility.

### Colab connector update for this prototype

Google's official remote MCP is **`https://colaboratory.googleapis.com/mcp`**, distinct from `googlecolab/colab-mcp` browser integration. It documents runtime/session lifecycle, Python execution, eligibility inspection and separate authenticated HTTP file transfer. `execute_code` returns text, not image/plot bytes; preserve plot/model files as artifacts. Keep a durable FORGE execution identity and qualify timeout/reattachment/cancellation using the compute audit. This is not a promise of persistent Colab hosting. [Remote reference][colab-remote] · [Browser connector][colab-browser]

The linked authentication guidance supports service-appropriate OAuth/bearer/ADC paths and explicitly excludes Dynamic Client Registration and Client ID Metadata Documents. Its setup guidance calls for product API enablement and project/billing preparation. These general prerequisites do not establish the owner's actual Colab eligibility or authorize a billing change; inspect the account and supported scopes. A consumer subscription alone is not proof that the chosen remote connector is ready. [Authentication][google-mcp-auth] · [Enablement][google-mcp-enable]

## Sources

[hf-hub]: https://huggingface.co/docs/hub/agents-mcp
[hf-endpoints]: https://huggingface.co/docs/inference-endpoints/guides/mcp_server
[hf-mcp-source]: https://github.com/huggingface/hf-mcp-server/tree/df77feaa49795d7fd11dc472f4fa067e7bd2f542
[hf-mcp-license]: https://github.com/huggingface/hf-mcp-server/blob/df77feaa49795d7fd11dc472f4fa067e7bd2f542/LICENSE
[hf-skills]: https://github.com/huggingface/skills
[hf-skills-license]: https://github.com/huggingface/skills/blob/main/LICENSE
[trackio-mcp]: https://huggingface.co/docs/trackio/api_mcp_server
[trackio-api]: https://huggingface.co/docs/trackio/api
[trackio-source]: https://github.com/gradio-app/trackio/tree/03d804f3bd0277fc855d39f92e3621e6f33faf46
[trackio-license]: https://github.com/gradio-app/trackio/blob/03d804f3bd0277fc855d39f92e3621e6f33faf46/LICENSE
[wandb]: https://github.com/wandb/wandb-mcp-server
[wandb-hosted]: https://mcp.withwandb.com/
[wandb-license]: https://github.com/wandb/wandb-mcp-server/blob/e841b7e23f7553da26126095418fa35b6a0ac628/LICENSE
[mlflow-mcp]: https://mlflow.org/docs/latest/genai/mcp/
[mlflow-server]: https://github.com/mlflow/mlflow/blob/v3.18.0/mlflow/mcp/server.py
[mlflow-models]: https://github.com/mlflow/mlflow/blob/v3.18.0/mlflow/models/cli.py
[mlflow-deployments]: https://github.com/mlflow/mlflow/blob/v3.18.0/mlflow/deployments/cli.py
[mlflow-license]: https://github.com/mlflow/mlflow/blob/v3.18.0/LICENSE.txt
[grafana]: https://github.com/grafana/mcp-grafana
[grafana-license]: https://github.com/grafana/mcp-grafana/blob/main/LICENSE
[gradio-mcp]: https://gradio.app/guides/building-mcp-server-with-gradio
[gradio-license]: https://github.com/gradio-app/gradio/blob/main/LICENSE
[vllm-serving]: https://docs.vllm.ai/en/latest/serving/online_serving/
[vllm-metrics]: https://docs.vllm.ai/en/latest/design/metrics/
[fastmcp-openapi]: https://gofastmcp.com/docs/integrations/openapi
[fastmcp-license]: https://github.com/PrefectHQ/fastmcp/blob/main/LICENSE
[mcp-tasks]: https://tasks.extensions.modelcontextprotocol.io/specification/2026-07-28/tasks
[litserve-mcp]: https://lightning.ai/docs/litserve/features/mcp
[litserve-source]: https://github.com/Lightning-AI/LitServe/blob/68c4943be1eeabd18561ac6704b6043459d6fa40/src/litserve/mcp.py
[litserve-api]: https://github.com/Lightning-AI/LitServe/blob/68c4943be1eeabd18561ac6704b6043459d6fa40/src/litserve/api.py
[litserve-server]: https://github.com/Lightning-AI/LitServe/blob/68c4943be1eeabd18561ac6704b6043459d6fa40/src/litserve/server.py
[litserve-test]: https://github.com/Lightning-AI/LitServe/blob/68c4943be1eeabd18561ac6704b6043459d6fa40/tests/unit/test_mcp.py
[litserve-pyproject]: https://github.com/Lightning-AI/LitServe/blob/68c4943be1eeabd18561ac6704b6043459d6fa40/pyproject.toml
[litserve-license]: https://github.com/Lightning-AI/LitServe/blob/68c4943be1eeabd18561ac6704b6043459d6fa40/LICENSE
[mcp-converter]: https://github.com/modelcontextprotocol/python-sdk/blob/v1.x/src/mcp/server/fastmcp/utilities/func_metadata.py
[colab-remote]: https://developers.google.com/colab/api/reference/mcp
[colab-browser]: https://github.com/googlecolab/colab-mcp
[google-mcp-auth]: https://docs.cloud.google.com/mcp/authenticate-mcp
[google-mcp-enable]: https://docs.cloud.google.com/mcp/enable-disable-mcp-servers
