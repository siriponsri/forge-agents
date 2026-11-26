import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Code2, FileSpreadsheet, FileText, ListChecks, LoaderCircle, MessageSquare, MessagesSquare, FolderPlus, CircleAlert, Clock3, Layers3, Sparkles, Users } from 'lucide-react';
import { recentThreads, relativeTime, threadActivity, threadTitle } from './shell-routes.mjs';

const THREAD_NAME_LIMIT = 60;

// Composer-first home. The main action hands the prompt to AI Product Studio.
// "Just chat" uses the same canonical commands as Chat (conversation.create,
// then message.send). Nothing here starts a run.
export default function Overview({ t, lang, state, project, projectId, busy, mutate, onCreate, onNavigate, onOpenThread, onStartProduct, focusToken }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const composer = useRef(null);
  const hintId = useId();
  const records = key => (state?.[key] ?? []).filter(record => record.projectId === projectId);
  const tasks = records('tasks'), bots = records('bots');
  const threads = project ? recentThreads(state?.conversations, projectId).slice(0, 6) : [];
  const completed = tasks.filter(task => task.status === 'done').length;
  const documents = records('documents').length;
  const text = draft.trim();

  // The sidebar's primary action lands here and puts the caret in the composer.
  useEffect(() => { if (focusToken) composer.current?.focus({ preventScroll: true }); }, [focusToken]);

  const statusLabel = status => ({
    backlog: t('รอจัดลำดับ', 'Backlog'), ready: t('พร้อมเริ่ม', 'Ready'),
    running: t('กำลังทำงาน', 'Running'), blocked: t('ติดขัด', 'Blocked'),
    review: t('รอตรวจ', 'In review'), done: t('เสร็จแล้ว', 'Done'),
  }[status] ?? status);
  // Ongoing work, blockers, then reviews; the most recently recorded task wins
  // within a status. A task's status never implies a live run.
  const focus = ['running', 'blocked', 'review', 'ready', 'backlog'].flatMap(status => tasks.filter(task => task.status === status).slice(-1))[0];
  const owner = bots.find(bot => bot.id === focus?.botId);
  const FocusIcon = focus?.status === 'blocked' ? CircleAlert : focus?.status === 'review' ? Clock3 : Layers3;

  const suggestions = [
    ['plan', ListChecks, t('วางแผนงาน', 'Plan your work')],
    ['office', FileSpreadsheet, t('เขียนเอกสารหรือตาราง', 'Write a doc or sheet')],
    ['reports', FileText, t('สร้างรายงาน', 'Create a report')],
    ['notebooks', Code2, t('รันโค้ด Python', 'Run Python')],
  ];

  const build = event => {
    event?.preventDefault();
    if (!project) { onCreate(); return; }
    if (!text) return;
    setDraft('');
    onStartProduct(text);
  };
  const chat = async () => {
    if (!text || sending || !project) return;
    setSending(true);
    try {
      const oneLine = text.replace(/\s+/g, ' ');
      const name = oneLine.length > THREAD_NAME_LIMIT ? `${oneLine.slice(0, THREAD_NAME_LIMIT - 1)}…` : oneLine;
      const created = await mutate('conversation.create', { name, kind: 'team', messages: [] });
      if (!created) return; // the shell shows the error; the draft stays here
      const sent = await mutate('message.send', { conversationId: created.entity.id, text, role: 'user' }, created.entity);
      setDraft('');
      // If saving the message failed, carry the text into the new conversation.
      onOpenThread(created.entity.id, sent ? '' : text);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="home">
      <header className="home-head">
        <h1>{project ? t('วันนี้อยากทำอะไร', 'What do you want to do?') : t('เริ่มจากไอเดียของคุณ', 'Start with an idea')}</h1>
        <p>
          {project
            ? <>{project.name}<span aria-hidden="true"> · </span>{t(`${tasks.length} งานย่อย (เสร็จ ${completed}) · ${documents} เอกสาร`, `${tasks.length} tasks (${completed} done) · ${documents} documents`)}</>
            : t('บอกสิ่งที่อยากให้ AI ทำ ผู้ช่วย AI จะช่วยวางแผน เทรนโมเดล และเปิดใช้งานให้ ข้อมูลทั้งหมดอยู่ในเครื่องคุณ', 'Describe what you want AI to do. FORGE helps you plan, train and deploy it. Everything stays on this computer.')}
        </p>
      </header>

      <form className="composer" onSubmit={build} aria-busy={sending || undefined}>
        <label className="visually-hidden" htmlFor={`${hintId}-input`}>
          {t('อธิบายสิ่งที่อยากให้ AI ทำ', 'Describe what you want to do')}
        </label>
        <textarea id={`${hintId}-input`} ref={composer} rows={4} value={draft}
          placeholder={project
            ? t('อยากให้ AI ช่วยทำนาย จัดหมวด หรือวิเคราะห์อะไร เช่น “ทำนายยอดขายสัปดาห์หน้าจากไฟล์ CSV”', 'What should AI predict, sort or analyse? For example, “Forecast next week’s sales from a CSV file”')
            : t('พิมพ์ไอเดียแรกของคุณ แล้วสร้างโปรเจกต์เพื่อเริ่ม', 'Type your first idea, then create a project to begin')}
          aria-describedby={hintId}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); build(); }
          }} />
        <div className="composer-bar">
          <small id={hintId}>
            {project
              ? t('Enter เพื่อเริ่มสร้าง · Shift+Enter ขึ้นบรรทัดใหม่', 'Enter starts building · Shift+Enter adds a line')
              : t('ต้องสร้างโปรเจกต์ก่อน ข้อความนี้จะรออยู่ที่นี่', 'A project comes first. Your text waits here.')}
          </small>
          {project
            ? <div className="composer-actions">
                <button type="button" className="composer-chat" disabled={!text || sending || busy} aria-busy={sending || undefined} onClick={chat}>
                  {sending ? <LoaderCircle size={15} aria-hidden="true" className="spin" /> : <MessagesSquare size={15} aria-hidden="true" />}
                  {t('แค่คุยกัน', 'Just chat')}
                </button>
                <button type="submit" className="primary composer-send" disabled={!text || sending}>
                  <Sparkles size={16} aria-hidden="true" />
                  {t('เริ่มสร้าง', 'Start building')}
                </button>
              </div>
            : <button type="button" className="primary composer-send" onClick={onCreate}>
                <FolderPlus size={16} aria-hidden="true" />
                {t('สร้างโปรเจกต์แรก', 'Create first project')}
              </button>}
        </div>
      </form>

      <div className="home-suggestions" role="group" aria-label={t('เริ่มจากเครื่องมือ', 'Start from a tool')}>
        {suggestions.map(([id, Icon, label]) => (
          <button key={id} type="button" className="quick-action" onClick={() => project ? onNavigate(id) : onCreate()}>
            <Icon size={15} aria-hidden="true" />{label}
          </button>
        ))}
      </div>

      {project && focus && (
        <section className="home-section" aria-labelledby="home-continue">
          <h2 id="home-continue">{t('ทำงานต่อ', 'Continue your work')}</h2>
          <div className="home-focus">
            <FocusIcon size={16} aria-hidden="true" className={`status-${focus.status}`} />
            <div className="home-focus-copy">
              <strong>{focus.title}</strong>
              <small>
                <span className={`status-${focus.status}`}>{statusLabel(focus.status)}</span>
                <span aria-hidden="true"> · </span>
                <Users size={12} aria-hidden="true" /> {owner?.name ?? t('ยังไม่มอบหมาย', 'Unassigned')}
              </small>
            </div>
            <button type="button" onClick={() => onNavigate('plan')}>
              {t('เปิดแผนงาน', 'Open your plan')}<ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {project && (
        <section className="home-section" aria-labelledby="home-threads">
          <h2 id="home-threads">{t('แชตล่าสุด', 'Recent conversations')}</h2>
          {threads.length ? (
            <ul className="home-threads">
              {threads.map(room => {
                const last = room.messages?.[room.messages.length - 1];
                const at = threadActivity(room);
                return (
                  <li key={room.id}>
                    <button type="button" className="home-thread" onClick={() => onOpenThread(room.id)}>
                      <MessageSquare size={15} aria-hidden="true" />
                      <span className="home-thread-copy">
                        <strong>{threadTitle(room, bots, t)}</strong>
                        <small>{last ? (last.text || last.content) : t('ยังไม่มีข้อความ', 'No messages yet')}</small>
                      </span>
                      {at > 0 && <time dateTime={new Date(at).toISOString()}>{relativeTime(at, lang)}</time>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="home-empty">
              {t('ยังไม่มีแชต พิมพ์ข้อความด้านบนแล้วกด “แค่คุยกัน” เพื่อเริ่มแชตแรก', 'No conversations yet. Type above and choose “Just chat” to start one.')}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
