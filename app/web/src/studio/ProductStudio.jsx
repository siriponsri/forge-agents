import React, {useEffect, useRef, useState} from 'react';
import {ArrowRight, Check, FileText, Plus} from 'lucide-react';
import {Heading, Field, Empty} from '../ui.jsx';
import {useStrategy} from '../Assistance.jsx';
import {frontier, settle, decisionsFromBrief, reopenDecision, glossaryFor, taskSpecFrom} from '../../../studio/question-tree.mjs';
import {BRIEF_SECTIONS, STUDIO_PRESET_ID, draftBrief, briefDecisions, briefTitle, isStudioBrief, missionDefinitionFrom} from '../../../studio/brief.mjs';
import {discoverFacts} from '../../../studio/facts.mjs';
import {defaultTrainerRegistry} from '../../../studio/backends.mjs';
import './studio.css';

const examples=[['ทำนายยอดขายจากไฟล์ CSV', 'Predict sales from a CSV file'], ['แยกประเภทภาพสินค้า', 'Classify product images'], ['ตอบคำถามจากเอกสารภาษาไทย', 'Answer questions from Thai documents']];
const promptFrom=b=>b.brief.objective.replace(/\n(?:ประเภทงาน|Task type):[^\n]*$/, '');

export default function ProductStudio(props){return <Studio key={props.projectId} {...props}/>;}
function Studio({t, lang='th', state, projectId, project, busy, refresh, initialPrompt='', onConsumePrompt, onNavigate}){
  // Existing journal stores transport intent, never a second brief or plan.
  // Remounts read state; retries are always explicit and use the original ID.
  const ui=useStrategy({projectId,service:'playbooks',readAction:'state',run:async fn=>{
    try{return await fn();}catch{return null;}finally{await refresh?.().catch(()=>{});}
  }});
  const [selected,setSelected]=useState(''),[mode,setMode]=useState('start');
  const [prompt,setPrompt]=useState(initialPrompt),[decisions,setDecisions]=useState({});
  const [editor,setEditor]=useState(null),[baseRevision,setBaseRevision]=useState(null);
  const [reviewed,setReviewed]=useState(false);
  const heading=useRef(null),consumed=useRef('');
  useEffect(()=>{
    if(initialPrompt&&initialPrompt!==consumed.current){setPrompt(initialPrompt);consumed.current=initialPrompt;onConsumePrompt?.();}
  },[initialPrompt,onConsumePrompt]);
  useEffect(()=>{if(projectId)void ui.refresh();},[state?.revision,projectId,ui.refresh]);
  useEffect(()=>{heading.current?.focus();},[mode,selected]);
  const workflows=(ui.data?.workflows??[]).filter(w=>isStudioBrief(ui.data?.briefs.find(b=>b.id===w.briefId)));
  const w=workflows.find(x=>x.id===selected),saved=ui.data?.briefs.find(b=>b.id===w?.briefId);
  const pending=ui.data?.materializations.find(x=>x.id===w?.pending?.id);
  const locked=!!busy||ui.loading||!!ui.uncertain.length||!!w?.pending;
  const facts=discoverFacts(state,projectId),questions=frontier(decisions,facts,prompt);
  const load=(workflow,b)=>{
    setSelected(workflow.id);setBaseRevision(workflow.revision);setPrompt(promptFrom(b));
    const d=decisionsFromBrief(b.decisions);setDecisions(d);setEditor({title:b.title,brief:{...b.brief}});
    setMode(frontier(d,facts,promptFrom(b)).length&&!workflow.missionId?'interview':'review');setReviewed(false);
  };
  const reset=()=>{setSelected('');setPrompt('');setDecisions({});setEditor(null);setBaseRevision(null);setMode('start');setReviewed(false);};
  const dirty=!!saved&&!!editor&&(editor.title!==saved.title||BRIEF_SECTIONS.some(f=>editor.brief[f.key]!==saved.brief[f.key]));
  const stale=!!w&&baseRevision!==w.revision;
  const save=async(next,body,after)=>{
    body={title:body.title.trim(),brief:Object.fromEntries(BRIEF_SECTIONS.map(f=>[f.key,body.brief[f.key].trim()]))};
    setReviewed(false);
    await ui.act(selected?'revise':'create',{
      ...(selected?{workflowId:selected,expectedRevision:baseRevision}:{presetId:STUDIO_PRESET_ID}),
      title:body.title,brief:body.brief,decisions:briefDecisions(next,lang),
    },result=>{setSelected(result.id);setBaseRevision(result.revision);setDecisions(next);setEditor(body);after?.();});
  };
  const answerRound=answers=>{
    const next={...decisions};for(const q of questions)next[q.id]=settle(q,answers[q.id]??{accept:true});
    const body={title:editor?.title??briefTitle(prompt),brief:draftBrief({prompt,decisions:next,facts,lang,backends:defaultTrainerRegistry().compatible(taskSpecFrom(next))})};
    void save(next,body,()=>{if(!frontier(next,facts,prompt).length)setMode('review');});
  };
  let definition=null,definitionError='';
  if(saved&&w&&!questions.length){try{definition=missionDefinitionFrom({title:saved.title,brief:saved.brief,decisions:saved.decisions,workflowId:w.id,lang});}catch{definitionError=t('ข้อความเกณฑ์ว่างานเสร็จ วิธีสร้างโมเดล และความเสี่ยงรวมกันยาวเกินไป ย่อข้อความแล้วบันทึกอีกครั้ง','Acceptance, dependencies and risks are too long together. Shorten them and save again.');}}
  const recover=entry=>ui.act(entry.action,entry.input,result=>{
    if(entry.action==='materialize'){
      const b=ui.data?.briefs.find(b=>b.id===result.workflow.briefId);
      if(b)load(result.workflow,b);
      else {setBaseRevision(result.workflow.revision);setMode('review');setReviewed(false);setSelected(result.workflow.id);}
    }
    else {setSelected(result.id);setBaseRevision(result.revision);setEditor({title:entry.input.title,brief:entry.input.brief});const d=decisionsFromBrief(entry.input.decisions);setDecisions(d);const p=promptFrom({brief:entry.input.brief});setPrompt(p);setMode(frontier(d,facts,p).length?'interview':'review');}
  });
  const failure=ui.error.startsWith('REVISION_CONFLICT')?t('มีการแก้ไขข้อมูลนี้ก่อนหน้า โหลดข้อมูลล่าสุดแล้วตรวจอีกครั้งก่อนบันทึก','This brief changed elsewhere. Load the latest saved version and review it before saving.'):
    ui.error?t('อ่านหรือบันทึกข้อมูลไม่สำเร็จ โหลดข้อมูลล่าสุดแล้วลองใหม่ หากยังไม่รู้ผล ให้ตรวจคำขอเดิมก่อน','Could not read or save. Refresh and try again. If the outcome is unknown, check the original request first.'):'';
  if(!projectId)return <Empty>{t('เลือกโปรเจกต์ก่อนเริ่มวางแผนผลิตภัณฑ์ AI','Select a project to plan an AI product.')}</Empty>;
  return <div className="product-studio">
    <Heading title={t('สร้างผลิตภัณฑ์ AI','AI Product Studio')} description={t('เริ่มจากสิ่งที่อยากทำ แล้วค่อยเลือกข้อมูล วิธีเทรน และวิธีวัดผล','Start with what you want to make, then choose data, a training approach and evaluation.')}>
      <button type="button" disabled={locked} onClick={reset}><Plus size={16}/>{t('เริ่มสรุปงานใหม่','New brief')}</button>
    </Heading>
    <div className="studio-layout">
      <aside className="studio-saved" aria-label={t('สรุปงานที่บันทึกไว้','Saved briefs')}>
        <h2>{t('สรุปงานของโปรเจกต์','Project briefs')}</h2><p className="studio-muted">{project?.name}</p>
        {workflows.length?<nav>{workflows.map(x=><button key={x.id} type="button" aria-current={selected===x.id?'page':undefined} disabled={locked} onClick={()=>load(x,ui.data.briefs.find(b=>b.id===x.briefId))}>
          <FileText size={16}/><span><strong>{x.title}</strong><small>{x.missionId?t('มีภารกิจแล้ว','Mission linked'):t('สรุปงานฉบับร่าง','Draft brief')}</small></span>
        </button>)}</nav>:<p className="studio-muted">{t('เมื่อบันทึกคำตอบ สรุปงานจะอยู่ที่นี่ เปิดกลับมาทำต่อได้','Saved answers appear here. Reopen a brief to continue.')}</p>}
        <button type="button" disabled={ui.loading} onClick={()=>void ui.refresh()}>{t('โหลดข้อมูลล่าสุด','Refresh')}</button>
      </aside>
      <section className="studio-work" aria-label={t('วางแผนผลิตภัณฑ์ AI','AI product planning')}>
        <ol className="studio-steps" aria-label={t('ขั้นตอน','Steps')}>{[t('บอกสิ่งที่อยากทำ','Describe'),t('เลือกแนวทาง','Choose'),t('ตรวจสรุปงาน','Review')].map((label,i)=><li key={i} aria-current={(['start','interview','review'].indexOf(mode)===i)?'step':undefined}><span>{i+1}</span>{label}</li>)}</ol>
        <p className="studio-boundary">{t('ตอนนี้ทำได้: วางแผน บันทึกสรุปงาน และสร้างภารกิจฉบับร่าง สูตรเทรนสำหรับข้อมูลแต่ละชนิดยังอยู่ระหว่างพัฒนา หน้านี้ไม่เริ่มเทรนหรือเรียกบริการ AI','Available now: plan, save a brief and create a draft mission. Training recipes for each data type are still being developed. This page does not train or call AI services.')}</p>
        <div role="status" aria-live="polite" className="studio-status">{ui.loading?t('กำลังอ่านหรือบันทึกข้อมูล…','Reading or saving…'):ui.notice?t('บันทึกแล้ว','Saved'):''}</div>
        {failure&&<p role="alert">{failure}</p>}
        {!!ui.uncertain.length&&<section className="studio-recovery"><h2>{t('ยังไม่รู้ผลการบันทึก','Save outcome unknown')}</h2><p>{t('ระบบอาจบันทึกแล้ว ตรวจคำขอเดิมเพื่อรับผลกลับมาโดยไม่สร้างซ้ำ','The save may have completed. Check the original request to recover its result without creating a duplicate.')}</p>{ui.uncertain.map(entry=><button type="button" key={entry.input.operationId} disabled={ui.loading} onClick={()=>recover(entry)}>{t('ตรวจคำขอเดิม','Check original request')}</button>)}</section>}
        {pending&&!ui.uncertain.length&&<section className="studio-recovery"><p>{t('การสร้างภารกิจยังไม่เสร็จ ตรวจคำขอเดิมเพื่อทำต่อ','Mission creation is unfinished. Check the original request to continue.')}</p><button disabled={ui.loading} onClick={()=>recover({action:'materialize',input:pending.request})}>{t('ตรวจคำขอเดิม','Check original request')}</button></section>}
        {mode==='start'&&<form onSubmit={e=>{e.preventDefault();setMode('interview');setEditor(null);}}>
          <h2 ref={heading} tabIndex={-1}>{t('อยากให้ AI ช่วยทำอะไร','What would you like AI to do?')}</h2>
          <Field label={t('เล่าเป้าหมายและข้อมูลที่มี','Describe your goal and available data')}><textarea required rows={5} maxLength={2400} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={t('เช่น อยากทำนายยอดขาย มีตารางยอดขายรายเดือนย้อนหลังสองปี','For example: predict sales using two years of monthly sales data')}/></Field>
          <div className="studio-examples">{examples.map(([th,en])=><button key={en} type="button" onClick={()=>setPrompt(t(th,en))}>{t(th,en)}</button>)}</div>
          <div className="studio-actions"><button className="primary" disabled={locked||!prompt.trim()}>{t('เริ่มเลือกแนวทาง','Choose an approach')}<ArrowRight size={16}/></button><span className="studio-muted">{t('ยังไม่บันทึกจนกว่าคุณเลือกคำตอบ','Nothing is saved until you choose answers')}</span></div>
        </form>}
        {mode==='interview'&&<>
          <h2 ref={heading} tabIndex={-1}>{t('เลือกแนวทางให้ตรงกับงาน','Choose what fits your work')}</h2><p className="studio-goal">{prompt}</p>
          <p className="studio-muted">{t('คำแนะนำเป็นจุดเริ่มต้น เปลี่ยนตัวเลือกหรือเขียนคำตอบเองได้','Recommendations are starting points. Change an option or write your own answer.')}</p>
          {stale&&<p role="alert">{t('สรุปงานเปลี่ยนแล้ว เปิดฉบับล่าสุดก่อนตอบต่อ','This brief changed. Load the latest version before continuing.')}<button disabled={locked} onClick={()=>load(w,saved)}>{t('เปิดฉบับล่าสุด','Load latest version')}</button></p>}
          <QuestionRound key={questions.map(q=>q.id).join(':')} {...{t,lang,questions}} disabled={locked||stale} onSubmit={answerRound}/>
          {!!Object.keys(decisions).length&&<details className="studio-decisions"><summary>{t('คำตอบที่บันทึกไว้','Saved answers')} ({Object.keys(decisions).length})</summary><Decisions {...{t,lang,decisions}} disabled={locked||stale} onReopen={id=>{setDecisions(reopenDecision(decisions,id));setReviewed(false);}}/></details>}
        </>}
        {mode==='review'&&editor&&<>
          <h2 ref={heading} tabIndex={-1}>{w?.missionId?t('ภารกิจวางแผนพร้อมตรวจแล้ว','Planning mission ready for review'):t('ตรวจสรุปงานก่อนสร้างภารกิจ','Review your brief before creating a mission')}</h2>
          {w?.missionId?<section className="studio-linked"><Check size={24}/><div><h3>{saved?.title}</h3><p>{t('สร้างภารกิจและแผนงานไว้แล้ว ตรวจสถานะและขั้นตอนต่อไปในหน้าภารกิจ การเทรนหรือใช้บริการภายนอกต้องพิจารณาแยก','The mission and plan are linked. Review their status and next steps in Missions. Training and external services require separate review.')}</p><button className="primary" onClick={()=>onNavigate?.('missions')}>{t('เปิดหน้าภารกิจ','Open Missions')}<ArrowRight size={16}/></button></div></section>:<>
            <p>{t('แก้ข้อความให้ตรงกับงานของคุณ แล้วบันทึกก่อนสร้างภารกิจ','Edit the text to match your work, then save before creating a mission.')}</p>
            {(stale||w?.restoreReviewRequired)&&<p role="alert">{t('ข้อมูลเปลี่ยนหรือผ่านการกู้คืน เปิดฉบับล่าสุด ตรวจและบันทึกอีกครั้ง','Data changed or was restored. Load the latest version, review and save again.')}<button disabled={locked} onClick={()=>load(w,saved)}>{t('เปิดฉบับล่าสุด','Load latest version')}</button></p>}
            <form onSubmit={e=>{e.preventDefault();void save(decisions,editor);}}>
              <fieldset disabled={locked||stale}><Field label={t('ชื่อสรุปงาน','Brief title')}><input required maxLength={180} value={editor.title} onChange={e=>{setReviewed(false);setEditor({...editor,title:e.target.value});}}/></Field>
              {BRIEF_SECTIONS.map(f=><Field key={f.key} label={t(f.th,f.en)}><textarea required rows={f.key==='objective'?3:5} maxLength={4000} value={editor.brief[f.key]} onChange={e=>{setReviewed(false);setEditor({...editor,brief:{...editor.brief,[f.key]:e.target.value}});}}/></Field>)}</fieldset>
              <div className="studio-actions"><button disabled={locked||stale||(!dirty&&!w?.restoreReviewRequired)}>{t('บันทึกสรุปงาน','Save brief')}</button>{dirty&&<span className="studio-muted">{t('มีข้อความที่ยังไม่บันทึก','Unsaved changes')}</span>}</div>
            </form>
          </>}
          <details className="studio-decisions"><summary>{t('คำตอบที่ใช้วางแผน','Planning decisions')}</summary><Decisions {...{t,lang,decisions}} disabled={locked||!!w?.missionId||stale} onReopen={id=>{setDecisions(reopenDecision(decisions,id));setReviewed(false);setMode('interview');}}/></details>
          {w?.missionId&&<details><summary>{t('อ่านสรุปงานที่บันทึกไว้','Read saved brief')}</summary><dl className="studio-brief">{BRIEF_SECTIONS.map(f=><React.Fragment key={f.key}><dt>{t(f.th,f.en)}</dt><dd>{saved.brief[f.key]}</dd></React.Fragment>)}</dl></details>}
          {!w?.missionId&&<section className="studio-handoff"><h3>{t('ภารกิจนี้จะสร้างแผนอะไรบ้าง','What this mission will plan')}</h3><ol>{definition?.outputs.map(o=><li key={o.key}><strong>{o.name}</strong><p>{o.acceptance}</p><details><summary>{t('ไฟล์ที่วางแผนไว้','Planned file')}</summary><code>{o.path}</code><p className="studio-muted">{t('เป็นชื่อไฟล์ที่เสนอ ยังไม่มีไฟล์หรือผลทดสอบ','Proposed file name; no file or test result exists yet')}</p></details></li>)}</ol>
            <p>{t('สร้างเฉพาะฉบับร่างที่ยังไม่อนุมัติ ไม่มีการเริ่มงานหรือสร้างโมเดล','Creates an unapproved draft only. No work starts and no model is created.')}</p>
            {definitionError&&<p role="alert">{definitionError}</p>}
            <label className="studio-consent"><input type="checkbox" checked={reviewed} disabled={locked||dirty||stale||!definition||w?.restoreReviewRequired} onChange={e=>setReviewed(e.target.checked)}/>{t('ตรวจสรุปงานและรายการผลลัพธ์แล้ว','I reviewed the brief and planned outputs')}</label>
            <button className="primary" disabled={locked||dirty||stale||!reviewed||!definition||w?.restoreReviewRequired} onClick={()=>ui.act('materialize',{workflowId:w.id,expectedRevision:baseRevision,definition},result=>{setBaseRevision(result.workflow.revision);setReviewed(false);})}>{t('สร้างภารกิจวางแผนฉบับร่าง','Create draft planning mission')}<ArrowRight size={16}/></button>
          </section>}
        </>}
        {!!Object.keys(decisions).length&&<details className="studio-glossary"><summary>{t('คำศัพท์ที่ใช้ในสรุปงาน','Terms used in this brief')}</summary><dl>{glossaryFor(decisions).map(g=><React.Fragment key={g.key}><dt>{g.term[lang]}</dt><dd>{g.definition[lang]}</dd></React.Fragment>)}</dl></details>}
      </section>
    </div>
  </div>;
}

