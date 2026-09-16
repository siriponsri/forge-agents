import path from 'node:path';
import {assert, assertProfile, nowIso, normalizeId, safeResolve, sha256} from './core.mjs';

const DEFAULT_DECISIONS = [
  {id: 'deployment-approval', label: 'อนุมัติ deployment เป้าหมาย', required: true},
  {id: 'external-spend', label: 'อนุมัติค่าใช้จ่ายภายนอก', required: true},
  {id: 'credentials', label: 'ดำเนินการ login/credential', required: true},
  {id: 'destructive-operations', label: 'อนุมัติการเปลี่ยนแปลงที่ย้อนกลับยาก', required: true},
  {id: 'privacy', label: 'ตัดสินใจด้าน privacy/security', required: true},
  {id: 'irreversible-choices', label: 'ยืนยันทางเลือกที่ย้อนกลับไม่ได้', required: true}
];

export function createProjectIntake({owner_goal, project_root, greenfield = true, deployment_targets = [], execution_profile = 'BALANCED', privacy_constraint = 'PROJECT_DATA_ONLY', budget_mode = 'NO_EXTERNAL_SPEND', product_constraints = [], owner_decision_points = [], assumptions = []} = {}) {
  assert(typeof owner_goal === 'string' && owner_goal.trim().length >= 3, 'owner_goal must be a non-empty short goal');
  assert(typeof project_root === 'string' && project_root.trim().length > 0, 'project_root is required');
  assertProfile(execution_profile);
  const root = path.resolve(project_root);
  const decisions = [...DEFAULT_DECISIONS, ...owner_decision_points].reduce((all, item) => {
    const id = normalizeId(item.id || item);
    if (!all.some(existing => existing.id === id)) all.push(typeof item === 'string' ? {id, label: item, required: false} : {...item, id});
    return all;
  }, []);
  const intake = {
    schema_version: '1.0.0',
    intake_id: `INTAKE-${sha256(`${owner_goal.trim()}|${root}`).slice(0, 12)}`,
    created_at: nowIso(),
    owner_goal: owner_goal.trim(),
    project_root: root,
    state_root: path.join(root, '.agent-state', 'hoh'),
    greenfield: Boolean(greenfield),
    deployment_targets: Array.isArray(deployment_targets) ? deployment_targets : [],
    execution_profile,
    privacy_constraint: String(privacy_constraint || 'PROJECT_DATA_ONLY'),
    budget_mode: String(budget_mode || 'NO_EXTERNAL_SPEND'),
    product_constraints: Array.isArray(product_constraints) ? product_constraints : [],
    owner_decision_points: decisions,
    assumptions: Array.isArray(assumptions) ? assumptions : [],
    model_selection: 'DEFERRED_TO_DETERMINISTIC_ROUTE_POLICY',
    harness_selection: 'DEFERRED_TO_DETERMINISTIC_ROUTE_POLICY'
  };
  return intake;
}

export function assertProjectIntake(intake) {
  assert(intake?.schema_version === '1.0.0', 'intake schema_version');
  assert(typeof intake.owner_goal === 'string' && intake.owner_goal.length >= 3, 'intake owner_goal');
  assertProfile(intake.execution_profile);
  assert(path.isAbsolute(intake.project_root), 'project_root must be absolute');
  safeResolve(intake.project_root, intake.state_root);
  return true;
}
