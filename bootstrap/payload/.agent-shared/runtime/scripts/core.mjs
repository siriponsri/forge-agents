import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PHASES = ['S0','S1','S2','S3','S4','S5','S6','S7','S8'];
export const PHASE_NAMES = {
  S0:'Intake', S1:'Discovery', S2:'Goal Ready', S3:'Plan Frozen', S4:'Build',
  S5:'Independent QA', S6:'Integrate', S7:'Release Ready', S8:'Retrospective'
};
export const READINESS = ['READY','READY_WITH_ASSUMPTIONS','NEEDS_OWNER_CHOICE','NOT_RECOMMENDED','HARD_BLOCKED'];
export const ROLES = ['PLANNER','DEVELOPER','QA'];
export const TRANSITIONS = {
  S0:['S1'], S1:['S2'], S2:['S3'], S3:['S4'], S4:['S5'],
  S5:['S4','S6'], S6:['S4','S7'], S7:['S8'], S8:[]
};

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function nowIso() { return new Date().toISOString(); }

function fail(message) { throw new Error(`CONTRACT_VIOLATION: ${message}`); }

export function assertRole(role) {
  if (!ROLES.includes(role)) fail(`unknown role ${role}`);
}

export function assertReadiness(readiness) {
  if (!READINESS.includes(readiness)) fail(`unknown readiness ${readiness}`);
}

export function assertPhase(phase) {
  if (!PHASES.includes(phase)) fail(`unknown phase ${phase}`);
}

export function assertTransition(from, to) {
  assertPhase(from); assertPhase(to);
  if (!(TRANSITIONS[from] || []).includes(to)) fail(`illegal transition ${from}->${to}`);
}

export function transitionRun(run, to, patch = {}) {
  assertTransition(run.phase, to);
  const next = {...run, ...patch, phase:to, updated_at:nowIso()};
  if (to === 'S5' && !next.snapshot_id) fail('S5 requires candidate snapshot_id');
  return next;
}

export function newRun({run_id, goal_id, owner='OWNER', assumptions=[]} = {}) {
  if (!run_id || !goal_id) fail('run_id and goal_id are required');
  return {schema_version:'1.0.0', run_id, goal_id, phase:'S0', status:'ACTIVE', owner,
    assumptions:[...assumptions], created_at:nowIso(), updated_at:nowIso()};
}

export function newPass({pass_id, run_id, role, harness, provider, model, status='PLANNED', snapshot_id} = {}) {
  if (!pass_id || !run_id || !harness) fail('pass_id, run_id and harness are required');
  assertRole(role);
  return {schema_version:'1.0.0', pass_id, run_id, role, harness,
    ...(provider ? {provider} : {}), ...(model ? {model} : {}), status,
    ...(snapshot_id ? {snapshot_id} : {}), artifacts:[]};
}

export function newEvidence({evidence_id, kind, summary, source, hash, artifacts=[], redacted=true} = {}) {
  if (!evidence_id || !kind || !summary || !source) fail('evidence_id, kind, summary and source are required');
  return {schema_version:'1.0.0', evidence_id, kind, summary, source,
    ...(hash ? {hash} : {}), artifacts, redacted, captured_at:nowIso()};
}

export function assertSnapshotStable(run, snapshotId) {
  if (!run.snapshot_id) fail('run has no snapshot_id');
  if (run.snapshot_id !== snapshotId) fail('QA snapshot does not match frozen candidate snapshot');
}

export function assertSingleWriter(existingOwner, requestedOwner) {
  if (existingOwner && requestedOwner && existingOwner !== requestedOwner) fail(`write lease held by ${existingOwner}`);
  return requestedOwner || existingOwner;
}

export function assertWriteAllowed(role, scope) {
  assertRole(role);
  const allowed = {PLANNER:['plan','state'], DEVELOPER:['candidate','state'], QA:['qa-evidence','state']};
  if (!(allowed[role] || []).includes(scope)) fail(`${role} cannot write ${scope}`);
}

export function redact(value) {
  const sensitive = /(token|secret|password|passwd|api[_-]?key|authorization|credential|private[_-]?key|access[_-]?key|chain[_ -]?of[_ -]?thought|reasoning[_ -]?trace|scratchpad|hidden[_ -]?reasoning)/i;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, sensitive.test(key) ? '[REDACTED]' : redact(val)]));
  }
  if (typeof value === 'string' && /(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]+)/i.test(value)) return '[REDACTED]';
  return value;
}

export function appendJsonl(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), {recursive:true});
  fs.appendFileSync(filePath, `${canonicalJson(redact(record))}\n`, 'utf8');
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive:true});
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/,'')); }

export function validateSchema(value, schema, at='$') {
  const errors = [];
  const typeOk = (type, v) => type === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) :
    type === 'array' ? Array.isArray(v) : type === 'string' ? typeof v === 'string' :
    type === 'integer' ? Number.isInteger(v) : type === 'boolean' ? typeof v === 'boolean' : true;
  if (schema.const !== undefined && value !== schema.const) errors.push(`${at} must equal ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at} not in enum`);
  if (schema.type && !typeOk(schema.type, value)) return [`${at} must be ${schema.type}`];
  if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at} too short`);
  if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at} too few items`);
  if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at} below minimum`);
  if (schema.required && value && typeof value === 'object') for (const key of schema.required) if (!(key in value)) errors.push(`${at}.${key} required`);
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(schema.properties)) if (key in value) errors.push(...validateSchema(value[key], child, `${at}.${key}`));
  }
  if (schema.items && Array.isArray(value)) value.forEach((item, i) => errors.push(...validateSchema(item, schema.items, `${at}[${i}]`)));
  return errors;
}

export function assertSchema(value, schema, name='schema') {
  const errors = validateSchema(value, schema);
  if (errors.length) fail(`${name}: ${errors.join('; ')}`);
  return true;
}

export function loadSchema(name) {
  return readJson(path.join(RUNTIME_ROOT, 'schemas', `${name}.schema.json`));
}

export function assertContract(name, value) { return assertSchema(value, loadSchema(name), name); }
