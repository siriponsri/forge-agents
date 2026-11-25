import React, {useEffect, useId, useRef, useState} from 'react';
import {request, operationId} from './api.mjs';
import './guarded-setup.css';

const stages = {
  preflight:['ตรวจเครื่องและเครื่องมือ','Checking this machine'],
  sources:['ดาวน์โหลดซอร์สที่กำหนดไว้','Downloading pinned sources'],
  toolchain:['เตรียมเครื่องมือสร้าง','Preparing build tools'],
  patch:['ตรวจและปรับซอร์ส','Verifying and preparing sources'],
  'opencode-dependencies':['เตรียมส่วนประกอบ OpenCode','Preparing OpenCode dependencies'],
  't3-dependencies':['เตรียมส่วนประกอบ T3','Preparing T3 dependencies'],
  'opencode-build':['สร้าง OpenCode ส่วนตัว','Building private OpenCode'],
  't3-build':['สร้าง T3 ส่วนตัว','Building private T3'],
  'broker-build':['สร้างตัวจัดการไฟล์','Building the file broker'],
  verify:['ตรวจไฟล์ที่สร้าง','Verifying built files'],
  copy:['ติดตั้งไฟล์ส่วนตัว','Installing private files'],
  complete:['ติดตั้งไฟล์แล้ว','Files installed'],
};
const statuses={missing:['ยังไม่ได้ติดตั้ง','Not installed'],preparing:['กำลังเตรียม Guarded','Preparing Guarded'],ready:['ติดตั้งแล้ว · ต้องตรวจเส้นทาง','Installed · route check required'],failed:['ตั้งค่ายังไม่สำเร็จ','Setup needs attention'],cancelled:['ยกเลิกการตั้งค่าแล้ว','Setup cancelled']};
const actions={
  'use-windows-x64':['ใช้เครื่อง Windows 64 บิตเพื่อตั้งค่า Guarded','Use a Windows x64 machine to set up Guarded.'],
  'install-python-3':['ติดตั้ง Python 3 แล้วเปิด FORGE ใหม่เพื่อลองอีกครั้ง','Install Python 3, then reopen FORGE and try setup again.'],
  'enable-net-framework-4':['เปิดใช้ .NET Framework 4 ใน Windows แล้วลองตั้งค่าอีกครั้ง','Enable .NET Framework 4 in Windows, then try setup again.'],
  'update-forge-build-pins':['อัปเดต FORGE ให้รองรับเครื่องมือใน Windows รุ่นนี้ก่อนตั้งค่า','Update FORGE to support this Windows toolchain before setup.'],
  'check-network-and-retry':['ตรวจการเชื่อมต่ออินเทอร์เน็ต แล้วเริ่มการตั้งค่าใหม่','Check the internet connection, then start a new setup.'],
  'reconcile-installed-files':['การตั้งค่าครั้งก่อนหยุดก่อนยืนยันผล เริ่มการตั้งค่าใหม่ได้เมื่อพร้อม','The previous setup stopped before its result was confirmed. Start a new setup when ready.'],
  'reinstall-private-artifacts':['ไฟล์ติดตั้งเปลี่ยนไป ติดตั้ง Guarded ใหม่ก่อนตรวจเส้นทาง','Installed files changed. Reinstall Guarded before checking the route.'],
};

