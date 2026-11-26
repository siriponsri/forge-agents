import React,{useEffect,useState} from 'react';
import {scoped} from './api.mjs';
import {Heading,Field,Badge,Empty,Json} from './ui.jsx';
import {useStrategy,StrategyStatus} from './Assistance.jsx';
import {presets as compiledPresets} from '../../playbooks/presets.mjs';
import './workflow-presets.css';

const fields=[['objective','เป้าหมาย','Objective'],['inputsScope','ข้อมูลและขอบเขต','Inputs and scope'],['acceptance','เกณฑ์ว่างานเสร็จ','Acceptance criteria'],['interfacesDependencies','ส่วนที่ต้องเชื่อมต่อและสิ่งที่ต้องพร้อมก่อน','Interfaces and dependencies'],['risksDecisions','ความเสี่ยง เกณฑ์หยุด และการตัดสินใจ','Risks, stop criteria and decisions']];
const blankBrief=()=>Object.fromEntries(fields.map(([key])=>[key,'']));
const output=()=>({key:crypto.randomUUID(),name:'',path:'',acceptance:'',testFiles:[],sourcePaths:[],botId:null,dependsOn:[]});
const lines=value=>value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
export default function WorkflowPresets(props){return <WorkflowPage key={props.projectId} {...props}/>;}
function WorkflowPage({t,state,projectId,run,busy}){
  const ui=useStrategy({projectId,run,service:'playbooks',readAction:'state'});
  const [selected,setSelected]=useState(''),[editing,setEditing]=useState(false);
  useEffect(()=>{void ui.refresh();},[state?.revision,ui.refresh]);
  const data=ui.data,w=data?.workflows.find(x=>x.id===selected),b=data?.briefs.find(x=>x.id===w?.briefId),disabled=busy||ui.loading||!!ui.uncertain.length;
  const act=(method,extra={},onSuccess)=>ui.act(method,{...(w?{workflowId:w.id,expectedRevision:w.revision}:{}),...extra},onSuccess);
  const reviews=(data?.reviews??[]).filter(r=>r.workflowId===w?.id),lessons=(data?.lessons??[]).filter(l=>l.workflowId===w?.id);
  const pending=[...(data?.materializations??[]),...(data?.lessons??[])].find(x=>x.id===w?.pending?.id);
  const choose=id=>{setSelected(id);setEditing(false);};
  if(!projectId)return <Empty>{t('เลือกโปรเจกต์ก่อน','Select a project first.')}</Empty>;
  return <div className="workflow-presets">
    <Heading title={t('รูปแบบการทำงาน','Workflow presets')} description={t('เริ่มด้วยสรุปงานห้าส่วน แล้วเชื่อมภารกิจการตรวจผล และบทเรียนจากหลักฐาน','Start with a five-part brief, then link a Mission, evidence review and draft lessons.')}>
      <button type="button" disabled={disabled} onClick={()=>choose('')}>{t('สรุปงานใหม่','New brief')}</button><button type="button" disabled={ui.loading} onClick={()=>void ui.refresh()}>{t('โหลดข้อมูลล่าสุด','Refresh state')}</button>
    </Heading>
    <StrategyStatus ui={ui} t={t}/>
    <p className="help">{t('เลือกแนวทางทำงานซ้ำ ตามลำดับงาน หรือปรับตามสถานการณ์ได้ การเลือกยังไม่เริ่มงาน ตั้งโมเดลในหน้าบริการ AI และกลยุทธ์ผู้ช่วยจากรายชื่อที่เชื่อมต่อจริง','Loop / Graph / Dynamic describe reviewable patterns. Selecting one saves a draft. Choose models through Providers and Assistance using the connected catalog.')}</p>
    <div className="workflow-layout">
      <nav aria-label={t('สรุปงานที่บันทึกไว้','Saved workflow briefs')} className="workflow-list">
        {(data?.workflows??[]).map(x=><button key={x.id} type="button" aria-pressed={selected===x.id} onClick={()=>choose(x.id)}><strong>{x.title}</strong><small>{x.preset.pattern} · {t('ฉบับ','Revision')} {x.briefRevision} · {x.status}</small></button>)}
        {!data?.workflows.length&&<Empty>{t('ยังไม่มีสรุปงาน','No saved briefs yet.')}</Empty>}
      </nav>
      <div className="workflow-main">
        {(!w||editing)&&<BriefEditor key={`${w?.id??'new'}:${b?.id??''}`} {...{t,disabled}} presets={data?.presets??compiledPresets()} workflow={w} saved={b} onCancel={()=>setEditing(false)} onSave={body=>act(w?'revise':'create',body,r=>choose(r.id))}/>}
        {w&&b&&!editing&&<>
          <section className="panel"><h2>{w.title}</h2><Badge>{w.status}</Badge><p>{w.preset.name[t('th','en')]} · {w.preset.pattern} · v{w.preset.version}</p>
            <dl className="workflow-brief">{fields.map(([key,th,en])=><React.Fragment key={key}><dt>{t(th,en)}</dt><dd>{b.brief[key]}</dd></React.Fragment>)}</dl>
            {b.decisions.length>0&&<ul>{b.decisions.map(d=><li key={d.id}><strong>{d.question}</strong>: {d.answer||t('ยังไม่ตัดสินใจ','Unresolved')}</li>)}</ul>}
            {w.restoreReviewRequired&&<p role="alert">{t('ข้อมูลผ่านการกู้คืน ตรวจและบันทึกสรุปงานฉบับใหม่ก่อนทำต่อ','Restored metadata: review and save a new brief revision before continuing.')}</p>}
            <button type="button" disabled={disabled||!!w.pending} onClick={()=>setEditing(true)}>{t('แก้ไขสรุปงานเป็นฉบับใหม่','Revise brief')}</button>
            <details><summary>{t('รูปแบบ ขั้นตอน และที่มา','Pattern, steps and provenance')}</summary><Json value={{steps:w.preset.steps,owners:w.preset.owners,source:w.preset.source}}/></details>
          </section>
          {pending&&<section className="panel" role="status"><h2>{t('คำสั่งที่จองไว้','Reserved command')}</h2><p>{t('ตรวจภารกิจหรือความจำของ AI เดิม แล้วส่งคำขอเดิมด้วยรหัสเดิมเพื่อเชื่อมผล ระบบไม่เริ่มงานที่สั่งทำ','Inspect the existing Mission or Memory, then reconcile the same request and operation ID. This does not start a run.')}</p><button type="button" disabled={busy||ui.loading} onClick={()=>ui.act(pending.type==='playbook.lesson'?'proposeLesson':'materialize',pending.request)}>{t('ตรวจคำขอเดิม','Recover exact request')}</button></section>}
          {!w.missionId&&!w.pending&&!w.restoreReviewRequired&&<MissionDraft key={b.id} {...{t,b,state,projectId}} disabled={disabled||b.decisions.some(d=>!d.answer)} onSave={definition=>act('materialize',{definition})}/>}
          {w.missionId&&<section className="panel"><h2>{t('ภารกิจที่เชื่อมไว้','Linked Mission')}</h2><p>{scoped(state,'events',projectId).find(e=>e.id===w.missionId)?.definition?.title??w.title}</p><p className="help">{t('เปิดหน้าภารกิจเพื่อตรวจแผน อนุมัติ เริ่มงาน และตรวจหลักฐาน งานใช้แผนงานและงานย่อยเดิมทั้งหมด','Open Missions to review the plan, approve, execute and verify outputs. It uses the existing canonical Plan and Tasks.')}</p><code>{w.missionId}</code></section>}
          {w.missionId&&<EvidenceReview key={`${w.id}:${w.briefId}`} {...{t,state,projectId,w}} disabled={disabled||!!w.pending||w.restoreReviewRequired} onSave={body=>act('review',body)}/>}
          <section className="panel"><h2>{t('ข้อค้นพบจากการตรวจ','Review findings')}</h2><p className="help">{t('บันทึกนี้เป็นข้อสังเกตของเจ้าของเท่านั้น ตรวจคุณภาพและรับงานในหน้าภารกิจหรือเป้าหมาย','These are Owner observations. QA and delivery acceptance remain in Mission / Goals.')}</p>
            {!reviews.length&&<Empty>{t('ยังไม่มีการตรวจที่อ้างหลักฐาน','No evidence-linked review yet.')}</Empty>}
            {reviews.map(r=><article key={r.id}><h3>{t('การตรวจฉบับ','Review version')} {r.reviewVersion} · {r.evidenceStatus==='current'?t('หลักฐานปัจจุบัน','Evidence current'):t('หลักฐานเก่า ต้องตรวจใหม่','Stale evidence; review again')}</h3><ul>{r.findings.map((f,i)=><li key={i}><strong>{t(...({observation:['ข้อสังเกต','Observation'],risk:['ความเสี่ยง','Risk'],blocker:['ข้อขัดข้อง','Blocker'],question:['คำถาม','Question']}[f.label]))}</strong>: {f.text}</li>)}</ul><details><summary>{t('ฉบับหลักฐานและการเลือกโมเดลที่สังเกตจริง','Evidence revisions and observed provider selection')}</summary><Json value={r.evidence}/></details></article>)}
          </section>
          <LessonDraft key={`${w.id}:${reviews.at(-1)?.id??''}`} {...{t}} reviews={reviews.filter(r=>r.evidenceStatus==='current')} disabled={disabled||!!w.pending||w.restoreReviewRequired} onSave={body=>act('proposeLesson',body)}/>
          {!!lessons.length&&<section className="panel"><h2>{t('บทเรียนที่บันทึกไว้','Saved lessons')}</h2>{lessons.map(l=><p key={l.id}>{l.payload.title} · {l.status} · {l.memory?.lessonStatus??t('ยังไม่มีความจำของ AI ที่เชื่อมไว้','No linked Memory')} {l.memoryId&&<code>{l.memoryId}</code>}</p>)}<p className="help">{t('เปิดหน้าความจำของ AI เพื่อเสนอฉบับทดลองของทักษะที่ใช้อยู่ จากนั้นวัดผลและอนุมัติในหน้าทักษะและการปรับปรุง','Open Memory to propose a candidate against a current active skill, then evaluate and promote through existing Adaptive review.')}</p></section>}
        </>}
      </div>
    </div>
  </div>;
}

