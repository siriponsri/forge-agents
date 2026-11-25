import React,{useEffect,useRef,useState} from 'react';
import {request,operationId,date} from './api.mjs';
import {Field,Empty} from './ui.jsx';

const live=new Set(['starting','running','waiting']);
export default function MemoryConnection({t,state,projectId,run,busy}){
  const runs=(state.runs??[]).filter(r=>r.projectId===projectId).slice().reverse(),[selected,setSelected]=useState(''),[access,setAccess]=useState('read'),[data,setData]=useState(null),[configuration,setConfiguration]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(null);
  const current=runs.find(r=>r.id===selected),scope=useRef(0);
  const label=r=>state.tasks.find(x=>x.id===r.taskId)?.title??state.bots.find(x=>x.id===r.botId)?.name??t('การสนทนา','Conversation');
  const reload=async(id=selected)=>{if(!id)return;const generation=scope.current;try{const value=await request('/api/memory-mcp/state',{projectId,runId:id});if(generation===scope.current)setData(value);}catch(e){if(generation===scope.current)setError(e.message);}};
  useEffect(()=>{scope.current++;setSelected('');setConfiguration(null);setData(null);setUncertain(null);setError('');setNotice('');},[projectId]);
  useEffect(()=>{scope.current++;setConfiguration(null);setData(null);setUncertain(null);setError('');setNotice('');if(selected)reload().catch(e=>setError(e.message));},[selected]);
  useEffect(()=>{if(!configuration)return;const timer=setTimeout(()=>setConfiguration(null),Math.max(0,configuration.expiresAt-Date.now()));return()=>clearTimeout(timer);},[configuration]);
  useEffect(()=>{if(current&&(!live.has(current.status)||current.stopRequest))setConfiguration(null);},[current?.status,current?.stopRequest]);
  const act=async(method,input)=>{
    const generation=scope.current;setError('');setNotice('');
    const result=await run(async()=>{try{return await request('/api/memory-mcp/'+method,input);}catch(e){if(generation===scope.current){setError(e.message);if(method==='issue'&&(!e.status||e.status>=500))setUncertain(input);}throw e;}});
    if(generation!==scope.current||!result)return;
    if(method==='issue'){
      setUncertain(null);setConfiguration(result.configuration?{value:result.configuration,sessionId:result.session.sessionId,expiresAt:result.session.expiresAt}:null);
      setNotice(result.configuration?t('สร้างสิทธิ์ชั่วคราวแล้ว คัดลอกการเชื่อมต่อไปยัง MCP client ที่คุณเลือก','Temporary access created. Copy the connection to your chosen MCP client.'):t('พบคำขอเดิม แต่ไม่ออกกุญแจซ้ำ หากต้องใช้ให้เพิกถอนรายการเดิมแล้วสร้างใหม่อย่างชัดเจน','The original request was found; its key is not reissued. Revoke the old grant and deliberately create a new one if needed.'));
    }else{setConfiguration(c=>c?.sessionId===input.sessionId?null:c);setNotice(t('เพิกถอนสิทธิ์แล้ว','Access revoked.'));}
    await reload().catch(e=>setError(e.message));
  };
  const issue=()=>act('issue',{projectId,runId:selected,operationId:operationId(),expectedRevision:current.revision,access});
  const names={ACTIVE:t('พร้อมใช้งาน','Available'),INACTIVE:t('งานไม่อยู่ในสถานะใช้งาน','Run inactive'),EXPIRED:t('หมดอายุ','Expired'),REVOKED:t('เพิกถอนแล้ว','Revoked'),INVALIDATED:t('ยกเลิกการเชื่อมต่อแล้ว','Invalidated')};
  return <section aria-labelledby="memory-mcp-heading">
    <h2 id="memory-mcp-heading">{t('เชื่อมความจำกับงานที่กำลังทำ','Connect memory to a run')}</h2>
    <p className="help">{t('อนุญาตให้ MCP client อ่านความจำในขอบเขตของงานเดียวได้ 5 นาที การแก้ไขต้องเลือกเพิ่มเอง ไม่มีสิทธิ์ Owner ส่วนกลาง และยังไม่เชื่อมเข้าห้อง T3 ให้อัตโนมัติ','Give an MCP client five minutes of access within one run’s memory scopes. Editing requires a separate choice. This grants no central Owner access and does not automatically attach to the T3 thread.')}</p>
    {!runs.length?<Empty>{t('เริ่มงานแบบมีผู้ดูแลก่อน แล้วเลือกงานที่กำลังทำเพื่อสร้างการเชื่อมต่อ','Start a supervised run, then select the active attempt to create a connection.')}</Empty>:<>
      <Field label={t('งานสำหรับการเชื่อมต่อความจำ','Run for memory connection')}><select value={selected} onChange={e=>{scope.current++;setConfiguration(null);setData(null);setSelected(e.target.value);}}><option value="">{t('เลือกงาน','Choose a run')}</option>{runs.map(r=><option key={r.id} value={r.id}>{label(r)} · {r.status} · {r.id.slice(0,8)}</option>)}</select></Field>
      {current&&<><Field label={t('สิทธิ์ความจำของการเชื่อมต่อ','Connection memory access')}><select value={access} onChange={e=>setAccess(e.target.value)}><option value="read">{t('อ่านความจำในขอบเขต','Read scoped memory')}</option><option value="read-write">{t('อ่านและแก้ความจำในขอบเขต','Read and edit scoped memory')}</option></select></Field>
        <div className="actions"><button disabled={busy||!!uncertain||!live.has(current.status)||!!current.stopRequest} onClick={issue}>{t('สร้างการเชื่อมต่อ 5 นาที','Create five-minute connection')}</button><button disabled={busy} onClick={()=>reload().catch(e=>setError(e.message))}>{t('ตรวจสิทธิ์ปัจจุบัน','Refresh access')}</button></div>
        {!live.has(current.status)&&<p role="status">{t('งานนี้จบหรือหยุดแล้ว จึงออกสิทธิ์ใหม่ไม่ได้','This attempt has ended or stopped; new access is unavailable.')}</p>}
      </>}
      {configuration&&<div role="status"><p>{t('การเชื่อมต่อพร้อมคัดลอกจนถึง','Connection available until')} {date(new Date(configuration.expiresAt).toISOString())}</p><button onClick={async()=>{try{await navigator.clipboard.writeText(JSON.stringify(configuration.value,null,2));setNotice(t('คัดลอกการตั้งค่าแล้ว เก็บกุญแจนี้เฉพาะใน MCP client ที่คุณเลือก','Configuration copied. Keep its key only in your chosen MCP client.'));}catch{setError(t('คัดลอกไม่ได้ อนุญาต clipboard ให้ localhost แล้วลองอีกครั้ง','Clipboard access failed. Allow clipboard access for localhost and try again.'));}}}>{t('คัดลอกการตั้งค่า MCP','Copy MCP configuration')}</button></div>}
      {uncertain&&<div role="status"><p>{t('ยังไม่ทราบผลคำขอ ใช้คำขอเดิมเพื่อตรวจสอบก่อนสร้างสิทธิ์ใหม่','The request outcome is unknown. Recover the original request before creating another grant.')}</p><button disabled={busy} onClick={()=>act('issue',uncertain)}>{t('ตรวจคำขอเดิม','Recover original request')}</button></div>}
      {!!data?.sessions?.length&&<ul>{data.sessions.map(s=><li key={s.sessionId}>{names[s.status]??s.status} · {s.access==='read'?t('อ่าน','Read'):t('อ่านและแก้ไข','Read and edit')} · {t('หมดอายุ','Expires')} {date(new Date(s.expiresAt).toISOString())}{!['REVOKED','INVALIDATED'].includes(s.status)&&<button disabled={busy||!current} onClick={()=>act('revoke',{projectId,runId:selected,sessionId:s.sessionId,operationId:operationId(),expectedRevision:current.revision})}>{t('เพิกถอน','Revoke')}</button>}</li>)}</ul>}
    </>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
