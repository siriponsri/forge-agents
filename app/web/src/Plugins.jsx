import React, {useEffect, useRef, useState} from 'react';
import {request, operationId, scoped} from './api.mjs';
import {Field, Badge, Empty} from './ui.jsx';

export default function PluginManager(props) { return <PluginProject key={props.projectId} {...props}/>; }
function PluginProject({t,state,projectId,run,busy}) {
  const [kind,setKind] = useState('project'), [scopeId,setScopeId] = useState(''), [catalog,setCatalog] = useState(null), [error,setError] = useState(''), [pending,setPending] = useState(false);
  const generation = useRef(0), performing = useRef(false);
  const collections = {session:'conversations',agent:'bots',task:'tasks'};
  const candidates = kind === 'project' ? [] : scoped(state,collections[kind],projectId);
  const id = kind === 'project' ? projectId : candidates.some(x => x.id === scopeId) ? scopeId : candidates[0]?.id;
  const body = {projectId,scope:{kind,id}};
  const valid = !!id, blocked = busy || pending;
  async function load(stamp = generation.current) {
    const value = await request('/api/plugins/list',body);
    if (stamp === generation.current) setCatalog(value);
    return value;
  }
  useEffect(() => {
    const stamp = ++generation.current; setCatalog(null); setError('');
    if (valid) load(stamp).catch(e => { if (stamp === generation.current) setError(e.message); });
    return () => { generation.current++; };
  },[projectId,kind,id]);
  const perform = fn => {
    if (performing.current) return; performing.current = true; setPending(true); setError(''); const stamp = generation.current;
    return run(async () => {
      try { const result = await fn(); if (stamp === generation.current) await load(stamp); return result; }
      catch (e) { if (stamp === generation.current) setError(e.message); throw e; }
      finally { performing.current = false; setPending(false); }
    });
  };
  return <section aria-label={t('จัดการปลั๊กอิน','Plugin Manager')} style={{minWidth:0,overflowWrap:'anywhere'}}>
    <h2>{t('จัดการปลั๊กอิน','Plugin Manager')}</h2>
    <p className="help">{t('เลือกความสามารถของโครงการ บทสนทนา บอต หรืองาน การเปิดปลั๊กอินไม่ใช่การอนุมัติรันเครื่องมือ บัญชีและบริบทของ provider ใช้การตั้งค่าเดิม','Choose capabilities for a project, conversation, agent or task. Enabling a plugin does not approve tool execution. Providers keep their native accounts and context.')}</p>
    <Field label={t('ขอบเขตความสามารถ','Capability scope')}><select disabled={blocked} value={kind} onChange={e => { setKind(e.target.value); setScopeId(''); }}>
      <option value="project">{t('ทั้งโครงการ','Project')}</option><option value="session">{t('บทสนทนา','Session / conversation')}</option><option value="agent">{t('บอต','Agent')}</option><option value="task">{t('งาน','Task')}</option>
    </select></Field>
    {kind !== 'project' && <Field label={t('ใช้กับรายการ','Apply to')}><select disabled={blocked || !candidates.length} value={id ?? ''} onChange={e => setScopeId(e.target.value)}><option value="" disabled>{t('เลือกรายการ','Choose an item')}</option>{candidates.map(x => <option key={x.id} value={x.id}>{x.name ?? x.title ?? x.id}</option>)}</select></Field>}
    {!valid && <Empty>{t('สร้างรายการในขอบเขตนี้ก่อนตั้งค่าปลั๊กอิน','Create an item in this scope before configuring plugins.')}</Empty>}
    <button disabled={blocked || !valid} onClick={() => perform(() => load())}>{t('โหลดค่าปัจจุบัน','Refresh configuration')}</button>
    {error && <p className="error-text" role="alert">{error}</p>}
    {catalog?.plugins.map(plugin => <PluginCard key={`${kind}:${id}:${plugin.id}`} {...{plugin,t,state,projectId,body,perform,blocked}}/>)}
    {catalog && <Selection {...{t,catalog,body,perform,blocked}}/>}
  </section>;
}
function PluginCard({plugin,t,state,projectId,body,perform,blocked}) {
  const [draft,setDraft] = useState(plugin.config), [base,setBase] = useState(plugin), [health,setHealth] = useState(null);
  const stale = base.revision !== plugin.revision;
  const update = (key,value) => setDraft(previous => { const next = {...previous}; if (value === '' || value === undefined || Array.isArray(value) && !value.length) delete next[key]; else next[key] = value; return next; });
  const mutate = action => perform(async () => {
    const value = await request(`/api/plugins/${action}`,{...body,operationId:operationId(),pluginId:plugin.id,expectedRevision:base.revision,...(action === 'configure' ? {config:draft} : {})});
    setBase({...plugin,revision:value.revision,enabled:value.enabled,config:value.config}); setDraft(value.config); setHealth(null); return value;
  });
  return <article className="panel" aria-label={plugin.name}>
    <h3>{plugin.name} <small>{plugin.version}</small></h3><p>{plugin.description}</p>
    <p>{t('ในขอบเขตนี้','This scope')}: <Badge>{plugin.revision ? plugin.enabled ? 'enabled' : 'disabled' : 'inherited'}</Badge> · {t('มีผลจริง','Effective')}: <Badge>{plugin.effectiveEnabled ? 'enabled' : 'disabled'}</Badge></p>
    {plugin.compatibility.status !== 'ready' && <p role="status">{plugin.compatibility.code}: {plugin.compatibility.message}</p>}
    <p className="help">{t('การปิดในขอบเขตแม่บล็อกขอบเขตลูก การปิดหยุดการเรียกใหม่ งานที่กำลังรันต้องตรวจหรือหยุดผ่านหน้าควบคุมเดิม','An ancestor set to Off blocks child scopes. Disable blocks new calls. Inspect or stop running work through its existing controls.')}</p>
    <form onSubmit={e => { e.preventDefault(); mutate('configure'); }}>
      {Object.entries(plugin.configSchema.properties).map(([key,schema]) => {
        const source = key === 'targetId' ? scoped(state,'desktopTargets',projectId) : key === 'connectionId' ? scoped(state,'connections',projectId) : key === 'skillIds' ? scoped(state,'skills',projectId).filter(x => x.status === 'active') : null;
        const labels = {targetId:t('เป้าหมายเดสก์ท็อป','Desktop target'),connectionId:t('การเชื่อมต่อ','Connection'),providerInstanceId:t('Provider instance ID จากการตั้งค่าบัญชี','Provider instance ID from account setup'),skillIds:t('ทักษะที่ใช้ได้','Available skills')};
        return <Field key={key} label={labels[key] ?? key} hint={t('เว้นว่างเพื่อรับค่าจากขอบเขตแม่','Leave empty to inherit the ancestor setting')}>
          {source ? schema.type === 'array' ? <select multiple disabled={blocked} value={draft[key] ?? []} onChange={e => update(key,[...e.target.selectedOptions].map(o => o.value))}>{source.map(x => <option key={x.id} value={x.id}>{x.name} {x.version ?? ''}</option>)}</select> : <select disabled={blocked} value={draft[key] ?? ''} onChange={e => update(key,e.target.value)}><option value="">{t('รับค่าจากขอบเขตแม่','Inherit')}</option>{source.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : schema.enum ? <select disabled={blocked} value={draft[key] ?? ''} onChange={e => update(key,e.target.value)}><option value="">{t('รับค่าจากขอบเขตแม่','Inherit')}</option>{schema.enum.map(v => <option key={v}>{v}</option>)}</select> : <input disabled={blocked} autoComplete="off" maxLength={schema.maxLength ?? 200} value={draft[key] ?? ''} onChange={e => update(key,e.target.value)} />}
        </Field>;
      })}
      {stale && <p role="alert">{t('ค่าถูกเปลี่ยนจากหน้าต่างอื่น โหลดร่างปัจจุบันก่อนแก้ต่อ','Configuration changed in another view. Load the current draft before editing.')}</p>}
      <div className="actions"><button type="submit" disabled={blocked || stale}>{t('บันทึกการตั้งค่า','Save configuration')}</button><button type="button" disabled={blocked} onClick={() => { setBase(plugin); setDraft(plugin.config); }}>{t('โหลดร่างปัจจุบัน','Load current draft')}</button></div>
    </form>
    <div className="actions">
      <button disabled={blocked || stale || plugin.enabled} onClick={() => mutate('enable')}>{t('เปิดในขอบเขตนี้','Enable in this scope')}</button>
      <button disabled={blocked || stale || plugin.revision > 0 && !plugin.enabled} onClick={() => mutate('disable')}>{t('ปิดในขอบเขตนี้','Disable in this scope')}</button>
      <button disabled={blocked} onClick={() => perform(async () => { const value = await request('/api/plugins/health',{...body,pluginId:plugin.id}); setHealth(value); return value; })}>{t('ตรวจความพร้อมจริง','Check actual health')}</button>
    </div>
    {health && <p role="status">{t('ความพร้อม','Health')}: <Badge>{health.status}</Badge> {health.code ?? ''} {health.message ?? ''} {health.checkedAt}</p>}
    {plugin.runtime.some(x => x.status !== 'active' || x.activeCalls) && <p role="status">{plugin.runtime.map((x,i) => <span key={i}>{x.status} · {x.activeCalls} {t('การเรียกกำลังทำงาน','active calls')} </span>)}</p>}
    <details><summary>{t('สัญญาบริการและ dependency','Service contracts and dependencies')}</summary><ul>{plugin.provides.map(c => <li key={c.capability}>{c.capability} {c.version}: {Object.keys(c.methods).join(', ')}</li>)}</ul><p>{plugin.consumes.length ? plugin.consumes.map(c => `${c.capability} ${c.version}`).join(', ') : t('ไม่มี dependency เพิ่มเติม','No additional dependencies')}</p></details>
  </article>;
}
function Selection({t,catalog,body,perform,blocked}) {
  const [requires,setRequires] = useState([]), [selection,setSelection] = useState(null);
  const context = {projectId:body.projectId,...(body.scope.kind === 'project' ? {} : {[{session:'sessionId',agent:'agentId',task:'taskId'}[body.scope.kind]]:body.scope.id})};
  return <details className="panel"><summary>{t('ตรวจชุดความสามารถสำหรับขอบเขตนี้','Check capability selection for this scope')}</summary>
    {catalog.plugins.flatMap(p => p.provides).map(c => <label className="check" key={c.capability}><input type="checkbox" disabled={blocked} checked={requires.includes(c.capability)} onChange={e => { setSelection(null); setRequires(previous => e.target.checked ? [...previous,c.capability] : previous.filter(x => x !== c.capability)); }}/>{c.capability} {c.version}</label>)}
    <button disabled={blocked || !requires.length} onClick={() => perform(async () => { const value = await request('/api/plugins/resolve',{...context,operationId:operationId(),requires:requires.map(capability => ({capability,version:'^1.0.0'}))}); setSelection(value); return value; })}>{t('ตรวจและบันทึกชุดความสามารถ','Check and record selection')}</button>
    {selection && <div role="status"><p>{selection.rationale}</p><ul>{selection.plugins.map(p => <li key={p.pluginId}>{p.pluginId} {p.pluginVersion}</li>)}</ul><p>{t('บันทึกการเลือกแล้ว ยังไม่อนุมัติรัน','Selection recorded. Execution is not approved.')} · {selection.receipt.operationId}</p></div>}
  </details>;
}
