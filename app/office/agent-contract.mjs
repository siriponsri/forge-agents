import { createHash } from 'node:crypto';
import { covertCellValue, Styles } from '@univerjs/core';
import { getCellType, getCellValue } from '@univerjs/sheets';
import { fail, find, revision } from '../server/domain.mjs';

export const OFFICE_AGENT_VERSION = 1;
export const LIMITS = Object.freeze({ text: 10000, cells: 1000, requests: 1024, activePerDocument: 32, leases: 256, leaseMs: 30000 });
export const SCOPE_KEYS = ['projectId', 'documentId', 'botId', 'taskId', 'runId', 'attemptId'];
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
export function object(value, keys, label = 'arguments') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('VALIDATION', `Invalid ${label} or unsupported field`);
  return value;
}
export function id(value, label) {
  if (typeof value !== 'string' || !value.length || value.length > 256 || /[\s\u0000-\u001f\u007f]/u.test(value)) fail('VALIDATION', `${label} must be an explicit bounded identifier`);
  return value;
}
export function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('VALIDATION', `${label} is out of bounds`);
  return value;
}
export function scopeOf(input) { return Object.fromEntries(SCOPE_KEYS.map(k => [k, id(input[k], k)])); }
export function documentOf(state, input) {
  id(input.projectId, 'projectId'); id(input.documentId, 'documentId');
  find(state, 'projects', input.projectId);
  return find(state, 'documents', input.documentId, input.projectId);
}
export function scopedDocument(state, input) {
  const scope = scopeOf(input), document = documentOf(state, scope);
  find(state, 'bots', scope.botId, scope.projectId);
  const task = find(state, 'tasks', scope.taskId, scope.projectId);
  const run = find(state, 'runs', scope.runId, scope.projectId);
  if (task.botId !== scope.botId || run.botId !== scope.botId || run.taskId !== scope.taskId || run.attemptId !== scope.attemptId) fail('SCOPE', 'Bot/task/run/attempt attribution does not match', 403);
  return document;
}
export function expected(document, value) { integer(value, 'expectedRevision', 1); revision(document, value); }
export function rangeOf(range) {
  if (typeof range !== 'string') fail('VALIDATION', 'A bounded A1 range is required');
  const normalized = range.toUpperCase().trim();
  const m = /^([A-Z]{1,3})([1-9]\d{0,5})(?::([A-Z]{1,3})([1-9]\d{0,5}))?$/.exec(normalized);
  if (!m) fail('VALIDATION', 'Use a bounded A1 range such as A1:B3');
  const col = letters => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const left = col(m[1]), right = col(m[3] || m[1]), top = Number(m[2]) - 1, bottom = Number(m[4] || m[2]) - 1;
  if (right < left || bottom < top || right >= 16384 || (right - left + 1) * (bottom - top + 1) > LIMITS.cells) fail('VALIDATION', 'Select 1–1000 cells within sheet bounds');
  return { range: normalized, left, right, top, bottom };
}
export function selectedSheet(document, sheetId, area) {
  id(sheetId, 'sheetId');
  const sheet = document.snapshot?.sheets?.[sheetId];
  if (document.kind !== 'sheet' || !document.snapshot?.sheetOrder?.includes(sheetId) || !sheet || area.bottom >= sheet.rowCount || area.right >= sheet.columnCount) fail('VALIDATION', 'Selected sheet/range is outside this saved workbook');
  return sheet;
}
export function parseEdit(document, input) {
  if (document.packageVersion !== '1.6.1') fail('EDITOR_VERSION', 'This operation requires the qualified Univer 1.6.1 editor', 409);
  if (input?.kind === 'sheet.setValues') {
    object(input, ['kind', 'sheetId', 'range', 'text'], 'sheet edit');
    const area = rangeOf(input.range), sheet = selectedSheet(document, input.sheetId, area);
    if (typeof input.text !== 'string' || input.text.length > LIMITS.text) fail('VALIDATION', 'Provide at most 10000 characters of tab-separated cell text');
    const text = input.text.replace(/\r/g, ''), values = text.split('\n').map(row => row.split('\t'));
    if (values.length !== area.bottom - area.top + 1 || values.some(row => row.length !== area.right - area.left + 1)) fail('VALIDATION', 'Tab-separated values must exactly match the selected rectangle');
    const styles = new Styles(document.snapshot.styles ?? {});
    // The same public scalar helpers used by the pinned Facade and mutation.
    // This creates expected scalar evidence only, never an editable snapshot.
    const cells = values.map((row, r) => row.map((value, c) => {
      if (value.startsWith('=')) return { formula: value };
      const next = covertCellValue(value), type = getCellType(styles, next, sheet.cellData?.[area.top + r]?.[area.left + c] ?? {});
      return { value: getCellValue(type, next), type };
    }));
    return { edit: { kind: input.kind, sheetId: input.sheetId, range: area.range, text }, region: `${input.sheetId}!${area.range}`, proof: { kind: 'sheet-values-v1', cells } };
  }
  if (input?.kind === 'doc.insertText') {
    object(input, ['kind', 'index', 'text'], 'document edit');
    const body = document.snapshot?.body?.dataStream;
    if (document.kind !== 'doc' || typeof body !== 'string' || !body.endsWith('\r\n')) fail('VALIDATION', 'A saved native Docs body is required');
    integer(input.index, 'index', 0, body.length - 2);
    if (typeof input.text !== 'string' || !input.text.length || input.text.length > LIMITS.text || /[\r\n]/.test(input.text)) fail('VALIDATION', 'Insert 1–10000 characters within one paragraph');
    return { edit: { kind: input.kind, index: input.index, text: input.text }, region: `body:${input.index}`, proof: { kind: 'doc-text-v1', textHash: digest(body.slice(0, input.index) + input.text + body.slice(input.index)) } };
  }
  fail('VALIDATION', 'Unsupported bounded edit; arbitrary code is not accepted');
}
// Verification only. This module never generates or installs a replacement snapshot.
export function verifyEffect(request, snapshot) {
  const edit = request.edit;
  if (edit.kind === 'doc.insertText') return typeof snapshot?.body?.dataStream === 'string' && digest(snapshot.body.dataStream) === request.proof.textHash;
  const sheet = snapshot?.sheets?.[edit.sheetId];
  if (!snapshot?.sheetOrder?.includes(edit.sheetId) || !sheet) return false;
  const area = rangeOf(edit.range), rows = request.proof.cells;
  for (let r = area.top; r <= area.bottom; r++) for (let c = area.left; c <= area.right; c++) {
    const value = rows[r - area.top][c - area.left], cell = sheet.cellData?.[r]?.[c];
    if (value.formula) { if (cell?.f !== value.formula) return false; }
    else if (cell?.f || (cell?.v ?? '') !== value.value || cell?.t !== value.type) return false;
  }
  return true;
}
export function actorOf(request) { return { kind: 'agent', ...Object.fromEntries(['botId', 'taskId', 'runId', 'attemptId'].map(k => [k, request[k]])) }; }
export function operationOf(request) { return { ...request.edit, region: request.region, expectedRevision: request.expectedRevision, requestFingerprint: request.fingerprint }; }

