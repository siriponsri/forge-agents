import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export const EVENT_TYPES = [
  'PROJECT_STARTED','PROJECT_COMPLETED','PROJECT_FAILED_SAFE','PHASE_CHANGED','TASK_QUEUED','TASK_STARTED','TASK_HEARTBEAT','TASK_BLOCKED','TASK_COMPLETED','TASK_FAILED','MODEL_CALL_STARTED','MODEL_CALL_COMPLETED','MODEL_CALL_FAILED','TOOL_CALL_STARTED','TOOL_CALL_COMPLETED','ARTIFACT_ACCEPTED','TEST_RESULT','QA_VERDICT','USAGE_UPDATED','BUDGET_WARNING','BUDGET_CRITICAL','PROVIDER_HEALTH_CHANGED','PROVIDER_LIMIT_DETECTED','PAUSE_REQUESTED','PAUSED_SAFE','RESUME_REQUESTED','RESUMED','FALLBACK_PROPOSED','FALLBACK_ALLOWED','FALLBACK_REJECTED','OWNER_ACTION_REQUIRED','ALERT_RESOLVED'
];
export const SOURCES = ['FACTORY','HARNESS','TOOL','QA','OWNER','MONITOR'];
export const DEFAULT_LIMITS = { max_model_calls: 40, max_concurrent_model_tasks: 4, max_retries: 6, max_fallbacks: 4, max_wall_minutes: 240, max_tokens: 'UNKNOWN', max_observed_cost_usd: 'UNKNOWN' };
export const THRESHOLDS = { warning_ratio: 0.70, critical_ratio: 0.90, drain_ratio: 0.95, hard_ratio: 1.00 };

export function nowIso() { return new Date().toISOString(); }
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  return value;
}
export function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
export function sha256(value) { return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(String(value))).digest('hex'); }
export function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
export function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8'); }
export function atomicWriteJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8'); fs.renameSync(tmp, file); }
export function appendJsonl(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, canonicalJson(value) + '\n', 'utf8'); }
export function readJsonl(file) { if (!fs.existsSync(file)) return { events: [], malformed_tail: false, malformed_line: null }; const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); const events = []; let malformedTail = false; let malformedLine = null; for (let index = 0; index < lines.length; index += 1) { const line = lines[index]; if (!line.trim()) continue; try { events.push(JSON.parse(line)); } catch { malformedTail = index === lines.length - 1 || lines.slice(index + 1).every(item => !item.trim()); malformedLine = index + 1; break; } } return { events, malformed_tail: malformedTail, malformed_line: malformedLine }; }
export function redact(value) {
  const keyPattern = /(token|secret|password|api[_-]?key|authorization|credential|cookie|hidden[_-]?reasoning|prompt|output_content)/i;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => { const isSafeMetric = /^(input_tokens|output_tokens|reasoning_tokens|max_model_calls|max_tokens|observed_cost_usd)$/i.test(key); const shouldRedact = keyPattern.test(key) && !isSafeMetric && key !== 'contains_secret' && key !== 'contains_hidden_chain_of_thought'; return [key, shouldRedact ? '[REDACTED]' : redact(item)]; }));
  if (typeof value === 'string' && /(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]+)/i.test(value)) return '[REDACTED]';
  return value;
}

function validateEvent(event) {
  if (event.schema_version !== '1.0.0' || !event.event_id || !Number.isInteger(event.seq) || event.seq < 1 || !event.project_id || !EVENT_TYPES.includes(event.type) || !event.timestamp || !SOURCES.includes(event.source) || !event.data || event.contains_secret !== false || event.contains_hidden_chain_of_thought !== false) throw new Error('P9_5_INVALID_FACTORY_EVENT');
  return true;
}

