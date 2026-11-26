import React,{useState,useEffect,useRef} from 'react';
import {request,operationId,scoped} from './api.mjs';
import {Heading,Field,Badge,Empty,Json} from './ui.jsx';

const defaultPolicy=()=>({mode:'manual',maxAttempts:8,maxAttemptsPerTask:3,maxMs:300000,maxUnchangedFailures:2,tokens:{unknown:'block',maxTotal:null},reportedCost:{unknown:'block',maxAmount:null,currency:null}});
export default function Goals({t,state,projectId,run,busy}) {
  const [data,setData]=useState(null),[goalId,setGoal]=useState(''),[localBusy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(null);
  const [objective,setObjective]=useState(''),[planId,setPlan]=useState(''),[criteria,setCriteria]=useState([]),[policy,setPolicy]=useState(defaultPolicy),[base,setBase]=useState(null),[taskId,setTask]=useState(''),[reason,setReason]=useState('');
  const generation=useRef(0),locked=useRef(null);
  const goals=data?.goals??[],goal=goals.find(g=>g.id===goalId),disabled=busy||localBusy;
  const tasks=scoped(state,'tasks',projectId),plans=scoped(state,'plans',projectId).filter(p=>p.approved===true);
  async function refresh(){
    const n=generation.current;
    try{const result=await request('/api/goals/state',{projectId});if(n===generation.current)setData(result);return result;}
    catch(e){if(n===generation.current)setError(`${e.code??'ERROR'}: ${e.message}`);throw e;}
  }
  useEffect(()=>{generation.current++;locked.current=null;setBusy(false);setData(null);setGoal('');setBase(null);setPlan('');setCriteria([]);setObjective('');setPolicy(defaultPolicy());setUncertain(null);setError('');setTask('');if(projectId)refresh().catch(()=>{});return()=>{generation.current++;};},[projectId]);
  async function act(method,body={}){
    if(locked.current)return;const op=operationId();locked.current=op;setBusy(true);setError('');
    const n=generation.current;
    try{
      return await run(async()=>{
        try{
          const input={projectId,operationId:op,...(method==='create'?{}:{goalId,expectedRevision:method==='revise'?base.revision:goal.revision}),...body};
          const result=await request(`/api/goals/${method}`,input);
          if(n===generation.current){setGoal(result.id);setUncertain(null);if(method==='revise'||method==='create')setBase(null);await refresh();}return result;
        }catch(e){if(n===generation.current){setError(`${e.code??'ERROR'}: ${e.message}`);if(e.code==='CONNECTION_LOST'||e.status===0)setUncertain({method,operationId:op});}throw e;}
      });
    }finally{if(locked.current===op)locked.current=null;if(n===generation.current)setBusy(false);}
  }
  const safely=(method,body)=>{act(method,body).catch(()=>{});};
  function edit(g){
    setBase({id:g.id,revision:g.revision});setObjective(g.objective);setPlan(g.planId);setCriteria(structuredClone(g.criteria));setPolicy(structuredClone(g.policy));
  }
  function selectTask(id,checked){
    setCriteria(c=>checked?[...c,{id:crypto.randomUUID(),taskId:id,description:tasks.find(x=>x.id===id)?.title??'',kind:'artifactHash',sha256:''}]:c.filter(x=>x.taskId!==id));
  }
  const patchCriterion=(id,patch)=>setCriteria(c=>c.map(x=>x.id===id?{...x,...patch}:x));
  const definition={planId,objective,taskIds:[...new Set(criteria.map(c=>c.taskId))],criteria,policy};
  return <>
    <Heading title={t('เป้าหมายและเกณฑ์ว่างานเสร็จ','Goals and acceptance')} description={t('ทำงานตามแผนที่อนุมัติ ตรวจหลักฐานจริง และหยุดตามขอบเขตที่กำหนด','Continue approved plans with actual evidence and bounded stopping conditions.')}>
      <button type="button" disabled={disabled||!projectId} onClick={()=>refresh().catch(()=>{})}>{t('โหลดข้อมูลล่าสุด','Refresh')}</button>
    </Heading>
    {error&&<p role="alert">{error}</p>}
    {uncertain&&<p role="status">{t('ผลคำสั่งยังไม่แน่นอน โหลดข้อมูลล่าสุดและตรวจสอบก่อนดำเนินต่อ','Command outcome is uncertain. Refresh and reconcile before continuing.')} {uncertain.method} · {uncertain.operationId}</p>}
    {data&&!data.capabilities.executionSupported&&<p role="status">{t('ยังส่งงานไม่ได้ ต้องใช้ T3 ที่รองรับข้อมูลเป้าหมายเวอร์ชัน 1','Dispatch unavailable: T3 must support goal context version 1.')}</p>}
    <p className="help">{t('ใช้แผนและงานเดิม ระบบให้ใช้โฟลเดอร์งานได้ทีละงาน การจองไม่ได้สร้างพื้นที่ปลอดภัยหรือสำเนาโค้ดแยกให้','Uses existing plans and tasks. Workspace checkout is serial; it does not create a sandbox or isolated worktree.')}</p>
    <section className="panel"><h2>{t('เป้าหมายที่บันทึกไว้','Saved goals')}</h2>
      {!goals.length&&<Empty>{t('ยังไม่มีเป้าหมาย เลือกงานจากแผนที่อนุมัติด้านล่าง','No goals yet. Select tasks from an approved plan below.')}</Empty>}
      <Field label={t('เลือกเป้าหมาย','Choose goal')}><select value={goalId} onChange={e=>{setGoal(e.target.value);setBase(null);setTask('');}}><option value="">{t('เลือกเป้าหมาย','Choose goal')}</option>{goals.map(g=><option key={g.id} value={g.id}>{g.objective} · {g.status}</option>)}</select></Field>
      {goal&&<>
        <h3>{goal.objective}</h3><Badge>{goal.status}</Badge><p>{t('ฉบับเป้าหมาย','Goal revision')} {goal.goalRevision} · {t('ผ่านเกณฑ์','Criteria passed')} {goal.progress.passed}/{goal.progress.total}</p>
        {goal.blocker&&<p role="status">{goal.blocker.code}</p>}
        <div className="actions">
          {['paused','blocked'].includes(goal.status)&&<button disabled={disabled||!!uncertain} onClick={()=>safely('resume')}>{t('เริ่มทำงานต่อ','Start / resume')}</button>}
          <button disabled={disabled||!!uncertain||goal.status!=='active'||!data.capabilities.executionSupported} onClick={()=>safely('advance')}>{t('ทำงานที่พร้อมครั้งถัดไป','Run next ready task')}</button>
          <button disabled={disabled||['completed','cancelled','exhausted'].includes(goal.status)} onClick={()=>safely('pause')}>{t('พักเป้าหมายและหยุดงานในเป้าหมายนี้','Pause and stop owned work')}</button>
          <button disabled={disabled||['completed','cancelled','exhausted'].includes(goal.status)} onClick={()=>safely('cancel')}>{t('ยกเลิกเป้าหมาย','Cancel goal')}</button>
          <button disabled={disabled} onClick={()=>safely('reconcile')}>{t('ตรวจผลกับ T3','Reconcile with T3')}</button>
          <button disabled={disabled||!!uncertain||['completed','cancelled','exhausted'].includes(goal.status)} onClick={()=>edit(goal)}>{t('แก้เป็นฉบับใหม่','Edit as new revision')}</button>
        </div>
        {goal.taskIds.map(id=>{
          const task=tasks.find(x=>x.id===id),verification=goal.verifications[id],qa=goal.qa[id];
          return <div key={id}><h3>{task?.title??id}</h3><p>{task?.status} {goal.blockers[id]?.code??''} {goal.blockers[id]?.reason??''}</p>
            {verification&&!qa&&<button disabled={disabled||!!uncertain} onClick={()=>safely('qa',{taskId:id})}>{t('ตรวจคุณภาพโดยผู้ตรวจที่ไม่ได้ลงมือทำงาน','QA review independent of executor')}</button>}
            {qa&&<p>{t('บันทึกผลตรวจคุณภาพแล้ว','QA recorded')} · {qa}</p>}
          </div>;
        })}
        {goal.status==='awaiting_owner'&&<button className="primary" disabled={disabled||!!uncertain} onClick={()=>safely('review')}>{t('ยืนยันรับงานขั้นสุดท้ายโดยเจ้าของ','Owner final acceptance')}</button>}
        <p className="help">{t('การตรวจคุณภาพและการรับงานโดยเจ้าของเป็นคนละขั้นตอน คนเดียวทำทั้งสองขั้นได้หากไม่ได้เป็นผู้ลงมือทำงานระบบจะยืนยันตัวตนและตรวจหลักฐานซ้ำ','QA and Owner acceptance are separate actions. The same human may perform both when independent of the executor. The server authenticates review and rechecks evidence.')}</p>
        <details><summary>{t('บันทึกผล ความคืบหน้า และการใช้ทรัพยากร','Attempts, progress and observed usage')}</summary><Json value={{attempts:goal.attempts,usage:goal.usage,policy:goal.policy,blockers:goal.blockers,deadlineAt:goal.deadlineAt,review:goal.review}}/></details>
        <form onSubmit={e=>{e.preventDefault();safely('blockTask',{taskId,reason});}}>
          <Field label={t('งานที่มีอุปสรรค','Blocked task')}><select required value={taskId} onChange={e=>setTask(e.target.value)}><option value="">{t('เลือกงาน','Choose task')}</option>{goal.taskIds.map(id=><option key={id} value={id}>{tasks.find(x=>x.id===id)?.title??id}</option>)}</select></Field>
          <Field label={t('เหตุผลที่ทำต่อไม่ได้','Concrete blocker')}><textarea required maxLength={4000} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
          <button disabled={disabled||!!uncertain||!taskId||!reason.trim()}>{t('บันทึกอุปสรรค','Record blocker')}</button>
        </form>
      </>}
    </section>
    <section className="panel"><h2>{base?t('แก้ไขฉบับเป้าหมาย','Revise goal'):t('สร้างเป้าหมายจากแผนเดิม','Create goal from an existing plan')}</h2>
      {base&&<p>{t('แก้ไขจากฉบับ','Editing record revision')} {base.revision} <button type="button" onClick={()=>setBase(null)}>{t('ยกเลิกการแก้ไข','Discard revision draft')}</button></p>}
      <form onSubmit={e=>{e.preventDefault();safely(base?'revise':'create',definition);}}>
        <Field label={t('เป้าหมาย','Objective')}><textarea required maxLength={4000} value={objective} onChange={e=>setObjective(e.target.value)}/></Field>
        <Field label={t('แผนที่อนุมัติแล้ว','Approved plan')}><select required value={planId} onChange={e=>{setPlan(e.target.value);setCriteria([]);}}><option value="">{t('เลือกแผน','Choose plan')}</option>{plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        {!plans.length&&<p>{t('สร้างและอนุมัติแผนในหน้าแผนก่อน','Create and approve a plan in Plans first.')}</p>}
        <fieldset><legend>{t('งานและเกณฑ์ที่วัดผลได้','Tasks and measurable criteria')}</legend>
          {tasks.filter(x=>x.planId===planId).map(task=>{const c=criteria.find(c=>c.taskId===task.id);return <div key={task.id}>
            <label><input type="checkbox" checked={!!c} onChange={e=>selectTask(task.id,e.target.checked)}/> {task.title}</label>
            {c&&<>
              <Field label={t('คำอธิบายเกณฑ์','Criterion description')}><input required maxLength={2000} value={c.description} onChange={e=>patchCriterion(c.id,{description:e.target.value})}/></Field>
              <Field label={t('วิธีตรวจ','Evidence check')}><select value={c.kind} onChange={e=>setCriteria(items=>items.map(x=>x.id!==c.id?x:{id:x.id,taskId:x.taskId,description:x.description,kind:e.target.value,...(e.target.value==='artifactHash'?{sha256:''}:{verifier:{id:'',version:''}})}))}><option value="artifactHash">{t('รหัสตรวจไฟล์ SHA-256 ของไฟล์จริง','Actual file SHA-256')}</option><option value="verifierReceipt">{t('ผลจากตัวตรวจสอบที่เชื่อถือได้','Trusted verifier receipt')}</option></select></Field>
              {c.kind==='artifactHash'?<Field label={t('รหัสตรวจไฟล์ SHA-256 ที่ต้องตรงกัน (กำหนดก่อนเริ่มงาน)','Expected SHA-256 (fixed before execution)')}><input required pattern="[a-f0-9]{64}" maxLength={64} value={c.sha256} onChange={e=>patchCriterion(c.id,{sha256:e.target.value})}/></Field>:<div className="form-grid"><Field label={t('รหัสตัวตรวจสอบ','Verifier ID')}><input required value={c.verifier.id} onChange={e=>patchCriterion(c.id,{verifier:{...c.verifier,id:e.target.value}})}/></Field><Field label={t('เวอร์ชันตัวตรวจสอบ','Verifier version')}><input required value={c.verifier.version} onChange={e=>patchCriterion(c.id,{verifier:{...c.verifier,version:e.target.value}})}/></Field></div>}
            </>}
          </div>;})}
        </fieldset>
        <Field label={t('นโยบายทำงานต่อ','Continuation policy')}><select value={policy.mode} onChange={e=>setPolicy(p=>({...p,mode:e.target.value}))}><option value="manual">{t('ทีละขั้นตอน','Manual steps')}</option><option value="bounded-auto">{t('ทำต่ออัตโนมัติภายในขอบเขต','Bounded automatic continuation')}</option></select></Field>
        <div className="form-grid">{[['maxAttempts',t('จำนวนครั้งรวมสูงสุด','Total attempt limit'),64],['maxAttemptsPerTask',t('จำนวนครั้งต่องาน','Attempts per task'),8],['maxUnchangedFailures',t('หยุดเมื่อผิดซ้ำไม่เปลี่ยน','Unchanged failure limit'),8],['maxMs',t('เวลารวมสูงสุด (มิลลิวินาที)','Elapsed limit (milliseconds)'),3600000]].map(([key,label,max])=><Field key={key} label={label}><input required type="number" min={1} max={max} value={policy[key]} onChange={e=>setPolicy(p=>({...p,[key]:Number(e.target.value)}))}/></Field>)}</div>
        <div className="form-grid"><Field label={t('เพดานโทเคนที่รายงาน (ว่าง = ไม่มี)','Reported token cap (blank = none)')}><input type="number" min={1} value={policy.tokens.maxTotal??''} onChange={e=>setPolicy(p=>({...p,tokens:{...p.tokens,maxTotal:e.target.value===''?null:Number(e.target.value)}}))}/></Field>
          <Field label={t('เมื่อไม่ทราบโทเคน','Unknown token usage')}><select value={policy.tokens.unknown} onChange={e=>setPolicy(p=>({...p,tokens:{...p.tokens,unknown:e.target.value}}))}><option value="block">{t('หยุดรอตรวจสอบ','Block continuation')}</option><option value="allow">{t('อนุญาตโดยยังแสดงว่าไม่ทราบ','Allow and retain unknown')}</option></select></Field>
          <Field label={t('เพดานค่าใช้จ่ายที่รายงาน','Reported spending cap')}><input type="number" min={0.000001} step="any" value={policy.reportedCost.maxAmount??''} onChange={e=>setPolicy(p=>({...p,reportedCost:{...p.reportedCost,maxAmount:e.target.value===''?null:Number(e.target.value)}}))}/></Field>
          <Field label={t('สกุลเงินตามรายงาน','Exact reported currency')}><input required={policy.reportedCost.maxAmount!==null} maxLength={20} value={policy.reportedCost.currency??''} onChange={e=>setPolicy(p=>({...p,reportedCost:{...p.reportedCost,currency:e.target.value||null}}))}/></Field>
          <Field label={t('เมื่อไม่ทราบค่าใช้จ่าย','Unknown spending')}><select value={policy.reportedCost.unknown} onChange={e=>setPolicy(p=>({...p,reportedCost:{...p.reportedCost,unknown:e.target.value}}))}><option value="block">{t('หยุดรอตรวจสอบ','Block continuation')}</option><option value="allow">{t('อนุญาตโดยยังแสดงว่าไม่ทราบ','Allow and retain unknown')}</option></select></Field></div>
        <p className="help">{t('ตรวจเพดานจากข้อมูลที่รายงานก่อนเริ่มครั้งถัดไป ค่าใช้จ่ายอาจยังไม่ครบ ไม่มีการประมาณราคา/แปลงสกุลเงิน การแก้ไขไม่ล้างจำนวนครั้งหรือยืดเวลาเดิม','Caps use reported observations before the next attempt. Spending can be incomplete; no prices or currency conversion are invented. Revisions retain attempts and the original deadline.')}</p>
        <button className="primary" disabled={disabled||!!uncertain||!criteria.length||!planId||!objective.trim()}>{base?t('บันทึกฉบับใหม่โดยเจ้าของ','Save Owner revision'):t('บันทึกเป้าหมาย (ยังไม่เริ่มงาน)','Save paused goal')}</button>
      </form>
    </section>
  </>;
}
