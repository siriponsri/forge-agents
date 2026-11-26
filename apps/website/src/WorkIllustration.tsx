import {useState} from 'react';
import {ArrowRight, GitBranch, FileCheck2, Lightbulb, Layers3, Code2, Search, ShieldCheck} from 'lucide-react';
type T=(th:string,en:string)=>string;
const steps=[
  {th:'วางแผน',en:'Plan',titleTh:'ทุกความคิด มีจุดเริ่มต้น',titleEn:'One idea. A shared direction.',lead:'Your brief',roles:['Explore','Plan','Review'],Icon:Lightbulb},
  {th:'ลงมือทำ',en:'Make',titleTh:'แบ่งงาน โดยไม่เสียภาพรวม',titleEn:'Many hands. One shared goal.',lead:'Your team',roles:['Research','Build','Verify'],Icon:GitBranch},
  {th:'ตรวจผล',en:'Inspect',titleTh:'เก็บสิ่งที่ตรวจสอบได้จริง',titleEn:'Real work leaves a trail.',lead:'Your results',roles:['Files','Revisions','Evidence'],Icon:FileCheck2},
];
export function WorkIllustration({t}:{t:T}) {
  const [step,setStep]=useState(1),s=steps[step],Icon=s.Icon;
  return <figure className="work-illustration">
    <div className="illustration-canvas" data-phase={step}>
      <svg className="work-connections" viewBox="0 0 600 460" preserveAspectRatio="none" fill="none" aria-hidden="true"><path className="connector-back" d="M300 85V135Q300 155 280 155H115Q95 155 95 175V216M300 85V216M300 85V135Q300 155 320 155H485Q505 155 505 175V216M95 284V315Q95 335 115 335H280Q300 335 300 355M300 284V355M505 284V315Q505 335 485 335H320Q300 335 300 355"/><path className="connector-current" key={step} d="M300 85V135Q300 155 280 155H115Q95 155 95 175V216M300 85V216M300 85V135Q300 155 320 155H485Q505 155 505 175V216M95 284V315Q95 335 115 335H280Q300 335 300 355M300 284V355M505 284V315Q505 335 485 335H320Q300 335 300 355"/></svg>
      <div className="orbit orbit-one" aria-hidden="true"/><div className="orbit orbit-two" aria-hidden="true"/>
      <div className="idea-node"><Icon size={20} aria-hidden="true"/><span>{s.lead}</span><span className="node-corner" aria-hidden="true"/></div>
      <div className="team-branches">{s.roles.map((r,i)=>{const RoleIcon=[Search,Code2,ShieldCheck][i];return <div className={`team-piece piece-${i}`} key={i}><span className="piece-symbol"><RoleIcon size={26} strokeWidth={1.5} aria-hidden="true"/></span><span>{r}</span></div>})}</div>
      <div className="result-node"><span className="result-stamp"><Layers3 size={23} aria-hidden="true"/></span><span>{t('งานที่ตรวจสอบได้','Inspectable work')}<small>{t('ไฟล์ · เอกสาร · หลักฐาน','Files · Documents · Evidence')}</small></span><ArrowRight size={18} aria-hidden="true"/></div>
      <div className="illustration-title" aria-live="polite">{t(s.titleTh,s.titleEn)}</div>
    </div>
    <div className="illustration-controls" role="group" aria-label={t('สำรวจภาพอธิบายการทำงาน','Explore workflow illustration')}>{steps.map((s,i)=><button key={s.en} aria-pressed={step===i} onClick={()=>setStep(i)}><span aria-hidden="true">{i+1}</span>{t(s.th,s.en)}</button>)}</div>
    <figcaption>{t('ภาพอธิบายแนวคิด · ไม่ใช่ภาพหน้าจอหรือการรันจริง','Workflow illustration · Not a product capture or live run')}</figcaption>
  </figure>;
}
