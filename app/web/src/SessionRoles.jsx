import React,{useCallback,useEffect,useRef,useState} from 'react';
import {operationId,request,scoped} from './api.mjs';
import {Field,Heading,Empty} from './ui.jsx';

const thai=(th,en)=>th;
const labels={orchestrator:['ผู้ประสานงาน','Orchestrator'],planner:['ผู้วางแผน','Planner'],reviewer:['ผู้ตรวจทาน','Reviewer'],executor:['ผู้ลงมือ','Executor'],strategist:['ผู้วางกลยุทธ์','Strategist'],researcher:['ผู้ค้นคว้า','Researcher'],designer:['ผู้ออกแบบ','Designer'],tester:['ผู้ทดสอบ','Tester'],assistant:['ผู้ช่วย','Assistant']};
const statuses={reserved:['บันทึกคำขอแล้ว','Reserved'],dispatching:['กำลังส่ง','Sending'],linked:['เชื่อมงานแล้ว','Linked'],unknown:['ยังไม่ทราบผล','Outcome unknown'],'not-dispatched':['ยังไม่ได้ส่ง','Not dispatched'],stopped:['หยุดก่อนส่งแล้ว','Stopped before send'],running:['กำลังทำงาน','Running'],starting:['กำลังเริ่ม','Starting'],waiting:['กำลังรอ','Waiting'],completed:['เสร็จแล้ว','Completed'],failed:['ไม่สำเร็จ','Failed'],interrupted:['หยุดแล้ว','Interrupted'],cancelled:['ยกเลิกแล้ว','Cancelled']};
const errors={WORKSPACE_BUSY:['โฟลเดอร์งานยังถูกใช้อยู่ ใช้โฟลเดอร์งานแยก หรือหยุดและตรวจผลของงานเดิมก่อนส่ง','Workspace is busy. Use an isolated Parallel Workspace, or stop and reconcile existing work before sending.'],SESSION_ROLE_STALE:['บทบาทหรือรอบการทำงานเปลี่ยนแล้ว โหลดข้อมูลล่าสุดและอนุมัติการเชื่อมใหม่','A role or session changed. Refresh state and approve a new child link.'],REVISION_CONFLICT:['มีคนแก้ไขข้อมูลนี้แล้ว โหลดบทบาทล่าสุดและตรวจอีกครั้งก่อนบันทึก','Newer changes exist. Load the current role before saving.'],SESSION_ROLE_BINDING:['เปิดแชตของผู้ช่วย AI และตรวจการเชื่อมต่อ T3 ก่อนเชื่อมเป็นรอบการทำงานย่อย','Open the bot’s chat and reconcile its T3 binding before linking a child.']};

