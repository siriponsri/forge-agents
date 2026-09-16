import {evaluateCandidate, resolveCapability} from '../../.agent-shared/runtime/scripts/resolver.mjs';
import {proposeRoutes, safeProbe, selectRoute} from '../../.agent-shared/runtime/scripts/capability-grad.mjs';
import {assert, assertProfile, canonicalJson, FRESHNESS_STATES, nowIso, sha256, sortedUnique} from './core.mjs';

export const ROUTING_POLICY = {
  hard_constraints_first: true,
  scoring_weights: {
    BALANCED: {evidence: 1000, health: 100, cost: -1, latency: -0.00001},
    QUALITY_FIRST: {evidence: 1400, health: 300, cost: -0.25, latency: -0.000005},
    ECONOMY: {evidence: 700, health: 80, cost: -8, latency: -0.00002},
    LOCAL_PRIVATE: {evidence: 1000, health: 100, cost: -1, latency: -0.00001}
  },
  excluded_backend_ids: ['deepseek-harness', 'hive', 'penguin', 'p6-hive', 'p7-penguin'],
  direct_reference_runtimes: ['official-codex', 'maxplus-codex', 'opencode']
};

export const REFERENCE_ROUTES = [
  {id: 'official-codex', runtime_id: 'official-codex', harness_id: 'official-codex', provider_id: 'openai-api', provider: 'OpenAI API', model_key: 'gpt-5-6-terra', roles: ['PLANNER', 'DEVELOPER', 'QA'], capabilities: ['planning', 'architecture', 'research', 'coding', 'tool-use', 'testing', 'review', 'audit', 'evidence', 'structured-output', 'documentation', 'deployment', 'rollback'], sandbox_policy: 'workspace-write', external_side_effects: false, runtime_status: 'RUNTIME_SURFACE', runtime_health: 'HEALTHY', provider_authorized: true, model_available: true, model_freshness: 'FRESH', evidence_score: 0.9, health_score: 0.9, estimated_cost: 1, latency_ms: 100, privacy_class: 'EXTERNAL_AUTHORIZED'},
  {id: 'maxplus-codex', runtime_id: 'maxplus-codex', harness_id: 'maxplus-codex', provider_id: 'openai-api', provider: 'OpenAI API', model_key: 'gpt-5-6-terra', roles: ['PLANNER', 'DEVELOPER', 'QA'], capabilities: ['planning', 'architecture', 'research', 'coding', 'tool-use', 'testing', 'review', 'audit', 'evidence', 'structured-output', 'documentation', 'deployment', 'rollback'], sandbox_policy: 'workspace-write', external_side_effects: false, runtime_status: 'RUNTIME_SURFACE', runtime_health: 'HEALTHY', provider_authorized: true, model_available: true, model_freshness: 'FRESH', evidence_score: 0.8, health_score: 0.8, estimated_cost: 0.5, latency_ms: 80, privacy_class: 'EXTERNAL_AUTHORIZED'},
  {id: 'opencode', runtime_id: 'opencode', harness_id: 'opencode', provider_id: 'opencode-go', provider: 'OpenCode Go', model_key: 'gpt-5-6-luna', roles: ['PLANNER', 'DEVELOPER', 'QA'], capabilities: ['planning', 'architecture', 'research', 'coding', 'tool-use', 'testing', 'review', 'audit', 'evidence', 'structured-output', 'documentation', 'deployment', 'rollback'], sandbox_policy: 'read-only', external_side_effects: false, runtime_status: 'RUNTIME_SURFACE', runtime_health: 'HEALTHY', provider_authorized: true, model_available: true, model_freshness: 'FRESH', evidence_score: 0.78, health_score: 0.86, estimated_cost: 0.25, latency_ms: 70, privacy_class: 'EXTERNAL_AUTHORIZED'}
];

const taskModelPreference = taskClass => taskClass.startsWith('planning') || taskClass.startsWith('review') || taskClass === 'audit.evidence' ? 'gpt-5-6-sol' : taskClass.startsWith('coding') || taskClass.startsWith('deployment') ? 'gpt-5-6-terra' : 'gpt-5-6-luna';

