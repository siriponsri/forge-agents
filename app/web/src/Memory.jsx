import React,{useEffect,useRef,useState} from 'react';
import {request,operationId,scoped,date} from './api.mjs';
import {Field,Heading,Badge,Json,Empty} from './ui.jsx';

const types=['working','episodic','semantic','procedural','collective','owner'];
const kinds=['project','owner','team','agent','session','task'];
const timestamp=value=>value?new Date(value).toISOString():null;
const localTime=value=>value?new Date(Date.parse(value)-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16):'';

function EntryForm({t,state,projectId,busy,act}) {
  const [title,setTitle]=useState(''),[content,setContent]=useState(''),[memoryType,setType]=useState('semantic'),[factKey,setKey]=useState(''),[refs,setRefs]=useState([]),[sensitive,setSensitive]=useState(false);
  const evidence=[...scoped(state,'runs',projectId).map(x=>({kind:'run',x})),...scoped(state,'tasks',projectId).map(x=>({kind:'task',x})),...scoped(state,'artifacts',projectId).map(x=>({kind:'artifact',x})),...scoped(state,'events',projectId).filter(x=>x.type==='verification.result').map(x=>({kind:'verification',x}))];
  return <form onSubmit={e=>{e.preventDefault();act('remember',{title,content,memoryType,...(factKey?{factKey}:{}),sourceRefs:refs,sensitive},()=>{setTitle('');setContent('');setRefs([]);});}}>
    <h2>{t('บันทึกความจำ','Remember')}</h2>
    <Field label={t('ชื่อเรื่อง','Title')}><input required maxLength={240} value={title} onChange={e=>setTitle(e.target.value)}/></Field>
    <Field label={t('ประเภทความจำ','Memory type')}><select value={memoryType} onChange={e=>setType(e.target.value)}>{types.map(type=><option key={type}>{type}</option>)}</select></Field>
    <Field label={t('เนื้อหาที่อนุญาตให้บันทึก','Authorized content')} hint={t('ห้ามเก็บรหัสผ่าน กุญแจ API หรือเหตุผลภายในโมเดล ไม่มีการดึงบทสนทนาเข้ามาอัตโนมัติ','No passwords, API keys or hidden reasoning. Conversations are never automatically ingested.')}><textarea rows={6} required maxLength={16000} value={content} onChange={e=>setContent(e.target.value)}/></Field>
    <Field label={t('หัวข้อข้อเท็จจริงสำหรับตรวจความขัดแย้ง (ถ้ามี)','Fact key for conflict detection (optional)')}><input maxLength={160} value={factKey} onChange={e=>setKey(e.target.value)}/></Field>
    <fieldset><legend>{t('แหล่งที่มาที่มีอยู่จริง','Existing source evidence')}</legend>{evidence.map(({kind,x})=><label key={kind+x.id} style={{display:'block'}}><input type="checkbox" checked={refs.some(r=>r.id===x.id&&r.kind===kind)} disabled={refs.length>=24&&!refs.some(r=>r.id===x.id&&r.kind===kind)} onChange={e=>setRefs(e.target.checked?[...refs,{kind,id:x.id}]:refs.filter(r=>r.id!==x.id||r.kind!==kind))}/> {kind} · {x.name??x.id} · {x.status??`r${x.revision}`}</label>)}</fieldset>
    <label><input type="checkbox" checked={sensitive} onChange={e=>setSensitive(e.target.checked)}/> {t('ข้อมูลละเอียดอ่อนที่ได้รับอนุญาตแล้ว (บริการตรวจสิทธิ์เพิ่มเติม)','Approved sensitive data (requires separate server permission)')}</label>
    {memoryType==='procedural'&&<p className="help">{t('บทเรียนเป็นแบบร่างเท่านั้น ต้องผ่าน Adaptive review ก่อนเป็นทักษะที่ใช้งานได้','Lessons remain drafts. Existing Adaptive review must evaluate them before skill promotion.')}</p>}
    <button className="primary" disabled={busy||!content.trim()}>{t('บันทึก','Save memory')}</button>
  </form>;
}

