import {useEffect, useState} from 'react';
import {Download, ArrowUpRight, Monitor, Apple} from 'lucide-react';
import {href, type Lang} from './site';

type T = (th:string,en:string)=>string;
type Package = {id:'windows'|'macos';filename:string;url:string;bytes:number;sha256:string};
type Manifest = {schemaVersion:1;product:'FORGE';commit:string;packageKind:string;signed:false;platforms:Package[]};
const names = {windows:'FORGE-Windows.zip',macos:'FORGE-macOS.zip'};
export function parseDownloads(value:unknown):Manifest|null {
  if(!value||typeof value!=='object')return null;
  const m=value as Manifest;
  if(m.schemaVersion!==1||m.product!=='FORGE'||m.signed!==false||m.packageKind!=='unsigned-development-source-launchers'||!/^[a-f\d]{40}$/i.test(m.commit)||!Array.isArray(m.platforms))return null;
  if(!['windows','macos'].every(id=>m.platforms.filter(p=>p.id===id).length===1))return null;
  if(!m.platforms.every(p=>(p.id==='windows'||p.id==='macos')&&p.filename===names[p.id]&&p.url===`/downloads/${names[p.id]}`&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&/^[a-f\d]{64}$/i.test(p.sha256)))return null;
  return m;
}
export function SourceDownloads({lang,t,detail=false}:{lang:Lang;t:T;detail?:boolean}) {
  const [manifest,setManifest]=useState<Manifest|null>(null);
  const [state,setState]=useState<'loading'|'ready'|'unavailable'>('loading');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState('loading');setManifest(null);
    fetch('/downloads/manifest.json',{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error('metadata');return r.json()}).then(data=>{
      const parsed=parseDownloads(data);if(!parsed)throw new Error('metadata');setManifest(parsed);setState('ready');
    }).catch(()=>{if(!controller.signal.aborted){setManifest(null);setState('unavailable')}});
    return()=>controller.abort();
  },[attempt]);
  return <div className={`source-downloads ${detail?'download-detail':''}`}>
    {state==='ready'&&manifest?<div className="platform-actions">{(['windows','macos'] as const).map(id=>{
      const p=manifest?.platforms.find(p=>p.id===id),Icon=id==='windows'?Monitor:Apple,label=id==='windows'?'Windows':'macOS';
      return p?<a className={`platform-download platform-${id}`} key={id} href={p.url} download={p.filename}><Icon size={18} aria-hidden="true"/><span>{t('ดาวน์โหลดสำหรับ','Download for')} {label}</span><Download size={17} aria-hidden="true"/></a>:null;
    })}</div>:detail?<p className="download-availability" role="status">{state==='loading'?t('กำลังตรวจไฟล์ดาวน์โหลด…','Checking download availability…'):t('ยังโหลดข้อมูลดาวน์โหลดไม่ได้','Download information unavailable')}</p>:<a className="platform-download package-details" href={href(lang,'download')}><Monitor size={18} aria-hidden="true"/><span>{t('รายละเอียดแพ็กเกจ Windows / macOS','Windows / macOS package details')}</span><ArrowUpRight size={17} aria-hidden="true"/></a>}
    <p className="source-requirements">{t('ZIP จาก source รุ่นพัฒนา · ไม่ได้เซ็นดิจิทัล','Development source ZIPs · Unsigned')}<br/>{t('ต้องมี Node.js 24.13+ · ครั้งแรกใช้อินเทอร์เน็ตติดตั้ง dependency','Requires Node.js 24.13+ · Internet to install dependencies on first start')}<br/>{t('FORGE Guarded และ native Orchestrator: Windows x64 เท่านั้น','FORGE Guarded and native Orchestrator: Windows x64 only')}</p>
    {detail&&<><p>{t('แตก ZIP ทั้งโฟลเดอร์ แล้วใช้ Start / Stop / Restart ของแพลตฟอร์มคุณ แพ็กเกจนี้ไม่ใช่แอปที่ติดตั้ง runtime มาให้แล้ว','Extract the entire ZIP, then use the platform’s Start / Stop / Restart launchers. These packages do not bundle a runtime.')}</p><p>{t('macOS native, live product และ Home UAT: NOT_RUN · ผลิตภัณฑ์ยังพัฒนาไม่ครบ','Native macOS, live product and Home UAT: NOT_RUN · Product implementation remains incomplete')}</p><div className="download-verification" aria-live="polite">{state==='ready'&&manifest?<><p>{t('Source commit ของแพ็กเกจ','Package source commit')}: <code>{manifest.commit}</code></p>{manifest.platforms.map(p=><div key={p.id}><strong>{p.filename} · {(p.bytes/1048576).toFixed(1)} MiB</strong><span>SHA-256 <code>{p.sha256}</code></span></div>)}<a href="/downloads/manifest.json">{t('เปิด manifest และข้อจำกัดทั้งหมด','Open manifest and all limitations')}<ArrowUpRight size={15}/></a></>:state==='loading'?<p>{t('กำลังตรวจ metadata ของไฟล์ดาวน์โหลด…','Checking download metadata…')}</p>:<p>{t('โหลด metadata ของไฟล์ไม่ได้ ลองตรวจอีกครั้งหรืออ่านคู่มือติดตั้ง','Download metadata could not be loaded. Retry or follow the installation guide.')} <button type="button" onClick={()=>setAttempt(n=>n+1)}>{t('ลองอีกครั้ง','Retry')}</button></p>}</div></>}
    <noscript><p><a href="/downloads/FORGE-Windows.zip" download>{t('ดาวน์โหลด Windows ZIP','Download Windows ZIP')}</a> · <a href="/downloads/FORGE-macOS.zip" download>{t('ดาวน์โหลด macOS ZIP','Download macOS ZIP')}</a> · <a href="/downloads/manifest.json">Manifest</a></p></noscript>
  </div>;
}