function modelFreshness(normalized, route) {
  const model = normalized?.models?.find(item => item.model_key === route.model_key);
  if (!model) return 'UNKNOWN';
  const surfaces = model.provider_surfaces.filter(surface => surface.provider_id === route.provider_id);
  if (surfaces.length === 0) return 'UNKNOWN';
  if (surfaces.some(surface => surface.freshness === 'FRESH')) return 'FRESH';
  if (surfaces.some(surface => surface.freshness === 'STALE')) return 'STALE';
  return 'UNKNOWN';
}

function withTaskModel(route, task, normalized) {
  const preferred = taskModelPreference(task.task_class);
  const model = normalized?.models?.find(item => item.model_key === preferred);
  const surface = model?.provider_surfaces?.find(item => item.provider_id === route.provider_id && item.freshness !== 'STALE');
  return {...route, model_key: model?.model_key ?? preferred, model_id: surface?.model_id ?? 'UNKNOWN', model_freshness: modelFreshness(normalized, {...route, model_key: model?.model_key ?? preferred})};
}

export function hardFilterRoute(route, {task, intake, normalized, maxCost, requireFresh = true, excludeRoutes = []} = {}) {
  const reasons = [];
  const constraints = {
    required_role: task?.authority_role,
    required_capabilities: task?.required_capabilities || [],
    max_cost: maxCost,
    no_external_side_effects: true,
    safe_only: true
  };
  const p4 = evaluateCandidate(route, constraints);
  reasons.push(...p4.reasons);
  if (ROUTING_POLICY.excluded_backend_ids.includes(route.id) || ROUTING_POLICY.excluded_backend_ids.includes(route.harness_id)) reasons.push('BACKEND_CLASSIFICATION_NOT_RECOMMENDED');
  if (!ROUTING_POLICY.direct_reference_runtimes.includes(route.runtime_id)) reasons.push('RUNTIME_NOT_REFERENCE_ELIGIBLE');
  if (route.provider_authorized !== true) reasons.push('PROVIDER_NOT_AUTHORIZED');
  if (route.runtime_health !== 'HEALTHY') reasons.push('HARNESS_NOT_HEALTHY');
  if (route.model_available !== true) reasons.push('MODEL_UNAVAILABLE');
  if (requireFresh && !FRESHNESS_STATES.includes(route.model_freshness)) reasons.push('FRESHNESS_UNKNOWN');
  if (requireFresh && route.model_freshness !== 'FRESH') reasons.push('FRESHNESS_UNSUITABLE');
  if (intake?.privacy_constraint === 'LOCAL_PRIVATE' && route.privacy_class !== 'LOCAL_PRIVATE') reasons.push('PRIVACY_POLICY_VIOLATION');
  if (excludeRoutes.includes(route.id)) reasons.push('QA_ROUTE_MUST_BE_INDEPENDENT');
  if (task?.routing_constraints?.required_modality && !(route.modalities || []).includes(task.routing_constraints.required_modality)) reasons.push('MODALITY_UNSUPPORTED');
  return {ok: reasons.length === 0, reasons: sortedUnique(reasons)};
}

function scoreRoute(route, profile) {
  const weights = ROUTING_POLICY.scoring_weights[profile];
  return (route.evidence_score ?? 0) * weights.evidence + (route.health_score ?? 0) * weights.health + (route.estimated_cost ?? 0) * weights.cost + (route.latency_ms ?? 0) * weights.latency;
}

