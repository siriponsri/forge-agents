import React, { useEffect, useRef, useState } from 'react';
import { Field } from './ui.jsx';
import { operationId, request } from './api.mjs';

const translate = (th, en) => th;
const errorResult = (pending, code) => ({ status: 'error', documentId: pending.arguments.documentId, revision: pending.arguments.expectedRevision, error: { code } });
const resultMessage = (code, t) => ({
  EDITOR_UNAVAILABLE: t('เปิดเอกสารใน Office ก่อนส่งข้อความที่เลือก', 'Open the document in Office before sending its selection.'),
  REVISION_CONFLICT: t('บันทึกการแก้ไขและเปิดเอกสารรุ่นล่าสุดก่อนเริ่มงานใหม่', 'Save your edits and reopen the latest revision before starting a new task.'),
  NO_SELECTION: t('ไม่มีข้อความที่เลือกในเนื้อหาหลัก หรือช่วงที่เลือกเกิน 8,192 ตัวอักษร', 'No main-body text selection, or the selection exceeds 8,192 UTF-16 units.'),
  DECLINED: t('คุณปฏิเสธคำขอนี้แล้ว', 'You declined this request.'),
}[code]);

// Pin: @univerjs/docs 1.6.1 exported DocSelectionManagerService, getSelectionInfo
// and getTextRanges. FDocument has setSelection but NO getSelection facade.
// No DOM/window selection, guessed offsets, test-only selection API or script.
export async function readSavedDocSelection(pending, getEditor) {
  const { DocSelectionManagerService } = await import('@univerjs/docs');
  try {
    const editor = getEditor?.();
    if (!editor?.univer || !editor.unit || !editor.ready || editor.record?.kind !== 'doc') return errorResult(pending, 'EDITOR_UNAVAILABLE');
    const { record, unit } = editor;
    if (record.id !== pending.arguments.documentId || record.revision !== pending.arguments.expectedRevision || editor.currentRevision !== record.revision || editor.dirty || editor.saving || editor.pendingEdit || typeof editor.baseline !== 'string' || typeof editor.rawSnapshot !== 'function' || JSON.stringify(editor.rawSnapshot()) !== editor.baseline || unit.getId() !== record.snapshot?.id) return errorResult(pending, 'REVISION_CONFLICT');
    const selection = editor.univer.__getInjector().get(DocSelectionManagerService);
    const target = { unitId: unit.getId(), subUnitId: unit.getId() };
    const info = selection.getSelectionInfo(target), ranges = selection.getTextRanges(target);
    // Initial tool supports one main-body text range only. Rectangles, multiple
    // ranges, headers/footers and insertion cursors cannot silently become text.
    if (!info || info.segmentId || info.rectRanges?.length || !ranges || ranges.length !== 1 || ranges[0].segmentId) return errorResult(pending, 'NO_SELECTION');
    const { startOffset: start, endOffset: end } = ranges[0];
    const live = unit.save(), text = live.body?.dataStream;
    if (typeof text !== 'string' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length - 2 || end - start > 8192) return errorResult(pending, 'NO_SELECTION');
    if (JSON.stringify(live.body) !== JSON.stringify(record.snapshot.body)) return errorResult(pending, 'REVISION_CONFLICT');
    return { status: 'ok', documentId: record.id, revision: record.revision, selection: { start, end, text: text.slice(start, end) } };
  } catch { return errorResult(pending, 'EDITOR_UNAVAILABLE'); }
}

/** Mount inside Office Editor. getEditor reads CURRENT refs, never render-time
 * captured selection. onResult may reconcile state but must not execute a tool.
 * requestOwner must be the application's session+CSRF-aware request function. */
