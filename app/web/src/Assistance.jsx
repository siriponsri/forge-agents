import React, {useCallback, useEffect, useRef, useState} from 'react';
import {request, operationId, scoped, date, safeLocalUrl} from './api.mjs';
import {Field, Heading, Badge, Empty, Json} from './ui.jsx';

export const terminal = new Set(['completed','failed','cancelled','interrupted','rolled_back']);
export const inactive = new Set(['completed','stopped','exhausted']);
export const blankProvenance = () => ({source:'', recordedBy:'', reason:''});
export const integer = value => value === '' || value == null ? null : Number(value);
const roleChoices=[['executor',['executor'],'Executor'],['asst',['asst'],'Asst'],['strategist',['strategist'],'Strategist'],['both',['executor','asst'],'Executor + Asst'],['strategist-executor',['strategist','executor'],'Strategist + Executor'],['strategist-asst',['strategist','asst'],'Strategist + Asst'],['all',['strategist','executor','asst'],'Strategist + Executor + Asst']];
const patternChoices=[['executor-asst','ผู้ลงมือทำงาน → ที่ปรึกษา (เฉพาะเมื่อติดขัด) → ผู้ลงมือทำงาน','Executor → Asst (only when needed) → Executor'],['executor-only','ผู้ลงมือทำงานเท่านั้น','Executor only'],['strategist-executor','ผู้วางกลยุทธ์ → ผู้ลงมือทำงาน','Strategist → Executor'],['strategist-executor-asst','ผู้วางกลยุทธ์ → ผู้ลงมือทำงาน + ที่ปรึกษาเมื่อติดขัด','Strategist → Executor + Asst when needed']];

