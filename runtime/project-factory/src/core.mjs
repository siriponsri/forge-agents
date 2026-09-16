import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const EXECUTION_PROFILES = ['BALANCED', 'QUALITY_FIRST', 'ECONOMY', 'LOCAL_PRIVATE'];
export const FRESHNESS_STATES = ['FRESH', 'STALE', 'UNKNOWN'];
export const EVIDENCE_CLASSES = [
  'PROVIDER_REPORTED', 'OFFICIAL_MODEL_CARD', 'OFFICIAL_TECHNICAL_REPORT',
  'INDEPENDENT_BENCHMARK', 'LOCAL_RUNTIME_EVIDENCE', 'PROJECT_OUTCOME_EVIDENCE'
];
export const AUTHORITY_ROLES = ['PLANNER', 'DEVELOPER', 'QA'];
export const TASK_CLASSES = [
  'planning.requirements', 'planning.architecture', 'research.web', 'research.academic',
  'research.data', 'coding.frontend', 'coding.backend', 'coding.fullstack', 'coding.ai_ml',
  'coding.devops', 'coding.refactor', 'coding.debug', 'testing.unit', 'testing.integration',
  'testing.browser', 'review.code', 'review.security', 'review.architecture', 'review.ui',
  'audit.evidence', 'writing.docs', 'writing.business', 'deployment.local', 'deployment.cloud'
];
export const LIFECYCLE_STATES = [
  'BUILD_READY', 'BUILD_COMPLETE', 'QA_PENDING', 'QA_PASS', 'QA_FAIL', 'AUDIT_PENDING',
  'AUDIT_PASS', 'RELEASE_READY', 'NEEDS_OWNER_APPROVAL', 'DEPLOYMENT_PENDING', 'DEPLOYED',
  'POST_DEPLOY_VERIFIED', 'ROLLBACK_REQUIRED'
];

export function nowIso() { return new Date().toISOString(); }
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}
export function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
export function sha256(value) {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array ? value : Buffer.from(String(value));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
export function normalizeId(value) {
  return String(value ?? 'UNKNOWN').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}
export function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')); }
export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}
export function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.appendFileSync(filePath, `${canonicalJson(value)}\n`, 'utf8');
}
export function assert(condition, message) { if (!condition) throw new Error(`P7.5_CONTRACT_VIOLATION: ${message}`); }
export function assertProfile(profile) { assert(EXECUTION_PROFILES.includes(profile), `unknown execution profile ${profile}`); }
export function assertTaskClass(taskClass) { assert(TASK_CLASSES.includes(taskClass), `unknown task class ${taskClass}`); }
export function assertRole(role) { assert(AUTHORITY_ROLES.includes(role), `unknown authority role ${role}`); }
export function assertFreshness(value) { assert(FRESHNESS_STATES.includes(value), `unknown freshness ${value}`); }
export function safeResolve(root, child) {
  const resolvedRoot = path.resolve(root);
  const resolvedChild = path.resolve(child);
  assert(resolvedChild === resolvedRoot || resolvedChild.startsWith(`${resolvedRoot}${path.sep}`), 'path escaped approved root');
  return resolvedChild;
}
export function redact(value) {
  const sensitive = /(token|secret|password|passwd|api[_-]?key|authorization|credential|private[_-]?key|access[_-]?key|cookie|scratchpad|hidden[_-]?reasoning)/i;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, sensitive.test(key) ? '[REDACTED]' : redact(val)]));
  }
  if (typeof value === 'string' && /(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]+)/i.test(value)) return '[REDACTED]';
  return value;
}
export function parseFreshness(observedAt, freshnessWindow, at = new Date()) {
  if (!observedAt || !freshnessWindow) return 'UNKNOWN';
  const observed = new Date(observedAt);
  if (Number.isNaN(observed.getTime())) return 'UNKNOWN';
  const match = String(freshnessWindow).match(/^(\d+)\s*(d|h|m)$/i);
  if (!match) return /^until superseded$/i.test(String(freshnessWindow).trim()) ? 'UNKNOWN' : 'UNKNOWN';
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const ms = amount * (unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000);
  return at.getTime() - observed.getTime() <= ms ? 'FRESH' : 'STALE';
}
export function sortedUnique(values) { return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b))); }
