// Hallmark · component: provider setup · theme: existing VS Code tokens
// Pre-emit critique: P4 H4 E4 S5 R5 V4. Native controls reuse ui.jsx and style.css.
import React, { useEffect, useRef, useState } from 'react';
import { request, operationId, scoped, safeLocalUrl, date } from './api.mjs';
import { Field, Badge, Empty, Json } from './ui.jsx';

// Accept references, never credential values. Used by both setup forms.
export function environmentNames(text) {
  const names = text.split(/[\s,]+/).filter(Boolean);
  if (names.some(name => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)))
    throw new Error('Use environment variable names only, such as FORGE_API_KEY. Set the value on this machine.');
  return [...new Set(names)];
}
export function argumentRows(text) {
  const rows = text ? text.replace(/\r/g, '').split('\n') : [];
  if (rows.some(row => /\0|(?:api[-_]?key|token|password|authorization|bearer|credential)(?:=|\b)/i.test(row)))
    throw new Error('Pass credentials through environment references, never executable arguments.');
  return rows;
}
export function authorizationLink(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === 'https:' ||
      url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) ? url.href : null;
  } catch { return null; }
}

export default function ProviderSetup(props) {
  return <ProviderProject key={props.projectId} {...props} />;
}
function ProviderProject({ t, state, projectId, run, busy }) {
  const [routes, setRoutes] = useState(null), [error, setError] = useState('');
  const [routeId, setRoute] = useState(''), [selected, setSelected] = useState('');
  const connections = scoped(state, 'connections', projectId).filter(c => c.kind === 'provider');
  const project = state?.projects?.find(p => p.id === projectId);
  useEffect(() => {
    let live = true;
    request('/api/providers/routes').then(value => {
      const list = Array.isArray(value) ? value : value.routes;
      if (!Array.isArray(list)) throw new Error('Provider routes are unavailable.');
      if (live) setRoutes(list);
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  const connection = connections.find(c => c.id === selected) ?? connections[0];
  const route = routes?.find(r => r.id === routeId);
  return <section aria-label={t('ตั้งค่าบริการ AI', 'Provider setup')} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <h2>{t('บริการ AI และโมเดลของโปรเจกต์', 'Project accounts & models')}</h2>
    <p className="help">{t('เพิ่มบัญชีบริการ AI ของ FORGE (แยกจากบัญชีที่ใช้พัฒนา) แล้วเลือกโมเดลจากรายการที่บริการ AI แจ้งมา การเห็นโมเดลในรายการยังไม่ได้แปลว่าใช้ได้จริง', 'FORGE uses its own account setup. Choose models from the observed instance catalog. Catalog membership does not prove model access or execution.')}</p>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="panel">
      <Field label={t('เพิ่มบริการ AI', 'Add provider route')}><select value={routeId} onChange={e => setRoute(e.target.value)} disabled={busy || !routes}>
        <option value="">{routes ? t('เลือกบริการ AI', 'Choose an account route') : t('กำลังอ่านรายการ…', 'Loading routes…')}</option>
        {routes?.map(r => <option key={r.id} value={r.id}>{r.brand ?? r.id} · {r.id} · {r.mode}</option>)}
      </select></Field>
      {route?.implemented === false ? <p role="status">{route.blocker || route.implementation}</p> : route && <ProviderForm key={route.id} {...{ route, projectId, t, busy, run }} onCreated={c => { setSelected(c.id); setRoute(''); }} />}
    </div>
    {!connections.length ? <Empty>{t('โปรเจกต์นี้ยังไม่มีบัญชีบริการ AI', 'No provider connections in this project yet.')}</Empty> : <>
      <Field label={t('บัญชีบริการ AI ที่เพิ่มไว้', 'Configured provider account')}><select value={connection.id} disabled={busy} onChange={e => setSelected(e.target.value)}>{connections.map(c => <option key={c.id} value={c.id}>{c.name} · {c.config?.routeId} · {c.providerInstanceId}</option>)}</select></Field>
      <ProviderAccount key={connection.id} {...{ t, connection, project, projectId, run, busy }} />
    </>}
  </section>;
}
function ProviderForm({ route, projectId, t, busy, run, onCreated }) {
  const [error, setError] = useState(''), pending = useRef(false);
  const [name, setName] = useState(route.brand ?? ''), [executable, setExecutable] = useState('');
  const [args, setArgs] = useState(''), [refs, setRefs] = useState(''), [keyEnv, setKeyEnv] = useState('');
  const [baseURL, setBaseURL] = useState(route.baseURL ?? ''), [family, setFamily] = useState(route.apiFamily ?? 'chat-completions');
  const [models, setModels] = useState('');
  const [preview,setPreview]=useState(null),previewIdentity=useRef('');previewIdentity.current=JSON.stringify([projectId,keyEnv,baseURL]);
  const api = route.mode === 'opencode-api';
  return <form onSubmit={e => {
    e.preventDefault(); if (pending.current) return; pending.current = true; setError('');
    run(async () => {
      try {
        const envRefs = environmentNames(refs), body = { operationId: operationId(), projectId, routeId: route.id, name,
          ...(executable ? { executable } : {}), ...(envRefs.length ? { envRefs } : {}),
          ...(route.id === 'custom-acp' ? { args: argumentRows(args) } : {}) };
        if (api) {
          if (environmentNames(keyEnv).length !== 1) throw new Error(t('ใส่ชื่อคีย์ลับ API หนึ่งชื่อ', 'Enter one API key environment variable name.'));
          Object.assign(body, { apiKeyEnv: keyEnv, baseURL, apiFamily: family, models: models.split('\n').map(s => s.trim()).filter(Boolean) });
        }
        const c = await request('/api/providers/configure', body); onCreated(c); return c;
      } catch (error) { setError(error.message); throw error; }
      finally { pending.current = false; }
    });
  }}>
    {route.limitations && <p className="help">{route.limitations}</p>}
    {api && <p>{t('บริการแบบ API ต้องใช้ OpenCode 2.x กด ตรวจโปรแกรมและบัญชี และ โหลดรายการโมเดล ก่อนเลือกโมเดล', 'API routes require OpenCode 2.x. Check the runtime and actual catalog before selecting a model.')}</p>}
    <Field label={t('ชื่อเรียกบัญชี', 'Account label')}><input required value={name} onChange={e => setName(e.target.value)} /></Field>
    {api && <>
      <Field label={t('ชื่อคีย์ลับ API', 'API key environment reference')} hint={t('บันทึกคีย์ในหน้า คีย์ลับ ก่อน แล้วนำชื่อคีย์มาใส่ที่นี่ ห้ามวางค่าคีย์จริง', 'Save the key in Machine keys, then enter its saved name here. Never paste the secret value here.')}><input required pattern="[A-Za-z_][A-Za-z0-9_]{0,127}" autoComplete="off" spellCheck={false} value={keyEnv} onChange={e => {setKeyEnv(e.target.value);setPreview(null);}} placeholder="FORGE_API_KEY" /></Field>
      <Field label={t('URL หลักของ API (ตรงกับบัญชี)', 'Exact API base URL')}><input required type="url" value={baseURL} onChange={e => {setBaseURL(e.target.value);setPreview(null);}} /></Field>
      <Field label={t('โปรโตคอล API', 'API protocol')}><select value={family} disabled={!!route.apiFamily} onChange={e => setFamily(e.target.value)}>{['chat-completions', 'responses', 'anthropic-messages', 'openrouter'].map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field label={t('รหัสโมเดลจากบริการ AI (บรรทัดละหนึ่งชื่อ)', 'Upstream model IDs (one per line)')} hint={t('โมเดลที่ใส่ต้องปรากฏในรายการโมเดลที่โหลดมาภายหลังด้วย', 'Configured candidates must subsequently appear in the actual catalog.')}><textarea required={route.id !== 'openrouter'} rows={3} value={models} onChange={e => setModels(e.target.value)} /></Field>
      {route.id==='kob'&&<><button type="button" disabled={busy||!keyEnv||!baseURL} onClick={()=>{const own=previewIdentity.current;run(async()=>{try{const result=await request('/api/providers/preview-models',{projectId,baseURL,apiKeyEnv:keyEnv});if(own===previewIdentity.current)setPreview(result);return result;}catch(e){if(own===previewIdentity.current)setError(e.message);throw e;}});}}>{t('ดูรายชื่อโมเดลจาก KOB API','Discover KOB API models')}</button>{preview&&<div><p className="help">{t('นี่คือรายชื่อจาก API เท่านั้น ต้องกด โหลดรายการโมเดล อีกครั้งก่อนเลือกใช้จริง','API discovery only. Refresh the actual T3 catalog before selecting a runnable model.')}</p><div className="actions">{preview.models.map(m=><button type="button" key={m.id} disabled={busy} onClick={()=>setModels([...new Set([...models.split('\n').filter(Boolean),m.id])].join('\n'))}>{m.id}</button>)}</div></div>}</>}
    </>}
    <details open={route.id === 'custom-acp'}><summary>{t('โปรแกรมและคีย์ลับเพิ่มเติม (ขั้นสูง)', 'Executable & environment (advanced)')}</summary>
      <Field label={t('ที่อยู่ไฟล์โปรแกรมที่ติดตั้งไว้', 'Installed executable path')} hint={route.command ? `${route.command} ${(route.args ?? []).join(' ')}` : t('เว้นว่างเพื่อใช้ค่าเริ่มต้น', 'Leave empty for the native runtime default.')}><input required={route.id === 'custom-acp'} value={executable} onChange={e => setExecutable(e.target.value)} /></Field>
      {route.id === 'custom-acp' && <Field label={t('ค่าที่ส่งให้โปรแกรม (บรรทัดละหนึ่งค่า)', 'Literal arguments (one per line)')} hint={t('ห้ามใส่คำสั่ง shell หรือคีย์ลับ', 'Literal argv only; no shell expression or credentials.')}><textarea value={args} onChange={e => setArgs(e.target.value)} /></Field>}
      <Field label={t('ชื่อคีย์ลับเพิ่มเติม (บรรทัดละชื่อ)', 'Additional environment references')}><textarea autoComplete="off" spellCheck={false} value={refs} onChange={e => setRefs(e.target.value)} placeholder="FORGE_AGENT_SETTING" /></Field>
    </details>
    {error && <p role="alert" className="error-text">{error}</p>}
    <button className="primary" type="submit" disabled={busy}>{t('เพิ่มบัญชี', 'Add FORGE account')}</button>
  </form>;
}
function ProviderAccount({ t, connection: c, project, projectId, run, busy }) {
  const [catalogState, setCatalog] = useState(null), [setup, setSetup] = useState(null), [error, setError] = useState('');
  const [modelId, setModel] = useState(''), [values, setValues] = useState({}), [methodId, setMethod] = useState(''), [callback, setCallback] = useState('');
  const pending = useRef(false), cancelled = useRef(new Set()), live = useRef(true);
  const scope = { projectId, connectionId: c.id };
  useEffect(() => {
    live.current = true;
    request('/api/providers/catalog', scope).then(v => { if (live.current) setCatalog(v); }).catch(e => { if (live.current) setError(e.message); });
    return () => { live.current = false; };
  }, [c.id]);
  const perform = fn => {
    if (pending.current) return; pending.current = true; setError('');
    return run(async () => {
      try { return await fn(); } catch (e) { if (live.current) setError(e.message); throw e; }
      finally { pending.current = false; }
    });
  };
  const setupAction = (action, extra = {}) => perform(async () => {
    const value = await request('/api/providers/setup', { ...scope, action, ...(!action.endsWith('-status') ? { operationId: operationId() } : {}), ...extra });
    if (live.current) { setSetup(value); setCallback(''); } return value;
  });
  const catalog = catalogState?.catalog ?? c.providerCatalog, models = catalog?.models ?? [], model = models.find(m => m.id === modelId);
  const saved = project?.profile?.provider, currentCatalog = !catalogState?.error && !catalogState?.refreshing && !catalogState?.stale && catalog?.catalogComplete!==false && catalog?.providerInstanceId === c.providerInstanceId;
  const interaction = setup?.interaction, url = authorizationLink(interaction?.url ?? setup?.authorizationUrl);
  const uncertain = setup?.status === 'unknown' || setup?.status === 'already-submitted';
  const cancel = (action, id, extra) => { if (cancelled.current.has(id)) return; cancelled.current.add(id); setupAction(action, extra); };
  return <div className="panel" aria-busy={busy}>
    <h3>{c.name}</h3><p><Badge>{c.config?.setupStatus}</Badge> · <code>{c.providerInstanceId}</code></p>
    {c.config?.setupStatus === 'unknown' && <p role="status">{t('ยังไม่รู้ผลการตั้งค่า กด ตรวจโปรแกรมและบัญชี ก่อน อย่าเพิ่มบัญชีซ้ำ', 'Setup outcome is unknown. Check status before creating another account configuration.')}</p>}
    <div className="actions">
      <button disabled={busy} onClick={() => perform(() => request('/api/providers/check', scope))}>{t('ตรวจโปรแกรมและบัญชี', 'Check runtime & account')}</button>
      <button disabled={busy} onClick={() => perform(async () => { const v = await request('/api/providers/refresh', scope); if (live.current) setCatalog(v); return v; })}>{t('โหลดรายการโมเดล', 'Refresh actual catalog')}</button>
    </div>
    {c.lastCheck && <div role="status"><p>{t('โปรแกรม', 'Runtime')}: <Badge>{c.lastCheck.status}</Badge> · {c.lastCheck.version ?? '—'} · {t('การล็อกอิน', 'Authentication')}: {c.lastCheck.authentication ?? 'unknown'}</p><p className="help">{t('ตรวจแค่โปรแกรมและบัญชี ยังไม่ได้ลองเรียกโมเดลจริง', 'Dependency/account check only. Model execution is NOT_RUN.')}</p></div>}
    {(error || c.setupError?.message || c.lastCheck?.error?.message || catalogState?.error?.message) && <p role="alert" className="error-text">{error || c.setupError?.message || c.lastCheck?.error?.message || catalogState?.error?.message}</p>}
    <details><summary>{t('ติดตั้งและลงชื่อเข้าใช้', 'Install & sign in')}</summary>
      <p className="help">{t('ติดตั้งผ่าน FORGE และใช้บัญชีใหม่ ไม่ได้ย้ายบัญชีจากแอปที่ใช้พัฒนา', 'Setup uses the FORGE runtime and fresh account store.')}</p>
      <div className="actions">
        <button disabled={busy || uncertain || !c.lastCheck?.canInstall} onClick={() => setupAction('install')}>{t('ติดตั้งโปรแกรม', 'Install runtime')}</button>
        <button disabled={busy} onClick={() => setupAction('install-status')}>{t('ตรวจสถานะการติดตั้ง', 'Check installation status')}</button>
        {setup?.installOperationId && <button disabled={busy || cancelled.current.has(setup.installOperationId)} onClick={() => cancel('install-cancel', setup.installOperationId, { installOperationId: setup.installOperationId })}>{t('ยกเลิกการติดตั้ง', 'Cancel installation')}</button>}
      </div>
      <Field label={t('วิธีลงชื่อเข้าใช้', 'Runtime sign-in method')}><select value={methodId} onChange={e => setMethod(e.target.value)}><option value="">{t('ค่าเริ่มต้น', 'Runtime default')}</option>{setup?.methods?.map(m => <option key={m.id} value={m.id}>{m.name} · {m.type}</option>)}</select></Field>
      <div className="actions">
        <button disabled={busy || uncertain || !c.lastCheck?.canAuthenticate} onClick={() => setupAction('signin', methodId ? { methodId } : {})}>{t('เริ่มลงชื่อเข้าใช้', 'Begin sign-in')}</button>
        <button disabled={busy} onClick={() => setupAction('signin-status')}>{t('ตรวจสถานะลงชื่อเข้าใช้', 'Check sign-in status')}</button>
        {setup?.flowId && <button disabled={busy || cancelled.current.has(setup.flowId)} onClick={() => cancel('signin-cancel', setup.flowId, { flowId: setup.flowId })}>{t('ยกเลิกการลงชื่อเข้าใช้', 'Cancel sign-in')}</button>}
      </div>
      {setup && <div role="status"><p>{setup.phase ?? setup.status}</p>{setup.error && <p className="error-text">{setup.error.message}</p>}
        {url && <><p style={{ overflowWrap: 'anywhere' }}>{url}</p><a className="button" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t('เปิดหน้าลงชื่อเข้าใช้', 'Open sign-in page')}</a></>}
        {interaction?.userCode && <p>{t('รหัสอุปกรณ์', 'Device code')}: <strong>{interaction.userCode}</strong></p>}
        {interaction?.requiresConsent && setup.flowId && <div className="actions">{['accept', 'decline'].map(decision => <button key={decision} disabled={busy} onClick={() => setupAction('consent', { flowId: setup.flowId, interactionId: interaction.id, decision })}>{decision === 'accept' ? t('ยินยอมให้เปิดเบราว์เซอร์', 'Accept browser consent') : t('ปฏิเสธ', 'Decline')}</button>)}</div>}
        {interaction?.acceptsCallback && setup.flowId && <form onSubmit={e => { e.preventDefault(); const callbackUrl = callback; setCallback(''); setupAction('callback', { flowId: setup.flowId, callbackUrl }); }}><Field label={t('URL ที่ได้หลังล็อกอิน (ใช้ครั้งเดียว)', 'Provider callback URL (transient)')}><input autoComplete="off" required value={callback} onChange={e => setCallback(e.target.value)} /></Field><button disabled={busy}>{t('ส่ง URL นี้', 'Submit callback once')}</button></form>}
        {interaction?.requiresNativeUi && <p>{t('วิธีนี้ต้องล็อกอินใน FORGE T3 (หน้าต่างคำสั่งหรือแบบฟอร์มของ T3) หน้านี้กรอกรหัสผ่านไม่ได้', 'This method requires the native terminal or credential form in FORGE T3. Complete it in that setup surface.')}</p>}
        {uncertain && <p>{t('ยังไม่รู้ผล ระบบจะไม่ส่งซ้ำเอง กดปุ่มตรวจสถานะก่อน', 'Nothing is replayed. Use the status check to reconcile first.')}</p>}
      </div>}
      <button disabled={busy} onClick={() => perform(async () => { const result = await request('/api/t3/start', { projectId }); const local = safeLocalUrl(result.url ?? result.appUrl); if (live.current) setSetup(s => ({ ...s, nativeURL: local })); return result; })}>{t('เปิดระบบตั้งค่าของ FORGE T3', 'Prepare FORGE T3 setup')}</button>
      {setup?.nativeURL && <a className="button" href={setup.nativeURL} target="_blank" rel="noopener noreferrer">{t('เปิด FORGE T3 แล้วไปที่ Settings', 'Open FORGE T3, then Settings')}</a>}
    </details>
    <hr /><h3>{t('เลือกโมเดลจากบัญชีนี้', 'Select a model from this instance')}</h3>
    <p className="help">{catalog ? `${catalog.source} · ${date(catalog.observedAt)}` : t('ยังไม่มีรายการโมเดล', 'No observed catalog yet.')} · {t('รายการอาจไม่ใช่ล่าสุดของบริการ AI', 'Upstream cache age unknown.')}</p>
    {catalogState?.stale && <p role="status">{t('โหลดรายการโมเดลล่าสุดไม่สำเร็จ ที่แสดงอยู่เป็นรายการเดิม', 'Catalog is stale or refresh failed. The last observed list remains visible.')}</p>}
    {catalogState?.refreshing && <p role="status">{t('กำลังโหลดรายการโมเดล กด โหลดรายการโมเดล อีกครั้งเพื่อดูผล (ไม่มีการเรียกโมเดล)', 'Catalog refresh is pending. Refresh again to inspect it; no model call is made.')}</p>}
    <form onSubmit={e => { e.preventDefault(); perform(() => request('/api/providers/select', { ...scope, operationId: operationId(), expectedRevision: project.revision, selection: { instanceId: c.providerInstanceId, model: modelId, options: Object.entries(values).map(([id, value]) => ({ id, value })) } })); }}>
      <Field label={t('โมเดล', 'Observed model ID')}><select required value={modelId} onChange={e => { setModel(e.target.value); setValues({}); }}><option value="">{t('เลือกโมเดล', 'Choose a model')}</option>{models.map(m => <option key={m.id} value={m.id}>{m.name ?? m.id} · {m.id}</option>)}</select></Field>
      {model?.options?.map(o => <Field key={o.id} label={o.id}><select value={Object.hasOwn(values, o.id) ? JSON.stringify(values[o.id]) : ''} onChange={e => setValues(s => { const next = { ...s }; if (e.target.value === '') delete next[o.id]; else next[o.id] = JSON.parse(e.target.value); return next; })}><option value="">{t('ค่าเริ่มต้น', 'Runtime default')}</option>{o.values.map(v => <option key={JSON.stringify(v)} value={JSON.stringify(v)}>{String(v)}</option>)}</select></Field>)}
      <button className="primary" disabled={busy || !model || !currentCatalog || !project}>{t('ใช้โมเดลนี้ในโปรเจกต์', 'Use model for project')}</button>
    </form>
    {saved && <p role="status">{t('โมเดลที่เลือกไว้', 'Saved selection')}: {saved.instanceId} · {saved.model} · {t('ตรวจแค่ว่ามีในรายการ ยังไม่ได้ลองใช้จริง', 'Catalog verified only')}</p>}
    <details><summary>{t('รายละเอียดทางเทคนิค', 'Diagnostic details')}</summary><Json value={{ runtime: c.lastCheck, catalog: { instanceId: catalog?.providerInstanceId, observedAt: catalog?.observedAt, source: catalog?.source, omittedModels: catalog?.omittedModels, upstreamFreshness: catalog?.upstreamFreshness } }} /></details>
  </div>;
}