export class EventLedger extends EventEmitter {
  constructor(stateRoot, projectId) { super(); this.stateRoot = stateRoot; this.projectId = projectId; this.file = path.join(stateRoot, 'FACTORY_EVENTS.jsonl'); fs.mkdirSync(stateRoot, { recursive: true }); const parsed = readJsonl(this.file); this.events = parsed.events.filter(event => event.project_id === projectId); this.malformedTail = parsed.malformed_tail; this.nextSeq = this.events.reduce((max, event) => Math.max(max, Number(event.seq) || 0), 0) + 1; this.events.forEach(validateEvent); }
  emitEvent(type, data = {}, options = {}) { const event = redact({ schema_version: '1.0.0', event_id: `evt-${String(this.nextSeq).padStart(6, '0')}`, seq: this.nextSeq, project_id: this.projectId, run_id: options.run_id ?? null, task_id: options.task_id ?? null, work_cell: options.work_cell ?? null, type, timestamp: nowIso(), source: options.source ?? 'FACTORY', data, evidence_refs: options.evidence_refs ?? [], contains_secret: false, contains_hidden_chain_of_thought: false }); validateEvent(event); appendJsonl(this.file, event); this.events.push(event); this.nextSeq += 1; super.emit('event', event); return event; }
  replay() { const state = { project_id: this.projectId, lifecycle: 'NEW', phase: 'UNKNOWN', paused: false, tasks: {}, usage: { model_calls: 0, observed_cost_usd: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 }, alerts: [], last_event_id: null }; for (const event of this.events) { state.last_event_id = event.event_id; if (event.type === 'PHASE_CHANGED') state.phase = event.data.phase ?? state.phase; if (event.type === 'PROJECT_STARTED') state.lifecycle = 'RUNNING'; if (event.type === 'PROJECT_COMPLETED') state.lifecycle = 'COMPLETE'; if (event.type === 'PROJECT_FAILED_SAFE') state.lifecycle = 'FAILED_SAFE'; if (event.type === 'PAUSED_SAFE') { state.paused = true; state.lifecycle = event.data.state ?? 'PAUSED_BUDGET'; } if (event.type === 'RESUMED') { state.paused = false; state.lifecycle = 'RUNNING'; } if (event.type === 'TASK_STARTED') state.tasks[event.task_id] = { ...(state.tasks[event.task_id] ?? {}), status: 'RUNNING', task_id: event.task_id }; if (event.type === 'TASK_COMPLETED') state.tasks[event.task_id] = { ...(state.tasks[event.task_id] ?? {}), status: 'COMPLETE', task_id: event.task_id }; if (event.type === 'TASK_FAILED') state.tasks[event.task_id] = { ...(state.tasks[event.task_id] ?? {}), status: 'FAILED_SAFE', task_id: event.task_id }; if (event.type === 'USAGE_UPDATED') { const usage = event.data.usage ?? {}; state.usage.model_calls += Number(usage.model_calls ?? 0); state.usage.input_tokens += Number(usage.input_tokens ?? 0); state.usage.output_tokens += Number(usage.output_tokens ?? 0); state.usage.reasoning_tokens += Number(usage.reasoning_tokens ?? 0); state.usage.observed_cost_usd += Number(usage.observed_cost_usd ?? 0); } if (event.type === 'OWNER_ACTION_REQUIRED' || event.type === 'BUDGET_WARNING' || event.type === 'BUDGET_CRITICAL' || event.type === 'PROVIDER_LIMIT_DETECTED') state.alerts.push(event.data); } return state; }
  after(lastEventId) { if (!lastEventId) return this.events; const index = this.events.findIndex(event => event.event_id === lastEventId); return index < 0 ? [] : this.events.slice(index + 1); }
}

export class UsageLedger {
  constructor(stateRoot) { this.file = path.join(stateRoot, 'USAGE_LEDGER.jsonl'); fs.mkdirSync(stateRoot, { recursive: true }); }
  append(receipt) { const value = redact({ schema_version: '1.0.0', ...receipt }); appendJsonl(this.file, value); return value; }
  all() { return readJsonl(this.file).events; }
}

export class AlertLedger {
  constructor(stateRoot, projectId) { this.file = path.join(stateRoot, 'OWNER_ALERTS.jsonl'); this.projectId = projectId; fs.mkdirSync(stateRoot, { recursive: true }); }
  append({ severity, category, dedupe_key, human_message, machine_reason, owner_action_required = false, allowed_actions = [], evidence_refs = [] }) { const existing = readJsonl(this.file).events; if (existing.some(item => item.project_id === this.projectId && item.dedupe_key === dedupe_key && !item.resolved_at)) return existing.find(item => item.dedupe_key === dedupe_key); const alert = { schema_version: '1.0.0', alert_id: `alert-${String(existing.length + 1).padStart(6, '0')}`, project_id: this.projectId, severity, category, created_at: nowIso(), dedupe_key, human_message, machine_reason, owner_action_required, allowed_actions, evidence_refs, resolved_at: null }; appendJsonl(this.file, redact(alert)); return alert; }
}

