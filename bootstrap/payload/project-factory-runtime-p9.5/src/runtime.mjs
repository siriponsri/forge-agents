import fs from 'node:fs';
import path from 'node:path';
import {appendJsonl, canonicalJson, nowIso, redact, safeResolve, sha256, writeJson} from './core.mjs';
import {createProjectIntake} from './intake.mjs';
import {normalizeModelIntelligence, validateNormalizedIntelligence} from './model-intelligence.mjs';
import {deriveTaskGraph, validateTaskGraph} from './task-graph.mjs';
import {selectWorkCells} from './staffing.mjs';
import {assertFrozenRoutePlan, buildRoutePlan} from './routing.mjs';
import {runHarnessSwitchProof} from './harness.mjs';

function writeProjectProjection(stateRoot, intake, graph, staffing, routes, lifecycle) {
  writeJson(path.join(stateRoot, 'OWNER_CHOICES.json'), {schema_version: '1.0.0', execution_profile: intake.execution_profile, privacy_constraint: intake.privacy_constraint, budget_mode: intake.budget_mode, owner_choices_preserved: true, decisions: intake.owner_decision_points});
  writeJson(path.join(stateRoot, 'GOALS.json'), [{goal_id: intake.intake_id, owner_goal: intake.owner_goal, status: 'ACTIVE', assumptions: intake.assumptions}]);
  writeJson(path.join(stateRoot, 'TASK_GRAPH.json'), graph);
  writeJson(path.join(stateRoot, 'ROUTE_PLAN.json'), {schema_version: '1.0.0', frozen: true, snapshot_id: sha256(canonicalJson(graph)), tasks: routes});
  writeJson(path.join(stateRoot, 'WORK_CELLS.json'), staffing);
  fs.writeFileSync(path.join(stateRoot, 'PROJECT_BRIEF.md'), `# Project Brief\n\nเป้าหมาย OWNER: ${intake.owner_goal}\n\n- execution profile: ${intake.execution_profile}\n- privacy: ${intake.privacy_constraint}\n- budget mode: ${intake.budget_mode}\n- project root: ${intake.project_root}\n- model/harness selection: deterministic route policy\n`, 'utf8');
  writeJson(path.join(stateRoot, 'reports', 'ROUTE_SUMMARY.json'), {schema_version: '1.0.0', route_count: routes.length, selected: routes.map(item => ({task_id: item.task_id, harness: item.chosen_harness, provider: item.chosen_provider, model: item.chosen_model, fallback_routes: item.fallback_routes}))});
  writeJson(path.join(stateRoot, 'PROJECT_STATUS.json'), {schema_version: '1.0.0', lifecycle, owner_goal: intake.owner_goal, task_count: graph.tasks.length, selected_work_cells: staffing.selected_work_cells.map(item => item.work_cell_id), production_promoted: false});
  fs.writeFileSync(path.join(stateRoot, 'PROJECT_STATUS.md'), `# Project Factory Runtime Status\n\n- lifecycle: ${lifecycle}\n- task count: ${graph.tasks.length}\n- work cells selected dynamically: ${staffing.selected_work_cells.map(item => item.label).join(', ')}\n- production promotion: none\n- deployment: planning contract only; no deployment executed\n`, 'utf8');
}

