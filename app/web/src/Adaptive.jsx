import React, {useEffect, useState} from 'react';
import {scoped} from './api.mjs';
import {Field, Heading, Badge, Empty, Json} from './ui.jsx';
import {useStrategy, StrategyStatus, TaskPicker, LimitsFields, Attempts, inactive} from './Assistance.jsx';

const linked = (artifact,run) => artifact.runId===run?.id || artifact.source?.runId===run?.id || run?.artifactIds?.includes(artifact.id);

// Pick only existing project records. These are references for the service to
// validate, never browser-created verifier receipts or executable checks.
function CheckBuilder({t,state,projectId,value,onChange,label,runId}) {
  const runs=scoped(state,'runs',projectId).filter(r=>!runId||r.id===runId);
  const artifacts=scoped(state,'artifacts',projectId),receipts=scoped(state,'events',projectId).filter(e=>e.type==='verification.result');
  const update=(index,patch)=>onChange(value.map((c,i)=>i===index?{...c,...patch}:c));
  return <fieldset><legend>{label}</legend>
    {!runs.length&&<Empty>{t('ยังไม่มีงานที่ใช้อ้างอิงได้ เริ่มงานและตรวจผลด้วยระบบเดิมก่อน','No existing run to reference. Execute and verify through the existing task pipeline first.')}</Empty>}
    {value.map((check,index)=>{const run=runs.find(r=>r.id===check.runId);return <fieldset key={index} style={{marginBottom:12}}><legend>{t('รายการตรวจ','Evidence check')} {index+1}</legend><div className="form-grid">
      <Field label={t('ชื่อรายการตรวจที่ใช้เปรียบเทียบ','Comparable check key')}><input required maxLength={120} value={check.key} onChange={e=>update(index,{key:e.target.value})}/></Field>
      <Field label={t('ประเภทหลักฐาน','Evidence kind')}><select value={check.kind} onChange={e=>onChange(value.map((c,i)=>i===index?{key:c.key,kind:e.target.value,runId:c.runId,...(e.target.value==='artifactHash'?{artifactId:'',sha256:''}:e.target.value==='verifierReceipt'?{receiptId:''}:{})}:c))}><option value="runStatus">{t('สถานะงานที่สั่งทำ','Run status')}</option><option value="artifactHash">{t('รหัสตรวจไฟล์ผลลัพธ์','Artifact hash')}</option><option value="verifierReceipt">{t('ผลตรวจที่บันทึกแล้ว','Stored verifier receipt')}</option></select></Field>
      <Field label={t('งานที่สร้างหลักฐานนี้','Evidence run')}><select required value={check.runId} onChange={e=>update(index,{runId:e.target.value,...(check.kind==='artifactHash'?{artifactId:'',sha256:''}:check.kind==='verifierReceipt'?{receiptId:''}:{})})}><option value="">{t('เลือกงานที่สั่งทำ','Choose run')}</option>{runs.map(r=><option key={r.id} value={r.id}>{r.id} · {r.status}</option>)}</select></Field>
      {check.kind==='artifactHash'&&<><Field label={t('ไฟล์ที่ผูกกับงานที่สั่งทำนี้','Artifact linked to this run')}><select required value={check.artifactId} onChange={e=>{const a=artifacts.find(a=>a.id===e.target.value);update(index,{artifactId:a?.id??'',sha256:a?.sha256??''});}}><option value="">{t('เลือกไฟล์ที่ตรวจแล้ว','Choose verified artifact')}</option>{artifacts.filter(a=>run&&linked(a,run)&&['verified','ready'].includes(a.status)).map(a=><option key={a.id} value={a.id}>{a.name} · r{a.revision}</option>)}</select></Field><Field label={t('SHA-256 ที่บันทึกไว้','Recorded SHA-256')}><input readOnly required value={check.sha256}/></Field></>}
      {check.kind==='verifierReceipt'&&<Field label={t('ผลตรวจที่ผูกกับงานที่สั่งทำนี้','Verifier receipt linked to this run')}><select required value={check.receiptId} onChange={e=>update(index,{receiptId:e.target.value})}><option value="">{t('เลือกผลตรวจจริง','Choose existing receipt')}</option>{receipts.filter(r=>r.runId===check.runId).map(r=><option key={r.id} value={r.id}>{r.id} · {r.status} · {r.verifier?.id||'unversioned'}</option>)}</select></Field>}
    </div><button type="button" onClick={()=>onChange(value.filter((_,i)=>i!==index))}>{t('ลบรายการตรวจนี้','Remove check')}</button></fieldset>;})}
    <button type="button" disabled={value.length>=24} onClick={()=>onChange([...value,{key:'',kind:'artifactHash',runId:runId??'',artifactId:'',sha256:''}])}>{t('เพิ่มรายการตรวจหลักฐาน','Add evidence check')}</button>
    <p className="help">{t('ต้องมีไฟล์หรือผลตรวจที่เชื่อมกับงานนั้นด้วย สถานะสำเร็จอย่างเดียวไม่พอ ระบบจะตรวจขอบเขต เวอร์ชัน และเนื้อหาไฟล์อีกครั้ง','Run success alone is insufficient. Include linked artifact or verifier evidence. The service rechecks scope, exact versions and actual bytes.')}</p>
  </fieldset>;
}