function BriefEditor({t,presets,workflow,saved,disabled,onSave,onCancel}){
  const [title,setTitle]=useState(saved?.title??''),[presetId,setPreset]=useState(workflow?.preset.id??'software-delivery'),[value,setValue]=useState(saved?.brief??blankBrief),[choices,setChoices]=useState(saved?.decisions??[]),[baseRevision]=useState(workflow?.revision);
  const preset=presets.find(p=>p.id===presetId);
  return <section className="panel"><h2>{t('สรุปงานห้าส่วน','Five-part brief')}</h2><form onSubmit={e=>{e.preventDefault();onSave({title,brief:value,decisions:choices,...(workflow?{expectedRevision:baseRevision}:{presetId})});}}>
    {!workflow&&<Field label={t('รูปแบบเริ่มต้น','Workflow preset')}><select value={presetId} onChange={e=>setPreset(e.target.value)}>{presets.map(p=><option key={p.id} value={p.id}>{p.name[t('th','en')]} · {p.pattern}</option>)}</select></Field>}
    {preset&&<p className="help">{preset.description[t('th','en')]}</p>}
    <Field label={t('ชื่อสรุปงาน','Brief title')}><input required maxLength={180} value={title} onChange={e=>setTitle(e.target.value)}/></Field>
    {fields.map(([key,th,en])=><Field key={key} label={t(th,en)}><textarea required maxLength={4000} rows={3} value={value[key]} onChange={e=>setValue(v=>({...v,[key]:e.target.value}))}/></Field>)}
    <h3>{t('เรื่องที่ยังต้องตัดสินใจ','Decisions to resolve')}</h3>
    {choices.map((d,i)=><fieldset key={d.id}><legend>{t('การตัดสินใจ','Decision')} {i+1}</legend><Field label={t('คำถาม','Question')}><input required maxLength={2000} value={d.question} onChange={e=>setChoices(v=>v.map((x,n)=>n===i?{...x,question:e.target.value}:x))}/></Field><Field label={t('คำตอบ (เว้นว่างถ้ายังไม่ทราบ)','Answer (blank when unknown)')}><input maxLength={2000} value={d.answer} onChange={e=>setChoices(v=>v.map((x,n)=>n===i?{...x,answer:e.target.value}:x))}/></Field><button type="button" onClick={()=>setChoices(v=>v.filter(x=>x.id!==d.id))}>{t('ลบคำถาม','Remove question')}</button></fieldset>)}
    <div className="actions"><button type="button" disabled={disabled||choices.length>=12} onClick={()=>setChoices(v=>[...v,{id:crypto.randomUUID(),question:'',answer:''}])}>{t('เพิ่มเรื่องที่ต้องตัดสินใจ','Add decision')}</button><button className="primary" disabled={disabled}>{t('บันทึกสรุปงานฉบับร่าง','Save draft brief')}</button>{workflow&&<button type="button" onClick={onCancel}>{t('ยกเลิกการแก้','Discard edit')}</button>}</div>
  </form></section>;
}

