import {useEffect, useRef, useState} from 'react';
import {ArrowRight, ArrowUpRight, Check, FileCheck2, GitBranch, Pause, Play, ShieldCheck} from 'lucide-react';
import {href, type Lang} from './site';

type T = (th:string,en:string)=>string;
const strategies = [
  {id:'supervisor',name:'Supervisor',full:'Supervisor / Orchestrator–Workers',lead:'Lead agent',workers:['Builder','Researcher','Reviewer'],join:'Reconcile',
    th:'ให้เอเจนต์หลักแบ่งงาน โดยผู้ช่วยแต่ละตัวมีขอบเขตและผู้รับผิดชอบชัดเจน',en:'A lead breaks down the work. Each approved helper gets a clear scope and an accountable owner.',
    limitTh:'ผู้ช่วยต้องได้รับอนุญาตผ่าน session owner เดิม ป้ายชื่อบทบาทไม่ใช่สิทธิ์ในการรัน',limitEn:'Helpers need approval through the existing session owner. A role label grants no execution authority.'},
  {id:'parallel',name:'Parallel',full:'Parallel fan-out / fan-in',lead:'Fan out',workers:['Workspace A','Workspace B','Workspace C'],join:'Fan in',
    th:'แยกงานที่เป็นอิสระลง workspace ของตัวเอง แล้วรวบรวมผลและหลักฐานกลับมา',en:'Give independent work its own workspace. Bring the actual results and evidence back together.',
    limitTh:'จำนวนงานพร้อมกันอยู่ภายในวงเงินและขีดจำกัด workspace ห้ามหลายงานเขียน checkout เดียวกัน',limitEn:'Concurrency stays within workspace and budget limits. Allocations must never share conflicting checkout ownership.'},
  {id:'router',name:'Specialists',full:'Router + Specialists',lead:'Router',workers:['Code specialist','Research specialist','Review specialist'],join:'Selected route',
    th:'เลือกผู้เชี่ยวชาญตามขอบเขต ความสามารถ และโมเดลที่เชื่อมต่อ พร้อมเก็บเหตุผลการเลือก',en:'Route the task to a scoped specialist using connected capabilities and models. Keep the reason for the choice.',
    limitTh:'เส้นทางที่ยังใช้ไม่ได้ต้องตั้งค่าก่อน การเลือกโมเดลไม่ได้รับรองคุณภาพของคำตอบ',limitEn:'Unavailable routes require setup. Model selection is not a claim about answer quality.'},
  {id:'verifier',name:'Gen + verify',full:'Generator + Verifier',lead:'Generator',workers:['Draft artifact'],join:'Verifier',
    th:'สร้างชิ้นงาน แล้วให้ขั้นตอนตรวจแยกต่างหากเก็บข้อค้นพบที่ทำซ้ำได้ พร้อม feedback',en:'Generate an artifact, then use a separate check to retain reproducible findings and feedback.',
    limitTh:'คำรายงานของ verifier เองไม่ใช่หลักฐานอิสระหรือการอนุมัติจากเจ้าของ',limitEn:'A verifier’s self-report is neither independent proof of success nor Owner approval.'},
  {id:'pipeline',name:'Pipeline',full:'Sequential pipeline / DAG',lead:'Stage A',workers:['Stage B','Stage C'],join:'Dependencies',
    th:'เชื่อมขั้นตอนด้วย dependency ให้แต่ละงานเริ่มได้เมื่อเงื่อนไขก่อนหน้าพร้อมจริง',en:'Connect stages by dependency. Release work only when its prerequisites are actually satisfied.',
    limitTh:'ต้องปฏิเสธวงจรและคงสถานะ failed หรือ unknown ไว้ ขั้นตอนที่ใช้โค้ดธรรมดาเพียงพอไม่จำเป็นต้องใช้ agent',limitEn:'Reject cycles and retain failed or unknown blockers. Use deterministic code when an agent is unnecessary.'},
  {id:'candidates',name:'Candidates',full:'Independent candidates + selection',lead:'Shared brief',workers:['Candidate A','Candidate B','Candidate C'],join:'Owner selects',
    th:'เก็บทางเลือกอย่างเป็นอิสระ เปรียบเทียบตามเกณฑ์และหลักฐาน ก่อนเจ้าของเลือกผลลัพธ์',en:'Keep alternatives independent. Compare them against a rubric and evidence before explicitly selecting an outcome.',
    limitTh:'แสดงต้นทุนของงานซ้ำ การเลือกไม่ได้รวมงานที่ยังไม่ผ่านการตรวจโดยอัตโนมัติ',limitEn:'Make duplicate-work cost visible. Selection never auto-merges unreviewed work.'},
] as const;
const steps = [
  {th:'ขอบเขต',en:'Scope',titleTh:'เริ่มที่สิ่งที่อนุญาต',titleEn:'Start with an approved scope.',bodyTh:'เป้าหมาย สิทธิ์ และวงเงินเป็นขอบเขตเดียวกันสำหรับทุกกลยุทธ์',bodyEn:'The goal, permissions and budget bound every strategy.'},
  {th:'แบ่งงาน',en:'Allocate',titleTh:'เลือกรูปแบบให้เข้ากับงาน',titleEn:'Give the work the right shape.',bodyTh:'เลือกโหมดด้านบนเพื่อดูว่าการแบ่งงานและเส้นทางเปลี่ยนไปอย่างไร',bodyEn:'Choose a mode above to see how allocation and routing change.'},
  {th:'ตรวจผล',en:'Inspect',titleTh:'ตรวจสิ่งที่เกิดขึ้นจริง',titleEn:'Inspect what actually happened.',bodyTh:'ติดตามผลจาก run และ attempt เดิม สถานะ unknown ต้องคงไว้ ไม่สั่งงานซ้ำเพื่อกู้หน้าจอ',bodyEn:'Follow the original run and attempt. Keep unknown outcomes unknown; never replay effects just to recover the UI.'},
  {th:'เก็บหลักฐาน',en:'Retain',titleTh:'เก็บผลพร้อมที่มา',titleEn:'Keep the result and its provenance.',bodyTh:'ไฟล์ revision และผลการตรวจอยู่กับงาน เพื่อให้กลับมาตรวจสอบก่อนยอมรับผล',bodyEn:'Keep artifacts, revisions and checks with the work, ready for inspection before acceptance.'},
];