function CandidateForm({t,state,projectId,ui,busy,skill,onCreated}) {
  const [base]=useState(skill);
  const [version,setVersion]=useState(''),[instructions,setInstructions]=useState(base.instructions??''),[lesson,setLesson]=useState(''),[refs,setRefs]=useState([]);
  const evidence=[...scoped(state,'runs',projectId).map(x=>({kind:'run',x})),...scoped(state,'artifacts',projectId).map(x=>({kind:'artifact',x})),...scoped(state,'events',projectId).filter(e=>e.type==='verification.result').map(x=>({kind:'verification',x}))];
  return <form onSubmit={e=>{e.preventDefault();ui.act('candidate',{skillId:base.id,expectedRevision:base.revision,version,instructions,lesson,evidenceRefs:refs},onCreated);}}>
    <p>{base.name} · {base.version} · r{base.revision}</p>
    {skill.revision!==base.revision&&<p role="alert">{t('ทักษะต้นทางเปลี่ยนแล้ว เลือกใหม่ก่อนทำต่อ แบบร่างยังเก็บไว้','Base skill changed. Reselect before continuing. Your draft is retained.')}</p>}
    <Field label={t('เวอร์ชันใหม่','New version')}><input required maxLength={80} value={version} onChange={e=>setVersion(e.target.value)}/></Field>
    <Field label={t('คำสั่งของทักษะฉบับทดลอง','Candidate instructions')}><textarea required rows={6} maxLength={32000} value={instructions} onChange={e=>setInstructions(e.target.value)}/></Field>
    <Field label={t('บทเรียนจากหลักฐาน','Lesson from evidence')}><textarea required maxLength={4000} value={lesson} onChange={e=>setLesson(e.target.value)}/></Field>
    <fieldset><legend>{t('หลักฐานต้นทาง (เลือก 1–24)','Source evidence (choose 1–24)')}</legend>
      {!evidence.length&&<Empty>{t('ยังไม่มีหลักฐาน เริ่มงานหรือเพิ่มไฟล์ผลลัพธ์ที่มีที่มาก่อน','No source evidence. Create an attributable run or output artifact first.')}</Empty>}
      {evidence.map(({kind,x})=><label key={`${kind}:${x.id}`} style={{display:'block',overflowWrap:'anywhere'}}><input type="checkbox" checked={refs.some(r=>r.kind===kind&&r.id===x.id)} onChange={e=>setRefs(e.target.checked?[...refs,{kind,id:x.id}]:refs.filter(r=>r.kind!==kind||r.id!==x.id))}/> {kind} · {x.name||x.id} · {x.status||`r${x.revision}`}</label>)}
    </fieldset>
    <p className="help">{t('ทักษะฉบับทดลองยังไม่ได้เปิดใช้ การเลือกทดสอบไม่ได้อนุมัติให้ใช้งานจริง','A candidate remains inactive. Selecting it for a test does not promote it.')}</p>
    <button disabled={busy||skill.revision!==base.revision||!refs.length||refs.length>24||instructions===base.instructions||version===base.version}>{t('สร้างทักษะฉบับทดลองฉบับใหม่','Create versioned candidate')}</button>
  </form>;
}

