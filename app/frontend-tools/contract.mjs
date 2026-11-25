// Bounded supervised frontend capability. This is deliberately not a Guarded
// profile extension, an arbitrary JS executor, or a saved-document mutation API.
export const META_KEY = 'forge/frontend-tool-call';
export const TOOL_NAME = 'selection_read';
export const NATIVE_TOOL_NAME = 'forge_frontend_selection_read';
export const LIMITS = Object.freeze({ body: 32768, text: 8192, pending: 32, perTurn: 4, ttl: 120000 });
const id = { type: 'string', minLength: 1, maxLength: 256 };
export const FRONTEND_TOOL = Object.freeze({
  name: TOOL_NAME,
  description: 'Read the mounted Owner editor selection at the explicitly scoped saved revision. Returns frontend-supplied selection context, not evidence of a saved edit. Waits for the existing frontend to answer.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['documentId', 'expectedRevision'], properties: { documentId: id, expectedRevision: { type: 'integer', minimum: 1 } } },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
});
export function fail(code, statusCode = 409) { throw Object.assign(new Error(code), { code, statusCode }); }
export function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('FRONTEND_VALIDATION', 400);
  return value;
}
export function identifier(value) {
  if (typeof value !== 'string' || !value.length || value.length > 256 || /[\u0000-\u001f]/.test(value)) fail('FRONTEND_VALIDATION', 400);
  return value;
}
export function revision(value) { if (!Number.isSafeInteger(value) || value < 1) fail('FRONTEND_VALIDATION', 400); return value; }
export const SCOPE_KEYS = ['projectId', 'runId', 'attemptId'];
export const BINDING_KEYS = [...SCOPE_KEYS, 'threadId', 'providerRunId', 'nativeSessionId', 'nativeTurnId', 'documentId', 'documentRevision'];
export const PRIVATE_BINDING_KEYS = [...SCOPE_KEYS, 'identityKind', 'threadId', 'rootNodeId', 'providerThreadId', 'providerTurnId', 'nativeThreadRef', 'nativeTurnRef', 'nativeSessionId', 'nativeTurnId', 'documentId', 'documentRevision'];
export function bindingFor(raw) {
  const keys = raw?.identityKind === 'private-adapter' ? PRIVATE_BINDING_KEYS : BINDING_KEYS;
  object(raw, [...keys, 'ttlMs']);
  const binding = Object.fromEntries(keys.map(k => {
    if (k === 'documentRevision') return [k, revision(raw[k])];
    if (['nativeThreadRef', 'nativeTurnRef'].includes(k)) {
      const ref = object(raw[k], ['driver', 'nativeId', 'strength']);
      if (ref.driver !== 'opencode' || !['weak', 'strong'].includes(ref.strength)) fail('FRONTEND_NATIVE_BINDING');
      return [k, { driver: ref.driver, nativeId: identifier(ref.nativeId), strength: ref.strength }];
    }
    return [k, identifier(raw[k])];
  }));
  if (binding.identityKind === 'private-adapter' && (binding.nativeSessionId !== binding.nativeThreadRef.nativeId || binding.nativeTurnId !== binding.nativeTurnRef.nativeId)) fail('FRONTEND_NATIVE_BINDING');
  return binding;
}
export function scope(value) { return Object.fromEntries(SCOPE_KEYS.map(k => [k, identifier(value?.[k])])); }
export function argumentsFor(value) {
  object(value, ['documentId', 'expectedRevision']);
  return { documentId: identifier(value.documentId), expectedRevision: revision(value.expectedRevision) };
}
export function nativeCall(value) {
  object(value, ['sessionId', 'turnId', 'callId', 'messageId']);
  return Object.fromEntries(['sessionId', 'turnId', 'callId', 'messageId'].map(k => [k, identifier(value[k])]));
}
export function typedResult(value, pending) {
  object(value, ['status', 'documentId', 'revision', 'selection', 'error']);
  if (value.documentId !== pending.arguments.documentId || value.revision !== pending.arguments.expectedRevision) fail('FRONTEND_RESULT_SCOPE');
  if (value.status === 'error') {
    if (value.selection !== undefined) fail('FRONTEND_VALIDATION', 400);
    object(value.error, ['code']);
    if (!['EDITOR_UNAVAILABLE', 'REVISION_CONFLICT', 'NO_SELECTION', 'DECLINED'].includes(value.error.code)) fail('FRONTEND_VALIDATION', 400);
    return { status: 'error', documentId: value.documentId, revision: value.revision, error: { code: value.error.code } };
  }
  if (value.status !== 'ok' || value.error !== undefined) fail('FRONTEND_VALIDATION', 400);
  const selection = object(value.selection, ['start', 'end', 'text']);
  if (!Number.isSafeInteger(selection.start) || selection.start < 0 || !Number.isSafeInteger(selection.end) || selection.end < selection.start || selection.end > 100000000 || typeof selection.text !== 'string' || selection.text.length > LIMITS.text || Buffer.byteLength(selection.text) > LIMITS.text * 3 || selection.end - selection.start !== selection.text.length) fail('FRONTEND_VALIDATION', 400);
  return { status: 'ok', documentId: value.documentId, revision: value.revision, selection: { start: selection.start, end: selection.end, text: selection.text } };
}
export function sdkResult(result) {
  const value = { source: 'owner-frontend-selection', ...result };
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, ...(result.status === 'error' ? { isError: true } : {}) };
}
