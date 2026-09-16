import crypto from 'node:crypto';

const DENIED_PATHS = [
  /\/api\/v1\/agents\/codex\/accounts(?:\/|$)/i,
  /\/api\/v1\/codex\/accounts(?:\/|$)/i,
  /\/account(?:s)?\/(?:add|switch|remove|activate|import|export)(?:\/|$)/i,
  /\/login(?:\/|$)/i,
  /\/auth(?:\/|$)/i
];

const DENIED_COMMANDS = [
  /(?:^|\s)codex-login(?:\s|$)/i,
  /(?:^|\s)(?:account|accounts)\s+(?:add|switch|remove|activate|import|export)(?:\s|$)/i
];

export class AoLimitedError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'AoLimitedError';
    this.code = code;
    this.detail = detail;
  }
}

export function stableHash(value) {
  const canonical = JSON.stringify(canonicalize(value));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function assertAllowedAoSurface(value, kind = 'path') {
  const text = String(value ?? '').trim();
  const rules = kind === 'command' ? DENIED_COMMANDS : DENIED_PATHS;
  if (rules.some(rule => rule.test(text))) {
    throw new AoLimitedError('AO_SURFACE_DENIED', `AO ${kind} is prohibited by FORGE policy`, { kind, value: text });
  }
  return text;
}

export function selectExecutionBackend(routeDecision, policy) {
  const requested = routeDecision?.execution_backend ?? 'native';
  if (requested === 'native') return 'native';
  if (requested !== 'ao') throw new AoLimitedError('EXECUTION_BACKEND_UNKNOWN', 'Execution backend must be native or ao', { requested });
  if (policy?.ao_limited_enabled !== true) throw new AoLimitedError('AO_FEATURE_DISABLED', 'AO Limited is not enabled');
  if (routeDecision?.kind && routeDecision.kind !== 'worker') {
    throw new AoLimitedError('AO_WORKER_ONLY', 'AO Limited accepts worker execution only', { kind: routeDecision.kind });
  }
  return 'ao';
}

export function resolveProviderDaemon(providerId, policy) {
  const boundary = policy?.provider_daemons?.[providerId];
  if (!boundary) throw new AoLimitedError('PROVIDER_BOUNDARY_UNKNOWN', 'No AO daemon boundary is configured for provider', { provider_id: providerId });
  const url = new URL(boundary.base_url);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new AoLimitedError('AO_LOOPBACK_REQUIRED', 'AO daemon must use loopback HTTP', { base_url: boundary.base_url });
  }
  if (!boundary.boundary_id || !boundary.run_file_id || !boundary.data_root_id) {
    throw new AoLimitedError('PROVIDER_BOUNDARY_INCOMPLETE', 'AO provider boundary identifiers are incomplete', { provider_id: providerId });
  }
  return Object.freeze({ provider_id: providerId, ...boundary });
}

export function normalizeAoError(error, phase, sessionCreated = false) {
  if (error instanceof AoLimitedError) return error;
  const timeout = error?.name === 'AbortError' || error?.code === 'ETIMEDOUT' || error?.code === 'AO_TIMEOUT';
  return new AoLimitedError(
    timeout ? 'AO_TIMEOUT' : 'AO_UNKNOWN',
    timeout ? `AO ${phase} timed out` : `AO ${phase} failed with unknown semantics`,
    { phase, session_created: sessionCreated, source_code: error?.code ?? 'UNKNOWN' }
  );
}

export function mapAoExecutionReceipt(input) {
  const state = input?.state ?? 'UNKNOWN';
  const knownStates = new Set(['CREATED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'CLEANED', 'UNKNOWN']);
  const normalizedState = knownStates.has(state) ? state : 'UNKNOWN';
  const receipt = {
    schema_version: '1.0.0',
    receipt_type: 'FORGE_AO_LIMITED_EXECUTION',
    backend: 'ao',
    authority: 'FORGE',
    planner_authority: 'FORGE',
    qa_authority: 'FORGE_INDEPENDENT_QA',
    provider_id: input.provider_id,
    boundary_id: input.boundary_id,
    project_id: input.project_id,
    session_id: input.session_id ?? null,
    workspace_ref: input.workspace_ref ?? null,
    state: normalizedState,
    source_state: state,
    started_at: input.started_at ?? null,
    finished_at: input.finished_at ?? null,
    model_backed_calls: input.model_backed_calls ?? 0,
    evidence: input.evidence ?? {},
    unknown_fields: input.unknown_fields ?? []
  };
  return { ...receipt, receipt_id: stableHash(receipt) };
}

export class AoLimitedAdapter {
  constructor({ policy, transport, nativeExecutor, clock = () => new Date().toISOString() }) {
    this.policy = policy;
    this.transport = transport;
    this.nativeExecutor = nativeExecutor;
    this.clock = clock;
  }

  async execute(routeDecision, task) {
    const backend = selectExecutionBackend(routeDecision, this.policy);
    if (backend === 'native') return this.nativeExecutor.execute(task, { reason: 'NATIVE_DEFAULT' });
    const boundary = resolveProviderDaemon(routeDecision.provider_id, this.policy);
    assertAllowedAoSurface('/api/v1/sessions');
    let sessionCreated = false;
    try {
      const created = await this.transport.spawn(boundary, {
        project_id: task.project_id,
        kind: 'worker',
        harness: routeDecision.harness,
        model: routeDecision.model ?? null,
        prompt: task.prompt,
        name: task.name
      }, { timeout_ms: this.policy.spawn_timeout_ms });
      sessionCreated = Boolean(created?.session_id);
      return mapAoExecutionReceipt({
        provider_id: routeDecision.provider_id,
        boundary_id: boundary.boundary_id,
        project_id: task.project_id,
        session_id: created?.session_id,
        workspace_ref: created?.workspace_ref,
        state: created?.state ?? 'UNKNOWN',
        started_at: this.clock(),
        model_backed_calls: created?.model_backed_calls ?? 0,
        evidence: created?.evidence ?? {}
      });
    } catch (cause) {
      const error = normalizeAoError(cause, 'spawn', sessionCreated);
      if (!sessionCreated && routeDecision.fallback_to_native === true) {
        return this.nativeExecutor.execute(task, { reason: error.code, fallback_from: 'ao' });
      }
      throw error;
    }
  }

  async cleanup(boundary, sessionId) {
    assertAllowedAoSurface(`/api/v1/sessions/${encodeURIComponent(sessionId)}/kill`);
    try {
      const result = await this.transport.cleanup(boundary, sessionId, { timeout_ms: this.policy.cleanup_timeout_ms });
      return {
        schema_version: '1.0.0', receipt_type: 'FORGE_AO_LIMITED_CLEANUP', backend: 'ao',
        boundary_id: boundary.boundary_id, session_id: sessionId,
        state: result?.state ?? 'UNKNOWN', workspace_disposition: result?.workspace_disposition ?? 'UNKNOWN',
        model_backed_calls: 0, cleaned_at: this.clock()
      };
    } catch (cause) {
      throw normalizeAoError(cause, 'cleanup', true);
    }
  }
}

export const aoLimitedPolicySurface = Object.freeze({
  classification: 'ADOPT_AO_LIMITED',
  native_default: true,
  worker_only: true,
  account_switching: 'DENIED',
  planner_authority: 'FORGE',
  independent_qa_authority: 'FORGE',
  deployment_authority: 'FORGE',
  evidence_authority: 'FORGE'
});