function MemoryEditor({t,item,state,projectId,busy,act}) {
  const [title,setTitle]=useState(item.title),[content,setContent]=useState(item.content),[staleAt,setStale]=useState(localTime(item.staleAt)),[expiresAt,setExpiry]=useState(localTime(item.expiresAt)),[shareKind,setShareKind]=useState('team'),[shareId,setShareId]=useState(''),[shares,setShares]=useState(item.shares),[forget,setForget]=useState(false),[skillId,setSkill]=useState(''),[version,setVersion]=useState(''),[instructions,setInstructions]=useState('');
  const write=(method,body)=>act(method,{id:item.id,expectedRevision:item.revision,...body});
  const ownScope=JSON.stringify(item.scope);
  return <section className="panel"><h2>{t('รายละเอียดและแก้ไข','Memory details & edit')}</h2><p><Badge>{item.memoryType}</Badge> r{item.revision} · {date(item.updatedAt)} · <Badge>{item.verification.status}</Badge></p>
    <p>{t('ข้อมูลที่ไม่เชื่อถือ ไม่ใช่คำสั่ง สิทธิ์ หรือการอนุมัติ','Untrusted data; grants no instructions, permissions or approval.')}</p>
    {item.stale&&<p role="status">{t('ข้อมูลนี้เก่าแล้ว ตรวจแหล่งที่มาก่อนใช้','This information is stale. Recheck its sources.')}</p>}
    {!!item.conflicts.length&&<p role="alert">{t('มีข้อมูลขัดแย้ง','Conflicting memories')}: {item.conflicts.join(', ')}</p>}
    <form onSubmit={e=>{e.preventDefault();write('update',{patch:{title,content,staleAt:timestamp(staleAt),expiresAt:timestamp(expiresAt)}});}}>
      <Field label={t('ชื่อเรื่อง','Title')}><input required maxLength={240} value={title} onChange={e=>setTitle(e.target.value)}/></Field>
      <Field label={t('เนื้อหา','Content')}><textarea required rows={7} maxLength={16000} value={content} onChange={e=>setContent(e.target.value)}/></Field>
      <div className="form-grid"><Field label={t('เริ่มถือว่าเก่าเมื่อ','Stale after')}><input type="datetime-local" value={staleAt} onChange={e=>setStale(e.target.value)}/></Field><Field label={t('หมดอายุและรอลบตาม retention','Expires for retention')}><input type="datetime-local" value={expiresAt} onChange={e=>setExpiry(e.target.value)}/></Field></div>
      <button className="primary" disabled={busy}>{t('บันทึกฉบับแก้ไข','Save revision')}</button>
    </form>
    <button disabled={busy} onClick={()=>write('update',{patch:{pinned:!item.pinned}})}>{item.pinned?t('เลิกปักหมุด','Unpin'):t('ปักหมุด','Pin')}</button>
    <fieldset><legend>{t('แชร์แบบอ่านได้เท่านั้น','Read-only sharing')}</legend>
      {shares.map(s=><div key={JSON.stringify(s)}>{s.kind}: {s.id} <button type="button" onClick={()=>setShares(shares.filter(x=>JSON.stringify(x)!==JSON.stringify(s)))}>{t('นำออก','Remove')}</button></div>)}
      <div className="form-grid"><Field label={t('ขอบเขตปลายทาง','Destination scope')}><select value={shareKind} onChange={e=>setShareKind(e.target.value)}>{kinds.map(k=><option key={k}>{k}</option>)}</select></Field><Field label={t('รหัสปลายทาง','Destination ID')}><input maxLength={200} value={shareId} onChange={e=>setShareId(e.target.value)}/></Field></div>
      <button type="button" disabled={busy||!shareId||shares.length>=12} onClick={()=>{const next={projectId,kind:shareKind,id:shareKind==='project'?projectId:shareId};if(!shares.some(x=>JSON.stringify(x)===JSON.stringify(next))&&JSON.stringify(next)!==ownScope)setShares([...shares,next]);setShareId('');}}>{t('เพิ่มขอบเขต','Add scope')}</button>
      <button type="button" disabled={busy} onClick={()=>write('update',{patch:{shares}})}>{t('บันทึกการแชร์','Save sharing')}</button>
      <p className="help">{t('บริการตรวจสิทธิ์แชร์ทั้งต้นทางและปลายทาง ผู้รับไม่ได้สิทธิ์เขียน','The server checks sharing grants on source and destination. Recipients receive no write permission.')}</p>
    </fieldset>
    <details><summary>{t('ที่มา เวลาบันทึก และหลักฐาน','Provenance, timestamps & evidence')}</summary><Json value={{id:item.id,scope:item.scope,createdAt:item.createdAt,updatedAt:item.updatedAt,sourceRefs:item.sourceRefs,verification:item.verification,lessonStatus:item.lessonStatus}}/></details>
    {item.memoryType==='procedural'&&<form onSubmit={e=>{e.preventDefault();const skill=scoped(state,'skills',projectId).find(x=>x.id===skillId);act('proposeLesson',{id:item.id,expectedRevision:item.revision,skillId,skillRevision:skill.revision,version,instructions});}}><h3>{t('เสนอบทเรียนเข้า Adaptive review','Propose lesson for Adaptive review')}</h3><Field label={t('ทักษะต้นทาง','Base skill')}><select required value={skillId} onChange={e=>setSkill(e.target.value)}><option value="">{t('เลือกทักษะ','Choose skill')}</option>{scoped(state,'skills',projectId).filter(s=>s.status==='active').map(s=><option key={s.id} value={s.id}>{s.name} · {s.version}</option>)}</select></Field><Field label={t('เวอร์ชันที่เสนอ','Proposed version')}><input required maxLength={80} value={version} onChange={e=>setVersion(e.target.value)}/></Field><Field label={t('คำสั่งที่ต้องการให้ผู้ตรวจพิจารณา','Instructions for review')}><textarea required maxLength={32000} value={instructions} onChange={e=>setInstructions(e.target.value)}/></Field><button disabled={busy||!skillId||!item.sourceRefs.length}>{t('สร้าง candidate เพื่อประเมินต่อ','Create candidate for evaluation')}</button><p className="help">{t('ยังไม่โปรโมตหรือรันทักษะ ใช้หน้า Adaptive เพื่อตรวจหลักฐานและประเมิน','This does not promote or execute a skill. Evaluate evidence in Adaptive.')}</p></form>}
    <fieldset><legend>{t('ลืมความจำนี้','Forget this memory')}</legend><label><input type="checkbox" checked={forget} onChange={e=>setForget(e.target.checked)}/> {t('ลบเนื้อหาและดัชนีด้วย tombstone ถาวร','Delete content and derived indexes with a durable tombstone')}</label><button disabled={busy||!forget} onClick={()=>write('forget',{})}>{t('ลืมความจำ','Forget memory')}</button></fieldset>
  </section>;
}