// Lead calls this synchronously INSIDE the existing command transaction, after
// the durable replay check and before mutating an entity. It does not save.
// Call for every command: queue IDs are reserved and all document writers must
// honor an in-flight editor lease (including update/restore and human saves).
export function validateOfficeAgentSave(state, input, { now = Date.now() } = {}) {
  const q = state.officeAgent;
  if (q && (q.schemaVersion !== OFFICE_AGENT_VERSION || !Array.isArray(q.requests) || !Array.isArray(q.leases))) fail('OFFICE_QUEUE_SCHEMA', 'Incompatible office agent queue', 409);
  const request = q?.requests.find(r => r.operationId === input.operationId);
  if (request && input.type !== 'document.save') fail('OPERATION_REUSE', 'Operation ID is reserved for a queued document save', 409);
  if (input.officeAgent && !request) fail('NOT_FOUND', 'No matching office agent request', 404);
  const writesDocument = ['document.save', 'document.update', 'document.restore'].includes(input.type);
  if (writesDocument && q?.requests.some(r => r.operationId !== input.operationId && r.projectId === input.projectId && r.documentId === input.id && ['applying', 'uncertain'].includes(r.status))) fail('EDITOR_OUTCOME_UNKNOWN', 'A mounted editor operation owns this document; reconcile before another write', 409);
  if (!request) return;
  if (input.id !== request.documentId || input.projectId !== request.projectId || input.expectedRevision !== request.expectedRevision) fail('SCOPE', 'Save does not match the queued document and base revision', 403);
  scopedDocument(state, request); expected(documentOf(state, request), input.expectedRevision);
  if (!['applying', 'uncertain'].includes(request.status) || request.applyStartedAt === undefined) fail('REVIEW_REQUIRED', 'Queued document edit has no issued apply permit', 409);
  object(input.officeAgent, ['editorSessionId', 'leaseToken'], 'editor lease');
  id(input.officeAgent.editorSessionId, 'editorSessionId'); id(input.officeAgent.leaseToken, 'leaseToken');
  const lease = q.leases.find(l => l.projectId === request.projectId && l.documentId === request.documentId);
  const tokenHash = digest(input.officeAgent.leaseToken);
  if (!lease || lease.expiresAt <= now || lease.editorSessionId !== input.officeAgent.editorSessionId || lease.leaseTokenHash !== tokenHash || request.appliedSessionId !== lease.editorSessionId || request.applyLeaseTokenHash !== tokenHash) fail('EDITOR_LEASE', 'Save is not from the claiming mounted editor session', 409);
  if (digest(input.data?.actor) !== digest(actorOf(request)) || digest(input.data?.operation) !== digest(operationOf(request))) fail('SCOPE', 'Save attribution/operation does not match the reviewed edit', 403);
  if (!verifyEffect(request, input.data?.snapshot)) fail('EDIT_EFFECT_MISMATCH', 'Mounted snapshot does not contain the requested edit', 409);
}