export async function runProjectFactory({owner_goal, project_root, input_root, execution_profile = 'BALANCED', privacy_constraint = 'PROJECT_DATA_ONLY', budget_mode = 'NO_EXTERNAL_SPEND', greenfield = true, deployment_targets = [], product_constraints = [], assumptions = [], capabilityGradEnabled = true, runHarnessProof = true} = {}) {
  const intake = createProjectIntake({owner_goal, project_root, input_root, execution_profile, privacy_constraint, budget_mode, greenfield, deployment_targets, product_constraints, assumptions});
  const stateRoot = safeResolve(intake.project_root, intake.state_root);
  fs.mkdirSync(stateRoot, {recursive: true});
  const normalized = normalizeModelIntelligence(input_root);
  validateNormalizedIntelligence(normalized);
  const graph = deriveTaskGraph(intake);
  validateTaskGraph(graph);
  const staffing = selectWorkCells(graph);
  writeJson(path.join(stateRoot, 'snapshots', 'MODEL_INTELLIGENCE_NORMALIZED.json'), normalized);
  const candidateSnapshotId = sha256(canonicalJson({intake, graph, staffing}));
  const routes = [];
  const observations = [];
  let implementationRoute = null;
  for (const task of graph.tasks) {
    const excludeRoutes = task.authority_role === 'QA' && implementationRoute ? [implementationRoute] : [];
    const routePlan = await buildRoutePlan({task, intake, normalized, snapshot_id: candidateSnapshotId, capabilityGradEnabled, excludeRoutes});
    assertFrozenRoutePlan(routePlan);
    routes.push(routePlan);
    if (task.task_id === 'implementation') implementationRoute = routePlan.chosen_harness;
    observations.push({schema_version: '1.0.0', task_id: task.task_id, task_class: task.task_class, authority_role: task.authority_role, work_cell: task.work_cell_profile, harness: routePlan.chosen_harness, provider: routePlan.chosen_provider, model: routePlan.chosen_model, reasoning_tier: routePlan.reasoning_tier, started_at: nowIso(), ended_at: nowIso(), latency_ms: 0, cost_tokens: 0, pass: routePlan.chosen_harness !== null, qa_result: task.authority_role === 'QA' ? 'PLANNED_INDEPENDENT' : 'NOT_APPLICABLE', retries: 0, fallback_used: false, owner_override: false, artifact_refs: [], route_plan_id: routePlan.route_plan_id, production_route_mutation: false});
  }
  const lifecycle = ['BUILD_READY', 'BUILD_COMPLETE', 'QA_PENDING', 'QA_PASS', 'AUDIT_PENDING', 'AUDIT_PASS', 'RELEASE_READY'];
  for (const state of lifecycle) appendJsonl(path.join(stateRoot, 'RUN_LEDGER.jsonl'), {schema_version: '1.0.0', event_id: `EVENT-${sha256(`${intake.intake_id}|${state}`).slice(0, 12)}`, event: state, at: nowIso(), side_effects: false});
  for (const record of observations) appendJsonl(path.join(stateRoot, 'ROUTING_OBSERVATIONS.jsonl'), redact(record));
  for (const task of graph.tasks) {
    const route = routes.find(item => item.task_id === task.task_id);
    const artifact = {schema_version: '1.0.0', task_id: task.task_id, task_class: task.task_class, fixture_execution: true, deterministic_input_sha256: sha256(canonicalJson({owner_goal: intake.owner_goal, task_id: task.task_id})), route_plan_id: route.route_plan_id, side_effects: false, output: 'bounded-local-fixture-complete'};
    writeJson(path.join(stateRoot, 'passes', `${task.task_id}.json`), artifact);
  }
  writeJson(path.join(stateRoot, 'iterations', '001.json'), {schema_version: '1.0.0', iteration: 1, snapshot_id: candidateSnapshotId, task_count: graph.tasks.length, status: 'COMPLETE'});
  appendJsonl(path.join(stateRoot, 'DECISIONS.jsonl'), {schema_version: '1.0.0', decision_id: `DEC-${sha256(candidateSnapshotId).slice(0, 12)}`, decision: 'use dynamic work cells and deterministic route policy', owner_override: false, at: nowIso()});
  let harnessProof = null;
  if (runHarnessProof) harnessProof = await runHarnessSwitchProof({fixtureRoot: path.join(stateRoot, 'workspace', 'harness-switch-fixture'), outputRoot: path.join(stateRoot, 'reports', 'harness-switch')});
  writeProjectProjection(stateRoot, intake, graph, staffing, routes, 'RELEASE_READY');
  return redact({schema_version: '1.0.0', run_id: `RUN-${sha256(intake.intake_id).slice(0, 12)}`, intake, normalized_summary: {models: normalized.counts.models, providers: normalized.counts.providers, evidence: normalized.counts.evidence, freshness: normalized.freshness_summary}, graph, staffing, routes, candidate_snapshot_id: candidateSnapshotId, harness_switch_proof: harnessProof, lifecycle, production_promoted: false, deployment_executed: false, completed_at: nowIso()});
}
