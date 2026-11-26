import {useState} from 'react';
import {GitBranch, FileCheck2, Lightbulb, Layers3, Code2, ListChecks, ShieldCheck, FileCode2, FolderArchive} from 'lucide-react';
type T=(th:string,en:string)=>string;
const steps=[
  {th:'วางแผน',en:'Plan',titleTh:'FORGE เก็บเป้าหมายและขอบเขตงาน',titleEn:'FORGE keeps the goal and scope together.',lead:'Website brief',Icon:Lightbulb,
    path:'M300 85V350',work:[['Goal','Project site'],['Scope','Pages + review'],['Owner','Your team']]},
  {th:'ลงมือทำ',en:'Make',titleTh:'แต่ละงานมีผู้รับผิดชอบ ผลลัพธ์กลับสู่โปรเจกต์',titleEn:'Assigned work returns to the same project.',lead:'Assigned work',Icon:GitBranch,
    path:'M300 85V135Q300 155 280 155H115Q95 155 95 175V216M300 85V216M300 85V135Q300 155 320 155H485Q505 155 505 175V216M95 284V315Q95 335 115 335H280Q300 335 300 355M300 284V355M505 284V315Q505 335 485 335H320Q300 335 300 355',work:[['Lead','Outline'],['Builder','Pages'],['Reviewer','Review']]},
  {th:'ตรวจผล',en:'Inspect',titleTh:'เก็บไฟล์ต้นทางและหลักฐานไว้ตรวจร่วมกัน',titleEn:'Keep the files and their evidence together.',lead:'FORGE records',Icon:FileCheck2,
    path:'M300 85V115Q300 140 275 140H190Q170 140 170 160V200M300 115Q300 140 325 140H410Q430 140 430 160V200M170 265V300Q170 325 195 325H275Q300 325 300 350M430 265V300Q430 325 405 325H325Q300 325 300 350',work:[['Source','Site files'],['History','Revisions'],['Evidence','Review notes']]},
];
export function WorkIllustration({t}:{t:T}) {
  const [step,setStep]=useState(1),s=steps[step],Icon=s.Icon;
  return <figure className="work-illustration">
    <div className="illustration-canvas" data-phase={step}>
      <svg className="work-connections" viewBox="0 0 600 460" preserveAspectRatio="none" fill="none" aria-hidden="true"><path className="connector-back" d={s.path}/><path className="connector-current" key={step} d={s.path}/></svg>
      <div className="orbit orbit-one" aria-hidden="true"/><div className="orbit orbit-two" aria-hidden="true"/>
      <div className="idea-node"><Icon size={20} aria-hidden="true"/><span>{s.lead}</span><span className="node-corner" aria-hidden="true"/></div>
      <div className={`team-branches work-phase-${step}`}>{s.work.map(([owner,work],i)=>{const RoleIcon=[ListChecks,Code2,ShieldCheck][i];return <div className={`team-piece piece-${i}`} key={i}><span className="piece-symbol"><RoleIcon size={26} strokeWidth={1.5} aria-hidden="true"/></span><span>{work}<small>{owner}</small></span></div>})}</div>
      <div className={`result-node result-phase-${step}`} aria-live="polite" aria-atomic="true">
        {step===0?<><ListChecks size={22} aria-hidden="true"/><div><strong>{t('แผนของ Mission','Mission plan')}</strong><small>{t('เว็บไซต์โปรเจกต์ · งานและผู้รับผิดชอบ','Project site · Tasks and owners')}</small></div></>:step===1?<><div className="working-output"><FileCode2 size={20} aria-hidden="true"/><span>{t('ไฟล์เว็บไซต์','Site files')}<small>Builder</small></span></div><div className="working-output"><FileCheck2 size={20} aria-hidden="true"/><span>{t('บันทึกตรวจงาน','Review notes')}<small>Reviewer</small></span></div></>:<><div className="delivery-heading"><FolderArchive size={22} aria-hidden="true"/><strong>Delivery Pack</strong></div><div className="retained-evidence"><Layers3 size={17} aria-hidden="true"/><span>{t('ไฟล์ + Revision + หลักฐาน','Files + Revisions + Evidence')}</span></div></>}
      </div>
    </div>
    <p className="illustration-title" aria-live="polite">{t(s.titleTh,s.titleEn)}</p>
    <div className="illustration-controls" role="group" aria-label={t('สำรวจภาพอธิบายการทำงาน','Explore workflow illustration')}>{steps.map((s,i)=><button key={s.en} aria-pressed={step===i} onClick={()=>setStep(i)}><span aria-hidden="true">{i+1}</span>{t(s.th,s.en)}</button>)}</div>
    <figcaption>{t('ตัวอย่างสมมติ: เว็บไซต์โปรเจกต์ · ภาพอธิบาย ไม่ใช่การรันจริง','Illustrative example: a project website · Not a capture or live run')}</figcaption>
  </figure>;
}
