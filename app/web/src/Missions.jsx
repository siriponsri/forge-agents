import React,{useEffect,useRef,useState} from 'react';
import {Plus,Play,Square,RefreshCw,Download,FileCheck,PackageCheck} from 'lucide-react';
import {request,operationId,scoped} from './api.mjs';
import {Badge,Empty,Field,Heading,Json} from './ui.jsx';
import './mission-workspace.css';

// A project switch drops selection, pending command reviews and private drafts.
export default function Missions(props){return <MissionWorkspace key={props.projectId} {...props}/>;}
function MissionWorkspace({t,state,projectId,run,busy}){
  const [data,setData]=useState(null),[selected,setSelected]=useState(''),[error,setError]=useState(null),[notice,setNotice]=useState(''),[editing,setEditing]=useState(false),[reviewed,setReviewed]=useState({}),[preview,setPreview]=useState(null),[uncertain,setUncertain]=useState(null);
  const alive=useRef(true),intents=useRef(new Map());
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const refresh=async()=>{const value=await request('/api/missions/state',{projectId});if(alive.current){setData(value);setError(null);}return value;};
  useEffect(()=>{let cancelled=false;request('/api/missions/state',{projectId}).then(value=>{if(!cancelled){setData(value);setError(null);}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[projectId,state.revision]);
  const missions=scoped(state,'events',projectId).filter(e=>e.type==='mission.definition'),m=missions.find(x=>x.id===selected),g=scoped(state,'events',projectId).find(e=>e.id===m?.goalId),plan=scoped(state,'plans',projectId).find(p=>p.id===m?.planId),tasks=scoped(state,'tasks',projectId).filter(x=>x.planId===m?.planId),outputs=(data?.outputs??[]).filter(x=>x.missionId===m?.id&&x.definitionRevision===m?.definitionRevision),packs=(data?.packs??[]).filter(x=>x.missionId===m?.id),bots=scoped(state,'bots',projectId);
  const act=async(method,extra={},mission=m)=>{
    const body={projectId,operationId:operationId(),...(mission?{missionId:mission.id,expectedRevision:mission.revision}:{}),...extra};
    const key=JSON.stringify({method,missionId:mission?.id,...extra});let input=intents.current.get(key);if(!input){input=body;intents.current.set(key,input);}
    return run(async()=>{try{const result=await request(`/api/missions/${method}`,input);intents.current.delete(key);if(alive.current){setUncertain(null);setNotice(t('บันทึกผลแล้ว','Result recorded'));await refresh();}return result;}catch(e){if(e.code==='CONNECTION_LOST'){if(alive.current)setUncertain({method,input});}else intents.current.delete(key);throw e;}});
  };
  const execution=action=>act('execute',{action,expectedGoalRevision:g.revision});
  const choose=id=>{setSelected(id);setEditing(false);setReviewed({});setPreview(null);setNotice('');};
  if(!projectId)return <Empty>{t('เลือกโปรเจกต์ก่อนเริ่มภารกิจ','Select a project to begin a mission.')}</Empty>;
  return <div className="mission-workspace">
    <Heading title={t('ภารกิจและชุดส่งมอบ','Missions & delivery')} description={t('จากไอเดียสู่แผน โค้ด ผลทดสอบ และไฟล์ที่ตรวจรับได้','Turn an idea into a reviewed plan, code, test evidence and a portable delivery.')}>
      <button onClick={()=>choose('')} disabled={busy}><Plus size={16}/>{t('ภารกิจใหม่','New mission')}</button>
      <button onClick={()=>run(refresh)} disabled={busy}><RefreshCw size={16}/>{t('โหลดสถานะ','Refresh state')}</button>
    </Heading>
    {error&&<p role="alert" className="mission-error">{error}</p>}
    {notice&&<p role="status" className="help">{notice}</p>}
    {uncertain&&<div className="mission-alert" role="alert"><p>{t('การเชื่อมต่อขาดหาย ผลลัพธ์อาจถูกบันทึกแล้ว โหลดสถานะและตรวจ run หรือหลักฐานก่อนดำเนินการต่อ','Connection lost. The action may have completed. Refresh and inspect the run or evidence. Retrying this exact request retains its operation ID and does not start a new test or attempt.')}</p><button disabled={busy} onClick={()=>run(async()=>{const result=await request(`/api/missions/${uncertain.method}`,uncertain.input);setUncertain(null);await refresh();return result;})}>{t('ตรวจคำขอเดิม','Recover exact request')}</button></div>}
    <div className="mission-layout">
      <nav className="mission-list" aria-label={t('รายการภารกิจ','Mission list')}>
        {missions.map(x=><button key={x.id} className={selected===x.id?'selected':''} aria-pressed={selected===x.id} onClick={()=>choose(x.id)}><strong>{x.definition.title}</strong><small>{t('ฉบับ','Revision')} {x.definitionRevision} · {x.status}</small></button>)}
        {!missions.length&&<Empty>{t('เริ่มด้วยผลลัพธ์ที่ต้องการและวิธีตรวจรับ แผนจะแสดงก่อนเริ่มงาน','Describe the output and how to check it. You will see the plan before work starts.')}</Empty>}
      </nav>
      <div className="mission-main">
        {(!m||editing)&&<MissionForm key={`${m?.id??'new'}:${m?.definitionRevision??0}`} t={t} mission={m} bots={bots} disabled={busy||!!uncertain} onCancel={()=>setEditing(false)} onSave={async definition=>{const result=await act(m?'revise':'create',{definition},m??null);if(result){choose(result.id);}}}/>}
        {m&&!editing&&<>
          <section className="mission-section">
            <div className="mission-section-title"><h2>{m.definition.title}</h2><Badge>{g?.status??m.status}</Badge></div>
            <p>{m.definition.objective}</p>
            <dl className="mission-facts"><dt>{t('ข้อจำกัด','Constraints')}</dt><dd>{m.definition.constraints||t('ไม่ได้ระบุ','Not specified')}</dd><dt>{t('ข้อมูลต้นทาง','Inputs')}</dt><dd>{m.definition.inputs||t('ไม่ได้ระบุ','Not specified')}</dd></dl>
            {!!m.definition.decisions.length&&<><h3>{t('การตัดสินใจ','Decisions')}</h3><dl className="mission-facts">{m.definition.decisions.map(d=><React.Fragment key={d.id}><dt>{d.question}</dt><dd>{d.answer||t('ยังไม่ได้ตอบ — ต้องตอบก่อนอนุมัติ','Unanswered — resolve before approval')}</dd></React.Fragment>)}</dl></>}
            <button disabled={busy||!!uncertain||!!g&&!['cancelled','completed','exhausted'].includes(g.status)} onClick={()=>setEditing(true)}>{t('แก้ไขและเก็บเป็นฉบับใหม่','Edit as a new revision')}</button>
            {m.restoreReviewRequired&&<p role="alert">{t('ข้อมูลผ่านการกู้คืน ต้องยุติหรือตรวจผล Goal เดิมและสร้างฉบับใหม่ก่อนเริ่มงาน','Restored metadata needs review. Reconcile and cancel the existing Goal before creating a fresh mission revision.')}</p>}
          </section>
          <section className="mission-section" aria-labelledby="mission-plan-title">
            <h2 id="mission-plan-title">{t('แผนที่ต้องตรวจทาน','Plan to review')}</h2><p className="help">{t('ใช้แผนและงานชุดเดียวกับหน้า Plan/Goals งานจะยังไม่เริ่มจนกว่าจะอนุมัติและกดเริ่ม','These are the same canonical Plan/Goals tasks. Approval saves the plan; Start launches an existing T3 attempt.')}</p>
            <ol className="mission-plan">{tasks.map(task=><li key={task.id}><div><strong>{task.title}</strong><Badge>{task.status}</Badge></div><p>{m.definition.outputs.find(o=>m.taskIds[o.key]===task.id)?.acceptance}</p><small>{t('ผู้รับผิดชอบ','Assigned to')}: {bots.find(b=>b.id===task.botId)?.name??t('ค่าเริ่มต้นของโปรเจกต์','Project default')}{!!task.dependsOn.length&&` · ${t('รอ','After')}: ${task.dependsOn.map(id=>tasks.find(x=>x.id===id)?.title??id).join(', ')}`}</small></li>)}</ol>
            {!m.goalId&&<button className="primary" disabled={busy||!!uncertain||!plan||m.definition.decisions.some(d=>!d.answer.trim())} onClick={()=>act('approve')}><FileCheck size={16}/>{t('Owner อนุมัติแผนนี้','Owner: approve this plan')}</button>}
            {g&&<><div className="actions">
              <button disabled={busy||!!uncertain||g.status!=='paused'} onClick={()=>execution('resume')}>{t('เปิดใช้งาน Goal','Resume goal')}</button>
              <button className="primary" disabled={busy||!!uncertain||g.status!=='active'} onClick={()=>execution('advance')}><Play size={15}/>{t('เริ่มงานถัดไป','Start next task')}</button>
              <button disabled={busy||!!uncertain} onClick={()=>execution('reconcile')}><RefreshCw size={15}/>{t('ตรวจผล run เดิม','Reconcile existing run')}</button>
              <button disabled={busy||!!uncertain||['completed','cancelled'].includes(g.status)} onClick={()=>execution('pause')}><Square size={14}/>{t('พักและหยุด run ที่เป็นเจ้าของ','Pause owned run')}</button>
              <button disabled={busy||!!uncertain||['completed','cancelled'].includes(g.status)} onClick={()=>execution('cancel')}>{t('ยุติ Goal','Cancel goal')}</button>
            </div><p className="help">{t('การพัก/เริ่มต่อไม่ล้างประวัติหรือเพิ่มเวลาที่อนุมัติ ผลไม่แน่นอนต้องตรวจ run เดิม ค่าใช้จ่ายที่ไม่ทราบไม่เท่ากับศูนย์','Pause/resume preserves attempts and elapsed limits. Unknown outcomes require reconciliation. Unknown cost is never treated as zero.')}</p>
              {g.blocker&&<p role={g.status==='completed'?'note':'alert'} className={g.status==='completed'?'help':'mission-alert'}>{g.status==='completed'?t('ตรวจรับงานแล้ว ข้อมูล token และค่าใช้จ่ายยังแยกตามหลักฐานที่ provider รายงาน โดยไม่ถือว่าค่าที่ขาดเป็นศูนย์','Delivery accepted. Usage and cost accounting follow provider evidence; missing reports remain unknown.'):['TOKENS_UNKNOWN','SPENDING_UNKNOWN'].includes(g.blocker.code)?t('ยังไม่เริ่มงานต่อ เพราะ provider ยังรายงานการใช้งานไม่ครบ ตรวจนโยบายใน Goals ก่อนดำเนินการต่อ','Continuation is blocked because provider usage reporting is incomplete. Review the policy in Goals before continuing.'):t('งานถึงขอบเขตของนโยบาย Goal แล้ว ตรวจผลและนโยบายก่อนเริ่มรอบใหม่','The goal policy blocked further work. Review results and limits before another attempt.')}</p>}
              <details><summary>{t('ประวัติ run และเกณฑ์ตรวจรับ','Runs and acceptance criteria')}</summary><Json value={{criteria:g.criteria,attempts:g.attempts,progress:g.progress,qa:g.qa,review:g.review}}/></details>
            </>}
          </section>
          {g&&<section className="mission-section"><h2>{t('ไฟล์จริงและหลักฐานทดสอบ','Files & test evidence')}</h2>
            <p className="help">{t('ลงทะเบียนไฟล์หลัง run เสร็จ ตรวจคำสั่งและ checksum ก่อนทดสอบ การเปิด preview ไม่ถือว่าผ่าน QA','Register completed-run files, then review commands and checksums before testing. Opening a preview does not pass QA. Tests execute reviewed local code; a worktree is not an OS sandbox.')}</p>
            {m.definition.outputs.map(o=>{
              const taskId=m.taskIds[o.key],rs=scoped(state,'runs',projectId).filter(r=>r.taskId===taskId&&r.status==='completed'&&g.attempts.some(a=>a.operationId===r.operationId)),x=outputs.filter(x=>x.outputKey===o.key).at(-1),review=data?.commandReviews?.find(x=>x.missionId===m.id&&x.outputKey===o.key),tests=scoped(state,'events',projectId).filter(e=>e.type==='mission.test'&&e.outputId===x?.id),last=tests.at(-1);
              return <div className="mission-output" key={o.key}><div className="mission-section-title"><h3>{o.name}</h3><Badge>{last?.status??(x?'registered':'missing')}</Badge></div><p><code>{o.path}</code> · {o.acceptance}</p>
                <form className="mission-inline-form" onSubmit={e=>{e.preventDefault();act('registerOutput',{outputKey:o.key,runId:new FormData(e.currentTarget).get('runId')});}}><Field label={t('run ที่เสร็จจริง','Completed run')}><select name="runId" required><option value="">{t('เลือก run','Choose run')}</option>{rs.map(r=><option key={r.id} value={r.id}>{r.id.slice(0,8)} · {r.selection?.model??'unknown'} · {r.attemptId?.slice(0,8)}</option>)}</select></Field><button disabled={busy||!!uncertain||!rs.length}>{t('ลงทะเบียนไฟล์','Register file bytes')}</button></form>
                {x&&<><dl className="mission-facts"><dt>SHA-256</dt><dd><code>{x.sha256}</code></dd><dt>{t('ขนาด','Size')}</dt><dd>{x.bytes} bytes</dd><dt>{t('แหล่งที่มา','Provenance')}</dt><dd>{x.provider?.model} · {x.runId} · {x.attemptId}</dd></dl>
                  {/\.html?$/i.test(o.path)&&<button disabled={busy||!!uncertain} onClick={async()=>{const p=await act('preview',{outputKey:o.key});if(p)setPreview(p);}}>{t('เปิด preview ในเครื่อง','Open local preview')}</button>}
                </>}
                {review&&<div className="mission-test-review"><h4>{t('ตรวจคำสั่งก่อนรัน','Review before running')}</h4><code className="mission-command">{review.command.join(' ')}</code><p className="help">{t('จำกัด 30 วินาที ไม่มีการเรียก package scripts อัตโนมัติ ต้องมี Python ในเครื่องสำหรับควบคุม process tree','30-second bound. No automatic package scripts. Local Python is required for owned process-tree cleanup.')}</p><ul>{review.sourceFiles.map(f=><li key={f.path}><code>{f.path}</code><small className="mission-hash">{f.sha256}</small></li>)}</ul><label className="mission-check"><input type="checkbox" checked={reviewed[o.key]===review.reviewDigest} onChange={e=>setReviewed({...reviewed,[o.key]:e.target.checked?review.reviewDigest:null})}/>{t('Owner ตรวจไฟล์และคำสั่งนี้แล้ว','Owner reviewed these files and this command')}</label><button disabled={busy||!!uncertain||reviewed[o.key]!==review.reviewDigest} onClick={()=>act('verify',{outputKey:o.key,runId:review.runId,reviewDigest:review.reviewDigest})}>{t('รันทดสอบที่ตรวจแล้ว','Run reviewed tests')}</button></div>}
                {last&&<details><summary>{t('ผลทดสอบจริง','Actual test result')} · {last.status}</summary><pre className="code">{last.result?.log??last.result?.error??t('ผลยังไม่แน่นอน ห้ามรันซ้ำอัตโนมัติ','Outcome unknown; never automatically replay')}</pre></details>}
                {last?.status==='PASSED'&&!g.verifications?.[taskId]&&<p className="help">{t('ทดสอบผ่านแล้ว กดตรวจผล run เดิมด้านบนเพื่อบันทึกเกณฑ์ตรวจรับก่อน QA','Tests passed. Use Reconcile existing run above to record the acceptance checks before QA.')}</p>}
                <button disabled={busy||!!uncertain||!x||last?.status!=='PASSED'||!g.verifications?.[taskId]||!!g.qa?.[taskId]} onClick={()=>act('qa',{taskId,expectedGoalRevision:g.revision})}>{t('ตรวจผล run แล้วรับรอง QA','Review run evidence & pass QA')}</button>
              </div>;
            })}
          </section>}
          {preview&&<section className="mission-section"><div className="mission-section-title"><h2>{t('ตัวอย่างไฟล์ที่ตรวจ checksum แล้ว','Verified file preview')}</h2><button disabled={busy} onClick={async()=>{await act('stopPreview',{previewId:preview.previewId});setPreview(null);}}>{t('หยุด preview','Stop preview')}</button></div><p className="help">{t('แสดง snapshot ไฟล์ที่ลงทะเบียนเท่านั้น ไม่เชื่อมเครือข่ายหรือส่งฟอร์ม หมดอายุใน 10 นาที','Immutable registered-file snapshot. Network connections and forms are blocked. Expires in 10 minutes.')}</p><iframe title={t('ตัวอย่างผลลัพธ์','Mission output preview')} src={preview.url} sandbox="allow-scripts" referrerPolicy="no-referrer"/></section>}
          {g&&<section className="mission-section"><h2>{t('ตรวจรับและส่งมอบ','Accept & deliver')}</h2><p>{t('ต้องผ่านผลทดสอบ QA และ Owner ตรวจรับก่อนสร้าง ZIP ไฟล์ต้นทางและผลทดสอบจะถูกตรวจซ้ำก่อนส่งมอบ','Tests, independent QA and final Owner review are required before ZIP creation. Source and evidence are rechecked during packaging.')}</p><div className="actions"><button disabled={busy||!!uncertain||g.status!=='awaiting_owner'} onClick={()=>act('review',{expectedGoalRevision:g.revision})}><FileCheck size={16}/>{t('Owner ตรวจรับงาน','Owner: accept delivery')}</button><button className="primary" disabled={busy||!!uncertain||g.status!=='completed'} onClick={()=>act('pack')}><PackageCheck size={16}/>{t('สร้าง Delivery Pack ZIP','Build Delivery Pack ZIP')}</button></div>
            <ul className="mission-pack-list">{packs.map(p=><li key={p.id}><a href={`/api/missions/${encodeURIComponent(p.id)}/download?projectId=${encodeURIComponent(projectId)}`} download={p.filename}><Download size={15}/>{p.filename}</a><small>{p.bytes} bytes · SHA-256 <span className="mission-hash">{p.sha256}</span></small></li>)}</ul>
            <p className="help">{t('ชุดส่งมอบรวมไฟล์ที่เลือก manifest checksum แหล่งที่มา ผลทดสอบ และสิ่งที่ยังไม่ตรวจ บ้าน/บัญชีจริงยังต้องทดสอบตามรายการ','Includes selected files, manifest, checksums, provenance, tests and unverified work. Home UAT and external qualification remain explicit.')}</p>
          </section>}
        </>}
      </div>
    </div>
  </div>;
}

function MissionForm({t,mission,bots,disabled,onSave,onCancel}){
  const empty=()=>({key:crypto.randomUUID().slice(0,8),name:'',path:'',acceptance:'',testFiles:[],sourcePaths:[],botId:bots[0]?.id??null,dependsOn:[]});
  const [d,set]=useState(()=>mission?structuredClone(mission.definition):{title:'',objective:'',constraints:'',inputs:'',outputs:[empty()],decisions:[]});
  const patch=(key,value)=>set(x=>({...x,[key]:value})),update=(index,key,value)=>set(x=>({...x,outputs:x.outputs.map((o,i)=>i===index?{...o,[key]:value}:o)}));
  const lines=value=>value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
  return <section className="mission-section"><h2>{mission?t('แก้ไขภารกิจเป็นฉบับใหม่','Revise mission'):t('คุณต้องการส่งมอบอะไร','What should this mission deliver?')}</h2><p className="help">{t('ระบุผลลัพธ์และเงื่อนไขตรวจรับ ระบบจะสร้างแผนจริงให้ตรวจทานก่อนเริ่มงาน','Describe outputs and measurable acceptance. FORGE creates the actual canonical plan for your review before execution.')}</p>
    <form onSubmit={e=>{e.preventDefault();onSave(d);}}>
      <Field label={t('ชื่อภารกิจ','Mission title')}><input required maxLength={180} value={d.title} onChange={e=>patch('title',e.target.value)}/></Field>
      <Field label={t('เป้าหมายและผู้ใช้ผลลัพธ์','Objective and intended user')}><textarea required rows={3} maxLength={4000} value={d.objective} onChange={e=>patch('objective',e.target.value)}/></Field>
      <div className="form-grid"><Field label={t('ข้อจำกัดและสิ่งที่ห้ามทำ','Constraints and exclusions')}><textarea rows={3} maxLength={4000} value={d.constraints} onChange={e=>patch('constraints',e.target.value)}/></Field><Field label={t('ข้อมูลและไฟล์ต้นทาง','Inputs and source material')}><textarea rows={3} maxLength={4000} value={d.inputs} onChange={e=>patch('inputs',e.target.value)}/></Field></div>
      <h3>{t('ไฟล์ที่คาดหวังและวิธีตรวจรับ','Expected files and acceptance')}</h3>
      {d.outputs.map((o,i)=><fieldset className="mission-output-form" key={o.key}><legend>{t('ผลลัพธ์','Deliverable')} {i+1}</legend>
        <div className="form-grid"><Field label={t('ชื่อผลลัพธ์','Deliverable name')}><input required maxLength={180} value={o.name} onChange={e=>update(i,'name',e.target.value)}/></Field><Field label={t('ไฟล์ปลายทางในโปรเจกต์ เช่น index.html','Project file, for example index.html')}><input required maxLength={240} value={o.path} onChange={e=>update(i,'path',e.target.value)}/></Field></div>
        <Field label={t('เกณฑ์ตรวจรับที่วัดได้','Measurable acceptance')}><textarea required rows={2} maxLength={2000} value={o.acceptance} onChange={e=>update(i,'acceptance',e.target.value)}/></Field>
        <div className="form-grid"><Field label={t('ไฟล์ทดสอบที่ Executor ต้องสร้าง (หนึ่งไฟล์ต่อบรรทัด)','Test files for the Executor to create (one per line)')} hint={t('ระบุชื่อไฟล์ .test.mjs เช่น tests/output.test.mjs ไม่ต้องเขียนคำสั่งเอง','Use .test.mjs paths such as tests/output.test.mjs; no command syntax needed.')}><textarea required rows={2} defaultValue={o.testFiles.join('\n')} onChange={e=>update(i,'testFiles',lines(e.target.value))}/></Field><Field label={t('ไฟล์ source อื่นที่ต้องแนบ (หนึ่งไฟล์ต่อบรรทัด)','Other source files to include (one per line)')}><textarea rows={2} defaultValue={o.sourcePaths.join('\n')} onChange={e=>update(i,'sourcePaths',lines(e.target.value))}/></Field></div>
        <div className="form-grid"><Field label={t('Executor ที่รับผิดชอบ','Assigned Executor')}><select value={o.botId??''} onChange={e=>update(i,'botId',e.target.value||null)}><option value="">{t('ค่าเริ่มต้นของโปรเจกต์','Project default')}</option>{bots.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          {!!i&&<Field label={t('งานที่ต้องเสร็จก่อน','Required earlier deliverables')}><select multiple value={o.dependsOn} onChange={e=>update(i,'dependsOn',[...e.target.selectedOptions].map(o=>o.value))}>{d.outputs.slice(0,i).map(x=><option key={x.key} value={x.key}>{x.name||t('ยังไม่มีชื่อ','Untitled')}</option>)}</select></Field>}
        </div>
        {d.outputs.length>1&&<button type="button" onClick={()=>set(x=>({...x,outputs:x.outputs.filter(y=>y.key!==o.key).map(y=>({...y,dependsOn:y.dependsOn.filter(k=>k!==o.key)}))}))}>{t('ลบผลลัพธ์นี้','Remove deliverable')}</button>}
      </fieldset>)}
      <button type="button" disabled={d.outputs.length>=12} onClick={()=>patch('outputs',[...d.outputs,empty()])}><Plus size={15}/>{t('เพิ่มผลลัพธ์','Add deliverable')}</button>
      <h3>{t('การตัดสินใจที่ยังไม่ชัดเจน','Decisions to clarify')}</h3><p className="help">{t('เพิ่มเฉพาะเรื่องที่ยังคลุมเครือหรือขัดแย้ง ต้องเลือกคำตอบก่อนอนุมัติ','Add only unclear or conflicting choices. Resolve each answer before approval.')}</p>
      {d.decisions.map((x,i)=><div className="mission-decision" key={x.id}><Field label={t('เรื่องที่ต้องตัดสินใจ','Decision question')}><input required value={x.question} onChange={e=>patch('decisions',d.decisions.map((v,n)=>n===i?{...v,question:e.target.value}:v))}/></Field><Field label={t('คำตอบที่เลือก (เว้นว่างเมื่อยังไม่ตัดสินใจ)','Selected answer (blank while unresolved)')}><input value={x.answer} onChange={e=>patch('decisions',d.decisions.map((v,n)=>n===i?{...v,answer:e.target.value}:v))}/></Field><button type="button" onClick={()=>patch('decisions',d.decisions.filter(v=>v.id!==x.id))}>{t('ลบคำถาม','Remove question')}</button></div>)}
      <button type="button" disabled={d.decisions.length>=12} onClick={()=>patch('decisions',[...d.decisions,{id:crypto.randomUUID(),question:'',answer:''}])}>{t('เพิ่มเรื่องที่ต้องตัดสินใจ','Add an unresolved decision')}</button>
      <div className="actions mission-save"><button className="primary" disabled={disabled}>{t('บันทึกและแสดงแผน','Save & show plan')}</button>{mission&&<button type="button" onClick={onCancel}>{t('กลับไปดูแผน','Back to plan')}</button>}</div>
    </form>
  </section>;
}