function BackendForm({t,status,busy,act}) {
  const [backend,setBackend]=useState(status.backend.backend),[embeddingModel,setEmbedding]=useState(status.backend.embeddingModel??'nomic-embed-text'),[extractionModel,setExtraction]=useState(status.backend.extractionModel??'llama3.2'),[dimensions,setDimensions]=useState(status.backend.dimensions??768),[ollamaUrl,setUrl]=useState(status.backend.ollamaUrl??'http://127.0.0.1:11434');
  return <details><summary>{t('ตั้งค่าระบบความจำในเครื่อง','Local backend configuration')}</summary><form onSubmit={e=>{e.preventDefault();act('configure',{expectedRevision:status.backendRevision,config:backend==='keyword'?{backend}:{backend,vectorStore:'qdrant-local-disk',embeddingModel,extractionModel,dimensions:Number(dimensions),ollamaUrl}});}}>
    <Field label={t('ระบบค้นหา','Search backend')}><select value={backend} onChange={e=>setBackend(e.target.value)}><option value="keyword">SQLite FTS5 · {t('ไม่ใช้โมเดลหรือบัญชีภายนอก','No model or account needed')}</option><option value="mem0">Mem0 OSS + Qdrant local</option></select></Field>
    {backend==='mem0'&&<><Field label={t('ที่อยู่ Ollama ในเครื่อง','Local Ollama URL')}><input type="url" required value={ollamaUrl} onChange={e=>setUrl(e.target.value)}/></Field><Field label={t('โมเดล embedding ที่ติดตั้งแล้ว','Installed embedding model')}><input required maxLength={200} value={embeddingModel} onChange={e=>setEmbedding(e.target.value)}/></Field><Field label={t('จำนวนมิติ embedding','Embedding dimensions')}><input type="number" min={8} max={8192} required value={dimensions} onChange={e=>setDimensions(e.target.value)}/></Field><Field label={t('โมเดลสกัดบทเรียน (ไม่เรียกอัตโนมัติ)','Extraction model (never called automatically)')}><input required maxLength={200} value={extractionModel} onChange={e=>setExtraction(e.target.value)}/></Field><p className="help">{t('ใช้โมเดลที่ติดตั้งไว้แล้ว ไม่ดาวน์โหลดโมเดล ไม่เรียก API แบบเสียเงิน Qdrant เก็บเฉพาะดัชนีที่สร้างใหม่ได้','Uses installed models; no automatic model download or paid API calls. Qdrant contains only disposable indexes.')}</p></>}
    <button disabled={busy}>{t('บันทึกการตั้งค่า','Save configuration')}</button>
  </form>{status.backend.backend==='mem0'&&<button disabled={busy} onClick={()=>act('setup',{})}>{t('ติดตั้งไลบรารี Mem0 แยกจากระบบหลัก','Set up isolated Mem0 dependencies')}</button>}<button disabled={busy} onClick={()=>act('health',{})}>{t('??????????????????????','Check local backend health')}</button><button disabled={busy} onClick={()=>act('rebuild',{})}>{t('สร้างดัชนีใหม่จาก event store','Rebuild index from event store')}</button><p className="help">{t('ต้องติดตั้ง Python ในเครื่องก่อน การติดตั้งไลบรารีไม่ใช่ผลทดสอบโมเดล','Python must be installed locally. Dependency setup does not qualify the model.')}</p></details>;
}

