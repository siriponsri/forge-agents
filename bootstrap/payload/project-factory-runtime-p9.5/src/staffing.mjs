import {assert, nowIso, sha256, sortedUnique} from './core.mjs';

export const WORK_CELLS = {
  'product-tech-lead': {label: 'Product / Tech Lead', capabilities: ['planning', 'architecture', 'structured-output']},
  'ai-research': {label: 'Research / AI', capabilities: ['research', 'evidence', 'data']},
  frontend: {label: 'Frontend', capabilities: ['coding', 'tool-use', 'ui-ux', 'testing']},
  backend: {label: 'Backend', capabilities: ['coding', 'tool-use', 'architecture', 'testing']},
  'qa-verification': {label: 'QA / Verification', capabilities: ['testing', 'review', 'structured-output', 'evidence']},
  'auditor-release': {label: 'Auditor / Writer / Release', capabilities: ['audit', 'evidence', 'documentation', 'deployment', 'rollback']}
};

export function selectWorkCells(graph) {
  assert(Array.isArray(graph?.tasks), 'graph.tasks required');
  const selected = Object.entries(WORK_CELLS).filter(([profile]) => graph.tasks.some(item => item.work_cell_profile === profile)).map(([profile, definition]) => {
    const tasks = graph.tasks.filter(item => item.work_cell_profile === profile).map(item => item.task_id);
    return {work_cell_id: profile, label: definition.label, task_ids: tasks, capabilities: sortedUnique(tasks.flatMap(taskId => graph.tasks.find(item => item.task_id === taskId).required_capabilities)), selection_reason: 'required_by_task_graph'};
  });
  return {schema_version: '1.0.0', staffing_id: `STAFF-${sha256(JSON.stringify(selected)).slice(0, 12)}`, created_at: nowIso(), dynamic: true, permanent_team: false, selected_work_cells: selected};
}
