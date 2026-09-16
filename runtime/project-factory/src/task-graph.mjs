import {assert, assertRole, assertTaskClass, nowIso, sha256, sortedUnique} from './core.mjs';

function task({task_id, goal, task_class, dependencies = [], required_capabilities = [], optional_capabilities = [], artifact_scope = [], side_effect_class = 'LOCAL_WORKSPACE_WRITE', authority_role, work_cell_profile, acceptance_criteria = [], routing_constraints = {}, execution_profile, parent_task_id = null, estimated_risk = 'LOW', owner_decision_required = false, owner_decision_ref = null}) {
  assertTaskClass(task_class); assertRole(authority_role);
  return {task_id, goal, task_class, dependencies: sortedUnique(dependencies), required_capabilities: sortedUnique(required_capabilities), optional_capabilities: sortedUnique(optional_capabilities), artifact_scope, side_effect_class, authority_role, work_cell_profile, acceptance_criteria, routing_constraints, execution_profile, status: 'PENDING', evidence_refs: [], parent_task_id, estimated_risk, owner_decision_required, owner_decision_ref};
}

export function deriveTaskGraph(intake) {
  const goal = intake.owner_goal.toLowerCase();
  const wantsFrontend = /(ui|ux|frontend|web|หน้า|เว็บไซต์|dashboard|หน้าเว็บ)/i.test(goal);
  const wantsBackend = /(api|backend|server|database|service|ระบบ|ข้อมูล)/i.test(goal);
  const wantsResearch = /(research|ค้นคว้า|วิจัย|เปรียบเทียบ|ข้อมูล)/i.test(goal);
  const wantsDeployment = /(deploy|deployment|docker|vercel|railway|เผยแพร่)/i.test(goal);
  const implementationClass = wantsFrontend && wantsBackend ? 'coding.fullstack' : wantsFrontend ? 'coding.frontend' : wantsBackend ? 'coding.backend' : 'coding.fullstack';
  const tasks = [
    task({task_id: 'requirements', goal: `กำหนด requirements ที่ตรวจสอบได้สำหรับ: ${intake.owner_goal}`, task_class: 'planning.requirements', authority_role: 'PLANNER', work_cell_profile: 'product-tech-lead', required_capabilities: ['planning', 'structured-output'], artifact_scope: ['PROJECT_BRIEF.md', 'GOALS.json'], acceptance_criteria: ['goal is explicit', 'scope and assumptions recorded'], execution_profile: intake.execution_profile, estimated_risk: 'LOW'}),
    task({task_id: 'architecture', goal: 'ออกแบบ boundary, acceptance criteria และ task graph', task_class: 'planning.architecture', dependencies: ['requirements'], authority_role: 'PLANNER', work_cell_profile: 'product-tech-lead', required_capabilities: ['architecture', 'planning'], artifact_scope: ['DECISIONS.jsonl', 'TASK_GRAPH.json'], acceptance_criteria: ['dependencies are acyclic', 'authority roles are explicit'], execution_profile: intake.execution_profile, estimated_risk: 'MEDIUM'}),
    task({task_id: 'implementation', goal: `ทำ bounded implementation สำหรับ: ${intake.owner_goal}`, task_class: implementationClass, dependencies: ['architecture'], authority_role: 'DEVELOPER', work_cell_profile: wantsFrontend ? (wantsBackend ? 'backend' : 'frontend') : 'backend', required_capabilities: ['coding', 'tool-use'], optional_capabilities: wantsFrontend ? ['ui-ux'] : [], artifact_scope: ['workspace/**'], acceptance_criteria: ['local fixture executes', 'no external side effect'], execution_profile: intake.execution_profile, estimated_risk: 'MEDIUM'}),
    task({task_id: 'integration-test', goal: 'ตรวจ integration ของ bounded result และ artifact persistence', task_class: 'testing.integration', dependencies: ['implementation'], authority_role: 'QA', work_cell_profile: 'qa-verification', required_capabilities: ['testing', 'structured-output'], artifact_scope: ['passes/**', 'iterations/**'], acceptance_criteria: ['result schema validates', 'candidate snapshot is referenced'], execution_profile: intake.execution_profile, estimated_risk: 'MEDIUM'}),
    task({task_id: 'audit', goal: 'ตรวจ evidence, provenance และ boundary ก่อน handoff', task_class: 'audit.evidence', dependencies: ['integration-test'], authority_role: 'QA', work_cell_profile: 'auditor-release', required_capabilities: ['audit', 'evidence'], artifact_scope: ['reports/**', 'RUN_LEDGER.jsonl'], acceptance_criteria: ['all evidence is redacted', 'no forbidden mutation'], execution_profile: intake.execution_profile, estimated_risk: 'LOW'})
  ];
  if (wantsResearch) tasks.splice(2, 0, task({task_id: 'research', goal: 'รวบรวม evidence ที่จำเป็นต่อ project goal', task_class: 'research.web', dependencies: ['architecture'], authority_role: 'PLANNER', work_cell_profile: 'ai-research', required_capabilities: ['research', 'evidence'], artifact_scope: ['research/**'], acceptance_criteria: ['sources are recorded', 'unknown remains unknown'], execution_profile: intake.execution_profile, estimated_risk: 'MEDIUM'}));
  if (wantsDeployment) tasks.push(task({task_id: 'deployment-plan', goal: 'เตรียม deployment/health-check/rollback contract (ยังไม่ deploy)', task_class: 'deployment.local', dependencies: ['integration-test'], authority_role: 'DEVELOPER', work_cell_profile: 'auditor-release', required_capabilities: ['deployment', 'rollback'], artifact_scope: ['reports/deployment-plan.json'], acceptance_criteria: ['authorization and rollback are explicit', 'no deployment executed'], execution_profile: intake.execution_profile, owner_decision_required: true, owner_decision_ref: 'deployment-approval', estimated_risk: 'HIGH'}));
  const graph = {schema_version: '1.0.0', graph_id: `GRAPH-${sha256(JSON.stringify(tasks.map(item => item.task_id))).slice(0, 12)}`, created_at: nowIso(), intake_id: intake.intake_id, execution_profile: intake.execution_profile, tasks};
  validateTaskGraph(graph);
  return graph;
}

export function validateTaskGraph(graph) {
  assert(graph?.schema_version === '1.0.0' && Array.isArray(graph.tasks), 'task graph shape');
  const ids = new Set(graph.tasks.map(item => item.task_id));
  assert(ids.size === graph.tasks.length, 'task IDs must be unique');
  for (const item of graph.tasks) {
    assertTaskClass(item.task_class); assertRole(item.authority_role);
    for (const dep of item.dependencies) assert(ids.has(dep), `missing dependency ${dep}`);
  }
  const visiting = new Set(); const visited = new Set();
  const visit = id => { if (visiting.has(id)) throw new Error(`P7.5_CONTRACT_VIOLATION: task cycle at ${id}`); if (visited.has(id)) return; visiting.add(id); const item = graph.tasks.find(candidate => candidate.task_id === id); for (const dep of item.dependencies) visit(dep); visiting.delete(id); visited.add(id); };
  for (const id of ids) visit(id);
  return {valid: true, task_count: graph.tasks.length, dependency_count: graph.tasks.reduce((sum, item) => sum + item.dependencies.length, 0)};
}
