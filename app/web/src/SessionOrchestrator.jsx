import React,{useEffect,useRef,useState} from 'react';
import {GitBranch} from 'lucide-react';
import {request,operationId,scoped} from './api.mjs';
import {Field,Empty,Badge} from './ui.jsx';
import './session-orchestrator.css';

export default function SessionOrchestrator(props){return <SessionStart key={props.projectId} {...props}/>;}
function SessionStart({state,projectId,t,run,busy,renderRun}){
  const [taskId,setTask]=useState(''),[parentId,setParent]=useState(''),[children,setChildren]=useState([]),[error,setError]=useState(''),[result,setResult]=useState(null),[pending,setPending]=useState(null),[working,setWorking]=useState(false);
  const lock=useRef(false),generation=useRef(0),key=`forge.orchestrator-start.${projectId}`;
  useEffect(()=>{try{setPending(JSON.parse(sessionStorage.getItem(key)||'null'));}catch{}return()=>{generation.current++;};},[key]);
  const remember=value=>{setPending(value);try{if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{}};
  const bots=scoped(state,'bots',projectId),rooms=scoped(state,'conversations',projectId),events=scoped(state,'events',projectId);
  const assignments=events.filter(e=>e.type==='session-role.assignment').filter((a,i,all)=>!all.slice(i+1).some(b=>a.conversationId===b.conversationId&&a.botId===b.botId));
  const tasks=scoped(state,'tasks',projectId).filter(task=>['ready','backlog'].includes(task.status)&&state.plans.some(p=>p.id===task.planId&&p.approved)&&assignments.some(a=>a.role==='orchestrator'&&a.botId===task.botId));
  const task=tasks.find(x=>x.id===taskId),parents=assignments.filter(a=>a.role==='orchestrator'&&a.botId===task?.botId),parent=parents.find(a=>a.id===parentId);
  const options=assignments.filter(a=>a.conversationId!==parent?.conversationId&&rooms.find(c=>c.id===a.conversationId)?.bindings?.[a.botId]);
  const label=a=>`${rooms.find(c=>c.id===a.conversationId)?.name??a.conversationId} · ${bots.find(b=>b.id===a.botId)?.name??a.botId} · ${a.role}`;
  async function start(retry=false){
    if(lock.current)return;const n=generation.current;lock.current=true;setWorking(true);setError('');
    const input=retry?pending:{create:{projectId,taskId,conversationId:parent?.conversationId,children:options.filter(a=>children.includes(a.id)).map(a=>({conversationId:a.conversationId,botId:a.botId})),operationId:operationId(),maxMs:300000}};
    remember(input);
    let retainedIntent=input.intent;
    try{await run(async()=>{try{
      const intent=input.intent??await request('/api/session-orchestrator/intent',input.create);
      retainedIntent=intent;
      const retained={...input,intent};if(n!==generation.current)return;remember(retained);
      const value=await request('/api/session-orchestrator/start',{projectId,intentId:intent.intentId,operationId:intent.operationId});
      if(n===generation.current){setResult(value);remember(null);}return value;
    }catch(e){if(n===generation.current){setError(`${e.code??'ERROR'}: ${e.message}`);if(!retainedIntent&&e.status>=400&&e.status<500)remember(null);}throw e;}});}catch{}finally{lock.current=false;if(n===generation.current)setWorking(false);}
  }
  async function revoke(){if(lock.current||!pending?.intent)return;lock.current=true;setWorking(true);setError('');const n=generation.current,intent=pending.intent;try{await run(async()=>{try{const value=await request('/api/session-orchestrator/cancel',{projectId,intentId:intent.intentId,operationId:intent.operationId});if(n===generation.current){remember(null);setResult(value);}return value;}catch(e){if(n===generation.current)setError(`${e.code??'ERROR'}: ${e.message}`);throw e;}});}catch{}finally{lock.current=false;if(n===generation.current)setWorking(false);}}
  const parentRuns=scoped(state,'runs',projectId).filter(r=>r.sessionContext).slice(-5).reverse();
  return <details className="session-orchestrator panel"><summary><GitBranch size={18} aria-hidden="true"/>{t('เริ่ม Orchestrator พร้อมเซสชันย่อย','Start an orchestrator with child sessions')}</summary>
    <p className="help">{t('ใช้ task ที่มีแผนอนุมัติและบอทที่กำหนดบทบาท Orchestrator ไว้ก่อนเริ่ม เลือกเซสชันย่อยที่เชื่อม T3 แล้ว การอนุมัตินี้ผูกกับ attempt ใหม่เท่านั้น','Use an approved-plan task whose bot already has the Orchestrator session role. Select children with existing T3 bindings. This approval applies only to the new attempt.')}</p>
    {!tasks.length?<Empty>{t('กำหนดบทบาท Orchestrator และเตรียม task ที่พร้อมก่อน','Assign an Orchestrator role and prepare a ready task first.')}</Empty>:<form onSubmit={e=>{e.preventDefault();start();}}>
      <div className="form-grid"><Field label={t('Task ที่อนุมัติ','Approved task')}><select required disabled={busy||working||!!pending} value={taskId} onChange={e=>{setTask(e.target.value);setParent('');setChildren([]);}}><option value="">{t('เลือก task','Choose task')}</option>{tasks.map(task=><option key={task.id} value={task.id}>{task.title}</option>)}</select></Field>
      <Field label={t('เซสชัน Orchestrator','Orchestrator session')}><select required disabled={busy||working||!!pending} value={parentId} onChange={e=>{setParent(e.target.value);setChildren([]);}}><option value="">{t('เลือกเซสชัน','Choose session')}</option>{parents.map(a=><option key={a.id} value={a.id}>{label(a)}</option>)}</select></Field></div>
      <fieldset disabled={busy||working||!!pending||!parent}><legend>{t('เซสชันย่อยที่อนุมัติ','Approved child sessions')}</legend>{!options.length&&<p>{t('เปิดแชตของบอทย่อยผ่าน provider และกำหนดบทบาทก่อน','Open a provider-backed child chat and assign its role first.')}</p>}{options.map(a=><label className="check session-child" key={a.id}><input type="checkbox" checked={children.includes(a.id)} onChange={e=>setChildren(e.target.checked?[...children,a.id]:children.filter(id=>id!==a.id))}/><span>{label(a)}</span></label>)}</fieldset>
      <p className="help">{t('Orchestrator นี้มีเฉพาะเครื่องมือดูและส่งคำสั่งให้เซสชันย่อย ไม่มีเครื่องมือไฟล์ ใช้บัญชีโมเดลที่เลือกและขอบเขตเวลา 5 นาทีรวมการเตรียม runtime','This orchestrator has only child-list and child-prompt tools, with no file tools. It uses the selected model account and an absolute five-minute envelope including runtime preparation.')}</p>
      <button className="primary" disabled={busy||working||!!pending||!parent||!children.length}>{t('อนุมัติและเริ่ม attempt ใหม่','Approve and start new attempt')}</button>
    </form>}
    {pending&&<p role="status">{t('เก็บคำขอเดิมไว้แล้ว หากขาดการเชื่อมต่อให้ตรวจผลเดิม ห้ามส่งเป็นคำสั่งใหม่','The original request is retained. After connection loss, inspect that request; do not issue a new operation.')} <button type="button" disabled={busy||working} onClick={()=>start(true)}>{t('ตรวจคำขอเดิม','Check retained request')}</button>{pending.intent&&<button type="button" disabled={busy||working} onClick={revoke}>{t('ยกเลิกสิทธิ์คำขอเดิม','Revoke retained approval')}</button>}</p>}
    {error&&<p role="alert">{error}</p>}{result&&<p role="status"><Badge>{result.status}</Badge> {t('งาน','Run')}: {result.runId??t('ยังไม่ยืนยัน','Unconfirmed')}</p>}
    {parentRuns.length>0&&<section aria-label={t('Attempts ของ Orchestrator','Orchestrator attempts')}><h3>{t('Attempts ของ Orchestrator','Orchestrator attempts')}</h3><p className="help">{t('Stop หยุด parent และปิดการส่งคำสั่งใหม่ งานย่อยที่รับไปแล้วมีปุ่ม Stop ของตัวเองในรายการคำสั่ง','Stop halts the parent and prevents new prompts. Accepted child attempts retain their own Stop control in the command list.')}</p>{parentRuns.map(r=><React.Fragment key={r.id}>{renderRun?renderRun(r):<p>{r.id} · {r.status}</p>}</React.Fragment>)}</section>}
  </details>;
}