export default function SessionRoles(props){return <RolePage key={props.projectId} {...props}/>;}
function RolePage({t=thai,state,projectId,run,busy=false}){
  const [data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(null);
  const [conversationId,setConversation]=useState(''),[botId,setBot]=useState(''),[editor,setEditor]=useState(null),[parentRunId,setParent]=useState(''),[childKey,setChild]=useState(''),[membershipId,setMembership]=useState(''),[text,setText]=useState('');
  const lock=useRef(false),mounted=useRef(true),latestRun=useRef(run),storageKey=`forge.session-roles.${projectId}`;
  latestRun.current=run;
  const invoke=useCallback(fn=>latestRun.current?latestRun.current(fn):fn(),[]);
  const refresh=useCallback(async()=>{
    if(!projectId)return null;
    try{const value=await invoke(async()=>{try{return await request('/api/session-roles/state',{projectId});}catch(e){if(mounted.current)setError(e);throw e;}});if(value&&mounted.current)setData(value);return value;}
    catch(e){if(mounted.current)setError(e);return null;}
  },[projectId,invoke]);
  useEffect(()=>{mounted.current=true;try{setUncertain(JSON.parse(sessionStorage.getItem(storageKey)||'null'));}catch{/* Durable server records remain available. */}void refresh();return()=>{mounted.current=false;};},[refresh,storageKey]);
  const remember=value=>{setUncertain(value);try{if(value)sessionStorage.setItem(storageKey,JSON.stringify(value));else sessionStorage.removeItem(storageKey);}catch{/* Server still retains command identity. */}};
  const act=async(method,body={},retry=null)=>{
    if(lock.current)return null;lock.current=true;setLoading(true);setError(null);setNotice('');
    const mutation=['assign','bind','revoke','prompt'].includes(method),input=retry??{projectId,...(mutation?{operationId:operationId()}:{}),...body};
    if(mutation)remember({method,input});
    try{return await invoke(async()=>{
      try{const result=await request(`/api/session-roles/${method}`,input);if(mounted.current){if(mutation)remember(null);setNotice(true);await refresh();}return result;}
      catch(e){if(mounted.current)setError(e);throw e;}
    });}catch{return null;}finally{lock.current=false;if(mounted.current)setLoading(false);}
  };
  const conversations=scoped(state,'conversations',projectId),bots=scoped(state,'bots',projectId),assignments=data?.assignments??[],memberships=data?.memberships??[],commands=data?.commands??[];
  const conversation=conversations.find(c=>c.id===conversationId),eligibleBots=conversation?.kind==='private'?bots.filter(b=>b.id===conversation.botId):bots;
  const current=assignments.find(a=>a.conversationId===conversationId&&a.botId===botId),roleLabel=role=>labels[role]?t(...labels[role]):role;
  const sessionLabel=(c,b)=>`${conversations.find(x=>x.id===c)?.name??c} · ${bots.find(x=>x.id===b)?.name??b}`;
  const sessionKey=`${conversationId}:${botId}`;
  useEffect(()=>{setEditor(null);},[sessionKey]);
  useEffect(()=>{if(!editor&&data)setEditor({role:current?.role??'assistant',expectedRevision:current?.roleRevision??0});},[data,current,editor]);
  const parentRuns=scoped(state,'runs',projectId).filter(r=>['starting','running','waiting'].includes(r.status)&&!r.stopRequest&&assignments.some(a=>a.conversationId===r.conversationId&&a.botId===r.botId&&a.role==='orchestrator'&&r.sessionRole?.assignmentId===a.id));
  const parent=parentRuns.find(r=>r.id===parentRunId),childOptions=assignments.filter(a=>a.conversationId!==parent?.conversationId&&conversations.find(c=>c.id===a.conversationId)?.bindings?.[a.botId]);
  const approved=memberships.filter(m=>m.status==='approved'&&!m.restoreReviewRequired&&m.usable!==false),disabled=busy||loading||!data||!!uncertain;
  if(!projectId)return <Empty>{t('เลือกโปรเจกต์ก่อน','Select a project first.')}</Empty>;
  return <div style={{minWidth:0,overflowWrap:'anywhere'}}>
    <Heading title={t('บทบาทของรอบการทำงาน','Session roles')} description={t('กำหนดหน้าที่และเชื่อมรอบการทำงานย่อยกับการทำงานของผู้ประสานงาน','Assign working roles and link child sessions to an orchestrator attempt.')}>
      <button type="button" disabled={loading} onClick={()=>void refresh()}>{t('โหลดข้อมูลล่าสุด','Refresh state')}</button>
    </Heading>
    <p className="help">{t('เจ้าของอนุมัติการเชื่อมแต่ละรอบการทำงาน บทบาทไม่เพิ่มสิทธิ์เครื่องมือหรืออนุมัติแผน การส่งข้อความยังตรวจโฟลเดอร์งานและงบตามเดิม','The Owner approves each child link. Roles grant no tool or plan authority. Prompts retain workspace and Budget checks.')}</p>
    <p role="status" aria-live="polite">{loading?t('กำลังบันทึกหรือตรวจสอบ…','Saving or checking…'):notice?t('บันทึกผลแล้ว','Result recorded'):''}</p>
    {error&&<p role="alert">{errors[error.code]?t(...errors[error.code]):t('ทำรายการไม่สำเร็จ โหลดข้อมูลล่าสุดและตรวจคำสั่งเดิมก่อนลองใหม่','The request failed. Refresh state and inspect the original command before retrying.')} <code>{error.code??'REQUEST_FAILED'}</code></p>}
    {uncertain&&<section className="panel" aria-label={t('คำสั่งที่ยังไม่ทราบผล','Uncertain command')}>
      <h2>{t('ตรวจคำสั่งเดิมก่อนทำต่อ','Check the original command')}</h2><p>{t('อาจไม่ได้รับคำตอบทั้งที่บันทึกแล้ว การตรวจใช้รหัสและข้อความเดิม และไม่ส่งคำสั่งซ้ำ','The response may have been lost after saving. Checking uses the same operation and text and never resends a prompt.')}</p>
      <div className="actions"><button type="button" disabled={busy||loading} onClick={()=>act(uncertain.method,{},uncertain.input)}>{t('ตรวจผลด้วยรหัสเดิม','Check same operation')}</button><button type="button" disabled={busy||loading} onClick={async()=>{if(await refresh())remember(null);}}>{t('รับทราบหลังตรวจสถานะแล้ว','Acknowledge after checking state')}</button></div>
    </section>}
    <section className="panel" aria-label={t('หน้าที่ของรอบการทำงาน','Working role')}>
      <h2>{t('กำหนดหน้าที่','Assign a role')}</h2>
      {!conversations.length?<Empty>{t('สร้างแชตส่วนตัวหรือห้องทีมในหน้าทีมก่อน','Create a private chat or team room in Team first.')}</Empty>:<form onSubmit={async e=>{e.preventDefault();if(await act('assign',{conversationId,botId,role:editor.role,expectedRevision:editor.expectedRevision}))setEditor(null);}}>
        <div className="form-grid"><Field label={t('แชต','Conversation')}><select required value={conversationId} onChange={e=>{setConversation(e.target.value);setBot('');}}><option value="">{t('เลือกแชต','Choose a conversation')}</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label={t('ผู้ช่วย AI ในรอบการทำงาน','Session bot')}><select required disabled={!conversationId} value={botId} onChange={e=>setBot(e.target.value)}><option value="">{t('เลือกผู้ช่วย AI','Choose a bot')}</option>{eligibleBots.filter(b=>b.status!=='retired').map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label={t('บทบาท','Role')}><select disabled={!editor} value={editor?.role??'assistant'} onChange={e=>setEditor({...editor,role:e.target.value})}>{(data?.roles??Object.keys(labels)).map(r=><option key={r} value={r}>{roleLabel(r)}</option>)}</select></Field></div>
        {editor&&editor.expectedRevision!==(current?.roleRevision??0)&&<p role="alert">{t('บทบาทเปลี่ยนแล้ว โหลดฉบับปัจจุบันก่อนบันทึก','Role changed. Load the current revision before saving.')}</p>}
        <div className="actions"><button className="primary" disabled={disabled||!conversationId||!botId||!editor} type="submit">{t('บันทึกบทบาท','Save role')}</button><button type="button" disabled={loading} onClick={()=>setEditor({role:current?.role??'assistant',expectedRevision:current?.roleRevision??0})}>{t('โหลดบทบาทปัจจุบัน','Load current role')}</button></div>
      </form>}
    </section>
    <section className="panel" aria-label={t('เชื่อมรอบการทำงานย่อย','Child membership')}>
      <h2>{t('อนุมัติการเชื่อมรอบการทำงานย่อย','Approve a child link')}</h2><p className="help">{t('เปิดแชตของรอบการทำงานย่อยผ่าน T3 ก่อน การอนุมัติผูกกับผู้ประสานงานและรอบที่สั่งงานนี้เท่านั้น การเปลี่ยนบทบาทต้องเชื่อมใหม่','Open the child chat through T3 first. Approval binds only this parent attempt. A changed role requires a new link.')}</p>
      {!parentRuns.length&&<p className="help">{t('บันทึกบทบาทผู้ประสานงานก่อนเริ่มงานใหม่ งานที่ส่งไปแล้วจะไม่เปลี่ยนสิทธิ์ตามบทบาทใหม่','Save the orchestrator role before starting a new run. Dispatched attempts retain their original role snapshot.')}</p>}
      <form onSubmit={async e=>{e.preventDefault();const child=childOptions.find(a=>a.id===childKey);if(child)await act('bind',{parentRunId,childConversationId:child.conversationId,childBotId:child.botId});}}>
        <div className="form-grid"><Field label={t('งานของผู้ประสานงาน','Parent orchestrator run')}><select required value={parentRunId} onChange={e=>{setParent(e.target.value);setChild('');}}><option value="">{t('เลือกงานที่กำลังทำ','Choose an active run')}</option>{parentRuns.map(r=><option key={r.id} value={r.id}>{sessionLabel(r.conversationId,r.botId)} · {r.id.slice(0,8)}</option>)}</select></Field>
          <Field label={t('รอบการทำงานย่อยที่เชื่อม T3 แล้ว','Bound child session')}><select required value={childKey} disabled={!parent} onChange={e=>setChild(e.target.value)}><option value="">{t('เลือกรอบการทำงานย่อย','Choose a child session')}</option>{childOptions.map(a=><option key={a.id} value={a.id}>{sessionLabel(a.conversationId,a.botId)} · {roleLabel(a.role)}</option>)}</select></Field></div>
        <button type="submit" disabled={disabled||!parent||!childKey}>{t('อนุมัติการเชื่อม','Approve child link')}</button>
      </form>
      {!approved.length&&<Empty>{t('ยังไม่มีรอบการทำงานย่อยที่อนุมัติ','No approved child sessions yet.')}</Empty>}
      {memberships.map(m=><div className="history-row" key={m.id}><div><strong>{sessionLabel(m.childConversationId,m.childBotId)}</strong><small>{roleLabel(m.childRole.role)} · {t('งานแม่','Parent')} {m.parentRunId.slice(0,8)} · {m.usable?t('ใช้ได้','Available'):m.status==='revoked'?t('ยกเลิกแล้ว','Revoked'):t('ต้องเชื่อมใหม่','Relink required')}</small></div><button type="button" disabled={disabled||m.status==='revoked'} onClick={()=>act('revoke',{membershipId:m.id,expectedRevision:m.revision})}>{t('ยกเลิกการเชื่อม','Revoke link')}</button></div>)}
    </section>
    <section className="panel" aria-label={t('ส่งข้อความให้รอบการทำงานย่อย','Prompt a child')}>
      <h2>{t('ส่งคำสั่งให้รอบการทำงานย่อย','Prompt a child')}</h2><p className="help">{t('ข้อความนี้เป็นคำแนะนำ งานที่ใช้โฟลเดอร์เดียวกันอาจต้องรอให้งานเดิมหยุดและตรวจผลแล้ว ผู้ช่วย AI จะส่งข้อความได้เมื่อมีการเชื่อมต่อ MCP สำหรับรอบนี้','Prompts are advice. Shared-workspace work may be blocked until existing work is stopped and reconciled. Agent-origin prompts require an MCP attachment to this exact attempt.')}</p>
      <form onSubmit={async e=>{e.preventDefault();const m=approved.find(x=>x.id===membershipId);if(m&&await act('prompt',{parentRunId:m.parentRunId,membershipId:m.id,text}))setText('');}}>
        <Field label={t('รอบการทำงานย่อยที่อนุมัติ','Approved child')}><select required value={membershipId} onChange={e=>setMembership(e.target.value)}><option value="">{t('เลือกการเชื่อมที่อนุมัติ','Choose an approved link')}</option>{approved.map(m=><option key={m.id} value={m.id}>{sessionLabel(m.childConversationId,m.childBotId)} · {m.parentRunId.slice(0,8)}</option>)}</select></Field>
        <Field label={t('ข้อความถึงรอบการทำงานย่อย','Child prompt')}><textarea required rows={4} maxLength={48000} value={text} onChange={e=>setText(e.target.value)}/></Field><button className="primary" type="submit" disabled={disabled||!membershipId||!text.trim()}>{t('ส่งข้อความ','Send prompt')}</button>
      </form>
    </section>
    <section className="panel" aria-label={t('ผลการส่งและการหยุด','Delivery and Stop')}><h2>{t('คำสั่งที่บันทึกไว้','Recorded prompts')}</h2>
      {!commands.length&&<Empty>{t('คำสั่งที่ส่งและผลจากงานจริงจะแสดงที่นี่','Sent commands and observed run results appear here.')}</Empty>}
      {commands.map(c=><article key={c.id}><h3>{sessionLabel(c.dispatchInput.conversationId,c.dispatchInput.botId)}</h3><p>{t(...(statuses[c.childRun?.status??c.status]??statuses.unknown))}{c.stopRequested&&` · ${t('ขอหยุดแล้ว','Stop requested')}`}</p><p>{c.dispatchInput.text}</p>{c.error&&<p role="alert">{errors[c.error.code]?t(...errors[c.error.code]):t('ยังยืนยันการส่งไม่ได้ ตรวจคำสั่งเดิมก่อนส่งใหม่','Delivery is unconfirmed. Reconcile the original command before another prompt.')} <code>{c.error.code}</code></p>}
        <div className="actions"><button type="button" disabled={busy||loading} onClick={()=>act('reconcile',{commandId:c.id})}>{t('ตรวจผลเดิม','Reconcile')}</button><button type="button" disabled={busy||loading||c.stopRequested} onClick={()=>act('stop',{commandId:c.id})}>{t('หยุดคำสั่งนี้','Stop prompt')}</button></div>
        <details><summary>{t('ตัวตนของงานและโมเดลที่สังเกตจริง','Run identity and observed model')}</summary><p>{t('งาน','Run')}: <code>{c.childRun?.id??t('ยังไม่พบ','Not observed')}</code></p><p>{t('โมเดลที่รันจริง','Executed model')}: {c.childRun?.executedModel??t('ยังไม่ทราบ','Unknown')}</p><p>{t('คำสั่ง','Command')}: <code>{c.id}</code></p></details>
      </article>)}
    </section>
  </div>;
}