function MissionDraft({t,b,state,projectId,disabled,onSave}){
  const [outputs,setOutputs]=useState(()=>[output()]),[reviewed,setReviewed]=useState(false);
  const bots=scoped(state,'bots',projectId),change=(i,key,value)=>{setReviewed(false);setOutputs(v=>v.map((o,n)=>n===i?{...o,[key]:value}:o));};
  const definition={title:b.title,objective:b.brief.objective,inputs:b.brief.inputsScope,constraints:`Acceptance: ${b.brief.acceptance}\nInterfaces/dependencies: ${b.brief.interfacesDependencies}\nRisks/decisions: ${b.brief.risksDecisions}`,outputs,decisions:b.decisions};
  return <section className="panel"><h2>{t('ตรวจทานภารกิจฉบับร่าง','Review Mission draft')}</h2><p className="help">{t('สรุปงานนี้จะเป็นเป้าหมายและข้อมูลต้นทางของภารกิจระบุไฟล์และเกณฑ์ว่างานเสร็จก่อนสร้างแผนที่ยังไม่อนุมัติ','This brief becomes the Mission objective and inputs. Select files and acceptance criteria to create an unapproved canonical plan.')}</p><form onSubmit={e=>{e.preventDefault();onSave(definition);}}>
    {outputs.map((o,i)=><fieldset key={o.key}><legend>{t('ผลลัพธ์','Deliverable')} {i+1}</legend>
      <div className="form-grid"><Field label={t('ชื่อผลลัพธ์','Deliverable name')}><input required maxLength={180} value={o.name} onChange={e=>change(i,'name',e.target.value)}/></Field><Field label={t('ไฟล์ปลายทางในโปรเจกต์','Output file in project')}><input required maxLength={240} value={o.path} onChange={e=>change(i,'path',e.target.value)}/></Field></div>
      <Field label={t('เกณฑ์ว่างานเสร็จสำหรับผลลัพธ์นี้','Acceptance for this deliverable')}><textarea required rows={2} maxLength={2000} value={o.acceptance} onChange={e=>change(i,'acceptance',e.target.value)}/></Field>
      <Field label={t('ไฟล์ทดสอบ JavaScript (หนึ่งไฟล์ต่อบรรทัด)','JavaScript test files (one per line)')}><textarea required rows={2} value={o.testFiles.join('\n')} onChange={e=>change(i,'testFiles',lines(e.target.value))}/></Field>
      <Field label={t('ไฟล์ต้นฉบับอื่น (หนึ่งไฟล์ต่อบรรทัด)','Other source files (one per line)')}><textarea rows={2} value={o.sourcePaths.join('\n')} onChange={e=>change(i,'sourcePaths',lines(e.target.value))}/></Field>
      <div className="form-grid"><Field label={t('Executor','Executor')}><select value={o.botId??''} onChange={e=>change(i,'botId',e.target.value||null)}><option value="">{t('ค่าเริ่มต้นของโปรเจกต์','Project default')}</option>{bots.map(bot=><option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></Field>
        {i>0&&<Field label={t('งานที่ต้องเสร็จก่อน','Earlier dependencies')}><select multiple value={o.dependsOn} onChange={e=>change(i,'dependsOn',[...e.target.selectedOptions].map(x=>x.value))}>{outputs.slice(0,i).map(x=><option key={x.key} value={x.key}>{x.name||t('ยังไม่มีชื่อ','Untitled')}</option>)}</select></Field>}
      </div>
      {outputs.length>1&&<button type="button" onClick={()=>{setReviewed(false);setOutputs(v=>v.filter(x=>x.key!==o.key).map(x=>({...x,dependsOn:x.dependsOn.filter(k=>k!==o.key)})));}}>{t('ลบผลลัพธ์','Remove deliverable')}</button>}
    </fieldset>)}
    <button type="button" disabled={disabled||outputs.length>=12} onClick={()=>{setReviewed(false);setOutputs(v=>[...v,output()]);}}>{t('เพิ่มผลลัพธ์','Add deliverable')}</button>
    <details><summary>{t('นิยามภารกิจที่จะบันทึก','Mission definition to save')}</summary><Json value={definition}/></details>
    {definition.constraints.length>4000&&<p role="alert">{t('ข้อจำกัดที่รวมจากเกณฑ์ จุดเชื่อมต่อ และความเสี่ยงยาวเกิน 4,000 ตัวอักษร แก้สรุปงานให้กระชับก่อนสร้างภารกิจ','Combined acceptance, interfaces and risks exceed the Mission limit of 4,000 characters. Revise the brief before creating the Mission.')}</p>}
    <label className="workflow-consent"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>{t('ตรวจสรุปงาน ไฟล์ และเกณฑ์แล้ว สร้างเฉพาะภารกิจฉบับร่าง','I reviewed the brief, files and criteria. Create a Mission draft.')}</label>
    <button className="primary" disabled={disabled||!reviewed||definition.constraints.length>4000}>{t('สร้างภารกิจฉบับร่าง','Create Mission draft')}</button>
  </form></section>;
}

function EvidenceReview({t,state,projectId,w,disabled,onSave}){
  const [selected,setSelected]=useState(''),[label,setLabel]=useState('observation'),[text,setText]=useState('');
  const events=scoped(state,'events',projectId),outputs=events.filter(e=>e.type==='mission.output'&&e.missionId===w.missionId&&e.definitionRevision===w.missionDefinitionRevision);
  const options=events.filter(v=>v.type==='verification.result'&&v.missionId===w.missionId&&v.definitionRevision===w.missionDefinitionRevision&&outputs.some(o=>o.id===v.outputId)&&['PASSED','FAILED'].includes(v.status)),v=options.find(x=>x.id===selected),o=outputs.find(x=>x.id===v?.outputId),r=scoped(state,'runs',projectId).find(x=>x.id===v?.runId);
  return <section className="panel"><h2>{t('ตรวจหลักฐานฉบับที่ระบุ','Review exact evidence')}</h2><form onSubmit={e=>{e.preventDefault();onSave({evidence:[{runId:v.runId,attemptId:v.attemptId,artifactId:o.artifactId,verificationId:v.id}],findings:[{label,text,evidenceIndexes:[0]}]});}}>
    <Field label={t('ผลตรวจและไฟล์จากภารกิจนี้','Verification and file from this Mission')}><select required value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{t('เลือกหลักฐานจริง','Choose actual evidence')}</option>{options.map(v=><option key={v.id} value={v.id}>{outputs.find(o=>o.id===v.outputId)?.path} · {v.status} · {v.id}</option>)}</select></Field>
    {!options.length&&<p className="help">{t('ไปที่ภารกิจเพื่อสร้างงานที่สั่งทำลงทะเบียนไฟล์ และตรวจจริงก่อน','Use Missions to run, register output files and perform verification first.')}</p>}
    {v&&<p className="help">{o.path} · SHA-256 {o.sha256} · {r?.selection?.instanceId} / {r?.selection?.model} · {t('ครั้งที่','Attempt')} {v.attemptId}</p>}
    <Field label={t('ประเภทข้อค้นพบ','Finding label')}><select value={label} onChange={e=>setLabel(e.target.value)}>{[['observation','ข้อสังเกต','Observation'],['risk','ความเสี่ยง','Risk'],['blocker','ข้อขัดข้อง','Blocker'],['question','คำถาม','Question']].map(([key,th,en])=><option key={key} value={key}>{t(th,en)}</option>)}</select></Field>
    <Field label={t('ข้อค้นพบที่อ้างหลักฐานนี้','Finding supported by this evidence')}><textarea required rows={3} maxLength={4000} value={text} onChange={e=>setText(e.target.value)}/></Field><button disabled={disabled||!v}>{t('บันทึกข้อค้นพบ','Record finding')}</button>
  </form></section>;
}

function LessonDraft({t,reviews,disabled,onSave}){
  const [reviewId,setReview]=useState(reviews.at(-1)?.id??''),[title,setTitle]=useState(''),[procedure,setProcedure]=useState('');
  return <section className="panel"><h2>{t('บทเรียนขั้นตอนที่เสนอ','Proposed procedural lesson')}</h2><p className="help">{t('บันทึกบทเรียนเป็นฉบับร่างในความจำของ AI ของโปรเจกต์นี้ ตรวจหลักฐานก่อนบันทึก หากเป็นความชอบส่วนตัวให้เก็บในความจำส่วนกลางของเจ้าของแล้วแชร์เฉพาะฉบับที่เลือก','Save a draft in this project’s Memory after rechecking evidence. Personal preferences belong in private central Owner Memory with explicit revision grants.')}</p><form onSubmit={e=>{e.preventDefault();onSave({reviewId,title,procedure});}}>
    <Field label={t('ฉบับการตรวจที่อ้างอิง','Referenced review version')}><select required value={reviewId} onChange={e=>setReview(e.target.value)}><option value="">{t('เลือกการตรวจที่หลักฐานยังปัจจุบัน','Choose a review with current evidence')}</option>{reviews.map(r=><option key={r.id} value={r.id}>{t('ฉบับ','Version')} {r.reviewVersion} · {r.id}</option>)}</select></Field>
    <Field label={t('ชื่อบทเรียน','Lesson title')}><input required maxLength={240} value={title} onChange={e=>setTitle(e.target.value)}/></Field><Field label={t('ขั้นตอนที่เสนอและเงื่อนไขที่ใช้','Proposed procedure and when it applies')}><textarea required rows={4} maxLength={12000} value={procedure} onChange={e=>setProcedure(e.target.value)}/></Field>
    <button disabled={disabled||!reviews.some(r=>r.id===reviewId)}>{t('บันทึกบทเรียนฉบับร่าง','Save draft lesson')}</button>
  </form></section>;
}
