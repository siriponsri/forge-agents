import { find, records } from './common.mjs';

// Projection only. Decisions are deliberately left with each existing owner.
export function reviewProjection(s, { projectId }) {
  find(s, 'projects', projectId); const items = [];
  const add = (source, sourceId, data) => items.push({ id: `${source}:${sourceId}`, source, sourceId, projectId, ...data });
  for (const a of records(s, 'tool-approval', projectId)) if (a.status === 'pending') add('governance', a.id, {
    status: a.status, title: a.name, revision: a.revision, connectionId: a.connectionId,
    authority: { owner: 'governance', method: 'decideTool', approvalId: a.id, expectedRevision: a.revision },
  });
  for (const r of s.runs.filter(r => r.projectId === projectId)) for (const a of r.pendingApprovals ?? []) {
    const response = s.receipts.find(x => x.type === 't3.permission-response' && x.runId === r.id && x.requestId === a.requestId);
    // An accepted-but-not-yet-refreshed native request is no longer actionable.
    if (response?.status === 'accepted') continue;
    add('t3', `${r.id}:${a.requestId}`, { status: response ? 'reconcile' : 'pending', title: a.prompt ?? a.reason ?? a.requestKind ?? 'Permission', runId: r.id, taskId: r.taskId ?? null,
      authority: { owner: 't3', method: response ? 'reconcile' : 'respondApproval', runId: r.id, requestId: a.requestId } });
  }
  for (const r of s.officeAgent?.requests ?? []) if (r.projectId === projectId && ['pending', 'review', 'conflict', 'uncertain'].includes(r.status)) {
    if (!s.documents.some(d => d.id === r.documentId && d.projectId === projectId)) continue;
    add('office', r.operationId, { status: r.status, title: r.edit?.kind ?? 'Document edit', documentId: r.documentId, taskId: r.taskId ?? null,
      authority: { owner: 'office-agent', method: 'openDocument', documentId: r.documentId, operationId: r.operationId, qualification: 'Mounted editor lease, review and durable-save boundary required' } });
  }
  for (const t of s.tasks.filter(t => t.projectId === projectId && t.status === 'review')) add('task', t.id, {
    status: t.status, title: t.title, revision: t.revision, taskId: t.id, authority: { owner: 'domain', method: 'task.update', taskId: t.id, expectedRevision: t.revision, qualification: 'Completion still requires evidence' },
  });
  for (const j of s.jobs.filter(j => j.projectId === projectId && j.kind === 'storage' && j.status === 'conflict')) add('storage', j.id, {
    status: j.status, title: j.action ?? 'Storage conflict', jobId: j.id, destinationId: j.destinationId ?? null,
    authority: { owner: 'storage', method: 'retry', jobId: j.id, qualification: 'Review current destination heads through existing storage conflict flow' },
  });
  return { projectId, stateRevision: s.revision, items, readOnly: true };
}
