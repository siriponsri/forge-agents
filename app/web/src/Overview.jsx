import React from 'react';
import { ArrowRight, ArrowUpRight, FolderPlus, Workflow, Code2, FileSpreadsheet, FileText, Layers3, CheckCircle2, Circle, FolderOpen, Activity, Users, Clock3, CircleAlert } from 'lucide-react';

// Canonical records only. Opening a task routes to the existing plan; Overview
// neither starts a run nor introduces another task owner.
export default function Overview({t,state,project,projectId,onCreate,onNavigate}) {
  const records = key => (state?.[key] ?? []).filter(record => record.projectId === projectId);
  const tasks = records('tasks'), runs = records('runs'), documents = records('documents'), bots = records('bots');
  const completed = tasks.filter(task => task.status === 'done').length;
  const active = runs.filter(run => ['running','starting','submitting'].includes(run.status)).length;
  const statusLabel = status => ({
    backlog: t('รอจัดลำดับ','Backlog'), ready: t('พร้อมเริ่ม','Ready'),
    running: t('กำลังทำงาน','Running'), blocked: t('ติดขัด','Blocked'),
    review: t('รอตรวจ','In review'), done: t('เสร็จแล้ว','Done'),
  }[status] ?? status);
  // Ongoing work, blockers, then reviews. Within a state use the most recently
  // recorded task. Never infer a live run from a task's status.
  const focus = ['running','blocked','review','ready','backlog'].flatMap(status => tasks.filter(task => task.status === status).slice(-1))[0];
  const owner = bots.find(bot => bot.id === focus?.botId);
  const FocusIcon = focus?.status === 'blocked' ? CircleAlert : focus?.status === 'review' ? Clock3 : Layers3;
  const actions = [
    ['plan',Workflow,t('วางแผนงาน','Plan your work'),t('จากเป้าหมาย สู่ขั้นตอนที่ชัดเจน','Turn a goal into clear steps')],
    ['office',FileSpreadsheet,t('เอกสารและตาราง','Docs & sheets'),t('เปิดไอเดียในรูปแบบที่แก้ต่อได้','Write, calculate and keep editing')],
    ['reports',FileText,t('สร้างรายงาน','Create a report'),t('จากแหล่งข้อมูล สู่ DOCX และ PDF','From saved sources to DOCX and PDF')],
    ['notebooks',Code2,t('สมุดงาน Python','Python notebooks'),t('รันงานและติดตามผลในพื้นที่ของคุณ','Run work and inspect real output')],
  ];
  return <div className="overview">
    <header className="overview-head">
      <div><h1>{project ? t('ภาพรวมพื้นที่ทำงาน','Workspace overview') : t('พื้นที่สำหรับสิ่งที่คุณอยากสร้าง','A place for what comes next')}</h1>
        {project && <p>{project.name}</p>}</div>
      <span className="environment-tag">{t('ทำงานบนเครื่องคุณ','Local workspace')}</span>
    </header>
    <section className={`work-focus ${project ? '' : 'work-focus-first'}`} aria-label={t('ทำงานต่อ','Continue your work')}>
      <div className="focus-content">
        {project ? <>
          <h2 className="focus-title">{focus?.title ?? (tasks.length ? t('พร้อมสำหรับสิ่งถัดไป','Ready for what comes next.') : t('เริ่มจากแผนงานของคุณ','Start with your plan.'))}</h2>
          <div className="focus-context"><FocusIcon size={17} aria-hidden="true"/><span>{focus ? t('ทำงานต่อ','Continue your work') : t('เริ่มงานชิ้นถัดไป','Your next piece of work')}</span>{focus && <span className={`focus-status status-${focus.status}`} data-status={focus.status}>{statusLabel(focus.status)}</span>}</div>
          <p className="focus-description">{focus ? (focus.description || (focus.status === 'blocked' ? t('เปิดแผนงานเพื่อตรวจสิ่งที่ติดขัดและกำหนดขั้นตอนต่อไป','Open your plan to inspect the blocker and decide the next step.') : focus.status === 'review' ? t('เปิดแผนงานเพื่อตรวจผลงานและหลักฐานก่อนทำต่อ','Open your plan to review the work and its evidence.') : t('เปิดแผนงานเพื่อตรวจรายละเอียด เจ้าของงาน และขั้นตอนถัดไป','Open your plan for details, ownership and the next step.'))) : t('จากเป้าหมาย สู่ขั้นตอนที่ชัดเจน แบ่งงานและเลือกทีมที่เหมาะกับงานของคุณ','Turn a goal into clear steps. Give each task an owner and build at your own pace.')}</p>
          <div className="focus-footer"><button type="button" className="primary" onClick={() => onNavigate('plan')}>{t('ไปที่แผนงาน','Open your plan')}<ArrowRight size={17} aria-hidden="true"/></button>
            {focus && <span className="focus-owner"><Users size={15} aria-hidden="true"/>{owner?.name ?? t('ยังไม่มอบหมาย','Unassigned')}</span>}</div>
        </> : <>
          <h2 className="focus-title">{t('เริ่มจากไอเดีย','Start with an idea.')}<br/>{t('สร้างในแบบของคุณ','Make it yours.')}</h2>
          <p className="focus-description">{t('รวมทีม AI แผนงาน โค้ด เอกสาร และรายงานไว้ในพื้นที่เดียว คุณเป็นคนกำหนดทิศทาง','Bring your AI team, plans, code, documents and reports into one workspace. You set the direction.')}</p>
          <button type="button" className="primary" onClick={onCreate}>{t('สร้างโครงการแรก','Create first project')}<ArrowRight size={17} aria-hidden="true"/></button>
          <p className="focus-local-note">{t('บันทึกในเครื่อง · เชื่อมต่อบัญชีเมื่อพร้อม','Saved locally · connect accounts when ready')}</p>
        </>}
      </div>
      <aside className="focus-project">
        <FolderOpen size={22} aria-hidden="true"/>
        <h3>{project?.name ?? t('พื้นที่ทำงานของคุณ','Your workspace')}</h3>
        <p>{project?.description || t('งานทั้งหมดเชื่อมกับโครงการนี้ เอกสาร แผน และผลลัพธ์จะอยู่ให้คุณกลับมาทำต่อ','Your plans, documents and results stay connected to this project, ready when you return.')}</p>
        {project ? <button type="button" className="text-button" onClick={() => onNavigate('settings')}>{t('ตั้งค่าพื้นที่ทำงาน','Workspace settings')}<ArrowUpRight size={15} aria-hidden="true"/></button> : <p className="focus-setup-note">{t('เลือกชื่อและโฟลเดอร์ของโครงการ แล้วเริ่มทำงานได้เลย','Choose a project name and folder to make this workspace your own.')}</p>}
      </aside>
    </section>
    {project && <dl className="workspace-summary" aria-label={t('ข้อมูลโครงการ','Project records')}>
      {[[Layers3,t('งานทั้งหมด','Total tasks'),tasks.length,`${completed} ${t('เสร็จแล้ว','completed')}`],
        [Activity,t('กำลังทำงาน','Active runs'),active,`${runs.length} ${t('รันที่บันทึก','recorded runs')}`],
        [FileSpreadsheet,t('เอกสาร','Documents'),documents.length,t('เอกสารและตารางที่บันทึก','Saved docs and workbooks')],
        [Users,t('สมาชิกทีม','Team members'),bots.length,t('บอทในโครงการนี้','Bots in this project')]].map(([Icon,label,value,note]) => <div className="summary-record" key={label}>
          <dt><Icon size={15} aria-hidden="true"/>{label}</dt><dd>{value}</dd><small>{note}</small>
        </div>)}
    </dl>}
    <div className={`overview-work ${!project ? 'overview-work-first' : ''}`}>
      {project && <section className="overview-recent" aria-label={t('งานล่าสุด','Recent work')}>
        <div className="section-head"><h2>{t('งานล่าสุด','Recent work')}</h2><button type="button" className="text-button" onClick={() => onNavigate('plan')}>{t('ดูทั้งหมด','View all')}<ArrowRight size={14} aria-hidden="true"/></button></div>
        {tasks.length ? <div className="activity-list">{tasks.slice(-5).reverse().map(task => <button type="button" key={task.id} className="activity-row" onClick={() => onNavigate('plan')}>
          <span className={`activity-icon status-${task.status}`} aria-hidden="true">{task.status === 'done' ? <CheckCircle2 size={17}/> : task.status === 'blocked' ? <CircleAlert size={17}/> : <Circle size={17}/>}</span>
          <span className="activity-copy"><strong>{task.title}</strong><small>{bots.find(bot => bot.id === task.botId)?.name ?? t('ยังไม่มอบหมาย','Unassigned')}</small></span>
          <span className={`status status-${task.status}`}>{statusLabel(task.status)}</span>
        </button>)}</div> : <div className="overview-empty"><FolderPlus size={22} aria-hidden="true"/><h3>{t('พื้นที่ว่างสำหรับงานชิ้นถัดไป','Room for your next task')}</h3><p>{t('เริ่มจากแผน แล้วแตกเป็นงานที่ทีมช่วยกันทำได้','Start with a plan, then give each task an owner.')}</p><button type="button" onClick={() => onNavigate('plan')}>{t('สร้างแผนงาน','Create a plan')}<ArrowRight size={15} aria-hidden="true"/></button></div>}
      </section>}
      <section className="overview-actions" aria-label={t('เครื่องมือในพื้นที่ทำงาน','Workspace tools')}>
        <div className="section-head"><h2>{t('วันนี้อยากสร้างอะไร','What are you working on?')}</h2></div>
        <div className="quick-actions-list">{actions.map(([id,Icon,title,description]) => <button type="button" className="quick-action" key={id} onClick={() => project ? onNavigate(id) : onCreate()}><Icon size={18} aria-hidden="true"/><span><strong>{title}</strong><small>{description}</small></span><ArrowUpRight size={15} aria-hidden="true"/></button>)}</div>
      </section>
    </div>
  </div>;
}
