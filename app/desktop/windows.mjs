import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fault, aborted, text } from './common.mjs';

const script = fileURLToPath(new URL('./windows.ps1', import.meta.url));
const capabilities = ['inspect', 'screenshot', 'focus', 'type', 'click', 'key', 'wait'];
export function createWindowsDriver() {
  const children = new Set();
  async function invoke(operation, body = {}, signal) {
    aborted(signal);
    if (process.platform !== 'win32') throw fault('WINDOWS_REQUIRED', 'Native Windows driver requires Windows and an unlocked interactive desktop', 503);
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      children.add(child); let output = '', size = 0, settled = false;
      child.stdout.setEncoding('utf8');
      const timer = setTimeout(() => child.kill(), 35000);
      const abort = () => child.kill(); signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', data => { size += Buffer.byteLength(data); if (size > 8 * 1024 * 1024) child.kill(); else output += data; });
      child.stderr.resume(); // Do not log raw UI data or process/environment diagnostics.
      const finish = (err, result) => { if (settled) return; settled = true; clearTimeout(timer); children.delete(child); signal?.removeEventListener('abort', abort); err ? reject(err) : resolve(result); };
      child.on('error', () => finish(fault('WINDOWS_UNAVAILABLE', 'Could not start the fixed Windows UI Automation adapter', 503)));
      child.on('exit', () => {
        if (signal?.aborted) return finish(signal.reason ?? fault('CANCELLED', 'Windows action cancelled'));
        try {
          const response = JSON.parse(output.replace(/^\uFEFF/, '').trim());
          if (!response.ok) return finish(fault(response.code ?? 'WINDOWS_ACTION', response.message ?? 'Windows adapter refused this action', 409));
          finish(null, response.result);
        } catch { finish(fault('WINDOWS_UNAVAILABLE', 'Windows adapter timed out or exited without a complete response; check interactive session and app integrity level', 503)); }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ operation, ...body }));
    });
  }
  return {
    resourceKey: 'windows:interactive-desktop',
    async health() {
      try { const identity = await invoke('health'); return { ready: true, capabilities, identity: { kind: 'windows', ...identity }, limitations: ['type replaces text through ValuePattern or targeted native Edit WM_SETTEXT', 'click uses InvokePattern or targeted native Button BM_CLICK, without screen coordinates', 'key requires a selected native Edit control; no global shortcuts', 'screenshot uses target-window PrintWindow; protected surfaces may be blank'] }; }
      catch (e) { return { ready: false, capabilities: [], blocker: { code: e.code, message: e.message } }; }
    },
    async listWindows() {
      const windows = await invoke('list');
      return windows.map(w => ({ ...w, id: Buffer.from(JSON.stringify(w.identity)).toString('base64url') }));
    },
    async acquire(windowId) {
      text(windowId, 'windowId', 2000);
      let identity; try { identity = JSON.parse(Buffer.from(windowId, 'base64url').toString()); } catch { throw fault('TARGET_IDENTITY', 'Select a current window from List windows'); }
      await invoke('validate', { identity }); return { identity, windowId };
    },
    async action(name, args, { signal, selection, dispatch }) {
      aborted(signal);
      if (['type', 'click', 'key'].includes(name)) text(args.elementId, 'elementId', 1000);
      // The helper revalidates HWND/PID/start time/session before every operation.
      // An OS/UIA call can have an effect before its response is interrupted: mark uncertain.
      if (['type', 'click', 'key', 'focus'].includes(name)) dispatch();
      const result = await invoke(name, { identity: selection.identity, args }, signal);
      if (name === 'screenshot') return { png: Buffer.from(result.png, 'base64'), width: result.width, height: result.height };
      return result;
    },
    async stop() {
      const running = [...children];
      await Promise.all(running.map(child => new Promise(resolve => { child.once('close', resolve); child.kill(); if (child.exitCode !== null) resolve(); })));
    },
    async shutdown() { await this.stop(); },
  };
}