export class QuotaGuard {
  constructor({ stateRoot, projectId, ledger, usageLedger, alertLedger, limits = DEFAULT_LIMITS, thresholds = THRESHOLDS } = {}) { this.projectId = projectId; this.ledger = ledger; this.usageLedger = usageLedger; this.alertLedger = alertLedger; this.limits = { ...DEFAULT_LIMITS, ...limits }; this.thresholds = thresholds; this.state = 'HEALTHY'; this.usage = { model_calls: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, observed_cost_usd: 0 }; }
  ratio() { const max = Number(this.limits.max_model_calls); return Number.isFinite(max) && max > 0 ? this.usage.model_calls / max : null; }
  record(receipt) { const usage = { model_calls: 1, input_tokens: receipt.input_tokens ?? 0, output_tokens: receipt.output_tokens ?? 0, reasoning_tokens: receipt.reasoning_tokens ?? 0, observed_cost_usd: typeof receipt.observed_cost === 'number' ? receipt.observed_cost : 0 }; this.usage.model_calls += 1; this.usage.input_tokens += Number(usage.input_tokens) || 0; this.usage.output_tokens += Number(usage.output_tokens) || 0; this.usage.reasoning_tokens += Number(usage.reasoning_tokens) || 0; this.usage.observed_cost_usd += Number(usage.observed_cost_usd) || 0; const state = this.ratio() == null ? 'HEALTHY' : this.ratio() >= this.thresholds.hard_ratio ? 'PAUSED_BUDGET' : this.ratio() >= this.thresholds.drain_ratio ? 'DRAINING' : this.ratio() >= this.thresholds.critical_ratio ? 'CRITICAL' : this.ratio() >= this.thresholds.warning_ratio ? 'WARNING' : 'HEALTHY'; this.usageLedger.append({ project_id: this.projectId, ...receipt }); this.ledger.emitEvent('USAGE_UPDATED', { usage, state, ratio: this.ratio() }, { source: 'FACTORY', task_id: receipt.task_id }); if (state !== this.state) { this.state = state; if (state === 'WARNING' || state === 'CRITICAL') { this.ledger.emitEvent(state === 'WARNING' ? 'BUDGET_WARNING' : 'BUDGET_CRITICAL', { state, ratio: this.ratio(), owner_action_required: false }, { source: 'FACTORY' }); this.alertLedger.append({ severity: state === 'WARNING' ? 'WARNING' : 'ACTION_REQUIRED', category: 'LOCAL_RUN_BUDGET', dedupe_key: `budget-${state}`, human_message: `Local run budget is ${state.toLowerCase()}.`, machine_reason: `model_calls_ratio=${this.ratio()}`, owner_action_required: false, allowed_actions: ['Pause safely'] }); } if (state === 'DRAINING' || state === 'PAUSED_BUDGET') this.ledger.emitEvent('PAUSED_SAFE', { state, reason: 'local_budget_threshold' }, { source: 'FACTORY' }); } return { ...this.usage, state: this.state, ratio: this.ratio() }; }
  canDispatch(optional = false) { const ratio = this.ratio(); if (ratio == null) return true; if (ratio >= this.thresholds.hard_ratio || ratio >= this.thresholds.drain_ratio) return false; if (optional && ratio >= this.thresholds.critical_ratio) return false; return true; }
}

export function saveCheckpoint(stateRoot, value) { const checkpoint = { schema_version: '1.0.0', checkpoint_id: `ckpt-${sha256(canonicalJson(value)).slice(0, 16)}`, created_at: nowIso(), ...redact(value) }; atomicWriteJson(path.join(stateRoot, 'CHECKPOINT.json'), checkpoint); return checkpoint; }
export function loadCheckpoint(stateRoot) { const file = path.join(stateRoot, 'CHECKPOINT.json'); return fs.existsSync(file) ? readJson(file) : null; }
export function saveResumePlan(stateRoot, value) { atomicWriteJson(path.join(stateRoot, 'RESUME_PLAN.json'), { schema_version: '1.0.0', created_at: nowIso(), ...redact(value) }); }
export function saveQuotaState(stateRoot, value) { atomicWriteJson(path.join(stateRoot, 'QUOTA_STATE.json'), { schema_version: '1.0.0', updated_at: nowIso(), ...redact(value) }); }
export function saveMonitorState(stateRoot, value) { atomicWriteJson(path.join(stateRoot, 'MONITOR_STATE.json'), { schema_version: '1.0.0', rebuilt_at: nowIso(), ...redact(value) }); }