export async function buildRoutePlan({task, intake, normalized, snapshot_id = null, capabilityGradEnabled = false, maxCost = Number.POSITIVE_INFINITY, excludeRoutes = []} = {}) {
  assert(task && intake, 'task and intake are required for routing');
  assertProfile(intake.execution_profile);
  const candidates = REFERENCE_ROUTES.map(route => withTaskModel(route, task, normalized));
  const evaluated = candidates.map(route => ({route, ...hardFilterRoute(route, {task, intake, normalized, maxCost, excludeRoutes}), score: scoreRoute(route, intake.execution_profile)}));
  const eligible = evaluated.filter(item => item.ok).sort((a, b) => b.score - a.score || a.route.id.localeCompare(b.route.id));
  const rejected = evaluated.filter(item => !item.ok).map(item => ({route_id: item.route.id, reasons: item.reasons}));
  const p4Decision = resolveCapability({capability: task.required_capabilities[0] || 'planning', role: task.authority_role, candidates: eligible.map(item => item.route), constraints: {required_capabilities: task.required_capabilities, safe_only: true, no_external_side_effects: true}, readiness: 'READY_WITH_ASSUMPTIONS', exploration: capabilityGradEnabled});
  let capabilityGrad = null;
  if (capabilityGradEnabled && eligible.length) {
    const proposals = proposeRoutes(eligible.map(item => item.route), {count: Math.min(3, eligible.length), ambiguous: true});
    const reports = [];
    for (const proposal of proposals) reports.push(await safeProbe(proposal, async route => ({outcome: 'LOCAL_POLICY_PROBE', pass: eligible.some(item => item.route.id === route.id), summary: 'hard-filtered reference route is callable by contract', evidence: [`route:${route.id}`]})));
    capabilityGrad = selectRoute({proposals, reports, constraints: {required_role: task.authority_role, required_capabilities: task.required_capabilities, safe_only: true}});
  }
  const winner = eligible[0] || null;
  const fallback = eligible.slice(1).map(item => item.route.id);
  const routePlan = {
    schema_version: '1.0.0',
    route_plan_id: `ROUTE-${sha256(canonicalJson({task_id: task.task_id, intake_id: intake.intake_id, profile: intake.execution_profile, eligible: eligible.map(item => item.route.id), snapshot_id})).slice(0, 12)}`,
    task_id: task.task_id,
    chosen_work_cell: task.work_cell_profile,
    chosen_harness: winner?.route.harness_id ?? null,
    chosen_provider: winner?.route.provider ?? null,
    chosen_model: winner?.route.model_id ?? null,
    chosen_model_key: winner?.route.model_key ?? null,
    reasoning_tier: intake.execution_profile === 'QUALITY_FIRST' ? 'HIGH' : 'STANDARD',
    fallback_routes: fallback,
    hard_constraints_evaluated: {execution_profile: intake.execution_profile, privacy_constraint: intake.privacy_constraint, max_cost: Number.isFinite(maxCost) ? maxCost : null, required_capabilities: task.required_capabilities, excluded_backends: ROUTING_POLICY.excluded_backend_ids, route_independence_exclusions: excludeRoutes},
    evidence_used: [
      'P4_RESOLVER', 'P4B_CAPABILITYGRAD', 'MODEL_INTELLIGENCE_RESEARCH_INPUT',
      ...((normalized?.models?.find(item => item.model_key === winner?.route.model_key)?.evidence_refs) || [])
    ],
    execution_profile: intake.execution_profile,
    route_decision_at: nowIso(),
    model_provider_freshness: winner?.route.model_freshness ?? 'UNKNOWN',
    selected_score: winner?.score ?? null,
    selected_runtime_status: winner?.route.runtime_status ?? 'UNKNOWN',
    rejected_routes: rejected,
    p4_resolver_decision: p4Decision,
    capabilitygrad_recommendation: capabilityGrad,
    snapshot_id,
    frozen: true,
    route_plan_hash: sha256(canonicalJson({task_id: task.task_id, chosen_harness: winner?.route.harness_id ?? null, chosen_provider: winner?.route.provider ?? null, chosen_model: winner?.route.model_id ?? null, fallback_routes: fallback, snapshot_id})),
    production_route_mutation: false
  };
  return routePlan;
}

export function assertFrozenRoutePlan(routePlan) {
  assert(routePlan?.frozen === true, 'route plan must be frozen before execution');
  assert(routePlan?.production_route_mutation === false, 'production route mutation is forbidden');
  assert(routePlan?.snapshot_id !== undefined, 'route plan snapshot_id field is required');
  return true;
}
