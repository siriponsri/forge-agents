import { fault, text, aborted } from './common.mjs';

export function guestConfig(input = {}) {
  let endpoint; try { endpoint = new URL(text(input.endpoint, 'endpoint', 2048)); } catch { throw fault('VALIDATION', 'Choose a guest HTTPS endpoint or loopback SSH tunnel URL'); }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' || !['https:', 'http:'].includes(endpoint.protocol)) throw fault('VALIDATION', 'Guest endpoint must have no credentials, query, fragment or path');
  if (endpoint.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)) throw fault('VALIDATION', 'Plain HTTP is permitted only through a loopback tunnel');
  const tokenEnv = text(input.tokenEnv, 'tokenEnv');
  if (!/^[A-Z][A-Z0-9_]{1,100}$/.test(tokenEnv)) throw fault('VALIDATION', 'Use an environment secret reference, not a token value');
  return { endpoint: endpoint.origin, tokenEnv, agentId: text(input.agentId, 'agentId'), remoteTargetId: text(input.remoteTargetId, 'remoteTargetId') };
}

export function createGuestDriver({ config }) {
  let remoteLease;
  async function request(method, input = {}, signal) {
    aborted(signal);
    const token = process.env[config.tokenEnv];
    if (!token || token.length < 32) throw fault('AUTH_REQUIRED', 'Set the guest token in the selected machine-local environment secret reference', 503);
    let response;
    try {
      response = await fetch(`${config.endpoint}/v1/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...input, agentId: config.agentId, targetId: config.remoteTargetId }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000), redirect: 'error' });
    } catch { if (signal?.aborted) throw signal.reason; throw fault('GUEST_UNREACHABLE', 'Guest agent unavailable; check authenticated tunnel, agent and interactive desktop', 503); }
    const reader = response.body.getReader(); const chunks = []; let length = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 9 * 1024 * 1024) { await reader.cancel(); throw fault('PROTOCOL', 'Guest response exceeds bounded size', 502); } chunks.push(value); }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fault('PROTOCOL', 'Guest returned an invalid response', 502); }
    if (!response.ok) throw fault(response.status === 401 ? 'GUEST_AUTH' : body.error?.code ?? 'GUEST_ACTION', 'Guest refused the operation; check identity, ownership and selected element', response.status);
    if (body.protocol !== 'forge-desktop/1' || body.agentId !== config.agentId || body.targetId !== config.remoteTargetId) throw fault('TARGET_IDENTITY', 'Remote agent/target identity does not match the selected guest', 409);
    return body.result;
  }
  return {
    resourceKey: `guest:${config.agentId}:${config.remoteTargetId}`,
    async health() {
      try { const result = await request('health'); return { ...result, identity: { kind: 'guest', agentId: config.agentId, remoteTargetId: config.remoteTargetId, remote: result.identity, transport: 'authenticated forge-desktop/1' } }; }
      catch (e) { return { ready: false, capabilities: [], blocker: { code: e.code ?? 'GUEST_UNREACHABLE', message: e.message } }; }
    },
    async listWindows() { return (await request('windows')).windows; },
    async acquire(windowId, input) {
      remoteLease = await request('acquire', { windowId, controllerId: input.controllerId, attemptId: input.attemptId, runId: input.runId, ttlMs: input.ttlMs });
      return { windowId, remoteLease };
    },
    async action(name, args, { signal, dispatch, input, selection }) {
      dispatch(); // Delivery is uncertain on a transport failure; never automatically retry input.
      const result = await request('action', { ...selection.remoteLease, name, arguments: args, operationId: input.operationId }, signal);
      if (result.status !== 'completed') throw fault('GUEST_UNCERTAIN', 'Guest action did not complete; reconcile on the remote target', 409);
      if (result.result?.artifactId) {
        const png = await request('screenshot', { artifactId: result.result.artifactId }, signal);
        return { png: Buffer.from(png.base64, 'base64') };
      }
      return result.result;
    },
    async stop(selection) {
      const lease = selection?.remoteLease ?? remoteLease;
      if (lease) { await request('stop', lease); remoteLease = undefined; }
    },
    async shutdown() { await this.stop(); },
  };
}