export default function GuardedSetup(props) {
  return <GuardedProject key={props.projectId??'no-project'} {...props}/>;
}
function GuardedProject({t, state, projectId, run, busy}) {
  const initial=state?.guarded??(state?.installation?state:null);
  const [value,setValue]=useState(initial),[error,setError]=useState(''),[pending,setPending]=useState('');
  const alive=useRef(true),working=useRef(false),title=useId(),progressLabel=useId();
  const apply=result=>{if(alive.current)setValue(result);};
  useEffect(()=>{
    alive.current=true;
    async function refresh(){
      if(!projectId)return;
      try {const result=await request('/api/guarded/state',{projectId});if(!alive.current)return;apply(result);setError('');}
      catch {if(alive.current)setError(t('อ่านสถานะไม่ได้ กดรีเฟรชสถานะก่อนทำต่อ','Could not read setup status. Refresh status before continuing.'));}
    }
    refresh();return()=>{alive.current=false;};
  },[projectId]);
  // Only POST state is polled; installation/check operations are never replayed.
  const installation=value?.installation,status=installation?.status,preparing=status==='preparing';
  useEffect(()=>{
    if(!preparing||!projectId)return;let cancelled=false,timer;
    const poll=async()=>{try{const result=await request('/api/guarded/state',{projectId});if(cancelled)return;apply(result);if(result?.installation?.status==='preparing')timer=setTimeout(poll,1500);}catch{if(!cancelled)setError(t('ขาดการเชื่อมต่อ กดรีเฟรชสถานะเพื่อตรวจผลเดิม','Connection lost. Refresh status to inspect the existing setup.'));}};
    timer=setTimeout(poll,1500);return()=>{cancelled=true;clearTimeout(timer);};
  },[preparing,projectId]);
  const perform=action=>{
    if(working.current)return;working.current=true;setPending(action);setError('');
    const body={projectId,...(action==='install'||action==='check'?{operationId:operationId()}:action==='cancel'?{operationId:installation.operationId}:{})};
    return run(async()=>{
      try {const result=await request(`/api/guarded/${action}`,body);apply(result);return result;}
      catch {if(alive.current)setError(t('คำขอไม่สำเร็จ กดรีเฟรชสถานะเพื่อตรวจผลก่อนลองอีกครั้ง','The request did not finish. Refresh status to inspect its result before trying again.'));}
      finally {working.current=false;if(alive.current)setPending('');}
    });
  };
  const blocked=busy||!!pending||!projectId;
  const progress=installation?.progress,stage=stages[progress?.stage];
  const recovery=actions[installation?.error?.action]??['ตรวจสถานะ แล้วเริ่มการตั้งค่าใหม่เมื่อพร้อม','Refresh status, then start a new setup when ready.'];
  return <section className="guarded-setup" aria-labelledby={title}>
    <h2 id={title}>{t('ตั้งค่า Guarded ในเครื่อง','Guarded setup on this machine')}</h2>
    <p className="help">{t('ติดตั้งส่วนประกอบส่วนตัวสำหรับการอ่าน เสนอ และแก้ข้อความในขอบเขตที่อนุญาต จากนั้นตรวจเส้นทางบัญชีของโครงการก่อนใช้งาน','Install private components for scoped text reading, proposals and edits. Then check this project’s account route before use.')}</p>
    {!projectId?<p role="status">{t('เลือกโครงการก่อนตั้งค่า Guarded','Choose a project to set up Guarded.')}</p>:!installation?<p role="status">{t('กำลังอ่านสถานะการตั้งค่า…','Loading setup status…')}</p>:<>
      <p className="guarded-setup-status" role="status">{t(...(statuses[status]??statuses.missing))}</p>
      {preparing&&<div className="guarded-setup-progress">
        <label id={progressLabel}>{stage?t(...stage):t('กำลังตั้งค่า…','Setting up…')}</label>
        <progress aria-labelledby={progressLabel} max={progress?.total||11} value={Math.min(progress?.completed||0,progress?.total||11)}/>
        <p className="help">{t('ขั้นตอนนี้อาจใช้เวลาหลายนาที เปิดหน้านี้ใหม่เพื่อติดตามต่อได้','This may take several minutes. You can reopen this page to follow progress.')}</p>
      </div>}
      {(status==='failed'||installation.error)&&<p role="alert" className="error-text">{t(...recovery)}</p>}
      {status==='cancelled'&&<p className="help">{t('หากต้องการใช้งาน ให้เริ่มการตั้งค่าใหม่','Start a new setup when you want to continue.')}</p>}
      {status==='ready'&&<p className="help">{t('ไฟล์ติดตั้งผ่านการตรวจแล้ว ปุ่มด้านล่างจะตรวจเส้นทางในเครื่อง การติดตั้งไฟล์ยังไม่ยืนยันสิทธิ์ใช้งานโมเดลหรืออนุมัติให้ทำงาน','Installed files passed integrity checks. Use the button below to check the installed route. Installing files does not confirm model access or approve work.')}</p>}
      {value?.readiness&&<p role="status">{t('อ่านผลตรวจเส้นทางล่าสุดได้แล้ว สิทธิ์ใช้งานยังขึ้นกับบัญชีและนโยบายปัจจุบัน','The latest route check is available. Use still depends on the current account and policy.')}</p>}
    </>}
    {error&&<p role="alert" className="error-text">{error}</p>}
    <div className="actions guarded-setup-actions">
      {preparing?<button type="button" disabled={blocked} aria-busy={pending==='cancel'||undefined} onClick={()=>perform('cancel')}>{t('ยกเลิกการตั้งค่า','Cancel setup')}</button>:<button type="button" className={status==='ready'?'':'primary'} disabled={blocked||!installation} aria-busy={pending==='install'||undefined} onClick={()=>perform('install')}>{status==='ready'?t('ติดตั้งใหม่','Reinstall Guarded'):t('ติดตั้ง Guarded','Install Guarded')}</button>}
      {status==='ready'&&<button type="button" className="primary" disabled={blocked} aria-busy={pending==='check'||undefined} onClick={()=>perform('check')}>{t('ตรวจเส้นทางที่ติดตั้ง','Check installed route')}</button>}
      <button type="button" disabled={blocked} aria-busy={pending==='state'||undefined} onClick={()=>perform('state')}>{t('รีเฟรชสถานะ','Refresh status')}</button>
    </div>
  </section>;
}
