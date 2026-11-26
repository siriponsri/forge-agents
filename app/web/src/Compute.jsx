import React, { useRef, useState } from 'react';
import { Play, Square, RefreshCw, Download } from 'lucide-react';
import { request, operationId, scoped, date, downloadUrl } from './api.mjs';
import { Field, Heading, Badge, Empty, Json, Submit } from './ui.jsx';

const terminal=new Set(['completed','failed','stopped']);
const kinds=['local','owner-ssh','jupyter','vast','runpod','colab-browser','colab-mcp'];
const names={local:['CPU ในเครื่อง','Local CPU'],'owner-ssh':['เซิร์ฟเวอร์ของคุณผ่าน SSH','Owner SSH server'],jupyter:['Jupyter ที่มีอยู่แล้ว','Existing Jupyter'],vast:['เครื่องบน Vast ที่มีอยู่แล้ว','Existing Vast instance'],runpod:['เครื่องบน Runpod ที่มีอยู่แล้ว','Existing Runpod pod'],'colab-browser':['Colab · คุณเปิดและรันเองในเบราว์เซอร์','Colab · interactive browser'],'colab-mcp':['Colab · เชื่อมผ่าน MCP ทางการของ Google','Colab · official hosted MCP']};
const defaults=kind=>({kind,...(kind==='owner-ssh'?{port:22}:kind==='jupyter'?{kernelName:'python3'}:{})});
const compact=value=>Object.fromEntries(Object.entries(value).filter(([,v])=>v!==''&&v!==undefined).map(([k,v])=>[k,v&&typeof v==='object'?compact(v):v]));
function saveNotebook(result){
  const url=URL.createObjectURL(new Blob([result.content],{type:'application/x-ipynb+json'}));
  const a=document.createElement('a');a.href=url;a.download=result.name??'notebook.ipynb';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function Compute(props){return <ComputeProject key={props.projectId} {...props}/>;}
function ComputeProject({t,state,projectId,run,busy}){
  const project=state?.projects?.find(p=>p.id===projectId);
  const targets=scoped(state,'connections',projectId).filter(c=>c.kind==='compute'),notebooks=scoped(state,'notebooks',projectId),phases=scoped(state,'phases',projectId);
  const jobs=scoped(state,'jobs',projectId).filter(j=>j.kind==='notebook'||j.kind==='compute-notebook').slice().reverse(),artifacts=scoped(state,'artifacts',projectId).filter(a=>a.status==='verified');
  const initial=targets.find(c=>c.id===(project?.profile?.compute?.connectionId??project?.profile?.compute?.targetId));
  const [targetId,setTarget]=useState(initial?.id??''),[draft,setDraft]=useState(initial?.config??defaults('local')),[baseRevision,setBaseRevision]=useState(initial?.revision),[phaseId,setPhase]=useState(''),[select,setSelect]=useState(true),[health,setHealth]=useState(null);
  const [notebookId,setNotebook]=useState(notebooks[0]?.id??''),[jobId,setJob]=useState(''),[mode,setMode]=useState('restart'),[checkpointId,setCheckpoint]=useState(''),[observed,setObserved]=useState(null),[log,setLog]=useState(null),[artifactId,setArtifact]=useState(''),[relativePath,setPath]=useState(''),[expectedSha,setSha]=useState(''),[transferOperation,setTransfer]=useState(''),[notice,setNotice]=useState('');
  const pending=useRef(new Map());
  const selectedJob=jobs.find(j=>j.id===jobId)??jobs[0],job=observed&&selectedJob&&observed.id===selectedJob.id&&observed.revision>=selectedJob.revision?observed:selectedJob;
  const chosen=targets.find(c=>c.id===targetId),notebook=notebooks.find(n=>n.id===notebookId);
  const unsaved=JSON.stringify(compact(draft))!==JSON.stringify(compact(chosen?.config??defaults('local')));
  const call=(action,body={})=>request(`/api/compute/${action}`,{projectId,...body});
  const scope={...(targetId?{targetId}:{}),...(phaseId?{phaseId}:{})};
  const act=(fn)=>run(async()=>{setNotice('');return fn();});
  const operation=(key)=>{if(!pending.current.has(key))pending.current.set(key,operationId());return pending.current.get(key);};
  const loadTarget=id=>{const target=targets.find(c=>c.id===id);setTarget(id);setDraft(structuredClone(target?.config??defaults('local')));setBaseRevision(target?.revision);setHealth(null);};
  const field=(key,label,type='text',required=false,extra={})=><Field key={key} label={label}><input {...extra} type={type} required={required} value={draft[key]??''} onChange={e=>setDraft(d=>({...d,[key]:type==='number'?Number(e.target.value):e.target.value}))}/></Field>;
  const start=()=>act(async()=>{
    const body={notebookId,...scope,mode,...(job&&job.notebookId===notebookId&&terminal.has(job.status)?{previousJobId:job.id}:{}),...(mode==='resume'?{checkpointArtifactId:checkpointId}:{})};
    const key=JSON.stringify(['start',body]),op=operation(key),result=await call('start',{...body,operationId:op});pending.current.delete(key);setJob(result.id);setObserved(result);setNotice(t('ส่งคำสั่งแล้ว ดูสถานะและบันทึกการทำงานด้านล่าง','Request recorded. Inspect this job’s status and logs.'));return result;
  });
  const jobAction=action=>act(async()=>{const result=await call(action,{jobId:job.id});if(action==='logs')setLog({...result,id:job.id});else if(result?.id)setObserved(result);return result;});
  if(!projectId)return <Empty>{t('เลือกโปรเจกต์ก่อนตั้งค่าเครื่องประมวลผล','Select a project to configure compute.')}</Empty>;
  return <>
    <Heading title={t('เครื่องประมวลผลและสมุดโค้ด Python','Compute & notebook jobs')} description={t('เลือกเครื่องที่จะใช้รันโค้ด ทดสอบการเชื่อมต่อ แล้วติดตามงาน การหยุดงานกับการปิดเครื่องเป็นคนละปุ่มกัน','Choose a target, check its connection and follow actual jobs. Notebook Stop and resource Stop are separate actions.')}>
      <button disabled={busy} onClick={()=>act(()=>call('reconcile'))}><RefreshCw size={15} aria-hidden="true"/>{t('ตรวจสถานะล่าสุด','Reconcile existing work')}</button>
    </Heading>
    {notice&&<p role="status">{notice}</p>}
    <div className="serving-layout">
      <section className="panel" aria-label={t('ตั้งค่าเครื่องประมวลผล','Compute target setup')}>
        <h2>{t('เครื่องประมวลผลของโปรเจกต์','Project compute target')}</h2>
        <Field label={t('เครื่องที่บันทึกไว้','Saved target')}><select value={targetId} onChange={e=>loadTarget(e.target.value)}><option value="">{t('เพิ่มเครื่องใหม่','Add a target')}</option>{targets.map(c=><option key={c.id} value={c.id}>{c.name} · r{c.revision}</option>)}</select></Field>
        {chosen&&<button disabled={busy} onClick={()=>loadTarget(chosen.id)}>{t('โหลดค่าที่บันทึกล่าสุด','Reload saved target')}</button>}
        <form onSubmit={e=>{e.preventDefault();act(async()=>{
          const config=compact(draft);const result=await call('configure',{config,...(targetId?{targetId,expectedRevision:baseRevision}:{}),select,...(phaseId?{phaseId}:{})});setTarget(result.id);setBaseRevision(result.revision);setDraft(result.config);setHealth(null);setNotice(t('บันทึกเครื่องแล้ว แต่ยังไม่ได้ทดสอบว่ารันได้จริง','Target saved. Execution has not been verified.'));return result;
        });}}>
          <Field label={t('ประเภทเครื่อง','Target kind')}><select value={draft.kind} onChange={e=>{setDraft(defaults(e.target.value));setHealth(null);}}>{kinds.map(k=><option key={k} value={k}>{t(...names[k])}</option>)}</select></Field>
          {field('name',t('ชื่อเรียก','Display name'))}
          {['owner-ssh','jupyter'].includes(draft.kind)&&<ExecutorFields t={t} config={draft} onChange={setDraft}/>}
          {['vast','runpod'].includes(draft.kind)&&<>
            <p className="help">{t('ใส่รหัสเครื่องที่คุณเช่าไว้แล้ว หน้านี้ไม่เช่า ไม่สร้าง และไม่อัปเกรดเครื่องให้','Use an existing resource ID. This screen does not rent, create or upgrade resources.')}</p>
            {field('resourceId',t('รหัสเครื่องที่มีอยู่','Existing resource ID'),'text',true)}
            {field('authEnv',t('ชื่อคีย์ลับ API','API key environment reference'),'text',true,{pattern:'[A-Za-z_][A-Za-z0-9_]*'})}
            <Field label={t('วิธีรันสมุดโค้ดบนเครื่องนี้','Notebook executor')}><select value={draft.executor?.kind??''} onChange={e=>setDraft(d=>({...d,executor:e.target.value?defaults(e.target.value):undefined}))}><option value="">{t('ดูสถานะเครื่องอย่างเดียว (ไม่รันโค้ด)','Inspect resource only')}</option><option value="owner-ssh">SSH</option><option value="jupyter">Jupyter</option></select></Field>
            {draft.executor&&<ExecutorFields t={t} config={draft.executor} onChange={executor=>setDraft(d=>({...d,executor}))}/>}
            <p className="help">{t('ข้อมูล SSH ต้องตรงกับเครื่องที่ผู้ให้บริการแจ้ง ส่วน URL ของ Jupyter ที่คุณกรอกเอง ผู้ให้บริการไม่ได้รับรอง','SSH must match the resource identity. An owner-configured Jupyter URL is not provider-attested.')}</p>
          </>}
          {draft.kind==='colab-mcp'&&<>
            {field('runtimeName',t('ชื่อเครื่อง Colab ที่เปิดอยู่ เช่น runtimes/…','Existing runtime name, runtimes/…'),'text',true)}
            {field('authEnv',t('ชื่อคีย์ลับของ Google bearer token','Google bearer environment reference'),'text',true,{pattern:'[A-Za-z_][A-Za-z0-9_]*'})}
            {field('quotaProject',t('Google Cloud project สำหรับโควตา (ถ้ามี)','Owner quota project (optional)'))}
            <p className="help">{t('ต้องมีบัญชีที่ใช้ได้และเครื่อง Colab ที่เปิดไว้แล้ว การเห็นรายชื่อเครื่องมือไม่ได้แปลว่ามีสิทธิ์รันโค้ด หรือได้ GPU ฟรี','Official hosted MCP needs an eligible account and existing runtime. Tool discovery does not prove execution entitlement or free GPU availability.')}</p>
          </>}
          {draft.kind==='colab-browser'&&<p className="help">{t('ดาวน์โหลดไฟล์ .ipynb ไปเปิดและรันใน Colab ของคุณ แล้วนำไฟล์ที่บันทึกพร้อมผลกลับเข้ามา ผลนี้คุณเป็นคนนำเข้าเอง FORGE ไม่ได้เห็นการรันจริง','Export this attempt’s .ipynb, run it in your Colab browser, then import the saved file with outputs. Results are owner-imported, not API-attested.')}</p>}
          {draft.kind==='local'&&<p className="help">{t('ใช้ Python ในเครื่องนี้และโฟลเดอร์งานของโปรเจกต์ ทุกครั้งเริ่มใหม่จากต้น ไม่ทำต่อจากจุดบันทึกเดิม','Uses machine Python and the project workspace. A new local attempt starts fresh; kernel or checkpoint restoration is not supported.')}</p>}
          <details><summary>{t('รุ่นสภาพแวดล้อมและเวลารอการเชื่อมต่อ','Environment & connection timeout')}</summary>{field('environmentRevision',t('รุ่นของสภาพแวดล้อม (ระบุเอง)','Declared environment revision'))}{field('timeoutMs',t('เวลารอการเชื่อมต่อ (มิลลิวินาที)','Connection timeout (ms)'),'number',false,{min:50,max:120000})}</details>
          <Field label={t('ใช้เครื่องนี้กับ','Selection scope')}><select value={phaseId} onChange={e=>setPhase(e.target.value)}><option value="">{t('ทั้งโปรเจกต์ (ค่าเริ่มต้น)','Project default')}</option>{phases.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label={t('ใช้เครื่องนี้ทันทีหลังบันทึก','Use after saving')}><input type="checkbox" checked={select} onChange={e=>setSelect(e.target.checked)}/></Field>
          <p className="help">{t('กรอกเฉพาะชื่อคีย์ลับที่เก็บไว้ในเครื่อง อย่าวางคีย์หรือ token จริงลงในฟอร์มนี้','Enter machine secret reference names. Do not paste keys or tokens into this form.')}</p>
          <Submit busy={busy}>{t('บันทึกเครื่อง','Save target')}</Submit>
        </form>
        <div className="toolbar"><button disabled={busy||!chosen} onClick={()=>act(async()=>{const result=await call('health',scope);setHealth(result);return result;})}><RefreshCw size={15} aria-hidden="true"/>{t('ทดสอบการเชื่อมต่อ','Check health')}</button></div>
        {(health??chosen?.health)&&<div role="status"><p>{t('ผลทดสอบล่าสุด','Latest health observation')} · {date((health??chosen.health).checkedAt)}</p><Json value={health??chosen.health}/></div>}
        {['vast','runpod'].includes(chosen?.config?.kind)&&<details><summary>{t('เปิดหรือปิดเครื่อง (อาจมีค่าใช้จ่าย)','Existing resource power')}</summary><p>{t('การเปิดเครื่องอาจเริ่มคิดค่าเช่าเครื่อง การปิดเครื่องอาจยังมีค่าพื้นที่เก็บข้อมูล ปุ่มนี้ควบคุมตัวเครื่อง ไม่ใช่การหยุดสมุดโค้ด','Start may incur compute charges. Stop may leave storage charges. These actions control the resource, independently of notebook Stop.')}</p><div className="toolbar">{['start','stop'].map(action=><button key={action} disabled={busy} onClick={()=>act(async()=>{const key=`lifecycle:${chosen.id}:${action}`,result=await call('lifecycle',{targetId:chosen.id,action,operationId:operation(key)});pending.current.delete(key);setNotice(t('ส่งคำสั่งแล้ว กด ตรวจสถานะล่าสุด เพื่อดูว่าเครื่องเปิดหรือปิดจริงหรือไม่','Request recorded. Reconcile to observe actual resource state.'));return result;})}>{action==='start'?t('เปิดเครื่อง (เริ่มคิดค่าใช้จ่าย)','Start selected resource'):t('ปิดเครื่อง','Stop selected resource')}</button>)}</div></details>}
      </section>
      <section className="panel" aria-label={t('ควบคุมการรันสมุดโค้ด','Notebook job controls')}>
        <h2>{t('รันสมุดโค้ด Python','Run a notebook')}</h2>
        {!notebooks.length?<Empty>{t('สร้างสมุดโค้ดในหน้า สมุดโค้ด Python ก่อน แล้วกลับมาเลือกเครื่องรันที่นี่','Create a notebook on the Notebooks page, then choose its compute target here.')}</Empty>:<>
          <Field label={t('สมุดโค้ดที่จะรัน','Notebook to run')}><select value={notebookId} onChange={e=>{setNotebook(e.target.value);setMode('restart');}}><option value="">—</option>{notebooks.map(n=><option key={n.id} value={n.id}>{n.name} · r{n.revision}</option>)}</select></Field>
          <p className="help">{t('ใช้เครื่องและช่วงงานที่เลือกด้านบน ถ้าสมุดโค้ดนี้กำหนดเครื่องไว้เอง และด้านบนไม่ได้เลือกเครื่อง จะใช้เครื่องของสมุดโค้ด','Uses the target and phase selected above. A notebook-specific target applies when no explicit target is selected.')}</p>
          <Field label={t('วิธีเริ่ม','New attempt mode')}><select value={mode} onChange={e=>setMode(e.target.value)}><option value="restart">{t('เริ่มใหม่ตั้งแต่ต้น','Fresh restart')}</option><option value="resume" disabled={!['owner-ssh','jupyter'].includes(chosen?.config?.executor?.kind??chosen?.config?.kind)}>{t('ทำต่อจากจุดบันทึก (checkpoint)','New attempt from a qualified checkpoint')}</option></select></Field>
          {mode==='resume'&&<><p className="help">{t('ใช้ได้เมื่อรอบก่อนจบแล้ว โค้ดไม่เปลี่ยน และมีจุดบันทึกที่ตรวจแล้วบนเครื่องเดียวกัน โค้ดต้องรองรับ forge-checkpoint-env-v1','Requires a terminal previous attempt, identical source and a verified checkpoint on this target. Source must implement forge-checkpoint-env-v1.')}</p><Field label={t('จุดบันทึกที่ตรวจแล้ว','Verified checkpoint')}><select required value={checkpointId} onChange={e=>setCheckpoint(e.target.value)}><option value="">—</option>{artifacts.filter(a=>a.kind==='checkpoint').map(a=><option key={a.id} value={a.id}>{a.name} · r{a.revision}</option>)}</select></Field></>}
          {unsaved&&<p role="status">{t('ค่าเครื่องยังไม่ได้บันทึก กด บันทึกเครื่อง หรือ โหลดค่าที่บันทึกล่าสุด ก่อนเริ่มงาน','Save or reload the target before starting, so the job uses the displayed settings.')}</p>}
          <button className="primary" disabled={busy||unsaved||!notebook||mode==='resume'&&(!checkpointId||!job||!terminal.has(job.status)||job.notebookId!==notebookId)} onClick={start}><Play size={15} aria-hidden="true"/>{mode==='resume'?t('ทำต่อจากจุดบันทึก','Start from checkpoint'):t('เริ่มรัน','Start new job')}</button>
        </>}
        <hr/><h2>{t('สถานะและบันทึกการทำงาน','Attempt status & logs')}</h2>
        {!jobs.length?<Empty>{t('ยังไม่มีงาน การเปิดหน้านี้ไม่ได้รันโค้ด','No jobs yet. Opening this screen does not execute code.')}</Empty>:<>
          <Field label={t('เลือกรอบที่รัน','Select attempt')}><select value={job?.id??''} onChange={e=>{setJob(e.target.value);setObserved(null);setLog(null);}}>{jobs.map(j=><option key={j.id} value={j.id}>{notebooks.find(n=>n.id===j.notebookId)?.name??j.notebookId} · {j.status} · {date(j.createdAt)}</option>)}</select></Field>
          <div className="record-head"><strong>{job.computeAttempt?.kind??'local'} · r{job.sourceRevision}</strong><Badge>{job.status}</Badge></div>
          <p className="help">{t('อัปเดตล่าสุด','Last observation')} · {date(job.lastObservationAt??job.updatedAt)} · {job.id}</p>
          {['unknown','interrupted','stopping','awaiting-owner'].includes(job.status)&&<p role="status">{t('ยังไม่รู้ผล กด ตรวจสถานะล่าสุด หรือดูที่เครื่องนั้นก่อนเริ่มใหม่ การโหลดหน้านี้ใหม่จะไม่ส่งโค้ดไปรันซ้ำ','Outcome is not confirmed. Reconcile or inspect the target before a fresh start. Reloading never resubmits code.')}</p>}
          {(job.error||job.lastError)&&<p className="error-text">{typeof(job.error??job.lastError)==='string'?(job.error??job.lastError):(job.error??job.lastError).message}</p>}
          {job.evidenceScope&&<p>{job.evidenceScope}</p>}
          <div className="toolbar"><button disabled={busy} onClick={()=>jobAction('status')}><RefreshCw size={15} aria-hidden="true"/>{t('โหลดข้อมูลล่าสุด','Refresh status')}</button><button disabled={busy} onClick={()=>jobAction('logs')}>{t('อ่านบันทึกการทำงาน','Read logs')}</button><button disabled={busy||terminal.has(job.status)&&job.computeAttempt?.kind!=='colab-mcp'} onClick={()=>jobAction('stop')}><Square size={15} aria-hidden="true"/>{t('หยุดรอบนี้','Stop this attempt')}</button></div>
          <pre className="code logs" aria-label={t('บันทึกการทำงาน','Actual job logs')}>{log?.id===job.id?log.logs:job.logs||t('ยังไม่มีบันทึกการทำงาน','No observed logs yet.')}</pre>
          <details><summary>{t('รายละเอียดทางเทคนิค','Source, target & environment revisions')}</summary><Json value={{source:job.source,sourceRevision:job.sourceRevision,profileRevision:job.profileRevision,computeAttempt:job.computeAttempt,configRevision:job.configRevision,environment:job.environment,previousJobId:job.previousJobId,checkpointRefs:job.checkpointRefs,deadlineAt:job.deadlineAt}}/></details>
          <div className="toolbar"><button disabled={busy} onClick={()=>act(async()=>{const result=await call('export-notebook',{jobId:job.id});saveNotebook(result);return result;})}><Download size={15} aria-hidden="true"/>{t('ดาวน์โหลดไฟล์ .ipynb','Export source .ipynb')}</button></div>
          {job.computeAttempt?.kind==='colab-browser'&&<Field label={t('นำเข้าไฟล์ .ipynb ที่รันเสร็จจาก Colab','Import saved Colab result .ipynb')} hint={t('ผลนี้คุณเป็นคนนำเข้าเอง FORGE ไม่ได้เห็นการรันจริง','Imported outputs are owner evidence, not execution observed through the API.')}><input type="file" accept=".ipynb,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)act(async()=>{if(file.size>12000000)throw new Error(t('ไฟล์นี้ใหญ่เกินไป (สูงสุด 12 MB)','File exceeds 12 MB'));const result=await call('import-result',{jobId:job.id,notebook:JSON.parse(await file.text())});setObserved(result);return result;});e.target.value='';}}/></Field>}
          <Field label={t('ไฟล์ผลลัพธ์ในโปรเจกต์','Verified project artifact')}><select value={artifactId} onChange={e=>setArtifact(e.target.value)}><option value="">—</option>{artifacts.map(a=><option key={a.id} value={a.id}>{a.name} · r{a.revision}</option>)}</select></Field>
          <button disabled={busy||!artifactId} onClick={()=>act(()=>call('link-artifact',{jobId:job.id,artifactId}))}>{t('แนบไฟล์ผลลัพธ์กับงานนี้','Link artifact to job')}</button>
          {(job.artifactRefs??[]).map(id=><p key={id}><a href={downloadUrl(id)} download>{artifacts.find(a=>a.id===id)?.name??id}</a></p>)}
          {job.computeAttempt?.kind==='colab-mcp'&&<details><summary>{t('ส่งไฟล์เข้าและออกจาก Colab','Transfer Colab files')}</summary>
            <p className="help">{t('ใส่ที่อยู่ไฟล์ภายในโฟลเดอร์ของรอบนี้เท่านั้น การอัปโหลดใช้ไฟล์ผลลัพธ์ที่ตรวจแล้ว การดาวน์โหลดต้องใส่รหัสตรวจไฟล์ (SHA-256) ที่คาดไว้','Paths are relative to this attempt workspace. Upload uses a verified artifact; download requires an expected SHA-256.')}</p>
            <Field label={t('ที่อยู่ไฟล์ในโฟลเดอร์ของรอบนี้','Relative file path')}><input value={relativePath} onChange={e=>setPath(e.target.value)}/></Field>
            <Field label={t('รหัสตรวจไฟล์ (SHA-256) ของไฟล์ที่จะดาวน์โหลด','Expected download SHA-256')}><input value={expectedSha} onChange={e=>setSha(e.target.value)} pattern="[a-f0-9]{64}"/></Field>
            <div className="toolbar">{['upload-artifact','download-artifact'].map(action=><button key={action} disabled={busy||!relativePath||(action==='upload-artifact'?!artifactId:!(/^[a-f0-9]{64}$/.test(expectedSha)))} onClick={()=>act(async()=>{const body={jobId:job.id,relativePath,...(action==='upload-artifact'?{artifactId}:{sha256:expectedSha})},key=JSON.stringify([action,body]),op=operation(key);setTransfer(op);const result=await call(`colab/${action}`,{...body,operationId:op});pending.current.delete(key);setNotice(t('ส่งไฟล์เสร็จแล้ว ตรวจไฟล์ผลลัพธ์ก่อนใช้','Transfer result recorded. Inspect the artifact before using it.'));return result;})}>{action==='upload-artifact'?t('อัปโหลดไฟล์ผลลัพธ์ที่เลือก','Upload selected artifact'):t('ดาวน์โหลดและตรวจรหัสตรวจไฟล์','Download & verify hash')}</button>)}</div>
            <Field label={t('รหัสคำสั่งส่งไฟล์ที่ต้องการตรวจ','Transfer operation to reconcile')}><input value={transferOperation} onChange={e=>setTransfer(e.target.value)}/></Field><button disabled={busy||!transferOperation} onClick={()=>act(()=>call('colab/reconcile-transfer',{operationId:transferOperation}))}>{t('ตรวจผลการส่งไฟล์','Reconcile existing transfer')}</button>
          </details>}
        </>}
      </section>
    </div>
  </>;
}

function ExecutorFields({t,config,onChange}){
  const f=(key,label,{type='text',required=true,...props}={})=><Field key={key} label={label}><input {...props} type={type} required={required} value={config[key]??''} onChange={e=>onChange({...config,[key]:type==='number'?Number(e.target.value):e.target.value})}/></Field>;
  return config.kind==='owner-ssh'?<>
    <div className="form-grid">{f('host',t('ชื่อเครื่อง (host) SSH','SSH host'))}{f('port',t('พอร์ต SSH','SSH port'),{type:'number',min:1,max:65535})}</div>
    {f('user',t('ผู้ใช้ SSH','SSH user'))}{f('workspace',t('โฟลเดอร์งานบนเครื่อง (ที่อยู่เต็ม เช่น /home/me/work)','Absolute POSIX workspace'))}
    {f('knownHostsFileEnv',t('ชื่อคีย์ลับที่ชี้ไปยังไฟล์ known_hosts','known_hosts file environment reference'),{pattern:'[A-Za-z_][A-Za-z0-9_]*'})}
    {f('identityFileEnv',t('ชื่อคีย์ลับที่ชี้ไปยังไฟล์ private key (ถ้ามี)','Private key file environment reference (optional)'),{required:false,pattern:'[A-Za-z_][A-Za-z0-9_]*'})}
    {f('expectedMachineId',t('รหัสตรวจเครื่อง (SHA-256) ที่ยืนยันแล้ว','Verified machine identity SHA-256'),{required:false,pattern:'[a-f0-9]{64}'})}
    <p className="help">{t('กด ทดสอบการเชื่อมต่อ เพื่ออ่านรหัสตรวจเครื่อง แล้วเทียบกับข้อมูลจากช่องทางที่เชื่อถือได้ ใส่รหัสนั้นก่อนรัน FORGE ไม่เชื่อถือเครื่องใหม่ให้อัตโนมัติ รองรับเฉพาะเครื่อง Linux/POSIX','Check health and compare identity through a trusted channel. Bind its hash before execution. No automatic host-key trust. Remote executor requires Linux/POSIX.')}</p>
  </>:<>
    {f('baseUrl',t('Jupyter base URL','Jupyter base URL'),{type:'url'})}{f('workspace',t('โฟลเดอร์งานใน Jupyter (นับจากโฟลเดอร์หลัก)','Relative workspace in Jupyter Contents'))}
    {f('authEnv',t('ชื่อคีย์ลับของ Jupyter token','Jupyter token environment reference'),{pattern:'[A-Za-z_][A-Za-z0-9_]*'})}{f('kernelName',t('ชื่อ kernel','Kernel name'))}
    <p className="help">{t('แต่ละรอบใช้ kernel แยกกัน ถ้าการเชื่อมต่อขาด FORGE จะไม่ถือว่างานเสร็จ','Each attempt uses a dedicated kernel and receipt readable through Contents API. A disconnect does not establish completion.')}</p>
  </>;
}
