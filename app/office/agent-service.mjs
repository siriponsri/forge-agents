import { randomBytes } from 'node:crypto';
import { fail } from '../server/domain.mjs';
import { OFFICE_AGENT_VERSION, LIMITS, SCOPE_KEYS, digest, object, id, scopeOf, documentOf, scopedDocument, expected, parseEdit, rangeOf, selectedSheet, integer, verifyEffect, actorOf, operationOf } from './agent-contract.mjs';

const final = new Set(['completed', 'conflict', 'rejected']);
const editorKeys = ['projectId', 'documentId', 'editorSessionId', 'leaseToken', 'expectedRevision', 'dirty'];
const requestKeys = [...SCOPE_KEYS, 'operationId'];
function queue(state) {
  state.officeAgent ??= { schemaVersion: OFFICE_AGENT_VERSION, requests: [], leases: [] };
  const q = state.officeAgent;
  if (q.schemaVersion !== OFFICE_AGENT_VERSION || !Array.isArray(q.requests) || !Array.isArray(q.leases)) fail('OFFICE_QUEUE_SCHEMA', 'Retain state for recovery; incompatible office agent queue', 409);
  return q;
}
function requestOf(state, input) {
  const scope = scopeOf(input); scopedDocument(state, scope); id(input.operationId, 'operationId');
  const request = queue(state).requests.find(r => r.operationId === input.operationId);
  if (!request || SCOPE_KEYS.some(k => request[k] !== scope[k])) fail('NOT_FOUND', 'Edit request not found in this scope', 404);
  return request;
}
function publicRequest(r) {
  return structuredClone(Object.fromEntries(['schemaVersion', ...SCOPE_KEYS, 'operationId', 'expectedRevision', 'edit', 'region', 'fingerprint', 'status', 'reason', 'createdAt', 'reviewedAt', 'applyStartedAt', 'finishedAt', 'receipt'].filter(k => r[k] !== undefined).map(k => [k, r[k]])));
}
function leaseOf(state, input, time, { allowExpired = false } = {}) {
  id(input.editorSessionId, 'editorSessionId'); id(input.leaseToken, 'leaseToken');
  const lease = queue(state).leases.find(l => l.projectId === input.projectId && l.documentId === input.documentId);
  if (!lease || lease.editorSessionId !== input.editorSessionId || lease.leaseTokenHash !== digest(input.leaseToken) || (!allowExpired && lease.expiresAt <= time)) fail('EDITOR_LEASE', 'Editor lease expired or belongs to another mounted session', 409);
  return lease;
}
function clean(input) { if (input.dirty !== false) fail('HUMAN_DIRTY', 'Save or recover human edits before an agent operation', 409); }
function saveTemplate(r, input) {
  return { type: 'document.save', operationId: r.operationId, projectId: r.projectId, id: r.documentId, expectedRevision: r.expectedRevision, officeAgent: { editorSessionId: input.editorSessionId, leaseToken: input.leaseToken }, data: { actor: actorOf(r), operation: operationOf(r), summary: r.edit.kind === 'sheet.setValues' ? `Set ${r.region}` : `Insert ${r.edit.text.length} characters at ${r.edit.index}` } };
}
function receiptEvidence(state, r) {
  const prior = state.receipts.find(x => x.operationId === r.operationId);
  if (!prior) return { verified: false, reason: 'AWAITING_DURABLE_SAVE' };
  const result = prior.result, receipt = result?.receipt, saved = result?.entity;
  if (receipt?.type !== 'document.save' || receipt.outcome !== 'applied' || receipt.entityId !== r.documentId || receipt.projectId !== r.projectId || receipt.baseRevision !== r.expectedRevision || receipt.revision !== r.expectedRevision + 1 || receipt.operationId !== r.operationId || saved?.id !== r.documentId || saved.projectId !== r.projectId || saved.revision !== receipt.revision || saved.kind !== (r.edit.kind === 'sheet.setValues' ? 'sheet' : 'doc') || digest(receipt.actor) !== digest(actorOf(r)) || digest(receipt.operation) !== digest(operationOf(r)) || !verifyEffect(r, saved.snapshot)) return { verified: false, reason: 'RECEIPT_UNVERIFIED' };
  // Ensure this is still a durable revision, including when a human saved again.
  const current = documentOf(state, r);
  const persisted = current.revision === receipt.revision ? current : current.history?.find(h => h.revision === receipt.revision);
  if (!persisted || digest(persisted.snapshot) !== digest(saved.snapshot)) return { verified: false, reason: 'REVISION_NOT_DURABLE' };
  return { verified: true, receipt: { ...receipt, snapshotSha256: digest(saved.snapshot), durability: 'saved', verifiedBy: 'office-agent-v1' } };
}
function reconcile(state, r, time) {
  if (final.has(r.status)) return;
  if (r.applyStartedAt !== undefined) {
    const evidence = receiptEvidence(state, r);
    if (evidence.verified) Object.assign(r, { status: 'completed', receipt: evidence.receipt, finishedAt: time, reason: undefined });
    else {
      const lease = queue(state).leases.find(l => l.documentId === r.documentId && l.projectId === r.projectId);
      if (evidence.reason !== 'AWAITING_DURABLE_SAVE' || !lease || lease.expiresAt <= time) Object.assign(r, { status: 'uncertain', reason: evidence.reason });
    }
    return;
  }
  if (documentOf(state, r).revision !== r.expectedRevision) Object.assign(r, { status: 'conflict', reason: 'REVISION_CONFLICT', finishedAt: time });
}

