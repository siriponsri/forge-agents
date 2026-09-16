import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {nowIso, redact} from './core.mjs';

export const ADAPTERS = ['official-codex','maxplus-codex','opencode'];
const DEFAULT_TIMEOUT = 120000;

function violation(message) { throw new Error(`ADAPTER_POLICY_VIOLATION: ${message}`); }

export function assertSafePolicy(sandbox_policy='read-only', approval_policy='explicit') {
  if (sandbox_policy === 'danger-full-access') violation('danger-full-access is not permitted by direct adapter');
  if (!['read-only','workspace-write'].includes(sandbox_policy)) violation(`unsupported sandbox ${sandbox_policy}`);
  if (!['ask','on-failure','explicit','never'].includes(approval_policy)) violation(`unsupported approval ${approval_policy}`);
  if (sandbox_policy === 'workspace-write' && approval_policy === 'never') violation('workspace-write cannot use approval=never');
  return true;
}

function wrapperPath() {
  const root = process.env.AGENT_SHARED_ROOT || path.join(process.env.USERPROFILE || process.cwd(), '.agent-shared');
  return path.join(root, 'scripts', 'agent.ps1');
}

function opencodeExecutable() {
  if (process.env.OPENCODE_EXECUTABLE) return process.env.OPENCODE_EXECUTABLE;
  const nvmRoot = process.env.NVM_HOME || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'nvm') : '');
  if (nvmRoot && fs.existsSync(nvmRoot)) {
    const versions = fs.readdirSync(nvmRoot, {withFileTypes:true}).filter(entry=>entry.isDirectory() && /^v\d/.test(entry.name)).sort((a,b)=>b.name.localeCompare(a.name, undefined, {numeric:true}));
    for (const version of versions) {
      const candidates = [path.join(nvmRoot, version.name, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'), ...['opencode.exe','opencode.cmd','opencode.ps1'].map(file=>path.join(nvmRoot, version.name, file))];
      for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'opencode';
}

export function buildAdapterCommand({adapter_id, operation='probe', workspace_root, prompt='return only a concise probe result', sandbox_policy='read-only', approval_policy='explicit', timeout_ms=DEFAULT_TIMEOUT} = {}) {
  if (!ADAPTERS.includes(adapter_id)) violation(`unknown adapter ${adapter_id}`);
  if (!workspace_root) violation('workspace_root is required');
  assertSafePolicy(sandbox_policy, approval_policy);
  if (!Number.isInteger(timeout_ms) || timeout_ms < 1) violation('timeout_ms must be positive integer');
  if (operation === 'probe') {
    if (adapter_id === 'opencode') return {executable:opencodeExecutable(), args:['--help'], cwd:workspace_root, timeout_ms, sandbox_policy, approval_policy};
    const mode = adapter_id === 'maxplus-codex' ? 'maxplus' : 'official';
    return {executable:'pwsh', args:['-NoProfile','-File',wrapperPath(),mode,'--help'], cwd:workspace_root, timeout_ms, sandbox_policy, approval_policy};
  }
  if (!['plan','execute','resume','interrupt'].includes(operation)) violation(`unsupported operation ${operation}`);
  if (adapter_id === 'opencode') {
    if (sandbox_policy === 'workspace-write') violation('OpenCode write surface is not enabled until an explicit permission adapter exists');
    const args = ['run','--format','json','--dir',workspace_root,'--pure'];
    return {executable:opencodeExecutable(), args:[...args,prompt], cwd:workspace_root, timeout_ms, sandbox_policy, approval_policy};
  }
  const mode = adapter_id === 'maxplus-codex' ? 'maxplus' : 'official';
  const args = ['-NoProfile','-File',wrapperPath(),mode,'exec','--json','--ephemeral','-C',workspace_root,'-s',sandbox_policy];
  if (sandbox_policy === 'workspace-write') args.push('--approve-for-me');
  return {executable:'pwsh', args:[...args,prompt], cwd:workspace_root, timeout_ms, sandbox_policy, approval_policy};
}

export function normalizeResult({adapter_id, operation, command, stdout='', stderr='', exit_code=null, timed_out=false, cancelled=false, started_at, ended_at} = {}) {
  return redact({schema_version:'1.0.0', adapter_id, operation, command:{executable:command?.executable, args:command?.args, cwd:command?.cwd},
    stdout, stderr, exit_code, timed_out, cancelled, started_at, ended_at,
    terminal_state: cancelled ? 'INTERRUPTED' : timed_out ? 'TIMEOUT' : exit_code === 0 ? 'COMPLETED' : 'FAILED',
    artifacts:[], effective_sandbox_policy:command?.sandbox_policy, effective_approval_policy:command?.approval_policy});
}

export function runProcess(command, {signal} = {}) {
  return new Promise((resolve) => {
    const started_at = nowIso();
    let stdout=''; let stderr=''; let timed_out=false; let cancelled=false; let settled=false;
    const isCmd = command.executable.toLowerCase().endsWith('.cmd');
    const quoteWindows = value => `"${String(value).replaceAll('"','\\"')}"`;
    const commandToken = value => /[\s"]/.test(String(value)) ? quoteWindows(value) : String(value);
    const child = isCmd
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d','/c',[quoteWindows(command.executable), ...command.args.map(commandToken)].join(' ')], {cwd:command.cwd, windowsHide:true, shell:false, signal})
      : spawn(command.executable, command.args, {cwd:command.cwd, windowsHide:true, shell:false, signal});
    if (signal) signal.addEventListener('abort', () => { cancelled=true; child.kill(); }, {once:true});
    const finish = (exit_code) => { if (settled) return; settled=true; resolve(normalizeResult({adapter_id:command.adapter_id, operation:command.operation, command, stdout, stderr, exit_code, timed_out, cancelled, started_at, ended_at:nowIso()})); };
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => { if (error.name === 'AbortError' || signal?.aborted) cancelled=true; stderr += error.message; finish(null); });
    child.on('close', code => finish(code));
    const timer = setTimeout(() => { timed_out=true; child.kill(); }, command.timeout_ms ?? DEFAULT_TIMEOUT);
    child.on('close', () => clearTimeout(timer));
  });
}

export async function runAdapter(options, {signal} = {}) {
  const command = buildAdapterCommand(options);
  command.adapter_id = options.adapter_id; command.operation = options.operation || 'probe';
  const result = await runProcess(command, {signal});
  return {...result, adapter_id:options.adapter_id, operation:options.operation || 'probe'};
}