export default function FrontendTools({ t = translate, projectId, run, getEditor, requestOwner = request, onResult, busy = false }) {
  const [calls, setCalls] = useState([]), [loading, setLoading] = useState(false), [sending, setSending] = useState(null), [error, setError] = useState(null), [results, setResults] = useState({});
  const retries = useRef(new Map()), active = useRef(null), latest = useRef({ getEditor, requestOwner, onResult });
  latest.current = { getEditor, requestOwner, onResult };
  const scope = run?.frontendContext && run.projectId === projectId ? { projectId, runId: run.id, attemptId: run.attemptId } : null;
  const scopeKey = scope ? JSON.stringify(scope) : '';
  useEffect(() => {
    let disposed = false, checking = false;
    active.current = scopeKey; setCalls([]); setError(null); setSending(null); setResults({}); retries.current.clear();
    if (!scope) return;
    const refresh = async () => {
      if (checking) return; checking = true;
      try { const next = await latest.current.requestOwner('/api/frontend-tools/pending?' + new URLSearchParams(scope)); if (!disposed) { setCalls(next.calls); setError(null); } }
      catch (e) { if (!disposed) setError(e); }
      finally { checking = false; if (!disposed) setLoading(false); }
    };
    setLoading(true); void refresh(); const timer = setInterval(refresh, 1500);
    return () => { disposed = true; clearInterval(timer); };
  }, [scopeKey]);
  if (!scope) return null;
  const answer = async (call, declined = false) => {
    if (sending || busy) return;
    const key = scopeKey; setSending(call.pendingId); setError(null);
    try {
      let body = retries.current.get(call.pendingId);
      if (!body) {
        const result = declined ? errorResult(call, 'DECLINED') : await readSavedDocSelection(call, latest.current.getEditor);
        if (active.current !== key) return;
        body = { ...scope, pendingId: call.pendingId, operationId: operationId(), result };
        retries.current.set(call.pendingId, body);
      }
      // Retry the exact captured result/operation after a lost response. Never
      // reread a changed selection under an already used result operation ID.
      const receipt = await latest.current.requestOwner('/api/frontend-tools/result', body);
      if (active.current === key) { setCalls(current => current.map(x => x.pendingId === call.pendingId ? receipt.call : x)); setResults(current => ({ ...current, [call.pendingId]: body.result })); latest.current.onResult?.(receipt); }
    } catch (e) { if (active.current === key) setError(e); }
    finally { if (active.current === key) setSending(null); }
  };
  return <section className="panel" aria-label={t('คำขออ่านข้อความที่เลือก', 'Selection requests')}>
    <h3>{t('ข้อความที่เลือกสำหรับงานนี้', 'Selection for this task')}</h3>
    <p className="help">{t('เลือกข้อความในเอกสารที่บันทึกแล้ว แล้วส่งให้งานนี้ อ่านได้ไม่เกิน 8,192 ตัวอักษร โดยไม่แก้ไขเอกสาร', 'Select text in the saved document, then send it to this task. Reads up to 8,192 UTF-16 units without changing the document.')}</p>
    {loading && <p role="status">{t('กำลังตรวจคำขอ…', 'Checking requests…')}</p>}
    {!loading && !calls.length && <p className="help">{t('เมื่อบอทขออ่านข้อความที่เลือก คำขอจะปรากฏที่นี่', 'Requests appear here when the bot asks to read your selection.')}</p>}
    {calls.map(call => <div className="history-row" key={call.pendingId}>
      <div><strong>{t('อ่านข้อความที่เลือก', 'Read selected text')} · r{call.arguments.expectedRevision}</strong><small>{call.status === 'pending' ? t('รอคุณส่งข้อความที่เลือก', 'Waiting for your selection') : call.status === 'unknown' ? t('ไม่ทราบผล ส่งซ้ำไม่ได้ โปรดตรวจสถานะงาน', 'Outcome unknown. Check the run before starting again.') : t('รับผลแล้ว การส่งถึงบอทยังต้องยืนยันจากงาน', 'Result accepted; provider delivery awaits run observation.')}</small>{results[call.pendingId]?.status === 'error' && <small role="status">{resultMessage(results[call.pendingId].error.code, t)}</small>}</div>
      {call.status === 'pending' && <div className="toolbar">
        <button type="button" disabled={busy || !!sending || Date.now() >= call.expiresAt} onMouseDown={e => e.preventDefault()} onClick={() => answer(call)}>{sending === call.pendingId ? t('กำลังส่ง…', 'Sending…') : retries.current.has(call.pendingId) ? t('ตรวจและส่งผลเดิมอีกครั้ง', 'Retry same result') : t('ส่งข้อความที่เลือก', 'Send selection')}</button>
        <button type="button" disabled={busy || !!sending || retries.current.has(call.pendingId)} onClick={() => answer(call, true)}>{t('ปฏิเสธ', 'Decline')}</button>
      </div>}
    </div>)}
    {error && <p role="alert">{t('ส่งหรืออ่านสถานะไม่สำเร็จ ตรวจการเชื่อมต่อและลองผลเดิมอีกครั้ง', 'Could not send or read status. Check the connection and retry the same result.')} {error.code ?? ''}</p>}
  </section>;
}

// Mount next to the existing Run controls. Only existing approved tasks and a
// saved Docs revision are choices; this does not create plans/tasks or a turn.
export function FrontendRunControl({ t = translate, projectId, state, record, dirty, busy, requestOwner = request, onStarted }) {
  const [taskId, setTaskId] = useState(''), [sending, setSending] = useState(false), [error, setError] = useState(null);
  const attempt = useRef(null);
  const tasks = state.tasks.filter(x => x.projectId === projectId && state.plans.some(p => p.id === x.planId && p.projectId === projectId && p.approved));
  const start = async e => {
    e.preventDefault(); if (sending || busy || dirty || record?.kind !== 'doc') return;
    setSending(true); setError(null);
    try {
      const key = JSON.stringify([projectId, taskId, record.id, record.revision]);
      if (!attempt.current || attempt.current.key !== key) attempt.current = { key, body: { projectId, taskId, documentId: record.id, documentRevision: record.revision, operationId: operationId() } };
      const held = attempt.current;
      held.intent ??= await requestOwner('/api/frontend-tools/intent', held.body);
      const result = await requestOwner('/api/frontend-tools/start', { projectId, intentId: held.intent.intentId, operationId: held.intent.operationId });
      onStarted?.(result);
    } catch (e) { setError(e); } finally { setSending(false); }
  };
  return <form className="panel inline-form" onSubmit={start}>
    <Field label={t('งานที่อนุมัติให้อ่านข้อความที่เลือก', 'Approved task to read the selection')}><select value={taskId} onChange={e => { setTaskId(e.target.value); attempt.current = null; }} required disabled={sending}>
      <option value="">{t('เลือกงานจากแผนที่อนุมัติแล้ว', 'Choose a task from an approved plan')}</option>
      {tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
    </select></Field>
    <p className="help">{dirty ? t('บันทึกเอกสารก่อนเริ่มงาน', 'Save the document before starting.') : t('งานนี้อ่านเฉพาะข้อความที่เลือกจากเอกสารรุ่นที่บันทึกไว้', 'This task reads only selected text from the saved document revision.')}</p>
    <button type="submit" disabled={busy || sending || dirty || record?.kind !== 'doc' || !taskId}>{sending ? t('กำลังเริ่ม…', 'Starting…') : t('เริ่มงานอ่านข้อความที่เลือก', 'Start selection task')}</button>
    {error && <p role="alert">{t('เริ่มงานไม่ได้ ตรวจแผน รุ่นเอกสาร และโมเดลใน Settings แล้วลองอีกครั้ง', 'Could not start. Check the plan, document revision, and selected model in Settings, then retry.')} {error.code ?? ''}</p>}
  </form>;
}
