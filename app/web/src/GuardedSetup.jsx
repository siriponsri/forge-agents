import React, {useEffect, useId, useRef, useState} from 'react';
import {request, operationId} from './api.mjs';
import './guarded-setup.css';

const stages = {
  preflight:['ตรวจเครื่องและเครื่องมือ','Checking this machine'],
  sources:['ดาวน์โหลดซอร์สโค้ดรุ่นที่กำหนด','Downloading pinned sources'],
  toolchain:['เตรียมเครื่องมือสร้าง','Preparing build tools'],
  patch:['ตรวจและเตรียมซอร์สโค้ด','Verifying and preparing sources'],
  'opencode-dependencies':['เตรียมส่วนประกอบ OpenCode','Preparing OpenCode dependencies'],
  't3-dependencies':['เตรียมส่วนประกอบ T3','Preparing T3 dependencies'],
  'opencode-build':['สร้าง OpenCode ส่วนตัว','Building private OpenCode'],
  't3-build':['สร้าง T3 ส่วนตัว','Building private T3'],
  'broker-build':['สร้างตัวกลางรับส่งไฟล์','Building the file broker'],
  verify:['ตรวจไฟล์ที่สร้าง','Verifying built files'],
  copy:['ติดตั้งไฟล์ลงเครื่องนี้','Installing private files'],
  complete:['ติดตั้งไฟล์แล้ว','Files installed'],
};
const statuses={missing:['ยังไม่ได้ติดตั้ง','Not installed'],preparing:['กำลังติดตั้ง Guarded','Preparing Guarded'],ready:['ติดตั้งแล้ว · ต้องทดสอบการเชื่อมต่อก่อนใช้','Installed · route check required'],failed:['ตั้งค่าไม่สำเร็จ ต้องแก้ไขก่อน','Setup needs attention'],cancelled:['ยกเลิกการตั้งค่าแล้ว','Setup cancelled']};
const actions={
  'use-windows-x64':['Guarded ตั้งค่าได้เฉพาะบน Windows 64 บิต เปลี่ยนไปตั้งค่าบนเครื่องที่รองรับ','Use a Windows x64 machine to set up Guarded.'],
  'install-python-3':['ติดตั้ง Python 3 แล้วเปิด FORGE ใหม่และลองอีกครั้ง','Install Python 3, then reopen FORGE and try setup again.'],
  'enable-net-framework-4':['เปิดใช้ .NET Framework 4 ใน Windows แล้วลองตั้งค่าอีกครั้ง','Enable .NET Framework 4 in Windows, then try setup again.'],
  'update-forge-build-pins':['FORGE รุ่นนี้ยังไม่รองรับเครื่องมือใน Windows ของคุณ อัปเดต FORGE ก่อนตั้งค่า','Update FORGE to support this Windows toolchain before setup.'],
  'check-network-and-retry':['ตรวจอินเทอร์เน็ต แล้วเริ่มตั้งค่าใหม่','Check the internet connection, then start a new setup.'],
  'reconcile-installed-files':['การตั้งค่าครั้งก่อนหยุดไปก่อนรู้ผล เริ่มตั้งค่าใหม่ได้เมื่อพร้อม','The previous setup stopped before its result was confirmed. Start a new setup when ready.'],
  'reinstall-private-artifacts':['ไฟล์ที่ติดตั้งไว้ถูกเปลี่ยน ติดตั้ง Guarded ใหม่ก่อนทดสอบการเชื่อมต่อ','Installed files changed. Reinstall Guarded before checking the route.'],
};
const routeIssues={
  GUARDED_PROVIDER_REQUIRED:['ยังไม่ได้เลือกบริการ AI เลือกบัญชีและโมเดลในหน้า บริการ AI และโมเดล แล้วทดสอบอีกครั้ง','Select a connected account and model in Providers & models, then check the route again.'],
  GUARDED_ROUTE_UNSUPPORTED:['บัญชีนี้ใช้กับ Guarded ไม่ได้ ตอนนี้รองรับเฉพาะบัญชีแบบ Chat Completions API เลือกบัญชีอื่นในหน้า บริการ AI และโมเดล','This initial route supports configured Chat Completions API accounts. Select a compatible route in Providers & models.'],
  GUARDED_TRANSPORT_UNSUPPORTED:['ยังไม่ได้ระบุโมเดล เลือกโมเดลแบบ Chat Completions ในบัญชีของ FORGE แล้วทดสอบอีกครั้ง','Choose an explicitly configured Chat Completions model in the FORGE account, then check the route again.'],
  GUARDED_ARTIFACT_RESTART_REQUIRED:['ไฟล์ที่ติดตั้งเปลี่ยนเป็นรุ่นใหม่ ปิด FORGE แล้วเปิดใหม่จากตัวเปิดโปรแกรมก่อนทดสอบ','The installed generation changed. Stop FORGE and reopen its launcher before checking the route.'],
  GUARDED_BUSY:['มีงานที่ใช้ Guarded อยู่ หยุดงานนั้นและตรวจสถานะล่าสุดก่อนเปลี่ยนไฟล์ที่ติดตั้ง','Stop and reconcile Guarded runs before changing installed files.'],
};

