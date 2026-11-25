import { randomUUID, randomBytes } from 'node:crypto';
import { digest, exact, fail, find, prose, relayState, routeKeys, sameRoute, signBridgeBody, taskDigest, text, verifySignature } from './common.mjs';
export { signBridgeBody } from './common.mjs';
export { validateRelayAdmission,validateRelayDispatch } from './admission.mjs';

const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'rolled_back']);
const nowMs = clock => new Date(clock()).getTime();
function parseCommand(value) {
  if (typeof value !== 'string' || value.length > 12000) fail('RELAY_COMMAND', 'Invalid relay command', 400);
  const m = /^FORGE (WORK|APPROVE|DENY|STOP) ([\s\S]+)$/.exec(value);
  if (!m) fail('RELAY_COMMAND', 'Use FORGE WORK, APPROVE, DENY or STOP', 400);
  if (m[1] === 'WORK') return { action: 'work', text: prose(m[2], 'work', 10000) };
  const a = m[2].split(' ');
  if (a.length !== (m[1] === 'APPROVE' ? 2 : 1)) fail('RELAY_COMMAND', 'Invalid command arguments', 400);
  return { action: m[1].toLowerCase(), inboxId: text(a[0], 'inboxId'), challenge: a[1] };
}
function bump(x, time) { x.revision++; x.updatedAt = time; }
function enqueue(r, item, key, kind, content, time, correlation = {}) {
  const prior = r.outbox.find(x => x.inboxId === item.id && x.key === key);
  const fingerprint = digest({ kind, content, correlation });
  if (prior) { if (prior.fingerprint !== fingerprint) fail('RELAY_REPORT_REUSE'); return prior; }
  const out = { id: randomUUID(), projectId: item.projectId, inboxId: item.id, bindingId: item.bindingId, key, kind,
    content, correlation, fingerprint, status: 'pending', createdAt: time, revision: 1 };
  r.outbox.push(out); return out;
}
function bindingProjection(b) { const { secretRef, ...safe } = b; return safe; }

/** Internal trusted local service. Only bridge() is a machine-authenticated wire API.
 * configure/linkTask/dispatch/report/reconcile/recover are NOT model tools or public routes.
 */