function QuestionRound({questions,t,lang,disabled,onSubmit}){
  const [answers,setAnswers]=useState({});
  return <form onSubmit={e=>{e.preventDefault();onSubmit(answers);}}><fieldset disabled={disabled} className="studio-questions">
    {questions.map(q=><div className="studio-question" key={q.id}><h3>{q.topic[lang]}</h3><p>{q.prompt[lang]}</p><p className="studio-muted">{q.why?.[lang]}</p>
      <Field label={`${q.topic[lang]} — ${t('คำตอบ','Answer')}`}><select value={answers[q.id]?.text!==undefined?'custom':answers[q.id]?.value??q.recommended.value} onChange={e=>setAnswers({...answers,[q.id]:e.target.value==='custom'?{text:''}:{value:e.target.value}})}>{q.options.map(o=><option key={o.value} value={o.value}>{o.label[lang]}{o.value===q.recommended.value?t(' (แนะนำ)',' (recommended)'):''}</option>)}<option value="custom">{t('เขียนคำตอบเอง','Write my own answer')}</option></select></Field>
      {answers[q.id]?.text!==undefined&&<Field label={`${q.topic[lang]} — ${t('คำตอบของคุณ','Your answer')}`}><textarea required maxLength={1000} rows={2} value={answers[q.id].text} onChange={e=>setAnswers({...answers,[q.id]:{text:e.target.value}})}/></Field>}
    </div>)}
    {!!questions.length&&<div className="studio-actions"><button className="primary" disabled={disabled||Object.values(answers).some(a=>a.text!==undefined&&!a.text.trim())}>{t('บันทึกคำตอบและไปต่อ','Save answers and continue')}<ArrowRight size={16}/></button></div>}
  </fieldset></form>;
}
function Decisions({t,lang,decisions,disabled,onReopen}){
  return <ul>{Object.entries(decisions).map(([id,d])=><li key={id}><div><strong>{d.topic?.[lang]}</strong><p>{d.text??d.label?.[lang]}</p></div><button type="button" disabled={disabled} onClick={()=>onReopen(id)} aria-label={`${t('แก้คำตอบ','Edit answer')}: ${d.topic?.[lang]}`}>{t('แก้คำตอบ','Edit answer')}</button></li>)}</ul>;
}
