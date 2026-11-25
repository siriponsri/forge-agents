const active = new Set(['queued', 'submitting', 'submitted', 'starting', 'running', 'stopping']);
const uncertain = new Set(['unknown', 'interrupted', 'awaiting-owner']);
export function graphTone(status) {
  if (active.has(status)) return 'active';
  if (uncertain.has(status) || ['waiting', 'review', 'blocked'].includes(status)) return 'attention';
  if (['completed', 'done', 'verified'].includes(status)) return 'success';
  if (['failed', 'error'].includes(status)) return 'danger';
  return 'neutral';
}
export function createConversationGraph(state, projectId, conversationId) {
  const scoped = key => (state?.[key] ?? []).filter(record => record.projectId === projectId);
  const room = scoped('conversations').find(record => record.id === conversationId);
  if (!room) return {nodes: [], edges: [], runs: [], omittedRuns: 0, width: 1024, height: 440};
  const allRuns = scoped('runs').filter(record => record.conversationId === room.id);
  const rank = record => active.has(record.status) || uncertain.has(record.status) ? 0 : 1;
  const runs = [...allRuns].sort((left, right) => rank(left) - rank(right) || String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')) || left.id.localeCompare(right.id)).slice(0, 8);
  const bots = new Map(scoped('bots').map(record => [record.id, record]));
  const artifacts = new Map(scoped('artifacts').map(record => [record.id, record]));
  const tasks = new Map(scoped('tasks').map(record => [record.id, record]));
  const nodes = [], edges = [], groups = new Map();
  const connect = (source, target, kind) => edges.push({id: `${source}/${target}/${kind}`, source, target, kind});
  let nextY = 68;
  const orderedRuns = [...new Set(runs.map(run => bots.has(run.botId) ? run.botId : 'unattributed'))].flatMap(group => runs.filter(run => (bots.has(run.botId) ? run.botId : 'unattributed') === group));
  for (const run of orderedRuns) {
    const bot = bots.get(run.botId), group = bot?.id ?? 'unattributed';
    if (!groups.has(group)) groups.set(group, {bot, rows: []});
    const tools = Object.values(run.toolObservations ?? {}).sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const outputs = [...new Set(run.artifactIds ?? [])].map(id => artifacts.get(id)).filter(Boolean);
    const rowHeight = Math.max(148, (Math.min(3, tools.length) + Math.min(2, outputs.length)) * 112);
    const runNode = {id: `run:${run.id}`, kind: 'run', sourceId: run.id, runId: run.id, observing: run.connection?.status === 'connected', title: tasks.get(run.taskId)?.title ?? run.selection?.model ?? run.id.slice(0, 8), status: run.pendingApprovals?.length || run.pendingInputs?.length ? 'waiting' : run.status, detail: run.selection?.model ?? '', x: 540, y: nextY + (rowHeight - 92) / 2};
    groups.get(group).rows.push(runNode);
    nodes.push(runNode); connect(`bot:${group}`, runNode.id, 'execution');
    for (const [index, tool] of tools.slice(0, 3).entries()) {
      const fileChange = tool.observationKind === 'file_change';
      const status = tool.nonExecutionKind ? 'not-executed' : tool.outputIndicatesFailure ? 'failed' : tool.resultObserved || fileChange ? tool.status : active.has(tool.status) ? tool.status : 'unknown';
      const node = {id: `tool:${run.id}:${tool.id}`, kind: 'tool', sourceId: tool.id, runId: run.id, observing: runNode.observing, title: fileChange ? tool.path ?? tool.id : tool.name ?? tool.id, observationKind: tool.observationKind, status, detail: fileChange ? 'file-change-observed' : tool.resultObserved ? 'result-observed' : 'result-unconfirmed', x: 810, y: nextY + index * 112};
      nodes.push(node); connect(runNode.id, node.id, 'tool');
    }
    for (const [index, artifact] of outputs.slice(0, 2).entries()) {
      const node = {id: `artifact:${run.id}:${artifact.id}`, kind: 'artifact', sourceId: artifact.id, runId: run.id, title: artifact.name ?? artifact.id.slice(0, 8), status: artifact.status ?? 'registered', detail: artifact.sha256 ? 'sha256' : 'registered', x: 810, y: nextY + (Math.min(3, tools.length) + index) * 112};
      nodes.push(node); connect(runNode.id, node.id, 'artifact');
    }
    runNode.hiddenTools = Math.max(0, tools.length - 3);
    runNode.hiddenArtifacts = Math.max(0, outputs.length - 2);
    nextY += rowHeight + 30;
  }
  for (const [group, value] of groups) {
    const status = value.rows.find(row => ['active', 'attention', 'danger'].includes(graphTone(row.status)))?.status ?? value.rows[0]?.status ?? 'idle';
    const node = {id: `bot:${group}`, kind: 'bot', sourceId: value.bot?.id, title: value.bot?.name ?? '', status, detail: value.bot?.role ?? '', x: 270, y: value.rows.reduce((sum, row) => sum + row.y, 0) / value.rows.length};
    nodes.push(node); connect(`room:${room.id}`, node.id, 'room-binding');
  }
  for (const run of runs) if (run.parentRunId && runs.some(parent => parent.id === run.parentRunId)) connect(`run:${run.parentRunId}`, `run:${run.id}`, 'delegation');
  const height = Math.max(440, nextY + 16);
  nodes.unshift({id: `room:${room.id}`, kind: 'room', sourceId: room.id, title: room.name ?? '', status: 'context', detail: room.kind, x: 0, y: Math.max(120, (height - 92) / 2)});
  return {nodes, edges, runs, omittedRuns: allRuns.length - runs.length, width: nodes.some(node => ['artifact', 'tool'].includes(node.kind)) ? 1060 : 790, height};
}