export default function Memory({t=(th,en)=>en,state={},projectId,run=fn=>fn(),busy=false}) {
  const [kind,setKind]=useState('project'),[scopeId,setScopeId]=useState(''),[query,setQuery]=useState(''),[backend,setBackend]=useState('keyword'),[includeStale,setIncludeStale]=useState(false),[data,setData]=useState(null),[status,setStatus]=useState(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const pending=useRef(new Map()),epoch=useRef(0),scope={projectId,kind,id:kind==='project'?projectId:scopeId},valid=!!projectId&&!!scope.id;
  const refresh=async()=>{if(!valid)return;const own=epoch.current;const [list,info]=await Promise.all([request('/api/memory/'+(query.trim()?'recall':'list'),{projectId,scope,...(query.trim()?{query,backend}:{}),includeStale,limit:100}),request('/api/memory/status',{projectId,scope})]);if(own===epoch.current){setData(list);setStatus(info);}return list;};
  useEffect(()=>{epoch.current++;setData(null);setStatus(null);setSelected('');setError('');if(valid)refresh().catch(e=>setError(e.message));return()=>{epoch.current++;};},[projectId,kind,scopeId]);
  const act=(method,body,onDone)=>run(async()=>{
    setError('');setNotice('');const own=epoch.current,key=JSON.stringify({projectId,scope,method,body}),mutating=['remember','update','forget','configure','retention','proposeLesson'].includes(method);
    const id=mutating?(pending.current.get(key)??operationId()):undefined;if(mutating)pending.current.set(key,id);
    try {
      const result=await request('/api/memory/'+method,{projectId,scope,...body,...(mutating?{operationId:id}:{})});pending.current.delete(key);
      if(own!==epoch.current)return result;
      if(method==='export'){const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='forge-memory.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      setNotice(result.warnings?.map(x=>x.message).join(' ')||(method==='health'?JSON.stringify(result):t('บันทึกผลแล้ว','Operation completed')));onDone?.(result);await refresh();return result;
    } catch(e){if(own===epoch.current)setError(e.message);if(e.status)pending.current.delete(key);throw e;}
  });
  const item=data?.items.find(x=>x.id===selected);
  return <div className="memory-surface"><Heading title={t('Memory Studio · ความจำ','Memory Studio')} description={t('ความจำถาวรที่ใช้ข้ามผู้ให้บริการได้ เก็บข้อมูลหลักใน FORGE และค้นหาในเครื่อง','Persistent memory across providers. FORGE owns canonical records; retrieval runs locally.')}><button disabled={busy||!valid} onClick={()=>run(refresh)}>{t('โหลดใหม่','Refresh')}</button></Heading>
    <section className="panel"><div className="form-grid"><Field label={t('ขอบเขต','Scope')}><select value={kind} onChange={e=>{setKind(e.target.value);setScopeId('');}}>{kinds.map(k=><option key={k}>{k}</option>)}</select></Field>{kind!=='project'&&<Field label={t('รหัสขอบเขตที่ได้รับอนุญาต','Authorized scope ID')}><input required maxLength={200} value={scopeId} onChange={e=>setScopeId(e.target.value)} list={kind==='task'?'memory-task-ids':kind==='agent'?'memory-agent-ids':undefined}/></Field>}</div><datalist id="memory-task-ids">{scoped(state,'tasks',projectId).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</datalist><datalist id="memory-agent-ids">{scoped(state,'bots',projectId).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</datalist>
      <form onSubmit={e=>{e.preventDefault();run(refresh);}}><Field label={t('ค้นหาภาษาไทยหรืออังกฤษ','Search Thai or English')}><input maxLength={1000} value={query} onChange={e=>setQuery(e.target.value)}/></Field><Field label={t('วิธีค้นหา','Retrieval method')}><select value={backend} onChange={e=>setBackend(e.target.value)}><option value="keyword">SQLite FTS5</option><option value="mem0">Mem0 {t('(ต้องตั้งค่าก่อน)','(requires setup)')}</option></select></Field><label><input type="checkbox" checked={includeStale} onChange={e=>setIncludeStale(e.target.checked)}/> {t('รวมข้อมูลเก่า','Include stale information')}</label><button disabled={busy||!valid}>{t('ค้นหา','Search')}</button></form>
    </section>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!valid&&<Empty>{t('เลือกโครงการและขอบเขตที่ได้รับอนุญาต','Choose a project and authorized scope.')}</Empty>}
    {valid&&status&&<><div className="serving-layout"><section className="panel"><h2>{t('ความจำในขอบเขตนี้','Scoped memories')} · {data?.items.length??0}</h2>{!data?.items.length&&<Empty>{t('ไม่พบความจำที่ได้รับอนุญาต','No authorized memories found.')}</Empty>}<div className="collection">{data?.items.map(r=><button key={r.id} className={selected===r.id?'selected':''} onClick={()=>setSelected(r.id)}><strong>{r.pinned?'★ ':''}{r.title}</strong><small>{r.memoryType} · r{r.revision} · {r.stale?'stale':r.verification.status}{r.conflicts.length?' · conflict':''}</small></button>)}</div></section>{item?<MemoryEditor key={item.id+':'+item.revision} {...{t,item,state,projectId,busy,act}}/>:<section className="panel"><EntryForm key={projectId+kind+scopeId} {...{t,state,projectId,busy,act}}/></section>}</div>
      {selected&&<button onClick={()=>setSelected('')}>{t('บันทึกความจำใหม่','New memory')}</button>}
      <section className="panel"><div className="actions"><button disabled={busy} onClick={()=>act('export',{})}>{t('ส่งออก JSON','Export JSON')}</button><button disabled={busy} onClick={()=>act('retention',{})}>{t('ลบรายการหมดอายุตาม retention','Delete expired memories')}</button></div>{kind==='project'&&<BackendForm key={projectId+':'+status.backendRevision} {...{t,status,busy,act}}/>}<details><summary>{t('ค่าที่วัดได้และข้อจำกัด','Measurements & qualifications')}</summary><Json value={data?.metrics??status.metrics}/><p>{t('ยังไม่วัดคุณภาพโมเดล จำนวน token และค่าใช้จ่ายที่ไม่ทราบจะแสดง unknown','Model quality is not evaluated. Unknown token usage and cost are reported as unknown.')}</p></details></section>
    </>}
  </div>;
}
