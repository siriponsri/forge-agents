import React,{useEffect,useRef,useState} from 'react';
import {request,operationId,scoped} from './api.mjs';
import {Heading,Field,Badge,Empty} from './ui.jsx';
import './parallel-workspace.css';

export default function ParallelWorkspace({t,state,projectId,run,busy}){
  const [data,setData]=useState(null),[selected,setSelected]=useState(''),[taskId,setTask]=useState(''),[error,setError]=useState(''),[uncertain,setUncertain]=useState(null),[localBusy,setBusy]=useState(false);
  const [capacity,setCapacity]=useState(1),[providerLimit,setProviderLimit]=useState(1),[nodeTests,setNodeTests]=useState(true),[policyBase,setPolicyBase]=useState(0),[stopping,setStopping]=useState(false);
  const generation=useRef(0),locked=useRef(false),project=useRef(projectId);project.current=projectId;
  const disabled=busy||localBusy,tasks=scoped(state,'tasks',projectId),workspaces=data?.projectId===projectId?data.workspaces:[],integrations=data?.projectId===projectId?data.integrations:[],w=workspaces?.find(x=>x.id===selected),q=integrations?.find(x=>x.workspaceId===w?.id),checks=data?.checks??[];
  function hydratePolicy(x){setCapacity(x.policy?.maxConcurrent??1);setProviderLimit(x.policy?.providerLimit??1);setNodeTests(x.policy?.checks.includes('node-test')??true);setPolicyBase(x.policy?.revision??0);}
  async function refresh(hydrate=false){const n=generation.current,p=projectId;try{await request('/api/session');const value=await request(`/api/workspaces/state?projectId=${encodeURIComponent(p)}`);if(n===generation.current&&p===project.current){setData(old=>old?.projectId===p&&old.stateRevision>value.stateRevision?old:value);if(hydrate)hydratePolicy(value);}return value;}catch(e){if(n===generation.current)setError(`${e.code??'ERROR'}: ${e.message}`);throw e;}}
  useEffect(()=>{generation.current++;locked.current=false;setData(null);setSelected('');setTask('');setError('');setUncertain(null);setBusy(false);setStopping(false);setCapacity(1);setProviderLimit(1);setNodeTests(true);setPolicyBase(0);if(projectId)refresh(true).catch(()=>{});return()=>{generation.current++;};},[projectId]);
  useEffect(()=>{if(projectId&&data?.projectId===projectId)refresh().catch(()=>{});},[state?.revision]);
  async function act(method,body={}){
    if(locked.current)return;const n=generation.current,op=operationId();locked.current=op;setBusy(true);setError('');
    try{await run(async()=>{try{
      const result=await request(`/api/workspaces/${method}`,{projectId,operationId:op,...body});
      if(n===generation.current){if(method==='create')setSelected(result.id);if(method==='configure')setPolicyBase(result.revision);setUncertain(null);await refresh();}return result;
    }catch(e){if(n===generation.current){setError(`${e.code??'ERROR'}: ${e.message}`);if(e.code==='CONNECTION_LOST'||e.status===0)setUncertain({method,operationId:op});}throw e;}});}
    catch{/* Shared run() and the local alert expose the error. */}
    finally{if(n===generation.current){locked.current=false;setBusy(false);}}
  }
  const workspaceAction=(method,extra={})=>act(method,{workspaceId:w.id,expectedRevision:w.revision,...extra});
  async function stopOwned(){
    if(stopping)return;const n=generation.current,op=operationId();setStopping(true);
    try{await run(async()=>{try{const result=await request('/api/workspaces/stop',{projectId,operationId:op,workspaceId:w.id,expectedRevision:w.revision});if(n===generation.current)await refresh();return result;}catch(e){if(n===generation.current){setError(`${e.code??'ERROR'}: ${e.message}`);if(e.status===0)setUncertain({method:'stop',operationId:op});}throw e;}});}catch{}finally{if(n===generation.current)setStopping(false);}
  }
  const queueAction=(method,extra={})=>act(method,{integrationId:q.id,expectedRevision:q.revision,...extra});
  const readyTasks=tasks.filter(task=>['ready','backlog','blocked'].includes(task.status)&&scoped(state,'plans',projectId).some(p=>p.id===task.planId&&p.approved));
  const targetHead=integrations?.filter(x=>x.status==='integrated').at(-1)?.integratedHead??q?.sourceHeadSha;
  const check=w&&checks.find(x=>x.id===w.checkId),mutationDisabled=disabled||!!uncertain;
  return <div className="parallel-workspace">
    <Heading title={t('พื้นที่ทำงานคู่ขนาน','Parallel workspaces')} description={t('แยกไฟล์จริง ทำงานจากแผนเดียวกัน และรวมผลเมื่อผ่านการตรวจ','Separate actual files, follow one canonical plan, and review the combined result.')}>
      <button disabled={!projectId} onClick={()=>refresh(true).catch(()=>{})}>{t('โหลดสถานะ','Refresh')}</button>
    </Heading>
    {error&&<p role="alert">{error}</p>}
    {uncertain&&<p role="status">{t('ผลคำสั่งยังไม่แน่นอน ตรวจสถานะและกระทบยอดก่อนเริ่มงานใหม่','Command outcome is uncertain. Refresh and reconcile before starting more work.')} {uncertain.operationId}</p>}
    <p className="help">{t('Worktree แยกไฟล์และสาขา Git แต่ไม่ใช่ sandbox ของระบบปฏิบัติการ งานใช้สิทธิ์เครื่องมือเดิมและ T3 เป็นผู้รันเพียงรายเดียว','A Git worktree separates files and branches; it is not an OS sandbox. Existing tool permissions apply and T3 remains the sole executor.')}</p>
    {data&&!data.capabilities.executionSupported&&<p role="status">{t('ยังเริ่มรันไม่ได้: ต้องเชื่อมสัญญา worktree ของ T3 ให้ครบก่อน','Execution unavailable until the T3 worktree contract is fully wired.')}</p>}
    <section className="panel parallel-policy"><h2>{t('ขอบเขตที่ Owner กำหนด','Owner limits')}</h2>
      <form onSubmit={e=>{e.preventDefault();act('configure',{expectedRevision:policyBase,maxConcurrent:Number(capacity),providerLimit:Number(providerLimit),checks:nodeTests?['diff','node-test']:['diff']});}}>
        <div className="form-grid"><Field label={t('งานคู่ขนานสูงสุด','Maximum parallel attempts')}><input type="number" min="1" max="32" required value={capacity} onChange={e=>setCapacity(e.target.value)}/></Field>
          <Field label={t('เพดาน provider ที่ยอมให้ใช้','Provider attempt ceiling')}><input type="number" min="1" max="32" required value={providerLimit} onChange={e=>setProviderLimit(e.target.value)}/></Field></div>
        <label><input type="checkbox" checked={nodeTests} onChange={e=>setNodeTests(e.target.checked)}/>{t(' รันทดสอบ Node ของโปรเจกต์ (รวมการตรวจ diff ทุกครั้ง)',' Run project Node tests (diff check is always included)')}</label>
        <p className="help">{t('ตัวเลขนี้เป็นเพดานที่คุณอนุมัติ ไม่ใช่การยืนยันโควตาที่เหลือของ provider เริ่มต้นอย่างระมัดระวังที่ 1 งาน การทดสอบจะรันโค้ดในโปรเจกต์','These are ceilings you approve, not observed provider availability. The initial safe setting is one attempt. Tests execute project code.')}</p>
        <button disabled={mutationDisabled||!data}>{t('บันทึกขอบเขต','Save limits')}</button>
      </form>
    </section>
    <div className="parallel-layout"><section className="panel"><h2>{t('งานที่แยกพื้นที่ไว้','Isolated tasks')}</h2>
      <form onSubmit={e=>{e.preventDefault();const task=tasks.find(x=>x.id===taskId);act('create',{taskId,expectedTaskRevision:task.revision});}}>
        <Field label={t('เลือกงานจากแผนที่อนุมัติ','Task from an approved plan')}><select required value={taskId} onChange={e=>setTask(e.target.value)}><option value="">{t('เลือกงาน','Choose task')}</option>{readyTasks.map(task=><option key={task.id} value={task.id}>{task.title}</option>)}</select></Field>
        <button disabled={mutationDisabled||!taskId||!data?.policy}>{t('สร้างพื้นที่แยก','Create isolated workspace')}</button>
      </form>
      {!workspaces?.length&&<Empty>{t('สร้างพื้นที่แยกจากงานเดิม โดยคงไฟล์และสาขาเดิมไว้','Create a workspace from an existing task. Original files and branch are preserved.')}</Empty>}
      <ul className="parallel-list">{workspaces?.map(item=><li key={item.id}><button className={item.id===selected?'selected':''} aria-pressed={item.id===selected} onClick={()=>setSelected(item.id)}><span>{tasks.find(x=>x.id===item.taskId)?.title??item.taskId}</span><Badge>{item.status}</Badge></button></li>)}</ul>
    </section>
    <section className="panel parallel-detail"><h2>{t('ตรวจงานและรวมผล','Review and integrate')}</h2>
      {!w?<Empty>{t('เลือกพื้นที่ทำงานเพื่อดู run และหลักฐานจริง','Select a workspace to inspect its actual run and evidence.')}</Empty>:<>
        <h3>{tasks.find(x=>x.id===w.taskId)?.title??w.taskId}</h3><Badge>{w.status}</Badge>
        {w.error&&<p role="status">{w.error}</p>}
        <dl><dt>{t('โฟลเดอร์ที่แยกไว้','Isolated folder')}</dt><dd>{w.worktreePath}</dd><dt>{t('สาขา','Branch')}</dt><dd>{w.branch}</dd><dt>{t('ฐานที่ตรึงไว้','Immutable base')}</dt><dd>{w.baseSha}</dd><dt>{t('Run / attempt','Run / attempt')}</dt><dd>{w.runId??'—'} / {w.attemptId??'—'}</dd><dt>{t('ฉบับงาน / แผน','Task / plan revision')}</dt><dd>{w.taskRevision} / {w.planRevision}</dd></dl>
        <div className="actions">
          <button disabled={mutationDisabled||w.status!=='ready'||!data.capabilities.executionSupported} onClick={()=>workspaceAction('start')}>{t('เริ่มงานนี้','Start this task')}</button>
          <button disabled={disabled} onClick={()=>workspaceAction('reconcile')}>{t('กระทบยอดกับ T3','Reconcile with T3')}</button>
          <button disabled={stopping||!['ready','admitting','running','unknown','stopping'].includes(w.status)} onClick={stopOwned}>{t('หยุดเฉพาะงานนี้','Stop this attempt')}</button>
          <button disabled={mutationDisabled||!['review','approved'].includes(w.status)} onClick={()=>workspaceAction('check')}>{t('ตรวจไฟล์และรันทดสอบ','Check files and run tests')}</button>
          <button disabled={mutationDisabled||!check||check.status!=='passed'} onClick={()=>workspaceAction('review',{head:w.checkedHead})}>{t('Owner ตรวจรับ head นี้','Owner approve this head')}</button>
          <button disabled={mutationDisabled||w.status!=='approved'||!!q} onClick={()=>workspaceAction('enqueue',{head:w.checkedHead})}>{t('เข้าคิวรวมผล','Queue integration')}</button>
        </div>
        {check&&<details><summary>{t('หลักฐานการตรวจ','Verification evidence')} · {check.status}</summary><pre>{JSON.stringify(check,null,2)}</pre></details>}
        {q&&<div className="parallel-integration"><h3>{t('คิวรวมผล','Integration queue')} · {q.status}</h3>
          <p>{t('รวมบนสาขาแยก ไม่มีการ push อัตโนมัติ สาขาเดิมไม่ถูกเปลี่ยน','Merges into a separate branch with no automatic push. The original branch is preserved.')}</p>
          <dl><dt>{t('Head ที่เสนอ','Candidate head')}</dt><dd>{q.candidateHead}</dd><dt>{t('Head ปลายทาง','Target head')}</dt><dd>{q.targetHead??targetHead}</dd>{q.worktreePath&&<><dt>{t('พื้นที่รวมผล','Integration folder')}</dt><dd>{q.worktreePath}</dd></>}{q.integratedHead&&<><dt>{t('ผลรวมที่ตรวจแล้ว','Checked merged commit')}</dt><dd>{q.integratedHead}</dd></>}</dl>
          {q.error&&<p role="status">{q.error}</p>}
          {!!q.conflicts?.length&&<p role="status">{t('ไฟล์ขัดแย้งถูกเก็บไว้ในพื้นที่รวมผล ให้ตรวจและแก้ก่อนตรวจซ้ำ','Conflicting files are preserved in the integration checkout. Review and resolve them before checking again.')} {q.conflicts.join(', ')}</p>}
          <div className="actions"><button disabled={mutationDisabled||q.status!=='queued'} onClick={()=>queueAction('prepareIntegration',{targetHead})}>{t('เตรียมและตรวจผลรวม','Prepare and check merge')}</button>
            <button disabled={disabled||q.status==='queued'||q.status==='integrated'} onClick={()=>queueAction('reconcileIntegration')}>{t('ตรวจสถานะการรวมผล','Reconcile integration')}</button>
            <button disabled={mutationDisabled||!['conflict','checks-failed','unknown','awaiting-owner'].includes(q.status)} onClick={()=>queueAction('checkIntegration')}>{t('ตรวจผลรวมอีกครั้ง','Recheck combined files')}</button>
            <button disabled={mutationDisabled||q.status!=='awaiting-owner'||!!q.approval} onClick={()=>queueAction('approveIntegration',{targetHead:q.targetHead,head:q.candidateHead})}>{t('Owner อนุมัติผลรวมที่ผ่านตรวจ','Owner approve checked merge')}</button>
            <button disabled={mutationDisabled||!q.approval||q.status!=='awaiting-owner'} onClick={()=>queueAction('integrate',{targetHead:q.targetHead,head:q.candidateHead})}>{t('บันทึก merge ในสาขาแยก','Commit merge on separate branch')}</button></div>
          {q.combinedCheck&&<details><summary>{t('ผลทดสอบโค้ดรวม','Combined code checks')} · {q.combinedCheck.status}</summary><pre>{JSON.stringify(q.combinedCheck,null,2)}</pre></details>}
        </div>}
      </>}
    </section></div>
  </div>;
}