export function createRelayService({ store, t3, resolveSecret, clock = () => new Date().toISOString() }) {
  if (!store?.transaction || !store?.read) throw new TypeError('Transactional FORGE store required');
  let closed = false;
  const time = () => new Date(clock()).toISOString();
  function checkOpen() { if (closed) fail('RELAY_CLOSED', 'Relay is closed', 503); }
  function scope(s, projectId) { find(s, 'projects', projectId); return relayState(s); }
  async function stopRun(projectId, inboxId) {
    const reserved = await store.transaction(s => {
      const r = scope(s, projectId), item = find(r, 'inbox', inboxId, projectId);
      if (!item.stopRequested || !item.runId || item.cancel) return null;
      if (typeof t3?.stop !== 'function') fail('RELAY_STOP_SHIM_MISSING', 'T3 stop adapter is required', 503);
      const run = find(s, 'runs', item.runId, projectId);
      if (run.taskId !== item.taskId || run.attemptId !== item.attemptId) fail('RELAY_RUN_SCOPE');
      item.cancel = { status: 'sending', operationId: `relay-stop:${item.id}`, createdAt: time() };
      return { runId: run.id };
    });
    if (!reserved) return;
    try {
      await t3.stop(reserved.runId);
      await store.transaction(s => { find(scope(s, projectId), 'inbox', inboxId, projectId).cancel.status = 'requested'; });
    } catch {
      await store.transaction(s => { find(scope(s, projectId), 'inbox', inboxId, projectId).cancel.status = 'unknown'; });
    }
  }
  function attachObserved(s, item) {
    const runs = s.runs.filter(v => v.operationId === item.reservation?.operationId);
    if (runs.length !== 1) fail('RELAY_RUN_NOT_OBSERVED', 'No unambiguous durable run; reconcile without redispatch');
    const run = runs[0], c = item.reservation.context;
    if (run.projectId !== item.projectId || run.taskId !== item.taskId || !run.attemptId || digest(run.relayContext) !== digest(c)) fail('RELAY_RUN_SCOPE', 'T3 did not retain the exact relay context');
    item.runId = run.id; item.attemptId = run.attemptId;
    item.status = run.status === 'unknown' || run.status === 'submitting' ? 'unknown' : terminal.has(run.status) ? run.status : 'running';
    bump(item, time()); return run;
  }
  const service = {
    async readiness({ projectId }) {
      const s = store.read(), r = scope(s, projectId), bindings = [];
      for (const b of r.bindings.filter(x => x.projectId === projectId)) {
        let secretAvailable = false;
        try { signBridgeBody('', await resolveSecret?.(b.secretRef)); secretAvailable = true; } catch { /* Return codes, never vault diagnostics. */ }
        bindings.push({ bindingId: b.id, enabled: b.enabled, secretAvailable,
          lastAuthenticatedEventAt: r.events.filter(x => x.bindingId === b.id).at(-1)?.receivedAt ?? null,
          lastDeliveredReceiptAt: r.outbox.filter(x => x.bindingId === b.id && x.status === 'delivered').at(-1)?.receivedAt ?? null,
          actions: [...(!secretAvailable ? ['configure_machine_vault_secret'] : []), ...(!b.enabled ? ['enable_after_review'] : []), 'qualify_native_mobile_roundtrip'] });
      }
      return { ...service.state({ projectId }).readiness, bindings,
        actions: [...(t3?.relayContextVersion !== 1 ? ['wire_t3_admission_shim'] : []), ...(!bindings.length ? ['configure_native_owner_binding'] : [])],
        deployment: 'same-machine-loopback', remoteTopology: 'unsupported', publicProvisioning: false };
    },
    state({ projectId }) {
      const s = store.read(), r = scope(s, projectId);
      return { version: 1, projectId, bindings: r.bindings.filter(x => x.projectId === projectId).map(bindingProjection),
        inbox: r.inbox.filter(x => x.projectId === projectId), outbox: r.outbox.filter(x => x.projectId === projectId),
        readiness: { admission: t3?.relayContextVersion === 1 ? 'implemented' : 'RELAY_ADMISSION_SHIM_MISSING',
          secretResolver: typeof resolveSecret === 'function' ? 'configured' : 'RELAY_SECRET_UNAVAILABLE',
          nativePlatforms: ['telegram'], live: { hermes: 'LIVE_HERMES_NOT_RUN', openclaw: 'LIVE_OPENCLAW_NOT_RUN' } } };
    },
    async configure(i) {
      checkOpen(); exact(i, ['projectId', 'bindingId', 'expectedRevision', 'gateway', ...routeKeys, 'secretRef', 'enabled']);
      if (!['hermes', 'openclaw'].includes(i.gateway) || i.platform !== 'telegram') fail('RELAY_UNSUPPORTED_GATEWAY', 'Native Telegram bridge required', 400);
      routeKeys.forEach(k => { if (k !== 'threadId') text(i[k], k); });
      if (i.threadId !== null) text(i.threadId, 'threadId');
      text(i.bindingId, 'bindingId'); text(i.projectId, 'projectId');
      if (typeof i.enabled !== 'boolean' || !/^vault:[a-zA-Z0-9/_.-]{1,180}$/.test(i.secretRef)) fail('RELAY_SECRET_REF', 'Use a machine vault reference, never a token', 400);
      return store.transaction(s => {
        const r = scope(s, i.projectId), prior = r.bindings.find(x => x.id === i.bindingId);
        if (prior && (prior.projectId !== i.projectId || prior.revision !== i.expectedRevision)) fail('RELAY_REVISION');
        if (!prior && i.expectedRevision !== 0) fail('RELAY_REVISION');
        const candidate = { id: i.bindingId, projectId: i.projectId, gateway: i.gateway, secretRef: i.secretRef, enabled: i.enabled,
          ...Object.fromEntries(routeKeys.map(k => [k, i[k]])), revision: (prior?.revision ?? 0) + 1, updatedAt: time() };
        if (prior && digest({ ...prior, revision: 0, updatedAt: '' }) !== digest({ ...candidate, revision: 0, updatedAt: '' }) && r.inbox.some(x => x.bindingId === prior.id)) {
          // Historical reports must never silently move to a newly configured
          // recipient. Once used, a binding's origin remains immutable.
          if (digest({ ...prior, enabled: false, revision: 0, updatedAt: '' }) !== digest({ ...candidate, enabled: false, revision: 0, updatedAt: '' })) fail('RELAY_BINDING_BUSY');
        }
        if (r.bindings.some(b => b.id !== candidate.id && b.gateway === candidate.gateway && sameRoute(b, candidate))) fail('RELAY_ROUTE_BOUND', 'A native Owner route cannot name two projects');
        if (prior) Object.assign(prior, candidate); else r.bindings.push(candidate);
        return bindingProjection(candidate);
      });
    },
    async linkTask(i) {
      checkOpen(); exact(i, ['projectId', 'inboxId', 'taskId', 'expectedRevision']);
      return store.transaction(s => {
        const r = scope(s, i.projectId), item = find(r, 'inbox', i.inboxId, i.projectId), binding = find(r, 'bindings', item.bindingId, i.projectId);
        if (!binding.enabled || item.revision !== i.expectedRevision || !['inbox', 'awaiting_approval'].includes(item.status)) fail('RELAY_REVISION');
        item.taskDigest = taskDigest(s, i.projectId, i.taskId); item.taskId = i.taskId;
        item.challenge = randomBytes(16).toString('hex'); item.approvalExpiresAt = nowMs(clock) + 15 * 60 * 1000;
        item.status = 'awaiting_approval'; bump(item, time());
        const task = find(s, 'tasks', i.taskId, i.projectId);
        enqueue(r, item, `approval:${item.revision}`, 'approval', `FORGE Inbox ${item.id}\n${task.title}\n${task.description ?? ''}\nProject ${i.projectId}; task ${task.id}; digest ${item.taskDigest}\nApprove within 15 minutes: FORGE APPROVE ${item.id} ${item.challenge}\nDeny: FORGE DENY ${item.id}`, time(), { taskId: task.id, taskDigest: item.taskDigest });
        return item;
      });
    },
    async bridge({ body, signature }) {
      checkOpen();
      if (typeof body !== 'string' || Buffer.byteLength(body) > 65536) fail('RELAY_SIZE', 'Bridge body too large', 413);
      let e; try { e = JSON.parse(body); } catch { fail('RELAY_SCHEMA', 'Invalid JSON', 400); }
      exact(e, ['version', 'kind', 'bindingId', 'gatewayId', 'accountId', 'issuedAt', 'nonce', 'native', 'receipt']);
      if (e.version !== 1 || !['event', 'poll', 'receipt'].includes(e.kind)) fail('RELAY_SCHEMA', 'Invalid bridge version or kind', 400);
      text(e.bindingId, 'bindingId'); text(e.gatewayId, 'gatewayId'); text(e.accountId, 'accountId'); text(e.nonce, 'nonce');
      if (!Number.isSafeInteger(e.issuedAt) || Math.abs(nowMs(clock) - e.issuedAt) > 5 * 60 * 1000) fail('RELAY_STALE', 'Bridge timestamp outside permitted window', 401);
      const before = store.read().relay?.bindings.find(x => x.id === e.bindingId);
      if (!before || !before.enabled || e.gatewayId !== before.gatewayId || e.accountId !== before.accountId) fail('RELAY_AUTH', 'Binding not authorized', 401);
      if (typeof resolveSecret !== 'function') fail('RELAY_SECRET_UNAVAILABLE', 'Machine vault resolver required', 503);
      let secret; try { secret = await resolveSecret(before.secretRef); } catch { fail('RELAY_SECRET_UNAVAILABLE', 'Machine vault secret unavailable', 503); }
      verifySignature(body, signature, secret);
      const output = await store.transaction(s => {
        const r = relayState(s), b = find(r, 'bindings', e.bindingId, before.projectId);
        if (!b.enabled || b.revision !== before.revision) fail('RELAY_BINDING_CHANGED');
        if (r.nonces.some(x => x.bindingId === b.id && x.nonce === e.nonce)) fail('RELAY_REPLAY', 'Bridge nonce already used', 401);
        // Atomic with the operation; a failed command cannot consume a successful receipt.
        r.nonces.push({ bindingId: b.id, nonce: e.nonce, issuedAt: e.issuedAt });
        r.nonces = r.nonces.filter(x => x.issuedAt >= nowMs(clock) - 10 * 60 * 1000);
        if (e.kind === 'poll') {
          if (e.native || e.receipt) fail('RELAY_SCHEMA');
          for (const out of r.outbox) if (out.bindingId === b.id && out.status === 'delivering' && nowMs(clock) > out.leaseExpiresAt) {
            out.status = 'unknown'; out.revision++;
          }
          const out = r.outbox.find(x => x.bindingId === b.id && x.status === 'pending');
          if (!out) return { delivery: null };
          out.status = 'delivering'; out.lease = randomUUID(); out.claimedAt = time(); out.leaseExpiresAt = nowMs(clock) + 60000; out.revision++;
          return { delivery: { id: out.id, lease: out.lease, content: out.content, correlation: out.correlation,
            route: { ...Object.fromEntries(routeKeys.map(k => [k, b[k]])) } } };
        }
        if (e.kind === 'receipt') {
          if (e.native) fail('RELAY_SCHEMA'); exact(e.receipt, ['outboxId', 'lease', 'status', 'remoteMessageId']);
          const q = e.receipt, out = find(r, 'outbox', q.outboxId, b.projectId);
          if (out.bindingId !== b.id || out.lease !== q.lease || !['delivered', 'unknown', 'rejected'].includes(q.status)) fail('RELAY_DELIVERY_SCOPE');
          if (q.status === 'delivered') text(q.remoteMessageId, 'remoteMessageId');
          const receipt = { status: q.status, remoteMessageId: q.status === 'delivered' ? q.remoteMessageId : null };
          if (out.receipt) { if (digest(out.receipt) !== digest(receipt)) fail('RELAY_RECEIPT_REUSE'); return out; }
          if (!['delivering', 'unknown'].includes(out.status)) fail('RELAY_DELIVERY_STATE');
          out.status = q.status; out.receipt = receipt; out.receivedAt = time(); out.revision++; return out;
        }
        if (e.receipt) fail('RELAY_SCHEMA');
        const n = e.native; exact(n, ['platform', 'chatId', 'threadId', 'ownerId', 'messageId', 'text']);
        if (!sameRoute(b, { ...n, gatewayId: e.gatewayId, accountId: e.accountId })) fail('RELAY_OWNER_CHANNEL', 'Native Owner route does not match configured binding', 403);
        text(n.messageId, 'messageId'); const cmd = parseCommand(n.text);
        const eventId = digest({ bindingId: b.id, messageId: n.messageId }), fingerprint = digest(n);
        const prior = r.events.find(x => x.id === eventId);
        if (prior) { if (prior.fingerprint !== fingerprint) fail('RELAY_EVENT_REUSE', 'Native message changed; send a fresh message'); return { ...prior.result, duplicate: true }; }
        let item;
        if (cmd.action === 'work') {
          item = { id: randomUUID(), projectId: b.projectId, bindingId: b.id, sourceMessageId: n.messageId, text: cmd.text,
            status: 'inbox', revision: 1, createdAt: time(), updatedAt: time(), stopRequested: false };
          r.inbox.push(item);
          enqueue(r, item, 'received', 'inbox', `FORGE Inbox ${item.id}: received for review. Work has not started.`, time());
        } else {
          item = find(r, 'inbox', cmd.inboxId, b.projectId);
          if (item.bindingId !== b.id) fail('RELAY_OWNER_CHANNEL');
          if (cmd.action === 'approve') {
            if (item.status !== 'awaiting_approval' || item.stopRequested || cmd.challenge !== item.challenge || nowMs(clock) > item.approvalExpiresAt) fail('RELAY_APPROVAL_DENIED', 'Approval missing, expired, denied or already consumed');
            if (taskDigest(s, item.projectId, item.taskId) !== item.taskDigest) fail('RELAY_APPROVAL_STALE');
            item.approvalEventId = eventId; item.approvedAt = time(); item.status = 'approved'; delete item.challenge;
            enqueue(r, item, 'approved', 'approval', `FORGE Inbox ${item.id}: Owner approved the reviewed task; normal supervised permissions still apply.`, time(), { taskId: item.taskId });
          } else if (cmd.action === 'deny') {
            if (!['inbox', 'awaiting_approval', 'approved'].includes(item.status)) fail('RELAY_DENY_STATE', 'Use Stop for reserved or running work');
            item.status = 'denied'; delete item.challenge;
            enqueue(r, item, 'denied', 'approval', `FORGE Inbox ${item.id}: denied.`, time());
          } else {
            if (!item.stopRequested) {
              item.stopRequested = true; delete item.challenge;
              if (!item.reservation) item.status = 'stopped';
              enqueue(r, item, 'stop', 'stop', `FORGE Inbox ${item.id}: Stop requested; cancellation requires runtime confirmation.`, time(), { taskId: item.taskId ?? null });
            }
          }
          bump(item, time());
        }
        const result = { inboxId: item.id, projectId: item.projectId, status: item.status, revision: item.revision };
        r.events.push({ id: eventId, fingerprint, messageId: n.messageId, inboxId: item.id, bindingId: b.id, action: cmd.action, receivedAt: time(), result });
        return result;
      });
      // Start is deliberately absent here. Only dispatch() can consume an approval.
      if (e.kind === 'event' && e.native?.text.startsWith('FORGE STOP ') && output.inboxId) await stopRun(before.projectId, output.inboxId);
      return output;
    },
    async dispatch({ projectId, inboxId }) {
      checkOpen();
      if (t3?.relayContextVersion !== 1 || typeof t3.startRun !== 'function') fail('RELAY_ADMISSION_SHIM_MISSING', 'Lead must wire validateRelayAdmission inside T3 reservation', 503);
      const input = await store.transaction(s => {
        const r = scope(s, projectId), item = find(r, 'inbox', inboxId, projectId), binding = find(r, 'bindings', item.bindingId, projectId);
        if (item.reservation) return null; // Never redispatch, including unknown or failed.
        if (!binding.enabled || item.stopRequested || item.status !== 'approved') fail('RELAY_START_DENIED');
        if (taskDigest(s, projectId, item.taskId) !== item.taskDigest) fail('RELAY_APPROVAL_STALE');
        const id = randomUUID(), operationId = `relay-start:${item.id}`;
        const context = { version: 1, inboxId: item.id, reservationId: id, bindingId: binding.id, approvalEventId: item.approvalEventId, taskDigest: item.taskDigest };
        item.reservation = { id, operationId, context, createdAt: time() }; item.status = 'dispatching'; bump(item, time());
        return { operationId, projectId, taskId: item.taskId, relayContext: context };
      });
      if (!input) return find(scope(store.read(), projectId), 'inbox', inboxId, projectId);
      try {
        await t3.startRun(input);
        await store.transaction(s => { const item = find(scope(s, projectId), 'inbox', inboxId, projectId); attachObserved(s, item); });
      } catch {
        await store.transaction(s => { const item = find(scope(s, projectId), 'inbox', inboxId, projectId); item.status = 'unknown'; item.issue = 'RELAY_START_UNKNOWN'; bump(item, time()); });
      }
      const item = find(scope(store.read(), projectId), 'inbox', inboxId, projectId);
      if (item.stopRequested && item.runId) await stopRun(projectId, inboxId);
      return find(scope(store.read(), projectId), 'inbox', inboxId, projectId);
    },
    async reconcile({ projectId, inboxId }) {
      const result = await store.transaction(s => {
        const item = find(scope(s, projectId), 'inbox', inboxId, projectId);
        if (!item.reservation) fail('RELAY_NOT_RESERVED'); attachObserved(s, item); return item;
      });
      if (result.stopRequested && result.runId) await stopRun(projectId, inboxId);
      return result;
    },
    async report({ projectId, inboxId, runId, attemptId, eventId, kind, content }) {
      checkOpen(); text(eventId, 'eventId'); prose(content, 'report', 12000);
      if (!['progress', 'final'].includes(kind)) fail('RELAY_REPORT_KIND');
      return store.transaction(s => {
        const r = scope(s, projectId), item = find(r, 'inbox', inboxId, projectId), run = find(s, 'runs', runId, projectId);
        if (item.runId !== run.id || item.taskId !== run.taskId || item.attemptId !== attemptId || run.attemptId !== attemptId || digest(run.relayContext) !== digest(item.reservation?.context)) fail('RELAY_RUN_SCOPE');
        if (kind === 'final' && !terminal.has(run.status)) fail('RELAY_RESULT_NOT_FINAL');
        const correlation = { projectId, taskId: item.taskId, inboxId, runId, attemptId, status: run.status, eventId };
        return enqueue(r, item, `report:${eventId}`, kind, `FORGE ${kind}\nProject ${projectId}; task ${item.taskId}; run ${runId}; attempt ${attemptId}; status ${run.status}\n${content}`, time(), correlation);
      });
    },
    async recover() {
      return store.transaction(s => {
        const r = relayState(s);
        for (const item of r.inbox) {
          if (item.status === 'dispatching') { item.status = 'unknown'; item.issue = 'RELAY_START_UNKNOWN'; bump(item, time()); }
          if (item.cancel?.status === 'sending') item.cancel.status = 'unknown';
        }
        for (const out of r.outbox) if (out.status === 'delivering') { out.status = 'unknown'; out.revision++; }
        return { dispatchingRecovered: true, deliveryPolicy: 'unknown is never automatically resent' };
      });
    },
    close() { closed = true; },
  };
  return service;
}
