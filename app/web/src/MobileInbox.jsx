import React,{useEffect,useRef,useState} from 'react';
import {MessagesSquare,RefreshCw} from 'lucide-react';
import {request,scoped,date} from './api.mjs';
import {Heading,Field,Badge,Empty,Json} from './ui.jsx';

export default function MobileInbox({t,state,projectId,run,busy}){
  const [data,setData]=useState(null),[ready,setReady]=useState(null),[error,setError]=useState(''),[selected,setSelected]=useState(''),[taskId,setTask]=useState('');
  const [draft,setDraft]=useState({bindingId:crypto.randomUUID(),expectedRevision:0,gateway:'hermes',gatewayId:'',accountId:'',platform:'telegram',chatId:'',threadId:'',ownerId:'',secretRef:'',enabled:false});
  const epoch=useRef(0),tasks=scoped(state,'tasks',projectId),plans=scoped(state,'plans',projectId),item=data?.inbox.find(x=>x.id===selected);
  async function refresh(){const n=epoch.current;const [value,health]=await Promise.all([request('/api/relay/state',{projectId}),request('/api/relay/readiness',{projectId})]);if(n===epoch.current){setData(value);setReady(health);setError('');}return value;}
  useEffect(()=>{epoch.current++;setData(null);setSelected('');setTask('');refresh().catch(e=>setError(e.message));return()=>{epoch.current++;};},[projectId]);
  const act=fn=>run(async()=>{setError('');try{const result=await fn();await refresh();return result;}catch(e){setError(e.message);throw e;}});
  function edit(b){setDraft({...b,bindingId:b.id,expectedRevision:b.revision,threadId:b.threadId??'',secretRef:draft.bindingId===b.id?draft.secretRef:''});}
  return <>
    <Heading title={t('กล่องงานจากมือถือ','Mobile Inbox')} description={t('Telegram ผ่าน Hermes Agent หรือ OpenClaw · รับเข้า Inbox และอนุมัติในห้องเดิมก่อนเริ่ม','Telegram through Hermes Agent or OpenClaw. Work enters Inbox; approve in its original chat before execution.')}><button disabled={busy} onClick={()=>act(refresh)}><RefreshCw size={15}/>{t('โหลดใหม่','Refresh')}</button></Heading>
    {error&&<p className="alert error" role="alert">{error}</p>}
    <div className="serving-layout">
      <section className="panel"><h2>{t('งานที่รับมา','Incoming work')}</h2>
        {!data?<p role="status">{t('กำลังโหลดกล่องงาน…','Loading Inbox…')}</p>:!data.inbox.length?<Empty><MessagesSquare size={24}/>{t('ยังไม่มีงานจาก Telegram ติดตั้ง native bridge แล้วส่ง FORGE WORK ตามด้วยงานที่ต้องการ','No Telegram work yet. Set up the native bridge, then send FORGE WORK followed by the requested task.')}</Empty>:<div className="collection">{data.inbox.map(x=><button key={x.id} className={selected===x.id?'selected':''} onClick={()=>{setSelected(x.id);setTask(x.taskId??'');}}><strong>{x.text??x.work??x.id}</strong><small><Badge>{x.status}</Badge> · {date(x.createdAt)}</small></button>)}</div>}
      </section>
      <section className="panel"><h2>{t('ตรวจงานและผูกแผน','Review and link an approved task')}</h2>
        {!item?<Empty>{t('เลือกงานจาก Inbox เพื่ออ่านและผูกกับงานในแผนที่อนุมัติแล้ว','Select an Inbox item and link it to an existing approved-plan task.')}</Empty>:<><Badge>{item.status}</Badge><p style={{whiteSpace:'pre-wrap'}}>{item.text??item.work}</p><p>{t('การผูกงานส่งคำขออนุมัติกลับไปยัง Telegram ยังไม่เริ่มโมเดล','Linking sends an approval request back to Telegram. It does not start a model.')}</p>
          <Field label={t('งานในแผนที่อนุมัติแล้ว','Task in an approved plan')}><select value={taskId} disabled={busy||!['inbox','awaiting_approval'].includes(item.status)} onChange={e=>setTask(e.target.value)}><option value="">{t('เลือกงาน','Choose task')}</option>{tasks.filter(x=>plans.some(p=>p.id===x.planId&&p.approved)).map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
          <button className="primary" disabled={busy||!taskId||!['inbox','awaiting_approval'].includes(item.status)} onClick={()=>act(()=>request('/api/relay/link-task',{projectId,inboxId:item.id,taskId,expectedRevision:item.revision}))}>{t('ส่งคำขออนุมัติไปห้องเดิม','Send approval request to original chat')}</button>
          {item.status==='approved'&&<button disabled={busy} onClick={()=>act(()=>request('/api/relay/dispatch',{projectId,inboxId:item.id}))}>{t('เริ่มตามการอนุมัติใน Telegram','Start Telegram-approved work')}</button>}
          {item.reservation&&<button disabled={busy} onClick={()=>act(()=>request('/api/relay/reconcile',{projectId,inboxId:item.id}))}>{t('ตรวจสถานะเดิมโดยไม่ส่งงานซ้ำ','Reconcile existing attempt')}</button>}
          <details><summary>{t('ตัวตนและหลักฐานของงาน','Work identity & evidence')}</summary><Json value={item}/></details>
        </>}
      </section>
    </div>
    <section className="panel"><h2>{t('การเชื่อมต่อ Telegram','Telegram connection')}</h2><p>{t('Native bridge ทำงานเครื่องเดียวกับ FORGE และยืนยัน gateway บัญชี ห้อง หัวข้อ และ Owner ไม่เปิด public webhook','The native bridge runs on the FORGE machine and binds gateway, account, chat, topic and Owner identity. No public webhook is provisioned.')}</p>
      <div className="actions">{data?.bindings.map(b=><button key={b.id} disabled={busy} onClick={()=>edit(b)}>{b.gateway} · {b.chatId} · {b.enabled?t('เปิด','On'):t('ปิด','Off')}</button>)}</div>
      <form onSubmit={e=>{e.preventDefault();const {bindingId,expectedRevision,gateway,gatewayId,accountId,platform,chatId,threadId,ownerId,secretRef,enabled}=draft;act(()=>request('/api/relay/configure',{projectId,bindingId,expectedRevision,gateway,gatewayId,accountId,platform,chatId,threadId:threadId||null,ownerId,secretRef,enabled})).then(result=>{if(result)edit(result);});}}>
        <Field label={t('ตัวกลาง','Intermediary')}><select value={draft.gateway} onChange={e=>setDraft({...draft,gateway:e.target.value})}><option value="hermes">Hermes Agent · Nous Research</option><option value="openclaw">OpenClaw</option></select></Field>
        <div className="form-grid">{[['gatewayId','Gateway ID'],['accountId','Account ID'],['chatId','Telegram chat ID'],['threadId',t('Topic ID (ถ้ามี)','Topic ID (optional)')],['ownerId','Telegram Owner ID'],['secretRef',t('กุญแจเครื่อง · vault reference','Machine key · vault reference')]].map(([key,label])=><Field key={key} label={label}><input required={key!=='threadId'} maxLength={180} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></Field>)}</div>
        <label><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>{t('เปิด binding นี้หลังตรวจตัวตน','Enable this binding after reviewing identities')}</label>
        <div className="actions"><button className="primary" disabled={busy}>{t('บันทึกการเชื่อมต่อ','Save binding')}</button><button type="button" disabled={busy} onClick={()=>setDraft({...draft,bindingId:crypto.randomUUID(),expectedRevision:0,enabled:false})}>{t('สร้าง binding แยก','New binding')}</button></div>
      </form>
      <details><summary>{t('Readiness และข้อจำกัด','Readiness & limitations')}</summary><Json value={ready}/><p>{t('ต้องติดตั้ง native plugin และตั้ง signing key ใน environment ของตัวกลางตามคู่มือ Live Hermes/OpenClaw ยังไม่ได้ตรวจในบัญชีจริง','Install the native plugin and set its signing key in the intermediary environment using the guide. Live Hermes/OpenClaw account qualification remains not run.')}</p></details>
    </section>
    <section className="panel"><h2>{t('ประวัติส่งรายงาน','Report delivery history')}</h2>{!data?.outbox.length?<Empty>{t('ยังไม่มีรายงานรอส่ง','No queued reports.')}</Empty>:data.outbox.slice().reverse().slice(0,30).map(x=><details key={x.id}><summary><Badge>{x.status}</Badge> {x.kind} · {date(x.createdAt)}</summary><p style={{whiteSpace:'pre-wrap'}}>{x.content}</p><Json value={x.correlation}/></details>)}<p className="help">{t('ผลส่งที่ไม่แน่นอนจะไม่ถูกส่งซ้ำอัตโนมัติ Stop ไม่ได้แปลว่างานหรือผลข้างเคียงถูกย้อนกลับ','Uncertain deliveries are never automatically resent. Stop does not imply rollback of work or side effects.')}</p></section>
  </>;
}