// The existing store is the sole durable authority. dataDir is reserved for the
// separate private transport credential; no document bytes are written here.
export function createOfficeAgentService({ store, dataDir, now = Date.now }) {
  if (!store?.read || !store?.transaction) throw new TypeError('A FORGE transactional store is required');
  const tx = fn => store.transaction(state => fn(state, now()));
  const api = {
    async recover() {
      return tx((s, time) => {
        const q = queue(s);
        for (const r of q.requests) {
          if (r.status === 'applying') Object.assign(r, { status: 'uncertain', reason: 'EDITOR_OUTCOME_UNKNOWN' });
          reconcile(s, r, time);
        }
        // Rotating the service process revokes all pre-restart editor sessions.
        q.leases = [];
        return { schemaVersion: OFFICE_AGENT_VERSION, requests: q.requests.map(publicRequest) };
      });
    },
    async requestEdit(input) {
      object(input, [...requestKeys, 'expectedRevision', 'edit']);
      const scope = scopeOf(input); id(input.operationId, 'operationId'); integer(input.expectedRevision, 'expectedRevision', 1);
      // Fingerprint raw arguments first: even stale duplicate deliveries can be
      // reconciled, but cannot change scope or payload under an existing ID.
      const fingerprint = digest({ ...scope, expectedRevision: input.expectedRevision, edit: input.edit });
      return tx((s, time) => {
        const document = scopedDocument(s, scope), q = queue(s);
        const prior = q.requests.find(r => r.operationId === input.operationId);
        if (prior) {
          if (prior.fingerprint !== fingerprint) fail('OPERATION_REUSE', 'Operation ID belongs to different arguments or scope', 409);
          reconcile(s, prior, time); return { request: publicRequest(prior), replayed: true };
        }
        if (s.receipts.some(r => r.operationId === input.operationId)) fail('OPERATION_REUSE', 'Operation ID already belongs to a domain command', 409);
        expected(document, input.expectedRevision);
        const parsed = parseEdit(document, input.edit);
        if (q.requests.length >= LIMITS.requests || q.requests.filter(r => r.documentId === scope.documentId && !final.has(r.status)).length >= LIMITS.activePerDocument) fail('OFFICE_QUEUE_FULL', 'Retained edit queue is full; archive under an explicit retention policy', 409);
        const r = { schemaVersion: OFFICE_AGENT_VERSION, ...scope, operationId: input.operationId, expectedRevision: input.expectedRevision, fingerprint, ...parsed, status: 'pending', createdAt: time };
        q.requests.push(r); return { request: publicRequest(r), replayed: false };
      });
    },
    async status(input) {
      object(input, requestKeys);
      return tx((s, time) => { const r = requestOf(s, input); reconcile(s, r, time); return { request: publicRequest(r) }; });
    },
    async list(input) {
      object(input, ['projectId', 'documentId']);
      return tx((s, time) => {
        documentOf(s, input);
        return { requests: queue(s).requests.filter(r => r.projectId === input.projectId && r.documentId === input.documentId).map(r => { reconcile(s, r, time); return publicRequest(r); }) };
      });
    },
    readDocument(input) {
      object(input, [...SCOPE_KEYS, 'expectedRevision', 'selection']);
      const document = scopedDocument(store.read(), input); expected(document, input.expectedRevision);
      const selection = input.selection;
      let content;
      if (document.kind === 'sheet') {
        object(selection, ['sheetId', 'range'], 'selection');
        const area = rangeOf(selection.range), sheet = selectedSheet(document, selection.sheetId, area);
        const cells = [];
        for (let r = area.top; r <= area.bottom; r++) {
          const row = []; for (let c = area.left; c <= area.right; c++) {
            const cell = sheet.cellData?.[r]?.[c]; row.push({ value: cell?.v ?? null, ...(cell?.f ? { formula: cell.f } : {}) });
          } cells.push(row);
        }
        content = { sheetId: selection.sheetId, range: area.range, cells };
      } else {
        object(selection, ['index', 'length'], 'selection');
        const body = document.snapshot?.body?.dataStream;
        if (typeof body !== 'string') fail('VALIDATION', 'No saved document body');
        integer(selection.index, 'index', 0, Math.max(0, body.length - 2)); integer(selection.length, 'length', 1, LIMITS.text);
        content = { index: selection.index, text: body.slice(selection.index, Math.min(body.length - 2, selection.index + selection.length)) };
      }
      if (JSON.stringify(content).length > 64000) fail('READ_LIMIT', 'Selected content is too large; request a smaller range');
      return { schemaVersion: OFFICE_AGENT_VERSION, scope: scopeOf(input), kind: document.kind, revision: document.revision, content, source: 'durable-snapshot', unsavedEditorContent: 'excluded' };
    },
    async claim(input) {
      object(input, editorKeys.filter(k => k !== 'leaseToken')); clean(input); id(input.editorSessionId, 'editorSessionId');
      // Generate in memory; only the hash enters durable state or /api/state.
      const leaseToken = randomBytes(32).toString('base64url');
      const result = await tx((s, time) => {
        const document = documentOf(s, input); expected(document, input.expectedRevision); const q = queue(s);
        for (const r of q.requests.filter(r => r.documentId === input.documentId && r.projectId === input.projectId)) reconcile(s, r, time);
        const existing = q.leases.find(l => l.documentId === input.documentId && l.projectId === input.projectId);
        if (existing?.expiresAt > time) fail('EDITOR_LEASE', 'Another claim already owns this document; renew using its token', 409);
        if (q.requests.some(r => r.documentId === input.documentId && r.projectId === input.projectId && ['applying', 'uncertain'].includes(r.status))) fail('EDITOR_OUTCOME_UNKNOWN', 'An earlier edit needs durable-save reconciliation; do not replay it', 409);
        q.leases = q.leases.filter(l => l.expiresAt > time);
        if (q.leases.length >= LIMITS.leases) fail('OFFICE_QUEUE_FULL', 'Too many active editor sessions', 409);
        const lease = { projectId: input.projectId, documentId: input.documentId, editorSessionId: input.editorSessionId, leaseTokenHash: digest(leaseToken), expiresAt: time + LIMITS.leaseMs };
        q.leases.push(lease); return { expiresAt: lease.expiresAt, leaseMs: LIMITS.leaseMs };
      });
      return { ...result, leaseToken };
    },
    async renew(input) {
      object(input, editorKeys); clean(input);
      return tx((s, time) => { expected(documentOf(s, input), input.expectedRevision); const l = leaseOf(s, input, time); l.expiresAt = time + LIMITS.leaseMs; return { expiresAt: l.expiresAt }; });
    },
    async release(input) {
      object(input, ['projectId', 'documentId', 'editorSessionId', 'leaseToken']);
      return tx((s, time) => {
        documentOf(s, input); const l = leaseOf(s, input, time, { allowExpired: true }); l.expiresAt = time;
        for (const r of queue(s).requests.filter(r => r.documentId === input.documentId && r.projectId === input.projectId)) reconcile(s, r, time);
        return { released: true };
      });
    },
    async review(input) {
      object(input, [...requestKeys, ...editorKeys]); clean(input);
      return tx((s, time) => {
        const r = requestOf(s, input); reconcile(s, r, time); leaseOf(s, input, time);
        if (r.status !== 'pending' && r.status !== 'review') fail('EDIT_STATE', 'This request cannot be reviewed again', 409);
        expected(documentOf(s, input), input.expectedRevision);
        if (r.expectedRevision !== input.expectedRevision) fail('REVISION_CONFLICT', 'Request targets another revision', 409);
        Object.assign(r, { status: 'review', reviewedAt: time, reviewedSessionId: input.editorSessionId });
        return { request: publicRequest(r) };
      });
    },
    async beginApply(input) {
      object(input, [...requestKeys, ...editorKeys]); clean(input);
      return tx((s, time) => {
        const r = requestOf(s, input); reconcile(s, r, time); const lease = leaseOf(s, input, time);
        if (r.applyStartedAt !== undefined || final.has(r.status)) return { request: publicRequest(r), mayApply: false };
        if (r.status !== 'review' || r.reviewedSessionId !== input.editorSessionId) fail('REVIEW_REQUIRED', 'Review in this claiming mounted session first', 409);
        const document = documentOf(s, input); expected(document, input.expectedRevision);
        if (input.expectedRevision !== r.expectedRevision) fail('REVISION_CONFLICT', 'Request targets another revision', 409);
        if (queue(s).requests.some(other => other !== r && other.projectId === r.projectId && other.documentId === r.documentId && ['applying', 'uncertain'].includes(other.status))) fail('EDITOR_OUTCOME_UNKNOWN', 'Another document edit is already in flight', 409);
        const parsed = parseEdit(document, r.edit);
        if (digest(parsed.proof) !== digest(r.proof)) fail('REVISION_CONFLICT', 'Saved base content changed without the expected revision', 409);
        Object.assign(r, { status: 'applying', applyStartedAt: time, appliedSessionId: input.editorSessionId, applyLeaseTokenHash: lease.leaseTokenHash });
        return { request: publicRequest(r), mayApply: true, saveCommand: saveTemplate(r, input) };
      });
    },
    async ack(input) {
      object(input, [...requestKeys, 'editorSessionId', 'leaseToken']);
      return tx((s, time) => {
        const r = requestOf(s, input);
        id(input.editorSessionId, 'editorSessionId'); id(input.leaseToken, 'leaseToken');
        if (r.appliedSessionId !== input.editorSessionId || r.applyLeaseTokenHash !== digest(input.leaseToken)) fail('EDITOR_LEASE', 'Only the applying session may acknowledge this edit', 409);
        // No snapshot/result from the caller is trusted or even accepted.
        reconcile(s, r, time); return { request: publicRequest(r) };
      });
    },
    async reject(input) {
      object(input, [...requestKeys, 'editorSessionId', 'leaseToken']);
      return tx((s, time) => { const r = requestOf(s, input); reconcile(s, r, time); leaseOf(s, input, time); if (!['pending', 'review'].includes(r.status)) fail('EDIT_STATE', 'A started edit cannot be discarded or replayed', 409); Object.assign(r, { status: 'rejected', reason: 'EDITOR_REJECTED', finishedAt: time }); return { request: publicRequest(r) }; });
    },
  };
  return api;
}
