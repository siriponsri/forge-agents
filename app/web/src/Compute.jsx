import React, { useRef, useState } from 'react';
import { Play, Square, RefreshCw, Download } from 'lucide-react';
import { request, operationId, scoped, date, downloadUrl } from './api.mjs';
import { Field, Heading, Badge, Empty, Json, Submit } from './ui.jsx';

const terminal=new Set(['completed','failed','stopped']);
const kinds=['local','owner-ssh','jupyter','vast','runpod','colab-browser','colab-mcp'];
const names={local:['CPU ในเครื่อง','Local CPU'],'owner-ssh':['เซิร์ฟเวอร์ SSH ของคุณ','Owner SSH server'],jupyter:['Jupyter ที่มีอยู่','Existing Jupyter'],vast:['Vast instance ที่มีอยู่','Existing Vast instance'],runpod:['Runpod pod ที่มีอยู่','Existing Runpod pod'],'colab-browser':['Colab · เปิดและรันด้วยตนเอง','Colab · interactive browser'],'colab-mcp':['Colab · official hosted MCP','Colab · official hosted MCP']};
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
    const key=JSON.stringify(['start',body]),op=operation(key),result=await call('start',{...body,operationId:op});pending.current.delete(key);setJob(result.id);setObserved(result);setNotice(t('บันทึกคำขอแล้ว ตรวจสถานะและ log ของงานนี้','Request recorded. Inspect this job’s status and logs.'));return result;
  });
  const jobAction=action=>act(async()=>{const result=await call(action,{jobId:job.id});if(action==='logs')setLog({...result,id:job.id});else if(result?.id)setObserved(result);return result;});
  if(!projectId)return <Empty>{t('เลือกโครงการก่อนตั้งค่า compute','Select a project to configure compute.')}</Empty>;
  return <>
    <Heading title={t('Compute และงาน notebook','Compute & notebook jobs')} description={t('เลือกเครื่อง ตรวจการเชื่อมต่อ แล้วติดตามงานจริง การหยุดงานและการปิดทรัพยากรเป็นคนละคำสั่ง','Choose a target, check its connection and follow actual jobs. Notebook Stop and resource Stop are separate actions.')}>
      <button disabled={busy} onClick={()=>act(()=>call('reconcile'))}><RefreshCw size={15} aria-hidden="true"/>{t('ตรวจงานที่มีอยู่','Reconcile existing work')}</button>
    </Heading>
    {notice&&<p role="status">{notice}</p>}
    <div className="serving-layout">
      <section className="panel" aria-label={t('ตั้งค่าเครื่องประมวลผล','Compute target setup')}>
        <h2>{t('เครื่องประมวลผลของโครงการ','Project compute target')}</h2>
        <Field label={t('เป้าหมายที่บันทึกไว้','Saved target')}><select value={targetId} onChange={e=>loadTarget(e.target.value)}><option value="">{t('เพิ่มเป้าหมายใหม่','Add a target')}</option>{targets.map(c=><option key={c.id} value={c.id}>{c.name} · r{c.revision}</option>)}</select></Field>
        {chosen&&<button disabled={busy} onClick={()=>loadTarget(chosen.id)}>{t('โหลดค่าที่บันทึกล่าสุด','Reload saved target')}</button>}
        <form onSubmit={e=>{e.preventDefault();act(async()=>{
          const config=compact(draft);const result=await call('configure',{config,...(targetId?{targetId,expectedRevision:baseRevision}:{}),select,...(phaseId?{phaseId}:{})});setTarget(result.id);setBaseRevision(result.revision);setDraft(result.config);setHealth(null);setNotice(t('บันทึกเป้าหมายแล้ว ยังไม่ได้ยืนยันการรัน','Target saved. Execution has not been verified.'));return result;
        });}}>
          <Field label={t('ชนิดเครื่องประมวลผล','Target kind')}><select value={draft.kind} onChange={e=>{setDraft(defaults(e.target.value));setHealth(null);}}>{kinds.map(k=><option key={k} value={k}>{t(...names[k])}</option>)}</select></Field>
          {field('name',t('ชื่อที่แสดง','Display name'))}
          {['owner-ssh','jupyter'].includes(draft.kind)&&<ExecutorFields t={t} config={draft} onChange={setDraft}/>}
          {['vast','runpod'].includes(draft.kind)&&<>
            <p className="help">{t('ใช้ ID ของทรัพยากรที่คุณมีอยู่ ไม่มีการเช่า สร้าง หรืออัปเกรดจากหน้านี้','Use an existing resource ID. This screen does not rent, create or upgrade resources.')}</p>
            {field('resourceId',t('ID ของทรัพยากรที่มีอยู่','Existing resource ID'),'text',true)}
            {field('authEnv',t('ชื่อ environment ที่เก็บ API key','API key environment reference'),'text',true,{pattern:'[A-Za-z_][A-Za-z0-9_]*'})}
            <Field label={t('วิธีรัน notebook บนทรัพยากร','Notebook executor')}><select value={draft.executor?.kind??''} onChange={e=>setDraft(d=>({...d,executor:e.target.value?defaults(e.target.value):undefined}))}><option value="">{t('ตรวจทรัพยากรอย่างเดียว','Inspect resource only')}</option><option value="owner-ssh">SSH</option><option value="jupyter">Jupyter</option></select></Field>
            {draft.executor&&<ExecutorFields t={t} config={draft.executor} onChange={executor=>setDraft(d=>({...d,executor}))}/>}
            <p className="help">{t('SSH ต้องตรงกับทรัพยากรที่ API ส่งกลับ URL Jupyter ที่กรอกเองยังไม่ใช่การยืนยันจาก provider','SSH must match the resource identity. An owner-configured Jupyter URL is not provider-attested.')}</p>
          </>}
          {draft.kind==='colab-mcp'&&<>
            {field('runtimeName',t('ชื่อ runtime ที่มีอยู่ เช่น runtimes/…','Existing runtime name, runtimes/…'),'text',true)}
            {field('authEnv',t('ชื่อ environment ที่เก็บ Google bearer','Google bearer environment reference'),'text',true,{pattern:'[A-Za-z_][A-Za-z0-9_]*'})}
            {field('quotaProject',t('Quota project ของคุณ (ถ้ามี)','Owner quota project (optional)'))}
            <p className="help">{t('เชื่อม official hosted MCP ต้องมีสิทธิ์และ runtime ที่พร้อม การพบ tools ไม่ยืนยันสิทธิ์รันหรือ Free GPU','Official hosted MCP needs an eligible account and existing runtime. Tool discovery does not prove execution entitlement or free GPU availability.')}</p>
          </>}
          {draft.kind==='colab-browser'&&<p className="help">{t('ดาวน์โหลด .ipynb ของ attempt นี้ เปิดและรันใน Colab ของคุณ แล้วนำไฟล์ที่บันทึกพร้อมผลกลับเข้ามา ผลเป็นข้อมูลที่เจ้าของนำเข้า ไม่ใช่หลักฐานจาก API','Export this attempt’s .ipynb, run it in your Colab browser, then import the saved file with outputs. Results are owner-imported, not API-attested.')}</p>}
          {draft.kind==='local'&&<p className="help">{t('ใช้ Python ในเครื่องและโฟลเดอร์โครงการ งานใหม่เริ่มจากต้น ไม่อ้างว่ากู้คืน kernel หรือ checkpoint','Uses machine Python and the project workspace. A new local attempt starts fresh; kernel or checkpoint restoration is not supported.')}</p>}
          <details><summary>{t('สภาพแวดล้อมและเวลารอการเชื่อมต่อ','Environment & connection timeout')}</summary>{field('environmentRevision',t('เวอร์ชันสภาพแวดล้อมที่ประกาศ','Declared environment revision'))}{field('timeoutMs',t('เวลารอการเชื่อมต่อ (ms)','Connection timeout (ms)'),'number',false,{min:50,max:120000})}</details>
          <Field label={t('ขอบเขตการเลือกใช้','Selection scope')}><select value={phaseId} onChange={e=>setPhase(e.target.value)}><option value="">{t('ค่าเริ่มต้นของโครงการ','Project default')}</option>{phases.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label={t('เลือกใช้หลังบันทึก','Use after saving')}><input type="checkbox" checked={select} onChange={e=>setSelect(e.target.checked)}/></Field>
          <p className="help">{t('กรอกเฉพาะชื่ออ้างอิง secret ที่ตั้งไว้ในเครื่อง ไม่วาง key หรือ token ลงฟอร์มนี้','Enter machine secret reference names. Do not paste keys or tokens into this form.')}</p>
          <Submit busy={busy}>{t('บันทึกเป้าหมาย','Save target')}</Submit>
        </form>
        <div className="toolbar"><button disabled={busy||!chosen} onClick={()=>act(async()=>{const result=await call('health',scope);setHealth(result);return result;})}><RefreshCw size={15} aria-hidden="true"/>{t('ตรวจการเชื่อมต่อ','Check health')}</button></div>
        {(health??chosen?.health)&&<div role="status"><p>{t('ผลตรวจล่าสุด','Latest health observation')} · {date((health??chosen.health).checkedAt)}</p><Json value={health??chosen.health}/></div>}
        {['vast','runpod'].includes(chosen?.config?.kind)&&<details><summary>{t('เปิดหรือปิดทรัพยากรที่มีอยู่','Existing resource power')}</summary><p>{t('Start อาจเริ่มคิดค่า compute ส่วน Stop อาจยังมีค่าพื้นที่เก็บข้อมูล ไม่ใช่การหยุด notebook','Start may incur compute charges. Stop may leave storage charges. These actions control the resource, independently of notebook Stop.')}</p><div className="toolbar">{['start','stop'].map(action=><button key={action} disabled={busy} onClick={()=>act(async()=>{const key=`lifecycle:${chosen.id}:${action}`,result=await call('lifecycle',{targetId:chosen.id,action,operationId:operation(key)});pending.current.delete(key);setNotice(t('บันทึกคำขอแล้ว ใช้ตรวจงานเพื่อดูสถานะจริง','Request recorded. Reconcile to observe actual resource state.'));return result;})}>{action==='start'?t('เปิดทรัพยากรที่เลือก','Start selected resource'):t('ปิดทรัพยากรที่เลือก','Stop selected resource')}</button>)}</div></details>}
      </section>
      <section className="panel" aria-label={t('ควบคุมงาน notebook','Notebook job controls')}>
        <h2>{t('รัน notebook','Run a notebook')}</h2>
        {!notebooks.length?<Empty>{t('สร้าง notebook ในหน้า Notebooks แล้วกลับมาเลือกเครื่องรันที่นี่','Create a notebook on the Notebooks page, then choose its compute target here.')}</Empty>:<>
          <Field label={t('Notebook ที่จะรัน','Notebook to run')}><select value={notebookId} onChange={e=>{setNotebook(e.target.value);setMode('restart');}}><option value="">—</option>{notebooks.map(n=><option key={n.id} value={n.id}>{n.name} · r{n.revision}</option>)}</select></Field>
          <p className="help">{t('ใช้เป้าหมายและ phase ที่เลือกด้านบน Notebook ที่มีเป้าหมายเฉพาะจะใช้ค่านั้นเมื่อไม่เลือกเป้าหมายชัดเจน','Uses the target and phase selected above. A notebook-specific target applies when no explicit target is selected.')}</p>
          <Field label={t('รูปแบบ attempt ใหม่','New attempt mode')}><select value={mode} onChange={e=>setMode(e.target.value)}><option value="restart">{t('เริ่มใหม่จากต้น','Fresh restart')}</option><option value="resume" disabled={!['owner-ssh','jupyter'].includes(chosen?.config?.executor?.kind??chosen?.config?.kind)}>{t('เริ่ม attempt ใหม่จาก checkpoint ที่รองรับ','New attempt from a qualified checkpoint')}</option></select></Field>
          {mode==='resume'&&<><p className="help">{t('ต้องเลือก attempt ก่อนหน้าที่จบแล้ว source เดิม และ checkpoint ที่ตรวจบนเครื่องเดียวกัน Source ต้องรองรับ forge-checkpoint-env-v1 จริง','Requires a terminal previous attempt, identical source and a verified checkpoint on this target. Source must implement forge-checkpoint-env-v1.')}</p><Field label={t('Checkpoint ที่ตรวจแล้ว','Verified checkpoint')}><select required value={checkpointId} onChange={e=>setCheckpoint(e.target.value)}><option value="">—</option>{artifacts.filter(a=>a.kind==='checkpoint').map(a=><option key={a.id} value={a.id}>{a.name} · r{a.revision}</option>)}</select></Field></>}
          {unsaved&&<p role="status">{t('บันทึกหรือโหลดค่าเป้าหมายก่อนเริ่มงาน เพื่อให้ใช้การตั้งค่าที่เห็นอยู่','Save or reload the target before starting, so the job uses the displayed settings.')}</p>}
          <button className="primary" disabled={busy||unsaved||!notebook||mode==='resume'&&(!checkpointId||!job||!terminal.has(job.status)||job.notebookId!==notebookId)} onClick={start}><Play size={15} aria-hidden="true"/>{mode==='resume'?t('เริ่มจาก checkpoint','Start from checkpoint'):t('เริ่มงานใหม่','Start new job')}</button>
        </>}
        <hr/><h2>{t('สถานะและ log ของ attempt','Attempt status & logs')}</h2>
        {!jobs.length?<Empty>{t('ยังไม่มีงาน ไม่มีการรันเมื่อเปิดหน้านี้','No jobs yet. Opening this screen does not execute code.')}</Empty>:<>
          <Field label={t('เลือก attempt','Select attempt')}><select value={job?.id??''} onChange={e=>{setJob(e.target.value);setObserved(null);setLog(null);}}>{jobs.map(j=><option key={j.id} value={j.id}>{notebooks.find(n=>n.id===j.notebookId)?.name??j.notebookId} · {j.status} · {date(j.createdAt)}</option>)}</select></Field>
          <div className="record-head"><strong>{job.computeAttempt?.kind??'local'} · r{job.sourceRevision}</strong><Badge>{job.status}</Badge></div>
          <p className="help">{t('ข้อมูลล่าสุด','Last observation')} · {date(job.lastObservationAt??job.updatedAt)} · {job.id}</p>
          {['unknown','interrupted','stopping','awaiting-owner'].includes(job.status)&&<p role="status">{t('ผลยังไม่ยืนยัน ตรวจงานหรือดำเนินการในเครื่องปลายทางก่อนเริ่มใหม่ การโหลดหน้าไม่ส่งโค้ดซ้ำ','Outcome is not confirmed. Reconcile or inspect the target before a fresh start. Reloading never resubmits code.')}</p>}
          {(job.error||job.lastError)&&<p className="error-text">{typeof(job.error??job.lastError)==='string'?(job.error??job.lastError):(job.error??job.lastError).message}</p>}
          {job.evidenceScope&&<p>{job.evidenceScope}</p>}
          <div className="toolbar"><button disabled={busy} onClick={()=>jobAction('status')}><RefreshCw size={15} aria-hidden="true"/>{t('ตรวจสถานะ','Refresh status')}</button><button disabled={busy} onClick={()=>jobAction('logs')}>{t('อ่าน log','Read logs')}</button><button disabled={busy||terminal.has(job.status)&&job.computeAttempt?.kind!=='colab-mcp'} onClick={()=>jobAction('stop')}><Square size={15} aria-hidden="true"/>{t('หยุด attempt นี้','Stop this attempt')}</button></div>
          <pre className="code logs" aria-label={t('Log จากงานจริง','Actual job logs')}>{log?.id===job.id?log.logs:job.logs||t('ยังไม่มี log ที่สังเกตได้','No observed logs yet.')}</pre>
          <details><summary>{t('Source เป้าหมาย และเวอร์ชันสภาพแวดล้อม','Source, target & environment revisions')}</summary><Json value={{source:job.source,sourceRevision:job.sourceRevision,profileRevision:job.profileRevision,computeAttempt:job.computeAttempt,configRevision:job.configRevision,environment:job.environment,previousJobId:job.previousJobId,checkpointRefs:job.checkpointRefs,deadlineAt:job.deadlineAt}}/></details>
          <div className="toolbar"><button disabled={busy} onClick={()=>act(async()=>{const result=await call('export-notebook',{jobId:job.id});saveNotebook(result);return result;})}><Download size={15} aria-hidden="true"/>{t('ดาวน์โหลด source .ipynb','Export source .ipynb')}</button></div>
          {job.computeAttempt?.kind==='colab-browser'&&<Field label={t('นำเข้า .ipynb ที่รันและบันทึกจาก Colab','Import saved Colab result .ipynb')} hint={t('ผลที่นำเข้าคือหลักฐานจากเจ้าของ ไม่ใช่ผลที่ FORGE สังเกตผ่าน API','Imported outputs are owner evidence, not execution observed through the API.')}><input type="file" accept=".ipynb,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)act(async()=>{if(file.size>12000000)throw new Error(t('ไฟล์ใหญ่เกิน 12 MB','File exceeds 12 MB'));const result=await call('import-result',{jobId:job.id,notebook:JSON.parse(await file.text())});setObserved(result);return result;});e.target.value='';}}/></Field>}
          <Field label={t('Artifact ที่ตรวจแล้วในโครงการ','Verified project artifact')}><select value={artifactId} onChange={e=>setArtifact(e.target.value)}><option value="">—</option>{artifacts.map(a=><option key={a.id} value={a.id}>{a.name} · r{a.revision}</option>)}</select></Field>
          <button disabled={busy||!artifactId} onClick={()=>act(()=>call('link-artifact',{jobId:job.id,artifactId}))}>{t('เชื่อม artifact กับงาน','Link artifact to job')}</button>
          {(job.artifactRefs??[]).map(id=><p key={id}><a href={downloadUrl(id)} download>{artifacts.find(a=>a.id===id)?.name??id}</a></p>)}
          {job.computeAttempt?.kind==='colab-mcp'&&<details><summary>{t('ย้ายไฟล์เข้าและออกจาก Colab','Transfer Colab files')}</summary>
            <p className="help">{t('เส้นทางสัมพันธ์กับโฟลเดอร์ attempt นี้เท่านั้น อัปโหลดใช้ artifact ที่ตรวจแล้ว ดาวน์โหลดต้องระบุ SHA-256 ที่คาดไว้','Paths are relative to this attempt workspace. Upload uses a verified artifact; download requires an expected SHA-256.')}</p>
            <Field label={t('เส้นทางไฟล์ใน attempt','Relative file path')}><input value={relativePath} onChange={e=>setPath(e.target.value)}/></Field>
            <Field label={t('SHA-256 ของไฟล์ที่จะดาวน์โหลด','Expected download SHA-256')}><input value={expectedSha} onChange={e=>setSha(e.target.value)} pattern="[a-f0-9]{64}"/></Field>
            <div className="toolbar">{['upload-artifact','download-artifact'].map(action=><button key={action} disabled={busy||!relativePath||(action==='upload-artifact'?!artifactId:!(/^[a-f0-9]{64}$/.test(expectedSha)))} onClick={()=>act(async()=>{const body={jobId:job.id,relativePath,...(action==='upload-artifact'?{artifactId}:{sha256:expectedSha})},key=JSON.stringify([action,body]),op=operation(key);setTransfer(op);const result=await call(`colab/${action}`,{...body,operationId:op});pending.current.delete(key);setNotice(t('บันทึกผลการย้ายไฟล์แล้ว ตรวจ artifact ก่อนใช้งาน','Transfer result recorded. Inspect the artifact before using it.'));return result;})}>{action==='upload-artifact'?t('อัปโหลด artifact ที่เลือก','Upload selected artifact'):t('ดาวน์โหลดและตรวจ hash','Download & verify hash')}</button>)}</div>
            <Field label={t('Operation ID สำหรับตรวจการย้ายไฟล์','Transfer operation to reconcile')}><input value={transferOperation} onChange={e=>setTransfer(e.target.value)}/></Field><button disabled={busy||!transferOperation} onClick={()=>act(()=>call('colab/reconcile-transfer',{operationId:transferOperation}))}>{t('ตรวจการย้ายไฟล์เดิม','Reconcile existing transfer')}</button>
          </details>}
        </>}
      </section>
    </div>
  </>;
}

function ExecutorFields({t,config,onChange}){
  const f=(key,label,{type='text',required=true,...props}={})=><Field key={key} label={label}><input {...props} type={type} required={required} value={config[key]??''} onChange={e=>onChange({...config,[key]:type==='number'?Number(e.target.value):e.target.value})}/></Field>;
  return config.kind==='owner-ssh'?<>
    <div className="form-grid">{f('host',t('ชื่อ host SSH','SSH host'))}{f('port',t('พอร์ต SSH','SSH port'),{type:'number',min:1,max:65535})}</div>
    {f('user',t('ผู้ใช้ SSH','SSH user'))}{f('workspace',t('โฟลเดอร์ POSIX แบบเต็ม','Absolute POSIX workspace'))}
    {f('knownHostsFileEnv',t('ชื่อ environment ของไฟล์ known_hosts','known_hosts file environment reference'),{pattern:'[A-Za-z_][A-Za-z0-9_]*'})}
    {f('identityFileEnv',t('ชื่อ environment ของไฟล์ private key (ถ้ามี)','Private key file environment reference (optional)'),{required:false,pattern:'[A-Za-z_][A-Za-z0-9_]*'})}
    {f('expectedMachineId',t('SHA-256 ของ machine identity ที่ตรวจแล้ว','Verified machine identity SHA-256'),{required:false,pattern:'[a-f0-9]{64}'})}
    <p className="help">{t('ตรวจ Health เพื่ออ่าน identity แล้วเทียบผ่านช่องทางที่เชื่อถือได้ ต้องผูก hash ก่อนรัน ไม่เพิ่ม host key ให้อัตโนมัติ รองรับเครื่องปลายทาง Linux/POSIX','Check health and compare identity through a trusted channel. Bind its hash before execution. No automatic host-key trust. Remote executor requires Linux/POSIX.')}</p>
  </>:<>
    {f('baseUrl',t('Jupyter base URL','Jupyter base URL'),{type:'url'})}{f('workspace',t('โฟลเดอร์สัมพัทธ์ใน Jupyter Contents','Relative workspace in Jupyter Contents'))}
    {f('authEnv',t('ชื่อ environment ที่เก็บ Jupyter token','Jupyter token environment reference'),{pattern:'[A-Za-z_][A-Za-z0-9_]*'})}{f('kernelName',t('ชื่อ kernel','Kernel name'))}
    <p className="help">{t('ใช้ kernel แยกสำหรับแต่ละ attempt และ receipt ในโฟลเดอร์ที่ Contents API อ่านได้ การขาดการเชื่อมต่อไม่ถือว่างานสำเร็จ','Each attempt uses a dedicated kernel and receipt readable through Contents API. A disconnect does not establish completion.')}</p>
  </>;
}
