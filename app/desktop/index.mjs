import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createWindowsDriver } from './windows.mjs';
import { createBrowserDriver, browserConfig } from './browser.mjs';
import { createGuestDriver, guestConfig } from './remote.mjs';
import { fault, text, integer, aborted, wait, validateAction, mutations } from './common.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const safeId = id => { text(id, 'targetId'); if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw fault('VALIDATION', 'Invalid target ID'); return id; };
const change = target => { target.revision = (target.revision ?? 0) + 1; target.updatedAt = stamp(); };

/** Machine settings and credentials never enter portable domain snapshots.
 * One application service owns the driver lifecycle. driverFactories is an internal test seam,
 * never a user-configurable executable/JS adapter or HTTP request field.
 */
export function createDesktopService({ dataDir, store, driverFactories = {} }) {
  const root = path.resolve(dataDir, 'desktop');
  const drivers = new Map(), leases = new Map(), resources = new Map(), active = new Map(), gates = new Map(), results = new Map();
  let closed = false;
  function targetFor({ projectId, targetId }) {
    text(projectId, 'projectId'); safeId(targetId);
    const target = store.read().desktopTargets.find(t => t.id === targetId && t.projectId === projectId);
    if (!target) throw fault('NOT_FOUND', 'Desktop target not found in this project', 404);
    return target;
  }
  function serial(id, fn) {
    const next = (gates.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
    gates.set(id, next); return next.finally(() => { if (gates.get(id) === next) gates.delete(id); });
  }
  async function update(id, patch) {
    return store.transaction(s => { const t = s.desktopTargets.find(t => t.id === id); if (!t) throw fault('NOT_FOUND', 'Target removed', 404); Object.assign(t, patch); change(t); return t; });
  }
  async function driver(target) {
    if (closed) throw fault('SHUTDOWN', 'Desktop service is closed', 503);
    if (!drivers.has(target.id)) {
      let config;
      try { config = JSON.parse(await readFile(path.join(root, 'config', `${safeId(target.id)}.json`), 'utf8')); }
      catch { throw fault('SETUP_REQUIRED', 'Configure this target on this machine before use', 409); }
      const factory = driverFactories[target.kind] ?? { windows: createWindowsDriver, browser: createBrowserDriver, guest: createGuestDriver }[target.kind];
      if (!factory) throw fault('SETUP_REQUIRED', 'Choose Windows, browser or guest target setup');
      // Set synchronously after awaited config read; concurrent reads may reach this point together.
      if (!drivers.has(target.id)) drivers.set(target.id, factory({ config, targetId: target.id }));
    }
    return drivers.get(target.id);
  }
  function leaseFor(input) {
    const lease = leases.get(input.targetId);
    if (!lease || lease.revoked || lease.expiresAtMs <= Date.now() || lease.controllerId !== input.controllerId || lease.leaseId !== input.leaseId || (input.attemptId !== undefined && lease.attemptId !== input.attemptId)) throw fault('LEASE_REQUIRED', 'Acquire a current lease for this controller and attempt; stopped leases cannot resume', 409);
    return lease;
  }
  const publicLease = l => ({ targetId: l.targetId, controllerId: l.controllerId, leaseId: l.leaseId, generation: l.generation, attemptId: l.attemptId, runId: l.runId, windowId: l.windowId, expiresAt: new Date(l.expiresAtMs).toISOString() });

  async function revoke(target, state) {
    const lease = leases.get(target.id);
    if (lease) { lease.revoked = true; clearTimeout(lease.timer); leases.delete(target.id); }
    const running = active.get(target.id);
    if (running) running.controller.abort(fault('CANCELLED', 'Desktop input revoked', 409));
    // Keep the physical resource reserved until teardown finishes; another target cannot race it.
    let reconciled = true;
    try { await drivers.get(target.id)?.stop(lease?.selection); } catch { reconciled = false; }
    const resourceKey = lease?.resourceKey ?? drivers.get(target.id)?.resourceKey;
    if (reconciled && resources.get(resourceKey) === target.id) resources.delete(resourceKey);
    if (running) await running.finished;
    await update(target.id, { controllerId: null, leaseId: null, controlState: reconciled ? state : 'reconciliation_required', stopQualification: 'Admission revoked; completed effects are not undone. Interrupted dispatched effects remain unknown until inspection.', lastStopAt: stamp() });
    return { targetId: target.id, controlState: reconciled ? state : 'reconciliation_required', revokedLeaseId: lease?.leaseId ?? null, interrupted: running ? [running.operationId] : [], reconciliation: reconciled ? 'Driver stopped. Inspect before repeating any unknown effect.' : 'Remote teardown unconfirmed; restore the connection and retry Take over before acquiring.' };
  }

  const api = {
    async setup({ projectId, targetId, name, kind, config = {} }) {
      text(projectId, 'projectId'); text(name, 'name');
      if (!['windows', 'browser', 'guest'].includes(kind)) throw fault('VALIDATION', 'kind must be windows, browser or guest');
      if (!store.read().projects.some(p => p.id === projectId)) throw fault('NOT_FOUND', 'Project not found', 404);
      targetId = safeId(targetId ?? randomUUID());
      return serial(targetId, async () => {
        const previous = store.read().desktopTargets.find(t => t.id === targetId);
        if (previous && previous.projectId !== projectId) throw fault('NOT_FOUND', 'Desktop target belongs to another project', 404);
        if (leases.has(targetId) || active.has(targetId)) throw fault('TARGET_BUSY', 'Stop or release this target before changing its setup', 409);
        const clean = kind === 'browser' ? browserConfig(config) : kind === 'guest' ? guestConfig(config) : {};
        await drivers.get(targetId)?.shutdown(); drivers.delete(targetId);
        await mkdir(path.join(root, 'config'), { recursive: true });
        await writeFile(path.join(root, 'config', `${targetId}.json`), JSON.stringify(clean), { mode: 0o600 });
        const target = await store.transaction(s => {
          let t = s.desktopTargets.find(t => t.id === targetId);
          if (!t) { t = { id: targetId, projectId, createdAt: stamp(), revision: 0 }; s.desktopTargets.push(t); }
          Object.assign(t, { name, kind, controllerId: null, leaseId: null, controlState: 'stopped', capabilities: [], setup: 'machine-local' }); change(t); return t;
        });
        if (config.installBrowser === true && kind === 'browser') await (await driver(target)).install();
        return target;
      });
    },
    async installBrowser(input) {
      const target = targetFor(input);
      if (target.kind !== 'browser') throw fault('CAPABILITY', 'Browser installation applies to browser targets');
      return serial(target.id, async () => { if (leases.has(target.id)) throw fault('TARGET_BUSY', 'Release the browser before installing', 409); return (await driver(target)).install(); });
    },
    async health(input) {
      const target = targetFor(input);
      let result;
      try { result = await (await driver(target)).health(); }
      catch (e) { result = { ready: false, capabilities: [], blocker: { code: e.code ?? 'UNAVAILABLE', message: 'Target unavailable; configure this machine connection and retry' } }; }
      await update(target.id, { capabilities: result.capabilities, lastHealth: { ready: result.ready, at: stamp(), blocker: result.blocker }, ...(leases.has(target.id) ? {} : { controllerId: null, leaseId: null, controlState: 'stopped' }) });
      return { targetId: target.id, kind: target.kind, ...result };
    },
    async listWindows(input) { const t = targetFor(input); return { targetId: t.id, windows: await (await driver(t)).listWindows() }; },
    async acquire(input) {
      const target = targetFor(input); text(input.controllerId, 'controllerId'); text(input.attemptId, 'attemptId'); text(input.windowId, 'windowId', 2000);
      if (input.runId !== undefined) text(input.runId, 'runId');
      const ttlMs = integer(input.ttlMs ?? 120000, 'ttlMs', 1000, 900000);
      return serial(target.id, async () => {
        if (leases.has(target.id)) throw fault('TARGET_BUSY', 'This target already has a controller. Stop, release or take over explicitly.', 409);
        const d = await driver(target);
        if (resources.has(d.resourceKey)) throw fault('TARGET_BUSY', 'The same physical desktop is already reserved by another target or needs reconciliation', 409);
        // Reserve before awaits, including another target ID using the same Windows desktop.
        resources.set(d.resourceKey, target.id);
        let selection;
        try { selection = await d.acquire(input.windowId, input); }
        catch (e) { resources.delete(d.resourceKey); throw e; }
        const lease = { ...input, targetId: target.id, windowId: input.windowId, leaseId: randomUUID(), generation: randomUUID(), expiresAtMs: Date.now() + ttlMs, resourceKey: d.resourceKey, selection, revoked: false };
        leases.set(target.id, lease);
        lease.timer = setTimeout(() => { void serial(target.id, () => revoke(target, 'stopped')).catch(() => {}); }, ttlMs); lease.timer.unref();
        await update(target.id, { controllerId: input.controllerId, leaseId: lease.leaseId, controlState: 'owned', attemptId: input.attemptId, expiresAt: publicLease(lease).expiresAt });
        return publicLease(lease);
      });
    },
    async action(input) {
      const target = targetFor(input); const lease = leaseFor(input);
      text(input.attemptId, 'attemptId'); text(input.operationId, 'operationId');
      const args = validateAction(input.name, input.arguments);
      const fingerprint = hash(JSON.stringify({ targetId: target.id, projectId: target.projectId, leaseId: lease.leaseId, controllerId: input.controllerId, attemptId: input.attemptId, name: input.name, args }));
      const prior = store.read().receipts.find(r => r.operationId === input.operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint || prior.type !== 'desktop.action') throw fault('OPERATION_REUSE', 'Operation ID belongs to a different command, target, lease or attempt', 409);
        return results.get(input.operationId) ?? { ...prior.result, status: prior.result.status === 'running' ? 'unknown' : prior.result.status, replayed: true, resultUnavailable: true };
      }
      if (active.has(target.id)) throw fault('TARGET_BUSY', 'One bounded action at a time; queued input is not admitted', 409);
      const d = await driver(target); leaseFor(input);
      const capabilities = (await d.health()).capabilities;
      leaseFor(input);
      if (!capabilities.includes(input.name)) throw fault('CAPABILITY', 'Target does not currently support this operation', 409);
      if (active.has(target.id)) throw fault('TARGET_BUSY', 'One bounded action at a time', 409);
      const controller = new AbortController(); let finish;
      const running = { controller, operationId: input.operationId, finished: new Promise(resolve => { finish = resolve; }), dispatched: false };
      active.set(target.id, running);
      const base = { operationId: input.operationId, targetId: target.id, projectId: target.projectId, attemptId: input.attemptId, name: input.name };
      let timer;
      try {
        await store.transaction(s => {
          if (s.receipts.some(r => r.operationId === input.operationId)) throw fault('OPERATION_REUSE', 'Operation ID already exists', 409);
          s.receipts.push({ operationId: input.operationId, type: 'desktop.action', fingerprint, result: { ...base, status: 'running', at: stamp() } });
        });
        leaseFor(input); aborted(controller.signal);
        timer = setTimeout(() => { void serial(target.id, () => revoke(target, 'stopped')).catch(() => {}); }, args.timeoutMs ?? (input.name === 'wait' ? args.ms + 2000 : 15000));
        const options = { signal: controller.signal, selection: lease.selection, input, dispatch: () => { aborted(controller.signal); leaseFor(input); running.dispatched = true; } };
        let result = input.name === 'wait' ? (await wait(args.ms, controller.signal), { waitedMs: args.ms }) : await d.action(input.name, args, options);
        aborted(controller.signal); leaseFor(input);
        if (result?.verified === false) throw fault('POSTCONDITION', 'Driver could not verify the input postcondition', 409);
        if (result?.png) {
          const png = Buffer.from(result.png); if (png.length > 6 * 1024 * 1024) throw fault('ARTIFACT_LIMIT', 'Screenshot exceeds 6 MiB limit');
          const artifactId = randomUUID(); await mkdir(path.join(root, 'screenshots'), { recursive: true });
          await writeFile(path.join(root, 'screenshots', `${artifactId}.png`), png, { mode: 0o600 });
          const artifact = { id: artifactId, projectId: target.projectId, targetId: target.id, attemptId: input.attemptId, name: 'Desktop screenshot.png', type: 'desktop-screenshot', mimeType: 'image/png', size: png.length, sha256: hash(png), status: 'verified', createdAt: stamp() };
          await store.transaction(s => { s.artifacts.push(artifact); });
          result = { artifactId, mimeType: 'image/png', size: artifact.size, sha256: artifact.sha256 };
        }
        aborted(controller.signal); leaseFor(input);
        const completed = { ...base, status: 'completed', result, at: stamp() };
        results.set(input.operationId, completed);
        // Inspection text and typed text are never copied into durable receipts.
        await store.transaction(s => { const r = s.receipts.find(r => r.operationId === input.operationId); r.result = { ...base, status: 'completed', ...(result?.artifactId ? { result } : {}), at: stamp() }; });
        return completed;
      } catch (e) {
        if (e.code === 'OPERATION_REUSE') throw e;
        const status = mutations.has(input.name) && running.dispatched ? 'unknown' : controller.signal.aborted ? 'cancelled' : 'failed';
        const failed = { ...base, status, error: { code: controller.signal.aborted ? 'CANCELLED' : e.code ?? 'DRIVER_ACTION', message: status === 'unknown' ? 'Input may have taken effect before interruption. Inspect before retrying with a new operation.' : 'Action did not complete; inspect target readiness and selected element.' }, at: stamp() };
        results.set(input.operationId, failed);
        await store.transaction(s => { const r = s.receipts.find(r => r.operationId === input.operationId); if (r?.fingerprint === fingerprint) r.result = failed; });
        return failed;
      } finally { clearTimeout(timer); if (active.get(target.id) === running) active.delete(target.id); finish(); }
    },
    async stop(input) {
      const target = targetFor(input);
      return serial(target.id, () => {
        if (!input.takeover) leaseFor(input);
        return revoke(target, input.takeover ? 'human_control' : 'stopped');
      });
    },
    async takeover(input) { return api.stop({ ...input, takeover: true }); },
    async release(input) { return api.stop(input); },
    async screenshot(input) {
      const target = targetFor(input); safeId(input.artifactId);
      const a = store.read().artifacts.find(a => a.id === input.artifactId && a.projectId === input.projectId && a.targetId === target.id && a.type === 'desktop-screenshot');
      if (!a) throw fault('NOT_FOUND', 'Screenshot not found in this target/project', 404);
      const file = path.join(root, 'screenshots', `${a.id}.png`);
      if ((await stat(file)).size !== a.size || hash(await readFile(file)) !== a.sha256) throw fault('ARTIFACT_INTEGRITY', 'Screenshot bytes changed', 409);
      return { path: file, mimeType: 'image/png' };
    },
    async shutdown() {
      for (const id of [...drivers.keys()]) await serial(id, async () => { const target = store.read().desktopTargets.find(t => t.id === id); if (target) await revoke(target, 'stopped'); await drivers.get(id)?.shutdown(); });
      drivers.clear(); closed = true;
    },
  };
  return api;
}
