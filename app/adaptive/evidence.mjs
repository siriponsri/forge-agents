import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { confined } from '../server/domain.mjs';
import { find, fail, integer, digest } from './records.mjs';

export const EVALUATION_LIMITS = Object.freeze({maxChecks:24, maxArtifactBytes:16*1024*1024, maxTotalArtifactBytes:64*1024*1024, maxMs:10000});
const hashPattern = /^[a-f0-9]{64}$/;

export function validateChecks(checks) {
  if (!Array.isArray(checks) || !checks.length) fail('EVIDENCE_REQUIRED', 'Choose actual run, artifact or verifier checks');
  integer(checks.length, 'checks', 1, EVALUATION_LIMITS.maxChecks);
  const keys = new Set();
  for (const c of checks) {
    if (!c || typeof c.key !== 'string' || !c.key || c.key.length > 120 || keys.has(c.key)) fail('VALIDATION', 'Each check needs a unique bounded key');
    keys.add(c.key);
    if (!['runStatus','artifactHash','verifierReceipt'].includes(c.kind)) fail('UNSUPPORTED_CHECK', 'Only runStatus, artifactHash and verifierReceipt are supported');
    if (typeof c.runId !== 'string' || !c.runId) fail('VALIDATION', 'Every check needs its actual runId');
    const allowed = {runStatus:['key','kind','runId'], artifactHash:['key','kind','runId','artifactId','sha256'], verifierReceipt:['key','kind','runId','receiptId']}[c.kind];
    if (Object.keys(c).some(k => !allowed.includes(k))) fail('UNSUPPORTED_CHECK', 'Unexpected check fields; evaluation cannot run code');
    if (c.kind === 'artifactHash' && (!hashPattern.test(c.sha256) || !c.artifactId)) fail('VALIDATION', 'Artifact check needs a SHA-256 and artifactId');
    if (c.kind === 'verifierReceipt' && !c.receiptId) fail('VALIDATION', 'Choose an existing verifier receipt');
  }
  return structuredClone(checks);
}

function belongsToSkill(run, skill) {
  if (!skill) return true;
  return run.adaptiveContext?.skillSnapshots?.some(x => x.id === skill.id && x.version === skill.version && x.sha256 === skill.sha256);
}
function linkedArtifact(a, run) {
  return a.runId === run.id || a.source?.runId === run.id || run.artifactIds?.includes(a.id);
}
export function resolveEvidence(s, refs, projectId) {
  if (!Array.isArray(refs) || !refs.length || refs.length > 24) fail('EVIDENCE_REQUIRED', 'Provide 1..24 concrete evidence references');
  return refs.map(ref => {
    if (!ref || !['run','artifact','verification'].includes(ref.kind)) fail('EVIDENCE_REQUIRED', 'Reference run, artifact or verification records');
    const item = find(s, ref.kind === 'run' ? 'runs' : ref.kind === 'artifact' ? 'artifacts' : 'events', ref.id, projectId);
    if (ref.kind === 'verification' && item.type !== 'verification.result') fail('EVIDENCE_REQUIRED', 'Not an actual verifier record');
    return {kind:ref.kind, id:item.id, revision:item.revision, sha256:digest(item), record:structuredClone(item)};
  });
}

// Reads bounded local bytes and trusted stored verifier observations only. No eval,
// Function constructor, subprocess, shell command or caller-supplied verifier code.
export async function checkEvidence(s, projectId, checks, {skill, taskId}={}) {
  checks = validateChecks(checks);
  const began = Date.now(); let totalBytes = 0;
  const outcomes = [];
  for (const check of checks) {
    if (Date.now() - began > EVALUATION_LIMITS.maxMs) {outcomes.push({...check, status:'FAILED', reason:'EVALUATION_TIME_LIMIT'}); continue;}
    try {
      const run = find(s, 'runs', check.runId, projectId);
      if (taskId && run.taskId !== taskId) fail('EVIDENCE_SCOPE', 'Verification run belongs to a different task');
      if (!belongsToSkill(run, skill)) fail('EVIDENCE_SCOPE', 'Run did not consume this exact skill version');
      if (run.status !== 'completed') fail('RUN_NOT_COMPLETED', `Actual run status is ${run.status}`);
      const evidence = [{kind:'run', id:run.id, revision:run.revision, sha256:digest(run)}];
      if (check.kind === 'artifactHash') {
        const a = find(s, 'artifacts', check.artifactId, projectId);
        if (!linkedArtifact(a, run)) fail('EVIDENCE_SCOPE', 'Artifact is not linked to the selected run');
        if (!['verified','ready'].includes(a.status) || a.sha256 !== check.sha256) fail('INTEGRITY', 'Artifact record does not match selected verification');
        const p = find(s, 'projects', projectId), file = await confined(p.workspace, a.path);
        const handle = await open(file, 'r'); let bytes;
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > EVALUATION_LIMITS.maxArtifactBytes || totalBytes + stat.size > EVALUATION_LIMITS.maxTotalArtifactBytes) fail('EVALUATION_SIZE_LIMIT', 'Artifact exceeds bounded verification budget');
          // Read at most limit+1 even if a file grows after stat.
          bytes = Buffer.alloc(stat.size + 1); const result = await handle.read(bytes, 0, bytes.length, 0); bytes = bytes.subarray(0, result.bytesRead);
          totalBytes += bytes.length;
          if (bytes.length !== stat.size) fail('INTEGRITY', 'Artifact size changed during verification');
        } finally {await handle.close();}
        if (createHash('sha256').update(bytes).digest('hex') !== a.sha256) fail('INTEGRITY', 'Actual artifact bytes changed');
        evidence.push({kind:'artifact', id:a.id, revision:a.revision, sha256:a.sha256, bytes:bytes.length});
      } else if (check.kind === 'verifierReceipt') {
        const receipt = find(s, 'events', check.receiptId, projectId);
        if (receipt.type !== 'verification.result' || receipt.runId !== run.id || receipt.status !== 'PASSED' || !receipt.verifier?.id || !receipt.verifier?.version || !receipt.checkedAt || !Array.isArray(receipt.checks) || !receipt.checks.length || receipt.checks.some(c => c.status !== 'PASSED')) fail('VERIFIER_FAILED', 'An actual passed, versioned verifier receipt for this run is required');
        evidence.push({kind:'verification', id:receipt.id, revision:receipt.revision, sha256:digest(receipt), record:structuredClone(receipt)});
      }
      outcomes.push({...check, status:'PASSED', evidence});
    } catch (e) {
      outcomes.push({...check, status:'FAILED', reason:e.code ?? 'EVIDENCE_UNAVAILABLE', message:e.message});
    }
  }
  return {status:outcomes.every(o => o.status === 'PASSED') ? 'PASSED' : 'FAILED', outcomes, elapsedMs:Date.now()-began, bytesRead:totalBytes,
    limits:EVALUATION_LIMITS, qualifications:{liveProvider:'NOT_RUN', modelQuality:'NOT_RUN', homeUat:'NOT_RUN'}, method:'deterministic checks of selected records and local bytes; no learned optimizer'};
}

export function comparableChecks(baseline, candidate) {
  const signature = checks => checks.map(c => `${c.key}:${c.kind}`).sort().join('\n');
  return signature(baseline) === signature(candidate) && candidate.some(c => c.kind !== 'runStatus');
}
