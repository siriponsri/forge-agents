import React,{useEffect,useRef,useState} from 'react';
import {request,operationId} from './api.mjs';
import {Field,Badge,Json} from './ui.jsx';

// This surface allocates only existing reviewed Workspace/task records. The
// existing owners retain admission, native execution, evidence and Stop.
export default function ResearchCohort({t,state,trial,run,busy,onChanged}){
  const [data,setData]=useState(null),[helper,setHelper]=useState(''),[revision,setRevision]=useState(''),[skills,setSkills]=useState([]),[error,setError]=useState(''),[working,setWorking]=useState(false),[uncertain,setUncertain]=useState(null);
  const lock=useRef(false),generation=useRef(0),projectId=trial.projectId;
  const composition=(state.events??[]).find(e=>e.type==='research.composition'&&e.projectId===projectId&&e.trialId===trial.id);
  const workspaces=(state.events??[]).filter(w=>w.type==='workspace.workspace'&&w.projectId===projectId&&w.id!==trial.manifest.workspaceId&&w.status==='ready'&&!w.runOperationId&&!w.stopRequested&&!w.restoreReviewRequired);
  const activeSkills=(state.skills??[]).filter(s=>s.projectId===projectId&&s.status==='active');
  const title=w=>state.tasks.find(t=>t.id===w.taskId)?.title??w.taskId;
  async function refresh(){if(!composition)return;const n=generation.current,result=await request('/api/research-components/state',{projectId,trialId:trial.id});if(n===generation.current)setData(result);}
  useEffect(()=>{generation.current++;setData(null);if(composition)refresh().catch(e=>setError(`${e.code??'ERROR'}: ${e.message}`));return()=>{generation.current++;};},[trial.id,composition?.id,trial.revision]);
  async function command(method,extra={},exact){
    if(lock.current)return;lock.current=true;setWorking(true);setError('');
    const input=exact??{projectId,trialId:trial.id,...(method==='state'||method==='export'?{}:{operationId:operationId()}),...extra};
    try{const result=await request('/api/research-components/'+method,input);setUncertain(null);if(method==='export'){const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`forge-cohort-${trial.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}await run(async()=>result);await refresh();await onChanged?.();return result;}
    catch(e){setError(`${e.code??'ERROR'}: ${e.message}`);if(e.status===0)setUncertain({method,input});}
    finally{lock.current=false;setWorking(false);}
  }
  const disabled=busy||working,flags=trial.manifest.components;
  return <details className="panel"><summary>{t('ทีมวิจัยจากงานที่อนุมัติ','Research team from approved tasks')} · {trial.manifest.ablation} · <Badge>{data?.status??(composition?'prepared':trial.status)}</Badge></summary>
    <p className="help">{t('ใช้ Workspace แยกที่อนุมัติไว้แล้ว แต่ละบทบาทใช้เพดานรวมและเวลาสิ้นสุดเดียวกัน หลักฐานต้องผ่านตัวตรวจอิสระก่อนทำงานต่อ','Use existing approved isolated workspaces. Roles share one resource envelope and absolute deadline; independent evidence gates continuation.')}</p>
    {error&&<p role="alert">{error}</p>}
    {uncertain&&<button disabled={disabled} onClick={()=>command(uncertain.method,{},uncertain.input)}>{t('กู้ผลคำขอเดิม','Recover exact request')}</button>}
    {!composition&&trial.status==='reserved'&&<form onSubmit={e=>{e.preventDefault();const slots=[{workspaceId:trial.manifest.workspaceId,role:'primary',skillIds:flags.skills?skills:[]}];if(helper)slots.push({workspaceId:helper,role:'helper',skillIds:flags.skills?skills:[]});if(revision)slots.push({workspaceId:revision,role:'revision',skillIds:flags.skills?skills:[]});command('prepare',{slots});}}>
      <p>{t('งานหลัก','Primary')}: {state.tasks.find(t=>t.id===trial.manifest.taskId)?.title??trial.manifest.taskId}</p>
      {flags.staffing&&<Field label={t('Workspace ผู้ช่วย','Helper workspace')}><select required value={helper} disabled={disabled} onChange={e=>setHelper(e.target.value)}><option value="">{t('เลือกงานผู้ช่วยที่อนุมัติ','Choose approved helper work')}</option>{workspaces.filter(w=>w.id!==revision).map(w=><option key={w.id} value={w.id}>{title(w)}</option>)}</select></Field>}
      {flags.adaptation&&['rule-adapt','evidence-guided'].includes(trial.manifest.policy)&&<Field label={t('Workspace งานปรับแก้','Revision workspace')}><select required value={revision} disabled={disabled} onChange={e=>setRevision(e.target.value)}><option value="">{t('เลือกงานปรับแก้ที่อนุมัติ','Choose approved revision work')}</option>{workspaces.filter(w=>w.id!==helper).map(w=><option key={w.id} value={w.id}>{title(w)}</option>)}</select></Field>}
      {flags.skills&&<fieldset><legend>{t('ทักษะรุ่นที่ตรวจแล้ว','Reviewed skill versions')}</legend>{activeSkills.map(s=><label key={s.id}><input type="checkbox" checked={skills.includes(s.id)} onChange={e=>setSkills(v=>e.target.checked?[...v,s.id]:v.filter(id=>id!==s.id))}/> {s.name} · {s.version}</label>)}</fieldset>}
      <button disabled={disabled||!!uncertain||flags.skills&&!skills.length}>{t('ตรึงทีมและเพดาน (ยังไม่รัน)','Pin team and limits (no execution)')}</button>
    </form>}
    {composition&&<><div className="actions"><button disabled={disabled} onClick={()=>command('state')}>{t('โหลดสถานะทีม','Refresh team')}</button><button disabled={disabled||!!uncertain||['PASSED','FAILED','stopped','stopping'].includes(data?.status)} onClick={()=>command('advance')}>{t('รันขั้นถัดไปที่อนุญาต','Run next authorized step')}</button><button disabled={disabled} onClick={()=>command('reconcile')}>{t('ตรวจ attempt เดิม','Reconcile retained attempts')}</button><button disabled={disabled} onClick={()=>command('stop')}>{t('หยุดทั้งทีม','Stop team')}</button><button disabled={disabled} onClick={()=>command('export')}>{t('ส่งออกทีมและหลักฐาน','Export team and evidence')}</button></div>
      {(data?.attempts??[]).map(x=><div className="history-row" key={x.allocation.id}><span>{x.allocation.role} · {x.run?.status??'unknown'} · {x.evidence?.status??t('รอตรวจ','needs validation')}</span>{x.run?.status==='completed'&&<button disabled={disabled} onClick={()=>command('validate',{allocationId:x.allocation.id})}>{t('ตรวจ bytes ของผลงาน','Validate artifact bytes')}</button>}</div>)}
      {data&&<details><summary>{t('ดูเพดาน การใช้ และ receipts','Inspect limits, usage and receipts')}</summary><Json value={data}/></details>}
    </>}
  </details>;
}
