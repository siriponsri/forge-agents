// Hallmark · component: MCP connections · theme: existing VS Code tokens
// Pre-emit critique: P4 H4 E4 S5 R5 V4. Browser state contains no credentials.
import React, { useEffect, useRef, useState } from 'react';
import { request, operationId, scoped, date, ApiError } from './api.mjs';
import { Field, Badge, Empty, Json } from './ui.jsx';
import { environmentNames, argumentRows, authorizationLink } from './ProviderSetup.jsx';

const modes = ['allowed', 'ask', 'off'];
const query = scope => new URLSearchParams(scope).toString();
const modeLabel = (t, mode) => ({ allowed: t('อนุญาต', 'Allowed'), ask: t('ถามก่อน', 'Ask'), off: t('ปิด', 'Off') })[mode];
async function oauthStatus(scope, signal, timeout = 8000) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch('/api/mcp/oauth/status?' + query(scope), { signal: controller.signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new ApiError(data?.error?.message || 'OAuth status unavailable.', response.status, data?.error?.code);
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export default function McpConnections(props) { return <McpProject key={props.projectId} {...props} />; }
function McpProject({ t, state, projectId, run, busy }) {
  const connections = scoped(state, 'connections', projectId).filter(c => c.kind === 'mcp');
  const [selected, setSelected] = useState('');
  const connection = connections.find(c => c.id === selected) ?? connections[0];
  return <section aria-label={t('การเชื่อมต่อ MCP', 'MCP connections')} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <h2>{t('เชื่อมต่อเครื่องมือ MCP', 'Connect MCP tools')}</h2>
    <p className="help">{t('เพิ่ม server ตรวจ schema จริง แล้วกำหนด Allowed / Ask / Off เครื่องมือเริ่มต้นปิดอยู่ การเชื่อมบัญชีไม่ใช่การอนุญาตรันเครื่องมือ', 'Add a server, discover its actual schemas, then configure Allowed / Ask / Off. Tools default to Off. Account connection does not authorize tool execution.')}</p>
    <McpForm {...{ t, projectId, run, busy }} onCreated={c => setSelected(c.id)} />
    {!connections.length ? <Empty>{t('ยังไม่มี MCP ในโครงการนี้', 'No MCP connections in this project yet.')}</Empty> : <>
      <Field label={t('MCP ของโครงการ', 'Project MCP connection')}><select disabled={busy} value={connection.id} onChange={e => setSelected(e.target.value)}>{connections.map(c => <option key={c.id} value={c.id}>{c.name} · {c.route}</option>)}</select></Field>
      <McpAccount key={connection.id} {...{ t, state, connection, projectId, run, busy }} />
    </>}
  </section>;
}
function McpForm({ t, projectId, run, busy, onCreated }) {
  const [route, setRoute] = useState('http'), [name, setName] = useState(''), [url, setURL] = useState('');
  const [command, setCommand] = useState(''), [args, setArgs] = useState(''), [refs, setRefs] = useState(''), [auth, setAuth] = useState('none'), [authEnv, setAuthEnv] = useState(''), [error, setError] = useState('');
  const pending = useRef(false);
  return <details className="panel"><summary>{t('เพิ่ม MCP server', 'Add MCP server')}</summary>
    <form onSubmit={e => {
      e.preventDefault(); if (pending.current) return; pending.current = true; setError('');
      run(async () => {
        try {
          const body = { operationId: operationId(), projectId, name, route };
          if (route === 'stdio') Object.assign(body, { command, args: argumentRows(args), envRefs: environmentNames(refs) });
          else {
            const endpoint = new URL(url);
            if (!authorizationLink(url) || endpoint.search || endpoint.hash) throw new Error(t('ใช้ HTTPS หรือ localhost โดยไม่ใส่ credential หรือ query', 'Use HTTPS or loopback HTTP without credentials, query or fragment.'));
            body.url = url;
            if (auth === 'env') { if (environmentNames(authEnv).length !== 1) throw new Error('Enter one environment variable name.'); body.authEnv = authEnv; }
          }
          const c = await request('/api/mcp/configure', body); onCreated(c); setName(''); setURL(''); setCommand(''); setArgs(''); setRefs(''); setAuthEnv(''); return c;
        } catch (e) { setError(e.message); throw e; } finally { pending.current = false; }
      });
    }}>
      <Field label={t('ชื่อการเชื่อมต่อ MCP', 'MCP connection label')}><input required value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label={t('ช่องทาง MCP', 'MCP transport')}><select value={route} onChange={e => setRoute(e.target.value)}><option value="http">Streamable HTTP</option><option value="stdio">{t('โปรแกรม stdio ในเครื่อง', 'Local stdio executable')}</option></select></Field>
      {route === 'http' ? <>
        <Field label={t('URL ของ MCP endpoint', 'MCP endpoint URL')}><input required type="url" value={url} onChange={e => setURL(e.target.value)} placeholder="https://server.example/mcp" /></Field>
        <Field label={t('การยืนยันบัญชี HTTP', 'HTTP authentication')}><select value={auth} onChange={e => setAuth(e.target.value)}><option value="none">{t('ไม่มี / เชื่อม OAuth หลังบันทึก', 'None / connect OAuth after saving')}</option><option value="env">{t('Bearer จาก environment reference', 'Bearer environment reference')}</option></select></Field>
        {auth === 'env' && <Field label={t('ชื่อ environment variable ของ Bearer', 'Bearer environment reference')} hint={t('กรอกชื่อเท่านั้น ค่า secret อยู่ในเครื่อง', 'Name only; the secret value stays on this machine.')}><input required pattern="[A-Za-z_][A-Za-z0-9_]{0,127}" autoComplete="off" value={authEnv} onChange={e => setAuthEnv(e.target.value)} placeholder="FORGE_MCP_TOKEN" /></Field>}
      </> : <>
        <Field label={t('โปรแกรม MCP ที่ติดตั้งไว้', 'Installed MCP executable')}><input required value={command} onChange={e => setCommand(e.target.value)} /></Field>
        <Field label={t('อาร์กิวเมนต์ MCP (หนึ่งค่าต่อบรรทัด)', 'MCP literal arguments (one per line)')} hint={t('โปรแกรมจะเริ่มเมื่อตรวจเครื่องมือ ไม่ใช้ shell command หรือ secret', 'Discovery starts this program. Literal argv only, no shell commands or credentials.')}><textarea rows={3} value={args} onChange={e => setArgs(e.target.value)} /></Field>
        <Field label={t('ชื่อ environment variables ของ MCP', 'MCP environment references')}><textarea rows={2} autoComplete="off" value={refs} onChange={e => setRefs(e.target.value)} /></Field>
      </>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{t('บันทึก MCP server', 'Save MCP server')}</button>
    </form>
  </details>;
}
function McpAccount({ t, state, connection: c, projectId, run, busy }) {
  const scope = { projectId, connectionId: c.id }, [error, setError] = useState('');
  const [policy, setPolicy] = useState(null), [mode, setMode] = useState('off'), [overrides, setOverrides] = useState({});
  const [toolName, setTool] = useState(''), [result, setResult] = useState(null), [executing, setExecuting] = useState(false);
  const pending = useRef(false), live = useRef(true), stopped = useRef(new Set());
  const tools = c.lastCheck?.capabilities ?? [], tool = tools.find(tool => tool.name === toolName);
  const calls = scoped(state, 'events', projectId).filter(e => e.type === 'mcp.call' && e.connectionId === c.id);
  const active = calls.some(e => ['submitting', 'running'].includes(e.status));
  const unknown = calls.some(e => e.status === 'unknown') || result?.status === 'unknown';
  const observedPolicy = scoped(state, 'events', projectId).find(e => e.type === 'governance.policy' && e.connectionId === c.id);
  const policyFresh = policy?.connectionRevision === c.revision && (!observedPolicy || observedPolicy.revision === policy?.revision);
  const effective = name => policyFresh && policy?.bindingCurrent ? modes[Math.max(modes.indexOf(policy.effectiveMode ?? 'off'), modes.indexOf(policy.tools?.[name] ?? policy.effectiveMode ?? 'off'))] : 'off';
  const acceptPolicy = value => { if (live.current) { setPolicy(value); setMode(value.mode); setOverrides(value.tools ?? {}); } return value; };
  const loadPolicy = () => request('/api/governance/policy?' + query(scope)).then(acceptPolicy);
  useEffect(() => {
    live.current = true; loadPolicy().catch(e => { if (live.current) setError(e.message); });
    return () => { live.current = false; };
  }, [c.id]);
  const perform = fn => {
    if (pending.current) return; pending.current = true; setError('');
    return run(async () => {
      try { return await fn(); } catch (e) { if (live.current) setError(e.message); throw e; }
      finally { pending.current = false; }
    });
  };
  const execute = args => perform(async () => {
    // Allocate only on an explicit Run click. Retain this exact immutable object
    // across request, human decision and MCP admission; never retry after error.
    const operation = { ...scope, operationId: operationId(), name: tool.name, arguments: structuredClone(args) };
    let dispatchAttempted = false;
    if (live.current) { setExecuting(true); setResult({ status: 'requesting', operationId: operation.operationId }); }
    try {
      if (effective(tool.name) === 'off' || c.discoveryStale || c.enabled === false) throw new Error('Discover tools and explicitly configure policy for the current connection first.');
      if (effective(tool.name) === 'ask') {
        const approval = await request('/api/governance/tool/request', operation);
        if (!live.current) throw new Error('Connection view changed before approval. Nothing was dispatched.');
        if (approval.status !== 'pending' || approval.toolOperationId !== operation.operationId) throw new Error('The exact operation is no longer pending. Reload policy and inspect its decision.');
        const decided = await request('/api/governance/tool/decide', { operationId: operationId(), projectId, approvalId: approval.id, expectedRevision: approval.revision, decision: 'approved' });
        if (decided.status !== 'approved') throw new Error('Approval changed before execution. Reload policy; no tool was dispatched by this page.');
      }
      if (!live.current) throw new Error('Connection view changed before dispatch.');
      dispatchAttempted = true;
      const value = await request('/api/mcp/call', operation);
      if (live.current) setResult(value); return value;
    } catch (e) {
      if (live.current) {
        const uncertain = dispatchAttempted && (!e.status || e.status >= 500);
        setResult({ operationId: operation.operationId, status: uncertain ? 'unconfirmed' : 'not-dispatched', message: uncertain ? t('ไม่ส่งซ้ำ ตรวจประวัติและผลจาก server ก่อน', 'No replay. Inspect server history and outcome before another operation.') : t('ไม่ได้ส่งเครื่องมือ ตรวจสิทธิ์หรือแก้ arguments ก่อนเริ่ม operation ใหม่', 'Tool not dispatched. Reload policy or correct the arguments before a new operation.') });
        if (!dispatchAttempted) setPolicy(null);
      }
      throw e;
    } finally { if (live.current) setExecuting(false); }
  });
  const stop = call => {
    if (stopped.current.has(call.id)) return; stopped.current.add(call.id);
    // Stop remains reachable while the original HTTP call is waiting. One
    // cancellation dispatch per call, including when its response is lost.
    run(async () => { try { return await request('/api/mcp/stop', { ...scope, callId: call.id }); } catch (e) { if (live.current) setError(e.message); throw e; } });
    setResult(s => ({ ...s }));
  };
  return <div className="panel">
    <h3>{c.name}</h3><p><Badge>{c.enabled === false ? 'disabled' : 'enabled'}</Badge> · {c.route} · {c.url ?? c.command}</p>
    <div className="actions">
      <button disabled={busy || executing} onClick={() => perform(() => request('/api/mcp/enable', { ...scope, enabled: c.enabled === false }))}>{c.enabled === false ? t('เปิดการเชื่อมต่อ', 'Enable connection') : t('ปิดการเชื่อมต่อ', 'Disable connection')}</button>
      <button disabled={busy || executing || c.enabled === false} onClick={() => perform(async () => { const value = await request('/api/mcp/discover', scope); await loadPolicy(); return value; })}>{t('ตรวจเครื่องมือจริง', 'Discover actual tools')}</button>
    </div>
    {c.lastCheck && <p role="status">{t('ผลตรวจ', 'Discovery')}: <Badge>{c.lastCheck.status}</Badge> · {date(c.lastCheck.checkedAt)}</p>}
    {c.lastCheck?.error && <p className="error-text" role="alert">{c.lastCheck.error.message}</p>}
    {c.discoveryStale && <p role="status">{t('ต้องตรวจเครื่องมือใหม่ก่อนเรียกใช้งาน', 'Discovery is required before a call.')}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {c.route === 'http' && <McpOAuth key={c.id} {...{ t, c, scope, run, busy: busy || executing }} />}
    <hr /><h3>{t('สิทธิ์เครื่องมือ', 'Tool policy')}</h3>
    <p className="help">{t('Off เป็นค่าเริ่มต้น สิทธิ์รายเครื่องมือจำกัดให้แคบลงเท่านั้น เมื่อ endpoint บัญชี หรือ catalog เปลี่ยน ต้องบันทึกสิทธิ์ใหม่อย่างชัดเจน', 'Default is Off. Tool overrides can only narrow the connection policy. Endpoint, account or catalog changes require explicit policy configuration again.')}</p>
    {(!policyFresh || !policy?.bindingCurrent) && <p role="status">{t('สิทธิ์ที่แสดงยังไม่ผูกกับสถานะล่าสุด การเรียกถูกปิดจนกว่าจะอ่านและบันทึกสิทธิ์ใหม่', 'Policy is not bound to the displayed current connection. Calls remain Off until policy is reloaded and explicitly saved.')}</p>}
    <button disabled={busy || executing} onClick={() => perform(loadPolicy)}>{t('อ่านสิทธิ์ล่าสุด', 'Reload policy')}</button>
    <form onSubmit={e => { e.preventDefault(); perform(async () => {
      await request('/api/governance/policy', { ...scope, operationId: operationId(), expectedRevision: policy.revision, expectedConnectionRevision: policy.connectionRevision, mode, tools: Object.fromEntries(Object.entries(overrides).filter(([name]) => tools.some(tool => tool.name === name))) });
      return loadPolicy();
    }); }}>
      <Field label={t('สิทธิ์สูงสุดของการเชื่อมต่อ', 'Connection policy ceiling')}><select value={mode} onChange={e => setMode(e.target.value)}>{modes.map(value => <option key={value} value={value}>{modeLabel(t, value)}</option>)}</select></Field>
      {tools.map(tool => <Field key={tool.name} label={`${tool.name} · ${t('ใช้จริง', 'effective')}: ${modeLabel(t, effective(tool.name))}`}><select value={overrides[tool.name] ?? ''} onChange={e => setOverrides(s => { const next = { ...s }; if (e.target.value) next[tool.name] = e.target.value; else delete next[tool.name]; return next; })}><option value="">{t('ตามสิทธิ์การเชื่อมต่อ', 'Inherit connection policy')}</option>{modes.map(value => <option key={value} value={value}>{modeLabel(t, value)}</option>)}</select></Field>)}
      <button className="primary" disabled={busy || executing || !policyFresh || c.discoveryStale || c.enabled === false}>{t('บันทึกสิทธิ์สำหรับสถานะนี้', 'Save policy for this connection')}</button>
    </form>
    <hr /><h3>{t('ตรวจและเรียกเครื่องมือ', 'Inspect & run a tool')}</h3>
    {!tools.length && <Empty>{t('ยังไม่มี schema ที่ตรวจพบจาก server', 'No schemas discovered from this server yet.')}</Empty>}
    <Field label={t('เครื่องมือที่ตรวจพบ', 'Discovered tool')}><select value={toolName} disabled={executing} onChange={e => setTool(e.target.value)}><option value="">{t('เลือกเครื่องมือ', 'Choose a tool')}</option>{tools.map(tool => <option key={tool.name} value={tool.name}>{tool.name}</option>)}</select></Field>
    {tool && <ToolForm key={JSON.stringify([tool.name, tool.inputSchema])} {...{ t, tool, execute }} blocked={busy || executing || active || c.enabled === false || c.discoveryStale || effective(tool.name) === 'off' || unknown || result?.status === 'unconfirmed'} />}
    {unknown && <p role="status">{t('มีผลลัพธ์ไม่แน่นอน ต้องตรวจ server ก่อน ไม่มีการ retry หรืออ้างว่ายกเลิกผลที่เกิดแล้ว', 'An outcome is unknown. Inspect the server before further calls. No retry or rollback is assumed.')}</p>}
    {result && <div role="status"><p>{t('การเรียกล่าสุด', 'Latest call')}: <Badge>{result.status}</Badge></p>{result.message && <p>{result.message}</p>}<Json value={result} /></div>}
    {calls.slice().reverse().map(call => <article className="run" key={call.id}><div className="record-head"><strong>{call.name}</strong><Badge>{call.status}</Badge></div><small>{call.operationId} · {date(call.createdAt)}</small>{['submitting', 'running'].includes(call.status) && <button disabled={stopped.current.has(call.id) || call.stopRequested} onClick={() => stop(call)}>{t('หยุดรอผลครั้งเดียว', 'Stop waiting once')}</button>}{call.stopRequested && <p>{t('ส่งคำขอหยุดแล้ว ผลฝั่ง server อาจยังเกิดขึ้น', 'Stop was requested. The remote effect may still have happened.')}</p>}<details><summary>{t('ผลที่สังเกตได้', 'Observed outcome')}</summary><Json value={call} /></details></article>)}
  </div>;
}
function ToolForm({ t, tool, execute, blocked }) {
  const schema = tool.inputSchema ?? {}, fields = Object.entries(schema.properties ?? {});
  const simple = schema.type === 'object' && fields.every(([, s]) => s && ['string', 'number', 'integer', 'boolean'].includes(s.type) && !s.oneOf && !s.anyOf && !s.$ref && !s.enum?.some(v => typeof v === 'object'));
  const [advanced, setAdvanced] = useState(!simple), [json, setJSON] = useState('{}'), [values, setValues] = useState({}), [error, setError] = useState('');
  const parse = () => {
    const args = advanced ? JSON.parse(json) : Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(t('arguments ต้องเป็น JSON object', 'Arguments must be a JSON object.'));
    if (JSON.stringify(args).length > 128000) throw new Error('Arguments exceed the 128000 character limit.');
    return args;
  };
  let preview; try { preview = parse(); } catch { preview = null; }
  return <form onSubmit={e => { e.preventDefault(); try { const args = parse(); setError(''); execute(args); } catch (e) { setError(e.message); } }}>
    <p>{tool.description}</p><details><summary>{t('schema จาก server', 'Server input schema')}</summary><Json value={schema} /></details>
    {simple && <label className="check"><input type="checkbox" checked={advanced} onChange={e => { setAdvanced(e.target.checked); if (e.target.checked) setJSON(JSON.stringify(values, null, 2)); }} />{t('ใช้ JSON ขั้นสูง', 'Use advanced JSON')}</label>}
    {advanced ? <Field label={t('arguments JSON ที่จะรัน', 'Exact tool arguments JSON')}><textarea required rows={7} autoComplete="off" aria-invalid={error ? true : undefined} value={json} onChange={e => setJSON(e.target.value)} /></Field> : fields.map(([name, s]) => {
      const required = schema.required?.includes(name), update = value => setValues(previous => { const next = { ...previous }; if (value === undefined) delete next[name]; else next[name] = value; return next; });
      return <Field key={name} label={`${name}${required ? ' *' : ''}`} hint={s.description}>
        {s.enum || s.type === 'boolean' ? <select required={required} value={Object.hasOwn(values, name) ? JSON.stringify(values[name]) : ''} onChange={e => update(e.target.value === '' ? undefined : JSON.parse(e.target.value))}><option value="">{t('ไม่ระบุ', 'Omit')}</option>{(s.enum ?? [true, false]).map(v => <option key={JSON.stringify(v)} value={JSON.stringify(v)}>{String(v)}</option>)}</select> : <input required={required} type={s.type === 'string' ? 'text' : 'number'} step={s.type === 'integer' ? 1 : 'any'} min={s.minimum} max={s.maximum} minLength={s.minLength} maxLength={s.maxLength} value={values[name] ?? ''} onChange={e => update(e.target.value === '' ? undefined : s.type === 'string' ? e.target.value : Number(e.target.value))} />}
      </Field>;
    })}
    <p>{t('การรันอนุมัติเฉพาะชื่อเครื่องมือและ arguments ด้านล่าง คำอธิบาย read-only จาก server ไม่ใช่สิทธิ์', 'Run approves only this tool and the exact arguments below. Server annotations do not grant permission.')}</p>
    <div aria-label={t('ตัวอย่างการเรียกที่แน่นอน', 'Exact operation preview')}><Json value={{ name: tool.name, arguments: preview }} /></div>
    {error && <p className="error-text" role="alert">{error}</p>}
    <button className="primary" disabled={blocked || preview === null}>{t('รัน operation นี้', 'Run this exact operation')}</button>
  </form>;
}
function McpOAuth({ t, c, scope, run, busy }) {
  const [status, setStatus] = useState(null), [url, setURL] = useState(''), [clientEnv, setClientEnv] = useState(''), [error, setError] = useState(''), [poll, setPoll] = useState(0), [uncertain, setUncertain] = useState(false);
  const live = useRef(true), pending = useRef(false), disconnected = useRef(false);
  const read = () => oauthStatus(scope);
  useEffect(() => { const controller = new AbortController(); live.current = true; oauthStatus(scope, controller.signal).then(v => { if (live.current) setStatus(v); }).catch(e => { if (live.current) setError(e.message); }); return () => { live.current = false; controller.abort(); }; }, [c.id]);
  useEffect(() => {
    if (!poll) return;
    let disposed = false, timer, attempts = 0;
    const controller = new AbortController(), deadline = Date.now() + 60000;
    const next = async () => {
      if (Date.now() >= deadline) { setPoll(0); return; }
      try {
        const value = await oauthStatus(scope, controller.signal, Math.min(8000, deadline - Date.now())); if (disposed) return; setStatus(value);
        if (!['connecting', 'awaiting-authorization'].includes(value.status)) { setURL(''); setPoll(0); return; }
      } catch (e) { if (!disposed) { setError(e.message); setPoll(0); } return; }
      if (!disposed && ++attempts < 30 && Date.now() < deadline) timer = setTimeout(next, Math.min(2000, deadline - Date.now()));
      else if (!disposed) setPoll(0);
    };
    timer = setTimeout(next, 2000);
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [poll, c.id]);
  const action = name => {
    if (pending.current || name === 'disconnect' && disconnected.current) return;
    pending.current = true; if (name === 'disconnect') disconnected.current = true; setError(''); setURL(''); setPoll(0);
    run(async () => {
      try {
        const body = { ...scope, operationId: operationId() };
        if (name === 'begin' && clientEnv) { if (environmentNames(clientEnv).length !== 1) throw new Error('Enter one client registration environment reference.'); body.clientInformationEnv = clientEnv; }
        const value = await request('/api/mcp/oauth/' + name, body);
        if (live.current) {
          setStatus(value); setUncertain(false);
          if (name === 'begin') { disconnected.current = false; setURL(authorizationLink(value.authorizationUrl) ?? ''); if (['connecting', 'awaiting-authorization'].includes(value.status)) setPoll(n => n + 1); }
        }
        return value;
      } catch (e) { if (live.current) { setError(e.message); setUncertain(true); } throw e; } finally { pending.current = false; }
    });
  };
  return <details><summary>{t('เชื่อมบัญชี OAuth', 'OAuth account connection')}</summary>
    <p role="status">OAuth: <Badge>{status?.status ?? 'not checked'}</Badge></p>
    <p className="help">{t('บัญชีเก็บใน vault ของเครื่องนี้ callback จัดการโดย server เมื่อเชื่อมสำเร็จต้องตรวจเครื่องมือและตั้งสิทธิ์ใหม่ ไม่เรียก operation เดิมซ้ำ', 'Credentials stay in this machine’s vault. The server owns the fixed callback. After connection, rediscover tools and configure policy; previous operations are never replayed.')}</p>
    {c.config?.authEnv && <p>{t('การเชื่อมต่อนี้ใช้ Bearer reference หากต้องการ OAuth ให้เพิ่มการเชื่อมต่อใหม่ที่ไม่มี Bearer', 'This connection uses a Bearer reference. Add a connection without Bearer authentication to use OAuth.')}</p>}
    <details><summary>{t('Client registration ขั้นสูง', 'Advanced client registration')}</summary><Field label={t('ชื่อ environment variable ของ client registration', 'Client registration environment reference')} hint={t('เว้นว่างถ้า server รองรับการลงทะเบียนอัตโนมัติ ไม่ใส่ JSON หรือ client secret ที่นี่', 'Leave empty for dynamic registration. Do not paste client JSON or secrets here.')}><input autoComplete="off" pattern="[A-Za-z_][A-Za-z0-9_]{0,127}" value={clientEnv} onChange={e => setClientEnv(e.target.value)} /></Field></details>
    <div className="actions">
      <button disabled={busy || uncertain || c.enabled === false || !!c.config?.authEnv || ['connecting', 'awaiting-authorization'].includes(status?.status)} onClick={() => action('begin')}>{t('เชื่อม OAuth', 'Connect OAuth')}</button>
      <button disabled={busy} onClick={() => run(async () => { const value = await read(); if (live.current) { setStatus(value); setUncertain(false); if (!['connecting', 'awaiting-authorization'].includes(value.status)) setURL(''); } return value; })}>{t('ตรวจสถานะ OAuth', 'Check OAuth status')}</button>
      <button disabled={busy || !status || ['not-configured', 'disconnected'].includes(status.status) || disconnected.current} onClick={() => action('disconnect')}>{t('ยกเลิกการเชื่อม OAuth', 'Disconnect OAuth')}</button>
    </div>
    {url && <><p style={{ overflowWrap: 'anywhere' }}>{url}</p><a className="button" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t('เปิดหน้าอนุญาตที่แสดง', 'Open reviewed authorization page')}</a></>}
    {poll > 0 && <p role="status">{t('ตรวจสถานะอย่างเดียว สูงสุด 60 วินาที ไม่มีการ retry เครื่องมือ', 'Checking status only for up to 60 seconds. No tool retry.')}</p>}
    {uncertain && <p role="status">{t('ผลคำขอไม่แน่นอน ตรวจสถานะก่อนเริ่มใหม่ ไม่มีการส่งซ้ำ', 'Request outcome is unconfirmed. Check status before beginning again; nothing is replayed.')}</p>}
    {status?.status === 'connected' && <p>{t('เก็บบัญชีในเครื่องแล้ว การตรวจเครื่องมือจริงยังแยกต่างหาก', 'Machine credentials are connected. Remote tool qualification is separate.')}</p>}
    {(error || status?.error?.message) && <p className="error-text" role="alert">{error || status.error.message}</p>}
  </details>;
}