export function StrategyStory({lang,t}:{lang:Lang;t:T}) {
  const [mode,setMode]=useState(0),[step,setStep]=useState(0),[playing,setPlaying]=useState(false),[reduced,setReduced]=useState(false);
  const section=useRef<HTMLElement>(null);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>{setReduced(media.matches);if(media.matches)setPlaying(false)};
    update();media.addEventListener('change',update);
    const hide=()=>{if(document.hidden)setPlaying(false)};
    document.addEventListener('visibilitychange',hide);
    const observer=new IntersectionObserver(entries=>{if(!entries[0].isIntersecting)setPlaying(false)});
    if(section.current)observer.observe(section.current);
    return()=>{media.removeEventListener('change',update);document.removeEventListener('visibilitychange',hide);observer.disconnect()};
  },[]);
  useEffect(()=>{
    if(!playing||reduced)return;
    const timer=setTimeout(()=>{if(step===3)setPlaying(false);else setStep(step+1)},2600);
    return()=>clearTimeout(timer);
  },[playing,step,reduced]);
  const strategy=strategies[mode];
  function choose(index:number){setMode(index);setPlaying(false)}
  return <section ref={section} className="strategy-story" aria-labelledby="strategy-heading">
    <div className="strategy-intro"><div><h2 id="strategy-heading">Different work.<br/><span>Different formations.</span></h2></div><p>{t('บางงานต้องการผู้นำ บางงานควรแยกทาง บางงานต้องมีคนตรวจ ลองสำรวจรูปแบบการทำงานของทีมเอเจนต์','Some work needs a lead. Some can run in parallel. Some needs a second look. Explore the shape of an agent team.')}</p></div>
    <div className="strategy-board" data-playing={playing}>
      <div className="story-topline"><span><GitBranch size={16} aria-hidden="true"/>{t('ภาพอธิบายกลยุทธ์','Strategy explorer')}</span><span>{t('งานพัฒนา · ไม่ใช่การรันจริง','In development · Illustrative, not a live run')}</span></div>
      <div className="strategy-choices" role="group" aria-label={t('เลือกกลยุทธ์เอเจนต์','Choose agent strategy')} onKeyDown={event=>{
        const keys=['ArrowRight','ArrowLeft','Home','End'];if(!keys.includes(event.key))return;
        event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?5:(mode+(event.key==='ArrowRight'?1:5))%6;
        choose(next);event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next].focus({preventScroll:true});
      }}>{strategies.map((s,index)=><button key={s.id} type="button" aria-label={s.full} aria-pressed={mode===index} tabIndex={mode===index?0:-1} onClick={()=>choose(index)}><span className={`formation formation-${s.id}`} aria-hidden="true"><i/><i/><i/></span>{s.name}{mode===index&&<Check size={14} aria-hidden="true"/>}</button>)}</div>
      <div className="strategy-explanation" aria-live="polite" aria-atomic="true"><h3>{strategy.full}</h3><p>{t(strategy.th,strategy.en)}</p></div>
      <figure className={`flow-map mode-${strategy.id}`} aria-label={t('แผนภาพอธิบาย ไม่ใช่สถานะการรันจริง','Illustrative workflow, not actual execution status')} data-step={step}>
        <div className={`flow-node scope-node ${step===0?'is-current':''}`}><ShieldCheck size={20} aria-hidden="true"/><strong>{t('ขอบเขตที่อนุญาต','Approved scope')}</strong><span>{t('เป้าหมาย · สิทธิ์ · วงเงิน','Goal · Permissions · Budget')}</span></div>
        <ArrowRight className="flow-arrow" aria-hidden="true"/>
        <div className={`flow-node lead-node ${step===1?'is-current':''}`}><GitBranch size={20} aria-hidden="true"/><strong>{strategy.lead}</strong><span>{t('จัดสรรตามโหมด','Mode-specific allocation')}</span></div>
        <div className={`flow-branches ${step===1?'is-current':''}`}>{strategy.workers.map((worker,i)=><div className={`worker-node ${strategy.id==='router'&&i!==0?'route-idle':''}`} key={worker}><span className="worker-symbol" aria-hidden="true">{strategy.id==='router'&&i===0?<Check size={14}/>:<span/>}</span><strong>{worker}</strong>{strategy.id==='router'&&<small>{i===0?t('เส้นทางที่เลือก','Selected'):t('ทางเลือก','Alternative')}</small>}</div>)}</div>
        <ArrowRight className="flow-arrow" aria-hidden="true"/>
        <div className={`flow-node review-node ${step===2?'is-current':''}`}><ShieldCheck size={20} aria-hidden="true"/><strong>{strategy.join}</strong><span>{t('ตรวจผลและข้อจำกัด','Inspect results and limits')}</span></div>
        <ArrowRight className="flow-arrow" aria-hidden="true"/>
        <div className={`flow-node evidence-node ${step===3?'is-current':''}`}><FileCheck2 size={20} aria-hidden="true"/><strong>{t('หลักฐาน','Evidence')}</strong><span>{t('ไฟล์ · Revision · Checks','Files · Revisions · Checks')}</span></div>
        <figcaption className="sr-only">{t('ขอบเขตที่อนุญาต','Approved scope')} → {strategy.lead} → {strategy.workers.join(strategy.id==='pipeline'?' → ':' / ')} → {strategy.join} → {t('หลักฐาน','Evidence')}. {t(strategy.limitTh,strategy.limitEn)}</figcaption>
      </figure>
      <div className="story-controls"><div className="story-steps" role="group" aria-label={t('สำรวจขั้นตอน','Explore workflow steps')}>{steps.map((s,i)=><button type="button" key={s.en} aria-pressed={step===i} onClick={()=>{setStep(i);setPlaying(false)}}><span aria-hidden="true">{step===i?<span className="step-current"/>:i<step?<Check size={12}/>:<span className="step-dot"/>}</span>{t(s.th,s.en)}</button>)}</div><button type="button" className="story-play" aria-pressed={playing} onClick={()=>{
        if(reduced){setStep((step+1)%4);return}
        if(playing)setPlaying(false);
        else{if(step===3)setStep(0);setPlaying(true)}
      }}>{playing?<Pause size={15} aria-hidden="true"/>:<Play size={15} aria-hidden="true"/>}{reduced?t('ขั้นตอนถัดไป','Next step'):playing?t('หยุดภาพอธิบาย','Pause story'):t('เล่นภาพอธิบาย','Play story')}</button></div>
      <div className="story-detail" aria-live={playing?'off':'polite'} aria-atomic="true"><strong>{t(steps[step].titleTh,steps[step].titleEn)}</strong><p>{t(steps[step].bodyTh,steps[step].bodyEn)}</p></div>
      <p className="strategy-boundary"><ShieldCheck size={16} aria-hidden="true"/>{t(strategy.limitTh,strategy.limitEn)}</p>
    </div>
    <div className="strategy-publication"><p>{t('ทั้ง 6 โหมดอยู่ระหว่างพัฒนาใน branch ที่ยังไม่เผยแพร่ ภาพนี้อธิบายแนวคิด ไม่ใช่หลักฐานว่า checkpoint d928e9c มีโหมดเหล่านี้หรือผ่านการรัน provider จริง','All six modes are in active development on an unpublished branch. This diagram explains the design; it does not show these modes in public checkpoint d928e9c or qualify live provider execution.')}</p><a href={href(lang,'github')}>{t('ตรวจสถานะ source','Check source status')}<ArrowUpRight size={16} aria-hidden="true"/></a></div>
  </section>;
}