export default function GuardedSetup(props) {
  return <GuardedProject key={props.projectId??'no-project'} {...props}/>;
}
function GuardedProject({t, state, projectId, run, busy}) {
  const initial=state?.guarded??(state?.installation?state:null);
  const [value,setValue]=useState(initial),[error,setError]=useState(''),[pending,setPending]=useState(''),[leaseMs,setLeaseMs]=useState(300000);
  const alive=useRef(true),working=useRef(false),title=useId(),progressLabel=useId();
  const apply=result=>{if(alive.current)setValue(result);};
  useEffect(()=>{
    alive.current=true;
    async function refresh(){
      if(!projectId)return;
      try {const result=await request('/api/guarded/state',{projectId});if(!alive.current)return;apply(result);setError('');}
      catch {if(alive.current)setError(t('อ่านสถานะการตั้งค่าไม่ได้ กด โหลดข้อมูลล่าสุด ก่อนทำต่อ','Could not read setup status. Refresh status before continuing.'));}
    }
    refresh();return()=>{alive.current=false;};
  },[projectId]);
  // Only POST state is polled; installation/check operations are never replayed.
  const installation=value?.installation,status=installation?.status,preparing=status==='preparing';
  useEffect(()=>{
    if(!preparing||!projectId)return;let cancelled=false,timer;
    const poll=async()=>{try{const result=await request('/api/guarded/state',{projectId});if(cancelled)return;apply(result);if(result?.installation?.status==='preparing')timer=setTimeout(poll,1500);}catch{if(!cancelled)setError(t('การเชื่อมต่อขาดหาย กด โหลดข้อมูลล่าสุด เพื่อดูว่าการตั้งค่าเดิมไปถึงไหนแล้ว','Connection lost. Refresh status to inspect the existing setup.'));}};
    timer=setTimeout(poll,1500);return()=>{cancelled=true;clearTimeout(timer);};
  },[preparing,projectId]);
  const perform=action=>{
    if(working.current)return;working.current=true;setPending(action);setError('');
    const body={projectId,...(action==='install'||action==='check'?{operationId:operationId()}:action==='cancel'?{operationId:installation.operationId}:{}),...(action==='check'&&leaseMs!==300000?{leaseMs}:{})};
    return run(async()=>{
      try {const result=await request(`/api/guarded/${action}`,body);apply(result);return result;}
      catch(error) {if(alive.current)setError(routeIssues[error.code]?t(...routeIssues[error.code]):t('ยังไม่รู้ผลของคำสั่งนี้ กด โหลดข้อมูลล่าสุด เพื่อตรวจผลก่อนลองอีกครั้ง','The request did not finish. Refresh status to inspect its result before trying again.'));}
      finally {working.current=false;if(alive.current)setPending('');}
    });
  };
  const blocked=busy||!!pending||!projectId;
  const progress=installation?.progress,stage=stages[progress?.stage];
  const recovery=actions[installation?.error?.action]??['โหลดข้อมูลล่าสุด แล้วเริ่มตั้งค่าใหม่เมื่อพร้อม','Refresh status, then start a new setup when ready.'];
  return <section className="guarded-setup" aria-labelledby={title}>
    <h2 id={title}>{t('ตั้งค่า Guarded ในเครื่อง','Guarded setup on this machine')}</h2>
    <p className="help">{t('ติดตั้งส่วนเสริมที่ให้ AI อ่าน เสนอ และแก้ข้อความได้เฉพาะส่วนที่อนุญาต ติดตั้งเสร็จแล้วให้ทดสอบการเชื่อมต่อกับบริการ AI ของโปรเจกต์ก่อนใช้','Install private components for scoped text reading, proposals and edits. Then check this project’s account route before use.')}</p>
    {!projectId?<p role="status">{t('เลือกโปรเจกต์ก่อนตั้งค่า Guarded','Choose a project to set up Guarded.')}</p>:!installation?<p role="status">{t('กำลังอ่านสถานะการตั้งค่า…','Loading setup status…')}</p>:<>
      <p className="guarded-setup-status" role="status">{t(...(statuses[status]??statuses.missing))}</p>
      {preparing&&<div className="guarded-setup-progress">
        <label id={progressLabel}>{stage?t(...stage):t('กำลังตั้งค่า…','Setting up…')}</label>
        <progress aria-labelledby={progressLabel} max={progress?.total||11} value={Math.min(progress?.completed||0,progress?.total||11)}/>
        <p className="help">{t('ขั้นตอนนี้อาจใช้เวลาหลายนาที ปิดหน้านี้แล้วกลับมาดูความคืบหน้าทีหลังได้','This may take several minutes. You can reopen this page to follow progress.')}</p>
      </div>}
      {(status==='failed'||installation.error)&&<p role="alert" className="error-text">{t(...recovery)}</p>}
      {status==='cancelled'&&<p className="help">{t('ถ้าต้องการใช้ ให้เริ่มตั้งค่าใหม่','Start a new setup when you want to continue.')}</p>}
      {status==='ready'&&<p className="help">{t('ไฟล์ที่ติดตั้งผ่านการตรวจแล้ว กดปุ่มด้านล่างเพื่อทดสอบการเชื่อมต่อ การติดตั้งอย่างเดียวยังไม่ได้แปลว่าใช้โมเดลได้ และยังไม่ได้อนุมัติให้ AI เริ่มทำงาน','Installed files passed integrity checks. Use the button below to check the installed route. Installing files does not confirm model access or approve work.')}</p>}
      {value?.readiness&&<p role="status">{t('มีผลทดสอบการเชื่อมต่อล่าสุดแล้ว แต่จะใช้ได้จริงหรือไม่ยังขึ้นกับบัญชีและสิทธิ์และการอนุญาตในตอนนั้น','The latest route check is available. Use still depends on the current account and policy.')}</p>}
    </>}
    {error&&<p role="alert" className="error-text">{error}</p>}
    {status==='ready'&&<label>{t('ผลทดสอบใช้ได้นาน','Route check lifetime')}<select disabled={blocked} value={leaseMs} onChange={e=>setLeaseMs(Number(e.target.value))}><option value={300000}>{t('5 นาที','5 minutes')}</option><option value={900000}>{t('15 นาที','15 minutes')}</option><option value={3600000}>{t('1 ชั่วโมง','1 hour')}</option></select><small className="help">{t('เลือกเวลาให้พอสำหรับการทดลองใช้ ค่านี้ไม่ได้ยืดเวลาสิ้นสุดของงาน และระบบยังตรวจไฟล์ บัญชี และปุ่มหยุดทุกครั้ง','Choose enough time for the trial before starting. This does not extend a run deadline; image, account and Stop checks remain current.')}</small></label>}
    <div className="actions guarded-setup-actions">
      {preparing?<button type="button" disabled={blocked} aria-busy={pending==='cancel'||undefined} onClick={()=>perform('cancel')}>{t('ยกเลิกการตั้งค่า','Cancel setup')}</button>:<button type="button" className={status==='ready'?'':'primary'} disabled={blocked||!installation} aria-busy={pending==='install'||undefined} onClick={()=>perform('install')}>{status==='ready'?t('ติดตั้ง Guarded ใหม่','Reinstall Guarded'):t('ติดตั้ง Guarded','Install Guarded')}</button>}
      {status==='ready'&&<button type="button" className="primary" disabled={blocked} aria-busy={pending==='check'||undefined} onClick={()=>perform('check')}>{t('ทดสอบการเชื่อมต่อ','Check installed route')}</button>}
      <button type="button" disabled={blocked} aria-busy={pending==='state'||undefined} onClick={()=>perform('state')}>{t('โหลดข้อมูลล่าสุด','Refresh status')}</button>
    </div>
  </section>;
}
