import React, {useEffect, useRef, useState} from 'react';
import {request, operationId} from './api.mjs';
import {Field, Heading, Empty, Json} from './ui.jsx';

export default function ContextBudget({t,state,projectId,run,busy}){
  const project=state?.projects?.find(p=>p.id===projectId),provider=project?.profile?.provider;
  const [data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(null);
  const [providerId,setProvider]=useState(''),[modelId,setModel]=useState(''),[windowSize,setWindow]=useState(''),[output,setOutput]=useState('0'),[safety,setSafety]=useState('0'),[inputLimit,setInput]=useState(''),[source,setSource]=useState('');
  const [taskId,setTask]=useState(''),[content,setContent]=useState(''),[memory,setMemory]=useState(false),[query,setQuery]=useState('');
  const [selected,setSelected]=useState(''),[context,setContext]=useState(null),[handle,setHandle]=useState(''),[page,setPage]=useState(null),[usage,setUsage]=useState(null);
  const scope=useRef(projectId),lock=useRef(false);scope.current=projectId;
  const disabled=busy||loading;
  const route={providerId,modelId},policy=data?.policies?.filter(p=>p.route.providerId===providerId&&p.route.modelId===modelId).at(-1);
  const spills=data?.spills??[],spill=spills.find(s=>s.handle===handle);
  async function refresh(){const p=projectId;setLoading(true);try{const result=await request('/api/context/status',{projectId:p});if(scope.current===p){setData(result);setError('');}return result;}catch(e){if(scope.current===p)setError(`${e.code??'ERROR'}: ${e.message}`);}finally{if(scope.current===p)setLoading(false);}}
  useEffect(()=>{setData(null);setContext(null);setSelected('');setPage(null);setHandle('');setPending(null);setContent('');setQuery('');setUsage(null);setTask('');setProvider(provider?.instanceId??'');setModel(provider?.model??'');setWindow('');setInput('');setSource('');setError('');if(projectId)void refresh();},[projectId]);
  async function act(method,body,onSuccess,{write=false,replay=false}={}){
    if(lock.current)return;lock.current=true;setLoading(true);setError('');const p=projectId,input=replay?body:{projectId:p,...(write?{operationId:operationId()}:{}),...body};
    if(write)setPending({method,input});
    const work=async()=>{try{const result=await request(`/api/context/${method}`,input);if(scope.current===p){setPending(null);onSuccess?.(result);}return result;}catch(e){if(scope.current===p){setError(`${e.code??'ERROR'}: ${e.message}`);if(e.status&&e.status<500)setPending(null);}throw e;}};
    try{if(run)await run(work);else await work();}catch{/* Error is displayed locally and by the shared run boundary. */}finally{if(scope.current===p)setLoading(false);lock.current=false;}
  }
  function usePolicy(){if(!policy)return;setWindow(String(policy.budget.contextWindow));setOutput(String(policy.budget.outputReserve));setSafety(String(policy.budget.safetyReserve));setInput(String(policy.budget.maxInputTokens));setSource(policy.source.reference);}
  return <>
    <Heading title={t('บริบทและงบโทเคน','Context & token budget')} description={t('ควบคุมบริบทที่ FORGE ส่งให้ harness พร้อมที่มาและหลักฐานต้นฉบับ','Manage the FORGE prefix with source provenance and original evidence references.')}><button disabled={disabled} onClick={refresh}>{t('โหลดสถานะ','Refresh')}</button></Heading>
    {error&&<p role="alert">{error}</p>}
    {pending&&<section className="panel"><p role="status">{t('ผลคำสั่งยังไม่ชัดเจน โหลดสถานะเพื่อตรวจ หรือส่ง operation เดิมซ้ำอย่างปลอดภัย','Outcome is uncertain. Refresh to reconcile, or replay the identical operation.')}: {pending.method} · {pending.input.operationId}</p><button disabled={disabled} onClick={()=>act(pending.method,pending.input,result=>{if(result.contextId){setSelected(result.contextId);setContext(result);}void refresh();},{write:true,replay:true})}>{t('ตรวจด้วย operation เดิม','Replay same operation')}</button></section>}
    <section className="panel"><h2>{t('งบของ provider และโมเดล','Provider and model budget')}</h2>
      <p>{t('ค่าจากผู้ให้บริการ ตัวนับจริง ค่าประมาณ ขอบบน และค่าที่ยังไม่ทราบ แสดงแยกกัน ค่าใช้จ่ายจะไม่ถูกเดาขึ้น','Provider usage, exact tokenizer counts, estimates, upper bounds and unknown values remain distinct. Pricing is never inferred.')}</p>
      <form onSubmit={e=>{e.preventDefault();act('policy',{route,budget:{contextWindow:Number(windowSize),outputReserve:Number(output),safetyReserve:Number(safety),...(inputLimit?{maxInputTokens:Number(inputLimit)}:{})},expectedVersion:policy?.version??0,source:{kind:'configured',reference:source,observedAt:new Date().toISOString()}},()=>void refresh(),{write:true});}}>
        <div className="form-grid"><Field label={t('Provider instance ID','Provider instance ID')}><input required maxLength={200} value={providerId} onChange={e=>setProvider(e.target.value)}/></Field><Field label={t('Model ID แบบตรงตัว','Exact model ID')}><input required maxLength={200} value={modelId} onChange={e=>setModel(e.target.value)}/></Field>
          {[[t('ขนาด context window','Context window'),windowSize,setWindow,256],[t('สำรอง output tokens','Output reserve'),output,setOutput,0],[t('สำรองเผื่อ envelope','Safety reserve'),safety,setSafety,0],[t('เพดาน input (เว้นว่าง = ที่เหลือ)','Input cap (blank = remainder)'),inputLimit,setInput,1]].map(([label,value,set,min],i)=><Field key={i} label={label}><input type="number" min={min} max={100000000} step={1} required={i!==3} value={value} onChange={e=>set(e.target.value)}/></Field>)}
        </div><Field label={t('ที่มาของขนาดบริบท / หมายเหตุการตั้งค่า','Capacity source / configuration note')}><input required maxLength={2000} value={source} onChange={e=>setSource(e.target.value)}/></Field>
        <button disabled={disabled||!!pending}>{t('บันทึกงบสำหรับเส้นทางนี้','Save route budget')}</button>{policy&&<button type="button" disabled={disabled} onClick={usePolicy}>{t('โหลดค่าที่บันทึกไว้','Load saved values')}</button>}
      </form>{policy?<Json value={{version:policy.version,budget:policy.budget,source:policy.source}}/>:<Empty>{t('ยังไม่ได้ตั้งงบสำหรับเส้นทางนี้','No configured budget for this route.')}</Empty>}
    </section>
    <section className="panel"><h2>{t('ตรวจบริบทก่อนส่ง','Preview context')}</h2><p>{t('การ preview ไม่เรียกโมเดล ข้อมูลที่กรอกและความจำเป็น DATA และไม่อนุมัติงานหรือเปลี่ยนสิทธิ์','Preview makes no model call. Entered content and memory are DATA and confer no approval or permissions.')}</p>
      <form onSubmit={e=>{e.preventDefault();act('compose',{route,...(taskId?{taskId}:{}),items:content?[{id:'preview-data',kind:'data',text:content,sourceRefs:[]}]:[],...(memory?{memory:{scope:{projectId,kind:'project',id:projectId},query,limit:12,maxCharacters:16000}}:{})},result=>{setSelected(result.contextId);setContext(result);void refresh();},{write:true});}}>
        <Field label={t('งานที่อ้างอิง','Referenced task')}><select value={taskId} onChange={e=>setTask(e.target.value)}><option value="">{t('ไม่ระบุ','None')}</option>{state?.tasks?.filter(x=>x.projectId===projectId).map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
        <Field label={t('ข้อมูลสำหรับ preview','Preview data')}><textarea maxLength={500000} value={content} onChange={e=>setContent(e.target.value)}/></Field>
        <label><input type="checkbox" checked={memory} onChange={e=>setMemory(e.target.checked)}/>{t('ดึงความจำที่ได้รับสิทธิ์ของโปรเจกต์','Retrieve authorized project memory')}</label>
        {memory&&<Field label={t('คำค้นความจำ TH/EN','Memory query TH/EN')}><input maxLength={2000} value={query} onChange={e=>setQuery(e.target.value)}/></Field>}
        <div className="actions"><button disabled={disabled||!!pending||!policy}>{t('สร้างบริบทพร้อมใบรับรอง','Compose with receipt')}</button></div>
      </form>
      <Field label={t('เวอร์ชันบริบท','Context version')}><select value={selected} onChange={e=>{setSelected(e.target.value);setContext(null);}}><option value="">{t('เลือกเวอร์ชัน','Choose version')}</option>{data?.versions?.map(v=><option key={v.id} value={v.id}>v{v.version} · {v.route.modelId} · {v.id}</option>)}</select></Field>
      <div className="actions"><button disabled={disabled||!selected} onClick={()=>act('resolve',{contextId:selected,evidence:true},setContext)}>{t('อ่านบริบทและหลักฐาน','Resolve with evidence')}</button><button disabled={disabled||!!pending||!selected} onClick={()=>act('compact',{contextId:selected},result=>{setSelected(result.contextId);setContext(result);void refresh();},{write:true})}>{t('ย่อข้อมูลที่อนุญาต','Compact permitted content')}</button><button disabled={disabled||!!pending||!selected} onClick={()=>act('usage',{contextId:selected},setUsage)}>{t('ดูการนับและ usage','Inspect accounting & usage')}</button></div>
      {context&&<><p role="status">{context.accounting.status} · {context.accounting.tokens??t('ไม่ทราบ','unknown')} tokens · {context.accounting.bytes} bytes · {context.pressure}</p><p>{t('ประวัติภายใน native harness อยู่ภายใต้ harness และจำนวนโทเคนยังไม่ทราบ','The native harness owns its internal history; its token count is unknown.')}</p><details><summary>{t('บริบทที่ส่งจริง','Resolved prefix')}</summary><pre className="code">{context.message}</pre></details><Json value={{accounting:context.accounting,receipt:context.receipt,omitted:context.omitted,evidenceRefs:context.evidenceRefs,memoryRefs:context.memoryRefs,capabilities:context.capabilities}}/></>}
      {usage&&<Json value={usage}/>}
    </section>
    <section className="panel"><h2>{t('ผลเครื่องมือที่จัดเก็บภายนอกบริบท','Stored tool output')}</h2>
      <Field label={t('Retrieval handle ที่มีขอบเขต','Scoped retrieval handle')}><select value={handle} onChange={e=>{setHandle(e.target.value);setPage(null);}}><option value="">{t('เลือกผลเครื่องมือ','Choose output')}</option>{spills.map(s=><option key={s.handle} value={s.handle}>{s.revoked?'revoked · ':''}{s.bytes} bytes · {s.handle}</option>)}</select></Field>
      {spill&&<><Json value={{scope:spill.scope,sha256:spill.sha256,source:spill.source}}/><div className="actions"><button disabled={disabled||spill.revoked} onClick={()=>act('retrieve',{scope:spill.scope,handle,offset:0,limit:32768},setPage)}>{t('อ่านหน้าแรกและตรวจ hash','Read first page & verify hash')}</button><button disabled={disabled||spill.revoked||page?.nextOffset==null} onClick={()=>act('retrieve',{scope:spill.scope,handle,offset:page.nextOffset,limit:32768},setPage)}>{t('หน้าถัดไป','Next page')}</button><button disabled={disabled||!!pending||spill.revoked} onClick={()=>act('revoke',{scope:spill.scope,handle},()=>{setPage(null);void refresh();},{write:true})}>{t('ถอนสิทธิ์และลบ bytes','Revoke & delete bytes')}</button></div></>}
      {page&&<><p>{t('ข้อมูลที่ไม่ใช่คำสั่ง','Untrusted DATA')} · hash {page.hashVerified?'verified':'unknown'} · {page.offset}–{page.offset+page.pageBytes} / {page.totalBytes} bytes</p><pre className="code">{page.text}</pre></>}
      {!spills.length&&<Empty>{t('ยังไม่มีผลเครื่องมือที่เก็บไว้','No stored tool outputs.')}</Empty>}
    </section>
  </>;
}
