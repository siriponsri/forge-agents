import { audit, changed, fail, find, human, mutate, revision, text } from './common.mjs';

const live = new Set(['submitting', 'preparing', 'queued', 'starting', 'running', 'waiting', 'unknown']);
const context = x => x.governance ?? {};
function nullable(value, label) { return value === null ? null : text(value, label); }
function chain(s, collection, firstId, projectId, field, forbiddenId) {
  const result = [], seen = new Set(forbiddenId ? [forbiddenId] : []);
  let id = firstId;
  while (id) {
    if (seen.has(id)) fail('CYCLE', 'Reporting or task-parent cycle', 409);
    seen.add(id); const x = find(s, collection, id, projectId); result.push(x); id = context(x)[field];
  }
  return result;
}
function goal(s, task, projectId) {
  const id = context(task).goalId ?? task.planId ?? null;
  return id ? find(s, 'plans', id, projectId) : null;
}
function taskLinks(s, task, projectId) {
  if (task.botId) {
    const bot = find(s, 'bots', task.botId, projectId);
    if (bot.kind === 'helper' && bot.taskId !== task.id) fail('TASK_OWNER', 'Assigned helper belongs to another task', 403);
  }
  const ancestors = chain(s, 'tasks', context(task).parentTaskId, projectId, 'parentTaskId', task.id);
  const targetGoal = goal(s, task, projectId);
  if (task.planId && targetGoal?.id !== task.planId) fail('GOAL_SCOPE', 'Task goal must be its existing plan', 409);
  for (const ancestor of ancestors) if (goal(s, ancestor, projectId)?.id !== targetGoal?.id) fail('GOAL_SCOPE', 'Parent task belongs to a different goal', 409);
  return { ancestors, targetGoal };
}
// A pure validation seam for lead-owned generic CRUD and portable restore. It
// does not change an owner, status, approval, task record or execution lease.
export function validateProjectContext(s, { projectId }) {
  find(s, 'projects', projectId);
  for (const bot of s.bots.filter(b => b.projectId === projectId)) {
    if (bot.taskId) find(s, 'tasks', bot.taskId, projectId);
    if (bot.kind === 'helper' && !bot.taskId) fail('TASK_OWNER', 'A helper requires its existing task', 403);
    chain(s, 'bots', context(bot).managerBotId, projectId, 'managerBotId', bot.id);
  }
  for (const task of s.tasks.filter(t => t.projectId === projectId)) taskLinks(s, task, projectId);
  return true;
}
function actorOf(s, i, task) {
  if (i.actor?.kind === 'human') return human(i.actor);
  if (i.actor?.kind !== 'agent') fail('ACTOR_REQUIRED', 'A human or mapped agent actor is required', 403);
  const { botId, runId, attemptId } = i.actor;
  const bot = find(s, 'bots', text(botId, 'botId'), i.projectId), run = find(s, 'runs', text(runId, 'runId'), i.projectId);
  if (task.botId !== bot.id || run.botId !== bot.id || run.taskId !== task.id || run.attemptId !== text(attemptId, 'attemptId')) fail('TASK_OWNER', 'Agent context does not match this task bot/run/attempt', 403);
  if (bot.kind === 'helper' && bot.taskId !== task.id) fail('TASK_OWNER', 'Helper belongs to another task', 403);
  if (s.runs.some(r => r.projectId === i.projectId && r.taskId === task.id && r.id !== run.id && live.has(r.status))) fail('TASK_OWNER', 'Another execution owns this task; reconcile it first', 409);
  if (task.runIds?.length && task.runIds.at(-1) !== run.id) fail('TASK_OWNER', 'Only the latest mapped task attempt may leave agent context', 409);
  return { kind: 'agent', botId, runId, attemptId };
}
function nextActionOf(s, i, task) {
  if (i.nextAction === null) return null;
  const next = i.nextAction;
  if (!next || !['review', 'run', 'inspect', 'resolve'].includes(next.kind)) fail('NEXT_ACTION', 'Choose review, run, inspect or resolve');
  const result = { kind: next.kind, summary: text(next.summary, 'next action', 2000), taskId: task.id };
  for (const [key, collection] of [['runId', 'runs'], ['artifactId', 'artifacts'], ['documentId', 'documents']]) if (next[key]) {
    const ref = find(s, collection, next[key], i.projectId);
    if (key === 'runId' && ref.taskId !== task.id) fail('TASK_OWNER', 'Next action run belongs to another task', 403);
    if (key === 'artifactId' && ref.taskId && ref.taskId !== task.id) fail('TASK_OWNER', 'Next action artifact belongs to another task', 403);
    result[key] = ref.id;
  }
  if (next.kind === 'run' && (next.runId || next.artifactId || next.documentId)) fail('NEXT_ACTION', 'Run starts this task through its current T3 owner');
  return result;
}
export function taskProjection(s, input) {
  find(s, 'projects', input.projectId);
  const task = find(s, 'tasks', input.taskId, input.projectId), bot = task.botId ? find(s, 'bots', task.botId, input.projectId) : null;
  const { ancestors, targetGoal } = taskLinks(s, task, input.projectId), blockers = [];
  if (!task.planId || find(s, 'plans', task.planId, input.projectId).approved !== true) blockers.push('plan_approval_required');
  for (const id of task.dependsOn ?? []) if (find(s, 'tasks', id, input.projectId).status !== 'done') blockers.push(`dependency:${id}`);
  const activeRuns = s.runs.filter(r => r.projectId === input.projectId && r.taskId === task.id && live.has(r.status));
  if (activeRuns.length) blockers.push('existing_execution_requires_reconciliation');
  if (task.status === 'done') blockers.push('task_done');
  if (bot?.status === 'retired') blockers.push('bot_retired');
  const action = context(task).nextAction ?? null;
  return {
    projectId: input.projectId, task: structuredClone(task), bot: bot ? structuredClone(bot) : null,
    ancestors: ancestors.map(x => ({ id: x.id, title: x.title, status: x.status, revision: x.revision })),
    goal: targetGoal ? { id: targetGoal.id, kind: 'plan', name: targetGoal.name, description: targetGoal.description ?? '', approved: targetGoal.approved === true, revision: targetGoal.revision } : null,
    reportingChain: bot ? chain(s, 'bots', context(bot).managerBotId, input.projectId, 'managerBotId', bot.id).map(x => ({ id: x.id, name: x.name, role: x.role ?? '', responsibilities: context(x).responsibilities ?? [] })) : [],
    activeRuns: activeRuns.map(r => ({ id: r.id, status: r.status, botId: r.botId ?? null, attemptId: r.attemptId ?? null })),
    nextAction: structuredClone(action), blockers,
    // A command template for an explicit UI action, never an automatic wake.
    executable: action?.kind === 'run' && !blockers.length ? { owner: 't3', method: 'POST', path: '/api/runs/start', input: { projectId: input.projectId, taskId: task.id }, requiresNewOperationId: true } : null,
  };
}
export function createContextMethods({ store }) {
  return {
    organization({ projectId }) {
      const s = store.read(); find(s, 'projects', projectId);
      validateProjectContext(s, { projectId });
      return { projectId, bots: s.bots.filter(b => b.projectId === projectId).map(b => {
        chain(s, 'bots', context(b).managerBotId, projectId, 'managerBotId', b.id);
        return { id: b.id, revision: b.revision, name: b.name, role: b.role ?? '', kind: b.kind,
          taskId: b.taskId ?? null, managerBotId: context(b).managerBotId ?? null, responsibilities: context(b).responsibilities ?? [],
          taskIds: s.tasks.filter(t => t.projectId === projectId && t.botId === b.id).map(t => t.id) };
      }) };
    },
    taskContext(input) { return taskProjection(store.read(), input); },
    async setBotContext(input) {
      return mutate(store, 'bot.context', input, (s, i) => {
        const actor = human(i.actor), bot = find(s, 'bots', i.botId, i.projectId); revision(bot, i.expectedRevision);
        const managerBotId = nullable(i.managerBotId, 'managerBotId');
        chain(s, 'bots', managerBotId, i.projectId, 'managerBotId', bot.id);
        if (!Array.isArray(i.responsibilities) || i.responsibilities.length > 32) fail('VALIDATION', 'Use up to 32 responsibilities');
        const responsibilities = [...new Set(i.responsibilities.map(v => text(v, 'responsibility', 2000)))];
        bot.governance = { ...context(bot), managerBotId, responsibilities }; changed(bot);
        audit(s, i.projectId, 'bot.context', { botId: bot.id, revision: bot.revision, actor, context: bot.governance });
        return bot;
      });
    },
    async setTaskContext(input) {
      return mutate(store, 'task.context', input, (s, i) => {
        const task = find(s, 'tasks', i.taskId, i.projectId); revision(task, i.expectedRevision);
        const actor = actorOf(s, i, task), parentTaskId = nullable(i.parentTaskId, 'parentTaskId'), goalId = nullable(i.goalId, 'goalId');
        const ancestors = chain(s, 'tasks', parentTaskId, i.projectId, 'parentTaskId', task.id);
        if (goalId) find(s, 'plans', goalId, i.projectId);
        // Context supplements the existing approved plan; it cannot silently
        // broaden execution to a different goal/plan.
        const effectiveGoalId = goalId ?? task.planId ?? null;
        if (task.planId && effectiveGoalId !== task.planId) fail('GOAL_SCOPE', 'Task goal must be its existing plan', 409);
        for (const ancestor of ancestors) if (goal(s, ancestor, i.projectId)?.id !== effectiveGoalId) fail('GOAL_SCOPE', 'Parent task belongs to a different goal', 409);
        task.governance = { parentTaskId, goalId, nextAction: nextActionOf(s, i, task), updatedBy: actor }; changed(task);
        validateProjectContext(s, { projectId: i.projectId });
        audit(s, i.projectId, 'task.context', { taskId: task.id, revision: task.revision, actor, context: task.governance });
        return task;
      });
    },
  };
}