function CandidateEvaluation({candidate,t,state,projectId,ui,busy}) {
  const [baselineChecks,setBaseline]=useState([]),[checks,setChecks]=useState([]),[evaluationId,setEvaluation]=useState(''),[reason,setReason]=useState('');
  const evaluations=(ui.data?.evaluations??[]).filter(e=>e.candidateId===candidate.id),evaluation=evaluations.find(e=>e.id===evaluationId);
  const [base]=useState(candidate);
  const stale=base.revision!==candidate.revision;
  return <><p>{candidate.name} · {candidate.version} · r{base.revision} · <Badge>{candidate.status}</Badge></p>
    {stale&&<p role="alert">{t('ทักษะฉบับทดลองเปลี่ยนแล้ว เลือกใหม่ก่อนทำต่อ','Candidate changed. Reselect it before continuing.')}</p>}
    <details><summary>{t('คำสั่งและที่มาของทักษะฉบับทดลอง','Candidate instructions and provenance')}</summary><Json value={candidate}/></details>
    <form onSubmit={e=>{e.preventDefault();ui.act('evaluate',{candidateId:base.id,expectedRevision:base.revision,baselineChecks,checks},r=>setEvaluation(r.id));}}>
      <p>{t('หลักฐานทั้งสองชุดต้องใช้ชื่อรายการและประเภทเดียวกัน งานที่อ้างอิงต้องเคยใช้ทักษะเวอร์ชันนั้นจริง ข้อความของโมเดลใช้แทนผลตรวจไม่ได้','Both suites need matching keys and kinds. Each run must have consumed its exact skill version. Model prose cannot create a verification receipt.')}</p>
      <CheckBuilder {...{t,state,projectId}} label={t('หลักฐานฉบับเดิม','Baseline evidence')} value={baselineChecks} onChange={setBaseline}/>
      <CheckBuilder {...{t,state,projectId}} label={t('หลักฐานทักษะฉบับทดลอง','Candidate evidence')} value={checks} onChange={setChecks}/>
      <button disabled={busy||stale||candidate.status!=='candidate'||!checks.length||!baselineChecks.length}>{t('ประเมินหลักฐานทั้งสองชุด','Evaluate both evidence suites')}</button>
    </form>
    <Field label={t('ผลประเมินที่บันทึกไว้','Saved evaluation')}><select value={evaluationId} onChange={e=>setEvaluation(e.target.value)}><option value="">{t('เลือกผลประเมิน','Choose evaluation')}</option>{evaluations.map(e=><option key={e.id} value={e.id}>{e.status} · {e.id}</option>)}</select></Field>
    {evaluation&&<Json value={evaluation}/>}
    <form onSubmit={e=>{e.preventDefault();ui.act('promote',{candidateId:base.id,expectedRevision:base.revision,evaluationId,reason});}}>
      <Field label={t('เหตุผลการเปิดใช้ทักษะ','Promotion reason')}><textarea required maxLength={4000} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
      <button disabled={busy||stale||candidate.status!=='candidate'||evaluation?.status!=='PASSED'}>{t('เปิดใช้ทักษะหลังตรวจหลักฐานซ้ำ','Promote after evidence revalidation')}</button>
    </form>
  </>;
}

function RollbackForm({promotion,candidate,t,ui,busy}) {
  const [reason,setReason]=useState(''),[base]=useState(candidate);
  return <form onSubmit={e=>{e.preventDefault();ui.act('rollback',{promotionId:promotion.id,expectedRevision:base.revision,reason});}}><p>{promotion.id} · {candidate.name} {candidate.version} · r{base.revision}</p><Field label={t('เหตุผลย้อนเวอร์ชัน','Rollback reason')}><textarea required maxLength={4000} value={reason} onChange={e=>setReason(e.target.value)}/></Field><button disabled={busy||candidate.revision!==base.revision||candidate.status!=='active'}>{t('ย้อนกลับไปเวอร์ชันก่อนหน้า','Roll back to previous version')}</button><details><summary>{t('ประวัติการเปิดใช้ทักษะ','Promotion history')}</summary><Json value={promotion}/></details></form>;
}

