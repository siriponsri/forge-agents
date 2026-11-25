import React,{useEffect,useState} from 'react';
import {scoped,date} from './api.mjs';
import {Field,Heading,Badge,Empty,Json} from './ui.jsx';
import {useStrategy,StrategyStatus} from './Assistance.jsx';
import './proactive-workflows.css';

const localDate=ms=>{if(!Number.isFinite(ms))return '';const d=new Date(ms);return new Date(ms-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const blank=()=>({name:'',instructions:'',planId:'',taskIds:[],trigger:{kind:'schedule',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Bangkok',localTime:'09:00',weekdays:[1,2,3,4,5],maxLatenessMs:60000},identity:{connectionIds:[]},scope:{paths:['.'],capabilities:['read','propose']},budget:{maxRuns:1,maxRunMs:300000,maxTokens:null,maxCost:null,currency:null},expiresAt:Date.now()+86400000});
export default function ProactiveWorkflows(props){return <WorkflowPage key={props.projectId} {...props}/>;}
function WorkflowPage({t,state,projectId,run,busy}){
  const ui=useStrategy({projectId,run,service:'proactive',readAction:'state'});
  const [selected,setSelected]=useState(''),[draft,setDraft]=useState(blank),[editing,setEditing]=useState(null),[note,setNote]=useState('');
  useEffect(()=>{const timer=setInterval(()=>void ui.refresh(),5000);return()=>clearInterval(timer);},[ui.refresh]);
  const data=ui.data,recipe=data?.recipes?.find(r=>r.id===selected),disabled=busy||ui.loading||!!ui.uncertain.length;
  const tasks=scoped(state,'tasks',projectId),plans=scoped(state,'plans',projectId).filter(p=>p.approved),connections=scoped(state,'connections',projectId).filter(c=>c.enabled!==false);
  const act=(method,extra={})=>ui.act(method,{...(recipe?{recipeId:recipe.id,expectedRevision:recipe.revision}:{}),...extra});
  const patch=(key,value)=>setDraft(d=>({...d,[key]:value}));
  const trigger=(key,value)=>patch('trigger',{...draft.trigger,[key]:value});
  const changeKind=kind=>patch('trigger',kind==='schedule'?{kind,timezone:draft.trigger.timezone,localTime:'09:00',weekdays:[1,2,3,4,5],maxLatenessMs:60000}:{kind,timezone:draft.trigger.timezone,source:'',subject:'',eventType:'',maxAgeMs:60000});
  const toggle=(values,v)=>values.includes(v)?values.filter(x=>x!==v):[...values,v];
  const edit=r=>{const d=r.version.definition;setDraft(Object.fromEntries(Object.keys(blank()).map(k=>[k,structuredClone(d[k])])));setEditing({id:r.id,revision:r.revision});};
  const save=()=>ui.act(editing?'revise':'create',{...draft,...(editing?{recipeId:editing.id,expectedRevision:editing.revision}:{})},r=>{setSelected(r.id);setEditing(null);setDraft(blank());});
  const occurrences=data?.occurrences?.filter(o=>o.recipeId===selected)??[],inbox=data?.inbox?.filter(i=>i.recipeId===selected)??[];
  return <div className="proactive-workflows">
    <Heading title={t('งานเชิงรุก','Proactive workflows')} subtitle={t('อนุมัติสูตร ขอบเขต และงบก่อน แล้วให้ระบบเริ่มงานตามเงื่อนไขที่ยอมรับไว้','Approve a recipe, scope and budget, then run accepted triggers automatically.')}/>
    <StrategyStatus ui={ui} t={t}/>
    <p className="help">{t('ใช้แผนและงานเดิมผ่าน T3 งานจาก Telegram ยังต้องอนุมัติในช่องทางต้นทาง การพัก ปิด หรือเริ่มระบบใหม่ทำให้สิทธิ์เดิมใช้ต่อไม่ได้','Uses existing plans and tasks through T3. Telegram work still needs originating-channel approval. Pause, close and restart invalidate prior grants.')}</p>
    <button type="button" disabled={ui.loading} onClick={()=>void ui.refresh()}>{t('รีเฟรชสถานะ','Refresh status')}</button>
    {data&&!data.capabilities.executionSupported&&<p role="alert">{t('ยังเริ่มอัตโนมัติไม่ได้: T3 ต้องรองรับบริบทและการตรวจขอบเขตเวอร์ชัน 1','Automatic execution unavailable: T3 must support context and enforcement version 1.')}</p>}
    <p className="help">{t('ทุกครั้งต้องมีหลักฐานว่า runtime บังคับขอบเขตได้ทั้งเครื่องมือ native และ MCP ถ้ายังพิสูจน์ไม่ได้จะส่งเข้า Inbox ก่อนเริ่มงาน แม้เป็นสูตรอ่านหรือเสนอเท่านั้น','Every trigger needs evidence that the runtime enforces scope across native tools and MCP. Unproven enforcement goes to Inbox before execution, including read/propose recipes.')}</p>
    <div className="proactive-columns">
      <section className="panel"><h2>{t('สูตรที่บันทึกไว้','Saved recipes')}</h2>
        {!data?.recipes?.length&&<Empty>{t('ยังไม่มีสูตร เริ่มจากงานในแผนที่อนุมัติแล้ว','No recipes. Start with tasks in an approved plan.')}</Empty>}
        <Field label={t('เลือกสูตร','Choose recipe')}><select value={selected} onChange={e=>{setSelected(e.target.value);setEditing(null);setNote('');}}><option value="">{t('เลือกสูตร','Choose recipe')}</option>{data?.recipes?.map(r=><option key={r.id} value={r.id}>{r.name} · {r.status}</option>)}</select></Field>
        {recipe&&<>
          <h3>{recipe.name}</h3><Badge>{recipe.status}</Badge>
          <p>{t('เวอร์ชัน','Version')} {recipe.version.number} · {t('หมดอายุ','Expires')} {date(recipe.version.definition.expiresAt)}</p>
          <p>{t('ครั้งถัดไป','Next trigger')}: {recipe.nextDue?`${date(recipe.nextDue.at)} · ${recipe.version.definition.trigger.timezone}`:t('รอเปิดใช้งานหรือเหตุการณ์ที่ยืนยันตัวตนแล้ว','Awaiting enablement or authenticated event')}</p>
          <details open><summary>{t('ตรวจสูตรและขอบเขตก่อนอนุมัติ','Review recipe and envelope before approval')}</summary><p>{recipe.version.definition.instructions}</p><Json value={{trigger:recipe.version.definition.trigger,scope:recipe.version.definition.scope,budget:recipe.version.definition.budget,taskIds:recipe.version.definition.taskIds,identity:recipe.version.definition.identity,digest:recipe.version.digest}}/></details>
          <div className="actions">
            <button disabled={disabled||occurrences.some(o=>o.held)} onClick={()=>act('approve')}>{t('Owner อนุมัติเวอร์ชันนี้','Owner approves this version')}</button>
            <button className="primary" disabled={disabled||recipe.status!=='approved'||!data.capabilities.executionSupported} onClick={()=>act('enable')}>{t('เปิดเงื่อนไขอัตโนมัติ','Enable automatic triggers')}</button>
            <button disabled={disabled} onClick={()=>act('pause')}>{t('พักและหยุดงานที่เป็นเจ้าของ','Pause and stop owned work')}</button>
            <button disabled={disabled} onClick={()=>act('revoke')}>{t('ถอนสิทธิ์','Revoke grant')}</button>
            <button disabled={disabled||occurrences.some(o=>o.held)} onClick={()=>edit(recipe)}>{t('แก้เป็นเวอร์ชันใหม่','Edit as a new version')}</button>
          </div>
          <h3>{t('การใช้ทรัพยากรที่สังเกตได้','Observed accounting')}</h3>
          <p>{t('ค่าไม่ทราบไม่ใช่ศูนย์ ประมาณการและค่าสมาชิกแยกจากยอดที่รายงาน เพดานตรวจจากยอดที่รายงานก่อนเริ่มครั้งถัดไป ไม่ใช่การรับประกันราคาสูงสุดจากผู้ให้บริการ','Unknown is not zero. Estimates and subscription accounting are separate from reported totals. Caps check reported usage before the next start; they do not guarantee a provider price ceiling.')}</p><Json value={recipe.usage}/>
        </>}
      </section>
      <section className="panel"><h2>{editing?t('แก้เวอร์ชันสูตร','Revise recipe'):t('ตั้งค่าสูตรใหม่','Configure a recipe')}</h2>
        <form onSubmit={e=>{e.preventDefault();void save();}}>
          <Field label={t('ชื่อสูตร','Recipe name')}><input required maxLength={200} value={draft.name} onChange={e=>patch('name',e.target.value)}/></Field>
          <Field label={t('สิ่งที่จะอ่าน เสนอ หรือทำในงานนี้','What to read, propose or do')}><textarea required maxLength={8000} value={draft.instructions} onChange={e=>patch('instructions',e.target.value)}/></Field>
          <Field label={t('แผนที่อนุมัติแล้ว','Approved plan')}><select required value={draft.planId} onChange={e=>{patch('planId',e.target.value);patch('taskIds',[]);}}><option value="">{t('เลือกแผน','Choose plan')}</option>{plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <fieldset><legend>{t('งานเดิมที่จะเรียกได้ (ไม่ส่งงานเดิมซ้ำ)','Existing tasks (each may be submitted once)')}</legend>{tasks.filter(x=>x.planId===draft.planId).map(task=><label key={task.id} className="proactive-check"><input type="checkbox" checked={draft.taskIds.includes(task.id)} onChange={()=>patch('taskIds',toggle(draft.taskIds,task.id))}/>{task.title} · {task.status}</label>)}</fieldset>
          <div className="form-grid"><Field label={t('เงื่อนไขเริ่มงาน','Trigger')}><select value={draft.trigger.kind} onChange={e=>changeKind(e.target.value)}><option value="schedule">{t('เวลาและวัน','Time and weekdays')}</option><option value="event">{t('เหตุการณ์ที่ยืนยันตัวตนแล้ว','Authenticated event')}</option></select></Field>
          <Field label={t('เขตเวลา IANA','IANA timezone')}><input required value={draft.trigger.timezone} onChange={e=>trigger('timezone',e.target.value)}/></Field></div>
          {draft.trigger.kind==='schedule'?<>
            <Field label={t('เวลาท้องถิ่นของเขตเวลาข้างต้น','Local time in the selected timezone')}><input required type="time" value={draft.trigger.localTime} onChange={e=>trigger('localTime',e.target.value)}/></Field>
            <fieldset className="proactive-days"><legend>{t('วัน','Weekdays')}</legend>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,n)=><label key={day}><input type="checkbox" checked={draft.trigger.weekdays.includes(n)} onChange={()=>trigger('weekdays',toggle(draft.trigger.weekdays,n))}/>{t(['อา','จ','อ','พ','พฤ','ศ','ส'][n],day)}</label>)}</fieldset>
            <Field label={t('เริ่มช้าได้สูงสุด (วินาที)','Maximum lateness (seconds)')}><input required type="number" min={60} max={86400} value={draft.trigger.maxLatenessMs/1000} onChange={e=>trigger('maxLatenessMs',Number(e.target.value)*1000)}/></Field>
          </>:<>
            {['source','subject','eventType'].map(k=><Field key={k} label={t({source:'ชื่อแหล่งเหตุการณ์',subject:'ตัวตนของแหล่งที่ยอมรับ',eventType:'ประเภทเหตุการณ์'}[k],{source:'Event source',subject:'Accepted source identity',eventType:'Event type'}[k])}><input required maxLength={200} value={draft.trigger[k]} onChange={e=>trigger(k,e.target.value)}/></Field>)}
            <Field label={t('อายุเหตุการณ์สูงสุด (วินาที)','Maximum event age (seconds)')}><input required type="number" min={1} max={86400} value={draft.trigger.maxAgeMs/1000} onChange={e=>trigger('maxAgeMs',Number(e.target.value)*1000)}/></Field>
            <p className="help">{t('ต้องเชื่อม transport ที่ตรวจลายเซ็นหรือ session อยู่แล้ว ไม่มี URL สาธารณะหรือ secret ในสูตรนี้','Requires an existing transport that verifies signatures or sessions. This recipe creates no public URL or secret.')}</p>
          </>}
          <fieldset><legend>{t('บัญชีเชื่อมต่อที่ยอมรับ','Accepted connected accounts')}</legend>{connections.map(c=><label key={c.id} className="proactive-check"><input type="checkbox" checked={draft.identity.connectionIds.includes(c.id)} onChange={()=>patch('identity',{connectionIds:toggle(draft.identity.connectionIds,c.id)})}/>{c.name} · {c.kind}</label>)}</fieldset>
          <Field label={t('เส้นทางภายใน workspace (หนึ่งรายการต่อบรรทัด, . = workspace)','Workspace paths (one per line, . = workspace)')}><textarea required value={draft.scope.paths.join('\n')} onChange={e=>patch('scope',{...draft.scope,paths:e.target.value.split('\n')})}/></Field>
          <fieldset><legend>{t('ความสามารถที่ยอมรับ','Accepted capabilities')}</legend>{[['read',t('อ่าน','Read')],['propose',t('เสนอ','Propose')],['workspace.write',t('แก้ workspace ผ่านการกำกับเดิม','Workspace writes through existing governance')],['external.write',t('ผลภายนอกผ่านการกำกับเดิม','Outward effects through existing governance')]].map(([key,label])=><label key={key} className="proactive-check"><input type="checkbox" checked={draft.scope.capabilities.includes(key)} onChange={()=>patch('scope',{...draft.scope,capabilities:toggle(draft.scope.capabilities,key)})}/>{label}</label>)}</fieldset>
          <p className="help">{t('รายการเส้นทางไม่ใช่ sandbox การแก้ไขและผลภายนอกยังต้องผ่านสิทธิ์และการอนุมัติเครื่องมือเดิม','Paths are not a sandbox. Writes and outward effects retain existing permission and tool approval rules.')}</p>
          <div className="form-grid">{[['maxRuns',t('จำนวนครั้งสูงสุด','Maximum starts'),1,64],['maxRunMs',t('เวลาต่อครั้ง (มิลลิวินาที)','Time per run (ms)'),1000,3600000],['maxTokens',t('เพดาน token ที่รายงาน (ว่าง = ไม่กำหนด)','Reported token cap (blank = none)'),1,Number.MAX_SAFE_INTEGER],['maxCost',t('เพดานเงินที่รายงาน (ว่าง = ไม่กำหนด)','Reported spending cap (blank = none)'),0.000001,Number.MAX_SAFE_INTEGER]].map(([key,label,min,max])=><Field key={key} label={label}><input type="number" required={['maxRuns','maxRunMs'].includes(key)} min={min} max={max} step={key==='maxCost'?'any':1} value={draft.budget[key]??''} onChange={e=>patch('budget',{...draft.budget,[key]:e.target.value===''?null:Number(e.target.value),...(key==='maxCost'&&e.target.value===''?{currency:null}:{})})}/></Field>)}</div>
          {draft.budget.maxCost!==null&&<Field label={t('สกุลเงินตามรายงานจริง','Exact reported currency')}><input required maxLength={20} value={draft.budget.currency??''} onChange={e=>patch('budget',{...draft.budget,currency:e.target.value})}/></Field>}
          <Field label={t('สิทธิ์หมดอายุ (เวลาของเครื่องนี้)','Grant expiry (this computer’s local time)')}><input required type="datetime-local" value={localDate(draft.expiresAt)} onChange={e=>patch('expiresAt',new Date(e.target.value).getTime())}/></Field>
          <button className="primary" disabled={disabled||!draft.taskIds.length||!draft.scope.capabilities.length}>{t('บันทึกฉบับรออนุมัติ','Save for Owner approval')}</button>
          {editing&&<button type="button" disabled={disabled} onClick={()=>{setEditing(null);setDraft(blank());}}>{t('ยกเลิกการแก้','Discard edit')}</button>}
        </form>
      </section>
    </div>
    {recipe&&<section className="panel"><h2>{t('ประวัติการเรียกและการส่งผล','Run and delivery history')}</h2>
      {!occurrences.length&&<Empty>{t('ยังไม่มีเงื่อนไขที่เรียกงาน','No trigger occurrence yet.')}</Empty>}
      {occurrences.map(o=><details key={o.id}><summary>{date(o.scheduledAt)} · {o.status} · {o.outcome??o.error??o.kind}</summary><p>{t('งาน','Task')}: {tasks.find(x=>x.id===o.taskId)?.title??o.taskId??'—'} · run {o.runId??t('ยังไม่พบ','not observed')}</p><Json value={{occurrence:o,delivery:data.deliveries.find(d=>d.id===o.deliveryId)}}/>
        <button disabled={disabled} onClick={()=>act('reconcile',{occurrenceId:o.id})}>{t('ตรวจผลกับเจ้าของ T3','Reconcile with T3 owner')}</button></details>)}
      <h2>{t('กล่องรอตัดสินใจ','Inbox')}</h2><p>{t('การปิดรายการไม่อนุมัติให้ทำซ้ำหรือขยายสิทธิ์ ผลที่ยังไม่แน่นอนต้องตรวจสอบก่อน','Resolving an item does not authorize retry or wider scope. Unknown outcomes require reconciliation first.')}</p>
      <Field label={t('เหตุผลและหลักฐานสำหรับปิดรายการ','Resolution note and evidence')}><textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></Field>
      {!inbox.length&&<Empty>{t('ไม่มีข้อยกเว้น','No exceptions.')}</Empty>}
      {inbox.map(item=><div className="proactive-inbox" key={item.id}><Badge>{item.status}</Badge> {item.code} · {date(item.at)}<p>{item.occurrenceId}</p>{item.status==='open'&&<button disabled={disabled||!note.trim()||occurrences.find(o=>o.id===item.occurrenceId)?.held} onClick={()=>act('resolve',{inboxId:item.id,note})}>{t('Owner ปิดรายการพร้อมเหตุผล','Owner resolves with note')}</button>}</div>)}
    </section>}
  </div>;
}