// The parent run() catches failures and returns null. Only successful requests
// update local records. A lost response is retained for manual reconciliation.
export function useStrategy({projectId, run, service, readAction}) {
  const [data,setData] = useState(null), [loading,setLoading] = useState(false);
  const [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [uncertain,setUncertain] = useState([]), lock = useRef(false), scope = useRef(projectId);
  scope.current = projectId;
  const storageKey = `forge.strategy.${service}.${projectId}`;
  const remember = useCallback(entries => {
    setUncertain(entries);
    try {sessionStorage.setItem(storageKey,JSON.stringify(entries));} catch { /* Recovery still uses durable server records. */ }
  },[storageKey]);
  const refresh = useCallback(async () => {
    setLoading(true);setError('');
    try {const value=await request(`/api/${service}/${readAction}`,{projectId});if(scope.current===projectId)setData(value);return value;}
    catch(e){if(scope.current===projectId)setError(`${e.code || 'READ_FAILED'}: ${e.message}`);return null;}
    finally {if(scope.current===projectId)setLoading(false);}
  },[projectId,service,readAction]);
  useEffect(()=>{
    setData(null);setNotice('');setError('');
    try {setUncertain(JSON.parse(sessionStorage.getItem(storageKey)||'[]'));} catch {setUncertain([]);}
    void refresh();
  },[refresh,storageKey]);
  const act = async (action,body={},onSuccess) => {
    if(lock.current)return null;
    lock.current=true;setLoading(true);setError('');setNotice('');
    const input={projectId,operationId:operationId(),...body}, entry={action,input};
    // Persist intent before transport. No automatic replay, even on remount.
    const pending=[...uncertain,entry];remember(pending);
    try {
      return await run(async()=>{
        let result;
        try {result=await request(`/api/${service}/${action}`,input);}
        catch(e){
          if(scope.current===projectId){
            setError(`${e.code || 'COMMAND_FAILED'}: ${e.message}`);
            if(e.status>=400&&e.status<500&&e.status!==408)remember(pending.filter(x=>x.input.operationId!==input.operationId));
          }
          throw e;
        }
        if(scope.current===projectId){
          remember(pending.filter(x=>x.input.operationId!==input.operationId));
          onSuccess?.(result);setNotice(`${action} · ${result?.status || result?.id || 'saved'} · ${input.operationId}`);
          await refresh();
        }
        return result;
      });
    } finally {lock.current=false;if(scope.current===projectId)setLoading(false);}
  };
  return {data,loading,error,notice,uncertain,refresh,act,remember};
}

export function StrategyStatus({ui,t}) {
  return <><div role="status" aria-live="polite">{ui.loading?t('กำลังอ่านหรือบันทึกข้อมูล…','Reading or saving…'):ui.notice}</div>
    {ui.error&&<p role="alert" className="error-text">{ui.error}</p>}
    {!!ui.uncertain.length&&<section className="panel" aria-label={t('คำสั่งที่ยังไม่ทราบผล','Uncertain commands')}>
      <h2>{t('ตรวจสอบผลก่อนทำต่อ','Reconcile before continuing')}</h2>
      <p>{t('อาจไม่ได้รับคำตอบ ทั้งที่คำสั่งสำเร็จแล้ว โหลดข้อมูลล่าสุดและตรวจผลเดิมก่อน ระบบไม่ส่งงานซ้ำอัตโนมัติ','The response may be lost after the command was accepted. Refresh and reconcile the existing work. No command is automatically replayed.')}</p>
      <Json value={ui.uncertain}/>
      <button type="button" disabled={ui.loading} onClick={()=>ui.remember([])}>{t('รับทราบหลังตรวจสอบผลแล้ว','Acknowledge after checking outcome')}</button>
    </section>}
  </>;
}

export function ProvenanceFields({value,onChange,t,prefix=''}) {
  return <div className="form-grid">{[['source',t('แหล่งที่มา','Source')],['recordedBy',t('ผู้บันทึก','Recorded by')],['reason',t('เหตุผลพร้อมหลักฐาน','Reason and evidence')]].map(([key,label])=><Field key={key} label={`${prefix}${label}`}><input required maxLength={key==='recordedBy'?200:key==='source'?1000:2000} value={value?.[key]??''} onChange={e=>onChange({...value,[key]:e.target.value})}/></Field>)}</div>;
}

export function TaskPicker({t,state,projectId,value,onChange}) {
  const tasks=scoped(state,'tasks',projectId),task=tasks.find(x=>x.id===value);
  const plan=scoped(state,'plans',projectId).find(x=>x.id===task?.planId);
  return <><Field label={t('งาน','Task')}><select required value={value} onChange={e=>onChange(e.target.value)}><option value="">{t('เลือกงานที่มีอยู่','Choose an existing task')}</option>{tasks.map(x=><option key={x.id} value={x.id}>{x.title} · {x.id}</option>)}</select></Field>
    {!tasks.length&&<Empty>{t('สร้างงานและแผนจากหน้าทีมและงานก่อน','Create a task and a plan in Team & tasks first.')}</Empty>}
    {task&&<p className="help">{t('แผนที่อนุมัติโดยมนุษย์','Human-approved plan')}: <Badge>{plan?.approved?'approved':'required'}</Badge> · {t('ผู้ช่วย AI','Bot')}: {task.botId||t('ยังไม่ได้มอบหมาย','unassigned')}</p>}</>;
}

export function LimitsFields({value,onChange,t,assistance=false}) {
  const rows=[['maxAttempts',t('จำนวนครั้งสูงสุด','Maximum attempts'),8],['maxSteps',t('จำนวนขั้นสูงสุด','Maximum steps'),assistance?32:64],['maxMs',t('เวลาสูงสุด (มิลลิวินาที)','Maximum elapsed time (ms)'),3600000],...(assistance?[['maxEscalations',t('จำนวนครั้งสูงสุดที่ขอที่ปรึกษา','Maximum escalations'),3]]:[])];
  return <fieldset><legend>{t('ขอบเขตการทำงาน','Loop limits')}</legend><div className="form-grid">{rows.map(([key,label,max])=><Field key={key} label={label}><input required type="number" min={key==='maxEscalations'?0:1} max={max} step={1} value={value[key]} onChange={e=>onChange({...value,[key]:integer(e.target.value)??''})}/></Field>)}</div></fieldset>;
}

export function Attempts({loop,state,projectId,t}) {
  return <><p>{loop.id} · r{loop.revision} · <Badge>{loop.status}</Badge> {loop.stage} {loop.pendingRole&&`→ ${loop.pendingRole}`}</p>
    <p className="help">{t('ขั้นที่ใช้','Steps')}: {loop.steps} · {t('สิ้นสุดเวลา','Deadline')}: {date(loop.deadlineAt)} · {t('ขอบเขต','Limits')}: {JSON.stringify(loop.limits)}</p>
    {!loop.attempts?.length&&<Empty>{t('ยังไม่มีการส่งงาน เริ่มด้วยคำสั่งที่ชัดเจนเท่านั้น','No attempt dispatched. Each turn needs an explicit action.')}</Empty>}
    {(loop.attempts??[]).map(a=>{
      const r=scoped(state,'runs',projectId).find(x=>x.id===a.runId);
      let href;try{if(r?.threadUrl)href=safeLocalUrl(r.threadUrl);}catch{ /* Non-loopback links are not opened. */ }
      return <details key={a.number}><summary>{t('ครั้งที่','Attempt')} {a.number} · {a.role||'executor'} · {a.status} · {a.runId||t('ยังไม่พบงานที่สั่งทำ','no observed run')}</summary>
        <p>{t('โมเดลที่รันจริง','Observed executed model')}: {r?.executedModel||t('ยังไม่ทราบ','unknown')} · {t('ค่าใช้จ่ายที่รายงาน','Reported cost')}: {a.reportedCost?JSON.stringify(a.reportedCost):t('ยังไม่ทราบ','unknown')}</p>
        <p className="help">T3 thread: {r?.threadId||t('ยังไม่ทราบ','unknown')} · Provider run: {r?.providerRunId||t('ยังไม่ทราบ','unknown')}</p>
        {href&&<a href={href} target="_blank" rel="noreferrer">{t('เปิดงานใน T3','Open T3 run')}</a>}<Json value={a}/></details>;
    })}<details><summary>{t('ประวัติและที่มา','History and provenance')}</summary><Json value={loop.history??[]}/></details></>;
}

function PolicyEditor({t,policy,connections,catalogs,onSave,busy}) {
  const [base,setBase]=useState(policy?.id??null);
  const [draft,setDraft]=useState(policy?.policy??{classifications:[],qualityWeight:'',costWeight:'',unknownCost:'',provenance:blankProvenance()});
  const [edited,setEdited]=useState({});
  const models=connections.flatMap(c=>(catalogs[c.id]?.catalog??c.providerCatalog)?.models?.map(m=>({c,m}))??[]);
  const observed=new Set(models.map(({c,m})=>JSON.stringify([c.id,m.id])));
  const update=(key,patch)=>setEdited({...edited,[key]:{...edited[key],...patch}});
  const blank=(c,m)=>({connectionId:c.id,model:m.id,roles:null,sizeRank:'',qualityRank:'',costRank:'',options:[],monetaryCost:null,provenance:blankProvenance()});
  const row=({c,m})=>{const key=JSON.stringify([c.id,m.id]);return {...(draft.classifications.find(x=>JSON.stringify([x.connectionId,x.model])===key)??blank(c,m)),...edited[key]};};
  const missing=draft.classifications.filter(x=>!observed.has(JSON.stringify([x.connectionId,x.model])));
  return <form onSubmit={e=>{e.preventDefault();const classifications=[...models.map(item=>{const r=row(item);return {...r,sizeRank:integer(r.sizeRank),qualityRank:integer(r.qualityRank),costRank:integer(r.costRank),monetaryCost:r.monetaryCost?{...r.monetaryCost,amount:integer(r.monetaryCost.amount)}:null};}),...missing];onSave({expectedPolicyId:base,policy:{...draft,classifications,qualityWeight:integer(draft.qualityWeight),costWeight:integer(draft.costWeight)}});}}>
    <p>{t('จัดอันดับจากหลักฐานของคุณด้วยค่า 0–100 ค่านี้ไม่ใช่ผลวัดคุณภาพ ขนาดโมเดล หรือราคาจริง อันดับต้นทุนยิ่งสูงหมายถึงยิ่งแพง','Classify from your evidence: ranks are ordinals from 0–100, not measured quality, parameter counts or prices. Higher cost rank means more costly.')}</p>
    {base!==(policy?.id??null)&&<p role="alert">{t('นโยบายเปลี่ยนแล้ว โหลดฉบับปัจจุบันก่อนบันทึก','Policy changed. Reload the current policy before saving.')}</p>}
    <button type="button" disabled={busy} onClick={()=>{setBase(policy?.id??null);setDraft(policy?.policy??{classifications:[],qualityWeight:'',costWeight:'',unknownCost:'',provenance:blankProvenance()});setEdited({});}}>{t('โหลดนโยบายปัจจุบันแทนแบบร่าง','Replace draft with current policy')}</button>
    <div className="form-grid">{[['qualityWeight',t('น้ำหนักคุณภาพ','Quality weight')],['costWeight',t('น้ำหนักต้นทุน','Cost weight')]].map(([key,label])=><Field key={key} label={label}><input required type="number" min={1} max={100} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></Field>)}
      <Field label={t('เมื่อต้นทุนไม่ทราบ','Unknown cost handling')}><select required value={draft.unknownCost} onChange={e=>setDraft({...draft,unknownCost:e.target.value})}><option value="">{t('เลือกอย่างชัดเจน','Choose explicitly')}</option><option value="ask-owner">{t('ถามเจ้าของก่อน','Ask owner')}</option><option value="allow-ranked-last">{t('อนุญาตแต่จัดอันดับท้าย','Allow, ranked last')}</option></select></Field></div>
    <ProvenanceFields t={t} prefix={t('นโยบาย: ','Policy: ')} value={draft.provenance} onChange={provenance=>setDraft({...draft,provenance})}/>
    <p className="help">{t('สูตร: อันดับคุณภาพ × น้ำหนักคุณภาพ − อันดับต้นทุน × น้ำหนักต้นทุน หากไม่ทราบต้นทุนจะไม่คำนวณคะแนน','Rule: quality rank × quality weight − cost rank × cost weight. Unknown costs have no numeric utility.')}</p>
    {!models.length&&<Empty>{t('ยังไม่พบโมเดล ไปที่บริการ AI เพื่อเชื่อมต่อ ตรวจบัญชี และโหลดรายชื่อโมเดลล่าสุด','No observed models. Connect, check authentication and refresh the catalog in Providers.')}</Empty>}
    {models.map(item=>{const {c,m}=item,key=JSON.stringify([c.id,m.id]),r=row(item),roles=r.roles===null?'':!r.roles.length?'excluded':roleChoices.find(([,set])=>set.length===r.roles.length&&set.every(role=>r.roles.includes(role)))?.[0]??'';const advertised=o=>(m.options??[]).some(d=>d.id===o.id&&d.values?.includes(o.value)),orphaned=r.options.filter(o=>!advertised(o));return <fieldset key={key} style={{marginBottom:16}}><legend>{m.name||m.id} · {c.name||c.providerInstanceId}</legend>
      <p className="help">{c.id} / {m.id} · {t('ราคาเงินจริง','Monetary cost')}: {r.monetaryCost?`${r.monetaryCost.amount} ${r.monetaryCost.currency} / ${r.monetaryCost.unit}`:t('ยังไม่ทราบ','unknown')}</p>
      {!!orphaned.length&&<><p role="alert">{t('บริการ AI ไม่ได้แจ้งตัวเลือกเดิมแล้ว ตรวจและลบตัวเลือกนั้นก่อนเลือกงาน','Saved options are absent from the current catalog. Review and remove them before selecting work.')}</p><Json value={orphaned}/><button type="button" onClick={()=>update(key,{...r,options:r.options.filter(advertised)})}>{t('นำตัวเลือกที่ไม่ประกาศแล้วออก','Remove unadvertised saved options')}</button></>}
      <div className="form-grid"><Field label={t('บทบาทที่อนุญาต','Allowed roles')}><select required value={roles} onChange={e=>update(key,{...r,roles:e.target.value==='excluded'?[]:roleChoices.find(([key])=>key===e.target.value)?.[1]??null})}><option value="">{t('ยังไม่จัดประเภท','Unclassified')}</option><option value="excluded">{t('ยกเว้นอย่างชัดเจน','Explicitly excluded')}</option>{roleChoices.map(([key,,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
        {['sizeRank','qualityRank','costRank'].map(rank=><Field key={rank} label={rank==='sizeRank'?t('ลำดับขนาด','Size rank'):rank==='qualityRank'?t('ลำดับคุณภาพ','Quality rank'):t('ลำดับต้นทุน (เว้นว่าง = ไม่ทราบ)','Cost rank (blank = unknown)')}><input type="number" min={0} max={100} required={rank!=='costRank'} value={r[rank]??''} onChange={e=>update(key,{...r,[rank]:e.target.value})}/></Field>)}
        {(m.options??[]).map(o=><Field key={o.id} label={`${t('ตัวเลือก','Option')}: ${o.id}`}><select value={r.options.find(x=>x.id===o.id)?JSON.stringify(r.options.find(x=>x.id===o.id).value):''} onChange={e=>update(key,{...r,options:[...r.options.filter(x=>x.id!==o.id),...(e.target.value===''?[]:[{id:o.id,value:JSON.parse(e.target.value)}])]})}><option value="">{t('ใช้ค่าเริ่มต้นที่บริการ AI แจ้งไว้','Use advertised default')}</option>{(o.values??[]).map(v=><option key={JSON.stringify(v)} value={JSON.stringify(v)}>{String(v)}</option>)}</select></Field>)}</div>
      <ProvenanceFields t={t} value={r.provenance} onChange={provenance=>update(key,{...r,provenance})}/>
      <label><input type="checkbox" checked={!!r.monetaryCost} onChange={e=>update(key,{...r,monetaryCost:e.target.checked?{amount:'',currency:'',unit:'',provenance:blankProvenance()}:null})}/> {t('บันทึกราคาจริงพร้อมที่มา (ไม่ใช่ค่าประมาณต่องาน)','Record sourced monetary cost (not an estimated run price)')}</label>
      {r.monetaryCost&&<fieldset><legend>{t('ราคาและที่มา','Monetary cost and provenance')}</legend><div className="form-grid"><Field label={t('จำนวนเงิน','Amount')}><input required type="number" min={0} step="any" value={r.monetaryCost.amount} onChange={e=>update(key,{...r,monetaryCost:{...r.monetaryCost,amount:e.target.value}})}/></Field><Field label={t('สกุลเงิน','Currency')}><input required maxLength={20} value={r.monetaryCost.currency} onChange={e=>update(key,{...r,monetaryCost:{...r.monetaryCost,currency:e.target.value}})}/></Field><Field label={t('หน่วยราคา','Cost unit')}><input required maxLength={100} value={r.monetaryCost.unit} onChange={e=>update(key,{...r,monetaryCost:{...r.monetaryCost,unit:e.target.value}})}/></Field></div><ProvenanceFields t={t} prefix={t('ราคา: ','Monetary: ')} value={r.monetaryCost.provenance} onChange={provenance=>update(key,{...r,monetaryCost:{...r.monetaryCost,provenance}})}/></fieldset>}
    </fieldset>;})}
    {!!missing.length&&<details><summary>{t('การจัดประเภทเดิมที่ไม่พบในรายชื่อโมเดลล่าสุด (เก็บไว้)','Saved classifications absent from current catalog (retained)')}</summary><Json value={missing}/></details>}
    <button className="primary" disabled={busy||!models.length||base!==(policy?.id??null)}>{t('บันทึกนโยบายฉบับใหม่','Save new policy version')}</button>
  </form>;
}

function AssistanceLoop({loop,t,state,projectId,decision,ui,busy}) {
  const [reason,setReason]=useState(''),[feedback,setFeedback]=useState(''),[provenance,setProvenance]=useState(blankProvenance),[reviewer,setReviewer]=useState(''),[evidence,setEvidence]=useState('');
  const last=loop.attempts?.at(-1),ended=last&&terminal.has(last.status)&&last.reconciled,hasAsst=!!decision?.selection?.asst;
  const body={loopId:loop.id,expectedRevision:loop.revision};
  const transition=(action,extra)=>ui.act('transition',{...body,action,...extra});
  return <section className="panel"><h2>{decision?.selection?.strategist?t('รอบการทำงานผู้วางกลยุทธ์และผู้ลงมือทำงาน','Strategist and Executor loop'):hasAsst?t('รอบการทำงานผู้ลงมือทำงานและที่ปรึกษา','Executor and Asst loop'):t('รอบการทำงานผู้ลงมือทำงาน','Executor loop')}</h2><p>{t('รูปแบบที่บันทึกไว้','Saved pattern')}: {decision?.constraints?.rolePattern??'executor-asst'}</p><Attempts {...{loop,t,state,projectId}}/>
    <div className="toolbar"><button disabled={busy||!!ui.uncertain.length||loop.status!=='ready'||!loop.pendingRole} onClick={()=>ui.act('advance',body)}>{t('ส่งครั้งถัดไป','Dispatch next attempt')}</button><button disabled={busy} onClick={()=>ui.act('reconcile',{loopId:loop.id})}>{t('ตรวจสถานะเดิม','Reconcile loop')}</button><button disabled={busy||inactive.has(loop.status)} onClick={()=>ui.act('stop',{loopId:loop.id})}>{t('หยุดงานในรอบนี้','Stop owned loop')}</button></div>
    {['unknown','stopping','submitting','running'].includes(loop.status)&&<p>{t('ตรวจสถานะล่าสุดก่อนเปลี่ยนบทบาท หากจะควบคุมเอง ให้หยุดงานและรอจนยืนยันว่าหยุดแล้วก่อนใช้ตัวควบคุมเดิม','Reconcile before changing roles. To take over, Stop and wait for a terminal outcome before using the existing controller.')}</p>}
    {ended&&!inactive.has(loop.status)&&!loop.pendingRole&&<form onSubmit={e=>e.preventDefault()}>
      {last.role==='executor'&&hasAsst&&<><h3>{t('ขอความช่วยเหลือเฉพาะงานยากหรือติดขัด','Assistance for difficult or stuck work')}</h3>
        {decision?.constraints?.difficulty&&<button type="button" disabled={busy} onClick={()=>transition('escalate',{trigger:'difficult'})}>{t('ขอที่ปรึกษาตามหลักฐานงานยากที่บันทึกไว้','Escalate using saved difficulty evidence')}</button>}
        <Field label={t('หลักฐานว่าผู้ลงมือทำงานติดขัด','Observed stuck reason')}><textarea maxLength={4000} value={reason} onChange={e=>setReason(e.target.value)}/></Field></>}
      {last.role==='strategist'&&<p>{t('ตรวจแผนกลยุทธ์ ความเสี่ยง และเกณฑ์ว่างานเสร็จก่อนส่งต่อผู้ลงมือทำงาน การเลือกบทบาทไม่เพิ่มสิทธิ์เครื่องมือหรือแทนการอนุมัติแผน','Review the strategy, risks and acceptance checks before handing off to Executor. Roles do not grant tools or replace plan approval.')}</p>}
      {last.role!=='executor'&&last.status!=='completed'&&<p role="alert">{t('บทบาทที่ปรึกษายังไม่สำเร็จ ตรวจหลักฐานแล้วหยุดรอบการทำงานเพื่อเลือกใหม่ ไม่มีการลองซ้ำอัตโนมัติ','The advisory attempt did not complete. Inspect the evidence and stop this loop before selecting again. No automatic retry.')}</p>}
      {(last.role!=='executor'||hasAsst)&&<><Field label={t('ข้อเสนอแนะที่มนุษย์ตรวจแล้ว','Reviewed handoff')}><textarea maxLength={4000} value={feedback} onChange={e=>setFeedback(e.target.value)}/></Field>
      <ProvenanceFields {...{t,provenance}} value={provenance} onChange={setProvenance}/>
      <div className="actions">{last.role==='executor'?<button type="button" disabled={busy||!!ui.uncertain.length||!reason.trim()||Object.values(provenance).some(v=>!v.trim())} onClick={()=>transition('escalate',{trigger:'stuck',reason,provenance,...(feedback?{feedback}:{})})}>{t('ขอที่ปรึกษาสำหรับครั้งที่ติดขัดนี้','Escalate this stuck attempt')}</button>:<button type="button" disabled={busy||!!ui.uncertain.length||last.status!=='completed'||!feedback.trim()||Object.values(provenance).some(v=>!v.trim())} onClick={()=>transition('return',{feedback,provenance})}>{last.role==='strategist'?t('ส่งแผนที่ตรวจแล้วให้ผู้ลงมือทำงาน','Hand reviewed strategy to Executor'):t('ส่งกลับผู้ลงมือทำงานพร้อมข้อเสนอแนะ','Return reviewed handoff to Executor')}</button>}</div></>}
      {last.role==='executor'&&last.status==='completed'&&<><h3>{t('ตรวจผลโดยมนุษย์','Human review')}</h3><Field label={t('ผู้ตรวจ','Reviewer')}><input maxLength={200} value={reviewer} onChange={e=>setReviewer(e.target.value)}/></Field><Field label={t('หลักฐานการตรวจผล','Verification evidence')}><textarea maxLength={4000} value={evidence} onChange={e=>setEvidence(e.target.value)}/></Field><button type="button" disabled={busy||!reviewer.trim()||!evidence.trim()} onClick={()=>transition('approve',{reviewer,evidence})}>{t('ยืนยันการตรวจผลรอบการทำงาน','Approve loop review')}</button><p className="help">{t('บันทึกการตรวจ ไม่เปลี่ยนงานบนบอร์ดเป็นเสร็จอัตโนมัติ','Records review; does not automatically mark the board task done.')}</p></>}
    </form>}
  </section>;
}

export default function Assistance(props) {
  const {t,state,projectId,run,busy}=props;
  const ui=useStrategy({projectId,run,service:'assistance',readAction:'state'});
  const [taskId,setTask]=useState(''),[decisionId,setDecision]=useState(''),[loopId,setLoop]=useState(''),[catalogs,setCatalogs]=useState({});
  const [minExecutorQuality,setMinExecutor]=useState(0),[minAsstQuality,setMinAsst]=useState(0),[maxCostRank,setMaxCost]=useState('');
  const [rolePattern,setRolePattern]=useState('executor-asst'),[minStrategistQuality,setMinStrategist]=useState(0);
  const [difficult,setDifficult]=useState(false),[difficultyReason,setDifficultyReason]=useState(''),[provenance,setProvenance]=useState(blankProvenance);
  const [limits,setLimits]=useState({maxAttempts:4,maxEscalations:1,maxSteps:12,maxMs:300000});
  const [costMode,setCostMode]=useState(''),[costCap,setCostCap]=useState(''),[currency,setCurrency]=useState('');
  const connections=scoped(state,'connections',projectId).filter(c=>c.kind==='provider'&&c.enabled!==false);
  const decisions=(ui.data?.decisions??[]).filter(d=>d.taskId===taskId),decision=decisions.find(d=>d.id===decisionId);
  const loops=(ui.data?.loops??[]).filter(l=>l.taskId===taskId),loop=loops.find(l=>l.id===loopId);
  const disabled=busy||ui.loading;
  useEffect(()=>{setTask('');setDecision('');setLoop('');setCatalogs({});},[projectId]);
  return <>
    <Heading title={t('กลยุทธ์ผู้ช่วย','Assistance strategy')} description={t('เลือกรูปแบบบทบาทจากโมเดลที่เชื่อมต่อ เพิ่มผู้วางกลยุทธ์เพื่อวางกลยุทธ์ก่อนผู้ลงมือทำงานและเลือกที่ปรึกษาเฉพาะเมื่อจำเป็น','Choose a role pattern from connected models. Add a Strategist before Executor and choose Asst for difficult or stuck work.')}><button disabled={disabled} onClick={ui.refresh}>{t('โหลดข้อมูลล่าสุด','Refresh strategy')}</button></Heading>
    <StrategyStatus {...{ui,t}}/>
    <section className="panel"><h2>{t('นโยบายและโมเดลที่ตรวจพบ','Policy and observed models')}</h2>
      <p className="help">{t('การเลือกบทบาทไม่เปลี่ยนโมเดลของโปรเจกต์ คุณภาพที่ดีขึ้นยังไม่ได้รับการพิสูจน์','Role selection does not change the project model. Quality improvement is not established.')}</p>
      {!connections.length&&<Empty>{t('ยังไม่มีบริการ AI ที่เปิดใช้ ไปตั้งค่าที่หน้าบริการ AI ก่อน','No enabled provider connections. Set up Providers first.')}</Empty>}
      {connections.map(c=><details key={c.id}><summary>{c.name||c.providerInstanceId} · {c.lastCheck?.status||'needs_setup'}</summary><p>{t('สถานะบัญชี','Authentication')}: {c.lastCheck?.authentication||t('ยังไม่ทราบ','unknown')} · {t('ตรวจล่าสุด','Checked')}: {date(c.lastCheck?.checkedAt)}</p><button disabled={disabled} onClick={()=>run(async()=>{const result=await request('/api/providers/catalog',{projectId,connectionId:c.id});setCatalogs(x=>({...x,[c.id]:result}));return result;})}>{t('โหลดรายชื่อโมเดลของการเชื่อมต่อนี้','Read route catalog')}</button>{catalogs[c.id]&&<Json value={catalogs[c.id]}/>}<p className="help">{t('หากข้อมูลหมดอายุหรือบัญชียังไม่พร้อม ไปที่บริการ AI เพื่อตรวจบัญชีและโหลดข้อมูลล่าสุด การอ่านรายชื่อไม่เรียกใช้โมเดล','For stale catalogs or authentication, use Check and Refresh in Providers. This read does not run a model.')}</p></details>)}
      {ui.data&&<PolicyEditor key={projectId} t={t} policy={ui.data.policy} connections={connections} catalogs={catalogs} busy={disabled||!!ui.uncertain.length} onSave={body=>ui.act('configure',body)}/>}
    </section>
    <section className="panel"><h2>{t('เลือกบทบาทสำหรับงาน','Select task roles')}</h2><form onSubmit={e=>{e.preventDefault();ui.act('select',{taskId,constraints:{rolePattern,minStrategistQuality:Number(minStrategistQuality),minExecutorQuality:Number(minExecutorQuality),minAsstQuality:Number(minAsstQuality),maxCostRank:integer(maxCostRank),...(difficult?{difficulty:{kind:'difficult',reason:difficultyReason,provenance}}:{})}},r=>setDecision(r.id));}}>
      <TaskPicker {...{t,state,projectId}} value={taskId} onChange={id=>{setTask(id);setDecision('');setLoop('');}}/>
      <Field label={t('รูปแบบบทบาท','Role pattern')}><select value={rolePattern} onChange={e=>{setRolePattern(e.target.value);setDecision('');}}>{patternChoices.map(([key,th,en])=><option key={key} value={key}>{t(th,en)}</option>)}</select></Field>
      <p className="help">{t('ผู้วางกลยุทธ์เสนอทางเลือก ความเสี่ยง และเกณฑ์ว่างานเสร็จ มนุษย์ตรวจแล้วจึงส่งต่อผู้ลงมือทำงานแต่ละบทบาทใช้เส้นทาง/โมเดลต่างกัน ไม่อนุมานว่าผู้วางกลยุทธ์ใหญ่กว่าหรือเก่งกว่า และไม่เพิ่มสิทธิ์เครื่องมือ','Strategist proposes options, risks and acceptance checks for a human-reviewed handoff. Each role uses a distinct route/model. Strategist implies no size, quality superiority or extra tool permission.')}</p>
      <div className="form-grid">{[[t('คุณภาพผู้ลงมือทำงานขั้นต่ำ','Minimum Executor quality'),minExecutorQuality,setMinExecutor],...(rolePattern.includes('asst')?[[t('คุณภาพที่ปรึกษาขั้นต่ำ','Minimum Asst quality'),minAsstQuality,setMinAsst]]:[]),...(rolePattern.startsWith('strategist')?[[t('คุณภาพผู้วางกลยุทธ์ขั้นต่ำ','Minimum Strategist quality'),minStrategistQuality,setMinStrategist]]:[]),[t('อันดับต้นทุนสูงสุด (เว้นว่าง = ไม่จำกัด)','Maximum cost rank (blank = no limit)'),maxCostRank,setMaxCost]].map(([label,value,set])=><Field key={label} label={label}><input type="number" min={0} max={100} required={set!==setMaxCost} value={value} onChange={e=>set(e.target.value)}/></Field>)}</div>
      <label><input type="checkbox" checked={difficult} onChange={e=>setDifficult(e.target.checked)}/> {t('ระบุว่างานยากพร้อมหลักฐาน','Explicit difficult-work evidence')}</label>
      {difficult&&<><Field label={t('เหตุผลงานยาก','Difficulty reason')}><textarea required maxLength={4000} value={difficultyReason} onChange={e=>setDifficultyReason(e.target.value)}/></Field><ProvenanceFields t={t} value={provenance} onChange={setProvenance}/></>}
      <div className="actions"><button className="primary" disabled={disabled||!taskId||!!ui.uncertain.length}>{t('บันทึกการเลือกพร้อมเหตุผล','Select and record reasons')}</button></div>
    </form>
    <Field label={t('การตัดสินใจที่บันทึกไว้','Saved decision')}><select value={decisionId} onChange={e=>setDecision(e.target.value)}><option value="">{t('เลือกการตัดสินใจ','Choose decision')}</option>{decisions.map(d=><option key={d.id} value={d.id}>{d.status} · {d.id}</option>)}</select></Field>
    {decision&&<><Badge>{decision.status}</Badge><p>{t('รูปแบบที่บันทึกไว้','Saved pattern')}: {decision.constraints?.rolePattern??'executor-asst'}</p>{decision.issues?.map((issue,i)=><p key={i}>{issue.code}: {issue.action}</p>)}{decision.selection&&['strategist','executor','asst'].filter(role=>decision.selection[role]).map(role=>{const c=decision.selection[role];return <div key={role}><h3>{role==='asst'?'Asst':role==='strategist'?'Strategist':'Executor'} · {c.model}</h3><p>{c.instanceId} · {c.connectionId} · {c.reason} · utility: {c.utility??t('ไม่ทราบ','unknown')}</p><Json value={{selection:c.selection,classification:c.classification}}/></div>;})}<details><summary>{t('ผู้สมัคร เหตุผล และที่มาทั้งหมด','All candidates, reasons and provenance')}</summary><Json value={decision}/></details></>}
    </section>
    <section className="panel"><h2>{t('สร้างรอบการทำงานที่มีขอบเขต','Create bounded role loop')}</h2><form onSubmit={e=>{e.preventDefault();ui.act('create-loop',{taskId,decisionId,limits:{...limits,...(costMode?{reportedCost:{mode:costMode,maxAmount:integer(costCap),currency:currency||null}}:{})}},l=>setLoop(l.id));}}>
      <LimitsFields {...{t,limits}} value={limits} onChange={setLimits} assistance/>
      <Field label={t('นโยบายค่าใช้จ่ายที่รายงาน','Reported cost policy')}><select value={costMode} onChange={e=>setCostMode(e.target.value)}><option value="">{t('ใช้ค่าเริ่มต้นของบริการ','Use service default')}</option><option value="allow-unknown">{t('อนุญาตเมื่อยังไม่ทราบ','Allow unknown')}</option><option value="require-reported">{t('ต้องมีรายงานก่อนทำต่อ','Require reported cost')}</option></select></Field>
      {costMode&&<div className="form-grid"><Field label={t('เพดานค่าใช้จ่าย (เว้นว่าง = ไม่มี)','Reported amount cap (blank = none)')}><input type="number" min={0} step="any" value={costCap} onChange={e=>setCostCap(e.target.value)}/></Field><Field label={t('สกุลเงิน','Currency')}><input required={costCap!==''} maxLength={20} value={currency} onChange={e=>setCurrency(e.target.value)}/></Field></div>}
      <p className="help">{t('เพดานตรวจจากรายงานก่อนส่งครั้งถัดไป ไม่ใช่การรับประกันค่าใช้จ่ายสูงสุด ต้องมีแผนที่มนุษย์อนุมัติก่อนส่งงาน','Caps check reported expenditure before the next dispatch; they do not guarantee a hard spending ceiling. Dispatch requires an approved human plan.')}</p>
      <button disabled={disabled||decision?.status!=='selected'||!!ui.uncertain.length}>{decision?.selection?.strategist?t('สร้างรอบการทำงาน เริ่มผู้วางกลยุทธ์','Create loop starting with Strategist'):t('สร้างรอบการทำงาน เริ่มผู้ลงมือทำงาน','Create loop starting with Executor')}</button>
    </form></section>
    <Field label={t('รอบการทำงานที่บันทึกไว้','Saved loop')}><select value={loopId} onChange={e=>setLoop(e.target.value)}><option value="">{t('เลือกรอบการทำงาน','Choose loop')}</option>{loops.map(l=><option key={l.id} value={l.id}>{l.status} · {l.id}</option>)}</select></Field>
    {loop&&<AssistanceLoop key={loop.id} {...{loop,t,state,projectId,ui}} decision={(ui.data?.decisions??[]).find(d=>d.id===loop.decisionId)} busy={disabled}/>}
  </>;
}