function AdaptiveLoop({loop,t,state,projectId,ui,busy,decisions}) {
  const [checks,setChecks]=useState([]),[feedback,setFeedback]=useState(''),[reviewer,setReviewer]=useState(''),[replacement,setReplacement]=useState(''),[retry,setRetry]=useState(false);
  const last=loop.attempts?.at(-1),body={loopId:loop.id,expectedRevision:loop.revision};
  const uncertain=['running','submitting','unknown','stopping'].includes(loop.status);
  const pending=!!ui.uncertain.length;
  const labels={plan:t('ใช้แผนที่มนุษย์อนุมัติ','Use human-approved plan'),execute:t('ส่งงานผ่าน T3','Dispatch through T3'),inspect:t('ตรวจหลักฐานผลลัพธ์','Inspect output evidence'),revise:t('บันทึกการแก้ไขและกลับไปขั้นแผน','Save revision and return to plan'),review:t('ยืนยันการตรวจผลรอบการทำงาน','Approve loop review')};
  return <section className="panel"><h2>{t('รอบการทำงานที่กำหนดขอบเขต','Bounded task loop')}</h2><Attempts {...{loop,t,state,projectId}}/>
    <div className="toolbar"><button disabled={busy} onClick={()=>ui.act('reconcile',body)}>{t('ตรวจสถานะเดิม','Reconcile loop')}</button><button disabled={busy||inactive.has(loop.status)} onClick={()=>ui.act('stop',body)}>{t('หยุดงานในรอบนี้','Stop owned loop')}</button></div>
    {uncertain&&<p>{t('ยังมีงานหรือผลที่ไม่ทราบ ตรวจสถานะเดิมก่อน ระบบไม่ส่งครั้งใหม่อัตโนมัติ','An active or uncertain outcome remains. Reconcile the same attempt. No new attempt is automatically dispatched.')}</p>}
    <form onSubmit={e=>{e.preventDefault();ui.act('advance',{...body,...(loop.stage==='inspect'?{checks}:{}),...(loop.stage==='revise'?{feedback,...(replacement?{decisionId:replacement}:{})}:{}),...(loop.stage==='review'?{action:'approve',reviewer}:{})});}}>
      {loop.stage==='inspect'&&<CheckBuilder {...{t,state,projectId}} runId={last?.runId} label={t('หลักฐานของครั้งนี้','Current attempt evidence')} value={checks} onChange={setChecks}/>}
      {loop.stage==='revise'&&<><Field label={t('ข้อเสนอแนะการแก้ไข','Revision feedback')}><textarea required maxLength={4000} value={feedback} onChange={e=>setFeedback(e.target.value)}/></Field><Field label={t('การเลือกใหม่ถ้าขอบเขตเปลี่ยน','Replacement decision if scope changed')}><select value={replacement} onChange={e=>setReplacement(e.target.value)}><option value="">{t('ใช้การเลือกเดิม','Keep existing decision')}</option>{decisions.filter(d=>d.taskId===loop.taskId&&d.status==='selected').map(d=><option key={d.id} value={d.id}>{d.id}</option>)}</select></Field></>}
      {loop.stage==='review'&&<Field label={t('ผู้ตรวจ','Reviewer')}><input required maxLength={200} value={reviewer} onChange={e=>setReviewer(e.target.value)}/></Field>}
      <button className="primary" disabled={busy||pending||inactive.has(loop.status)||loop.status==='stopped'||uncertain||(loop.stage==='inspect'&&!checks.length)}>{labels[loop.stage]||t('ทำขั้นตอนถัดไป','Advance current stage')}</button>
    </form>
    {(loop.status==='stopped'||loop.status==='unknown')&&<form onSubmit={e=>{e.preventDefault();ui.act('resume',{...body,...(retry?{retryReservation:true}:{})});}}>
      {loop.status==='unknown'&&!last?.runId&&<label><input type="checkbox" checked={retry} onChange={e=>setRetry(e.target.checked)}/> {t('ตรวจสถานะแล้ว และอนุญาตให้ส่งคำขอจองเดิมซ้ำโดยใช้รหัสคำสั่งเดิมเท่านั้น','After reconciliation: allow replay of the same reservation and operation ID only')}</label>}
      <div className="actions"><button disabled={busy||pending||(loop.status==='unknown'&&(!!last?.runId||!retry))}>{t('กลับสู่รอบการทำงานโดยไม่เพิ่มเวลา','Resume within original deadline')}</button></div>
    </form>}
    <p className="help">{t('การตรวจรอบการทำงานไม่ทำให้งานบนบอร์ดเสร็จอัตโนมัติ หากจะควบคุมเอง ให้หยุดงานและรอจนยืนยันว่าหยุดแล้วก่อนใช้ตัวควบคุมเดิม','Loop review does not automatically finish the board task. To take over, Stop and wait for a terminal result before using the existing controller.')}</p>
  </section>;
}

export default function Adaptive({t,state,projectId,run,busy}) {
  const ui=useStrategy({projectId,run,service:'adaptive',readAction:'status'});
  const [taskId,setTask]=useState(''),[decisionId,setDecision]=useState(''),[loopId,setLoop]=useState(''),[skills,setSkills]=useState([]),[candidateId,setCandidate]=useState(''),[baseId,setBase]=useState(''),[promotionId,setPromotion]=useState('');
  const [limits,setLimits]=useState({maxAttempts:2,maxSteps:16,maxMs:300000});
  const allSkills=scoped(state,'skills',projectId),active=allSkills.filter(s=>s.status==='active'),base=active.find(s=>s.id===baseId);
  const candidates=ui.data?.candidates??[],candidate=candidates.find(c=>c.id===candidateId);
  const decisions=(ui.data?.decisions??[]).filter(d=>d.taskId===taskId),decision=decisions.find(d=>d.id===decisionId);
  const loops=(ui.data?.loops??[]).filter(l=>l.taskId===taskId),loop=loops.find(l=>l.id===loopId);
  const promotion=(ui.data?.history??[]).find(p=>p.id===promotionId),promoted=allSkills.find(s=>s.id===promotion?.candidateId);
  const disabled=busy||ui.loading,pending=!!ui.uncertain.length;
  useEffect(()=>{setTask('');setDecision('');setLoop('');setSkills([]);setCandidate('');setBase('');setPromotion('');},[projectId]);
  return <>
    <Heading title={t('ทักษะและการปรับปรุง','Adaptive skills & loops')} description={t('เลือกทักษะจากความสามารถจริง ตรวจหลักฐานฉบับใหม่ และเดินหน้าทีละขั้นผ่าน T3 เดิม','Select skills against observed capabilities, evaluate versioned evidence and advance one stage at a time through the existing T3 owner.')}><button disabled={disabled} onClick={ui.refresh}>{t('โหลดข้อมูลล่าสุด','Refresh strategy')}</button></Heading>
    <StrategyStatus {...{ui,t}}/>
    <section className="panel"><h2>{t('เลือกทักษะและเส้นทางสำหรับงาน','Select task skills and harness')}</h2>
      <p className="help">{t('ใช้โมเดลและตัวเลือกที่ตั้งไว้ในโปรเจกต์ เปลี่ยนได้ที่ตั้งค่าแล้วเลือกใหม่ กฎนี้ไม่ได้เรียนรู้เพื่อปรับการเลือกเอง และยังไม่พิสูจน์ว่าคุณภาพดีขึ้น','Uses the configured project model and options. Change Settings and select again when needed. Rule-based selection is not a learned optimizer or proof of improved quality.')}</p>
      <form onSubmit={e=>{e.preventDefault();ui.act('select',{taskId,constraints:{...(skills.length?{skillIds:skills}:{}),...(candidateId?{candidateId}:{})}},d=>setDecision(d.id));}}>
        <TaskPicker {...{t,state,projectId}} value={taskId} onChange={id=>{setTask(id);setDecision('');setLoop('');}}/>
        <fieldset><legend>{t('ทักษะที่เปิดใช้ (ไม่เลือก = ให้กฎเลือก)','Active skills (empty = rule selection)')}</legend>
          {!active.length&&<Empty>{t('ยังไม่มีทักษะที่เปิดใช้ ระบบอาจเลือกให้ทำงานโดยไม่มีทักษะได้ แต่การสร้างฉบับทดลองต้องมีทักษะต้นทางก่อน','No active skills. Selection may use an empty set; candidates require a real base skill.')}</Empty>}
          {active.map(s=><label key={s.id} style={{display:'block'}}><input type="checkbox" checked={skills.includes(s.id)} onChange={e=>setSkills(e.target.checked?[...skills,s.id]:skills.filter(id=>id!==s.id))}/> {s.name} · {s.version}</label>)}
        </fieldset>
        <Field label={t('เลือกทักษะฉบับทดลองเพื่อทดสอบ','Explicit candidate test')}><select value={candidateId} onChange={e=>setCandidate(e.target.value)}><option value="">{t('ไม่ใช้ทักษะฉบับทดลอง','No candidate')}</option>{candidates.filter(c=>c.status==='candidate').map(c=><option key={c.id} value={c.id}>{c.name} · {c.version}</option>)}</select></Field>
        <button className="primary" disabled={disabled||pending||!taskId}>{t('บันทึกการเลือกพร้อมเหตุผล','Select and record reasons')}</button>
      </form>
      <Field label={t('การตัดสินใจที่บันทึกไว้','Saved decision')}><select value={decisionId} onChange={e=>setDecision(e.target.value)}><option value="">{t('เลือกการตัดสินใจ','Choose decision')}</option>{decisions.map(d=><option key={d.id} value={d.id}>{d.status} · {d.id}</option>)}</select></Field>
      {decision&&<><Badge>{decision.status}</Badge>{(decision.rejections??[]).map((r,i)=><p key={i}>{r.reason||r.code}: {r.action||r.message||r.skillId||''}</p>)}<Json value={{harness:decision.harness,skills:decision.skills,qualifications:decision.qualifications}}/><details><summary>{t('ความสามารถ เหตุผล และที่มาทั้งหมด','Capabilities, reasons and provenance')}</summary><Json value={decision}/></details></>}
    </section>
    <section className="panel"><h2>{t('สร้างรอบการทำงานที่มีขอบเขต','Create bounded task loop')}</h2><form onSubmit={e=>{e.preventDefault();ui.act('create-loop',{taskId,decisionId,limits},l=>setLoop(l.id));}}><LimitsFields t={t} value={limits} onChange={setLimits}/><p className="help">{t('แต่ละขั้นต้องมีคำสั่งจากคุณ ระบบไม่ส่งงานต่ออัตโนมัติ และเริ่มส่งงานหลังอนุมัติแผนเท่านั้น','Each stage needs your command. No automatic dispatch; execution starts only after human plan approval.')}</p><button disabled={disabled||pending||decision?.status!=='selected'}>{t('สร้างรอบการทำงานตามการเลือกนี้','Create loop from this decision')}</button></form></section>
    <Field label={t('รอบการทำงานที่บันทึกไว้','Saved loop')}><select value={loopId} onChange={e=>setLoop(e.target.value)}><option value="">{t('เลือกรอบการทำงาน','Choose loop')}</option>{loops.map(l=><option key={l.id} value={l.id}>{l.stage} · {l.status} · {l.id}</option>)}</select></Field>
    {loop&&<AdaptiveLoop key={loop.id} {...{loop,t,state,projectId,ui,decisions}} busy={disabled}/>}
    <section className="panel"><h2>{t('ทักษะฉบับทดลองที่มีเวอร์ชันและหลักฐาน','Versioned improvement candidate')}</h2><Field label={t('ทักษะที่เปิดใช้และต้องการปรับปรุง','Active base skill')}><select value={baseId} onChange={e=>setBase(e.target.value)}><option value="">{t('เลือกทักษะจริง','Choose existing skill')}</option>{active.map(s=><option key={s.id} value={s.id}>{s.name} · {s.version} · r{s.revision}</option>)}</select></Field>
      {base&&<CandidateForm key={base.id} {...{t,state,projectId,ui}} skill={base} busy={disabled||pending} onCreated={c=>setCandidate(c.id)}/>}
    </section>
    <section className="panel"><h2>{t('ประเมินและเปิดใช้ทักษะ','Evaluate and promote')}</h2><Field label={t('ทักษะฉบับทดลองที่จะประเมิน','Candidate to evaluate')}><select value={candidateId} onChange={e=>setCandidate(e.target.value)}><option value="">{t('เลือกทักษะฉบับทดลอง','Choose candidate')}</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.name} · {c.version} · {c.status}</option>)}</select></Field>
      {candidate?<CandidateEvaluation key={candidate.id} {...{candidate,t,state,projectId,ui}} busy={disabled||pending}/>:<Empty>{t('สร้างทักษะฉบับทดลองจากทักษะและหลักฐานก่อน ยังไม่มีข้อมูลทดสอบที่พิสูจน์การปรับปรุง','Create a candidate from an existing skill and evidence first. No improvement evidence is assumed.')}</Empty>}
    </section>
    <section className="panel"><h2>{t('ย้อนเวอร์ชันพร้อมประวัติ','Rollback with provenance')}</h2><Field label={t('การเปิดใช้ทักษะที่จะย้อน','Promotion to roll back')}><select value={promotionId} onChange={e=>setPromotion(e.target.value)}><option value="">{t('เลือกการเปิดใช้ทักษะ','Choose promotion')}</option>{(ui.data?.history??[]).filter(p=>p.action==='promote').map(p=><option key={p.id} value={p.id}>{p.candidateId} · {p.id}</option>)}</select></Field>{promotion&&promoted&&<RollbackForm key={`${promotion.id}:${promoted.revision}`} {...{promotion,t,ui}} candidate={promoted} busy={disabled||pending}/>}</section>
  </>;
}
