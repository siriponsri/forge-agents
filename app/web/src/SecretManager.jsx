import React, { useEffect, useRef, useState } from 'react';
import { request, operationId, date } from './api.mjs';
import { Field, Badge, Empty } from './ui.jsx';

const purposes = ['provider', 'mcp', 'compute', 'relay', 'storage'];
const messages = {
  SECRET_REVISION_CONFLICT: ['มีการแก้ไขคีย์นี้ก่อนหน้า กด โหลดข้อมูลล่าสุด ตรวจอีกครั้งแล้วลองใหม่', 'This key changed. Refresh and review its revision before saving.'],
  SECRET_OPERATION_REUSE: ['คำสั่งบันทึกนี้ถูกส่งไปแล้ว ตรวจรายการคีย์ก่อนเริ่มใหม่', 'This operation ID was already used. Check the list before starting again.'],
  SECRET_UNSUPPORTED: ['เครื่องนี้ยังเก็บคีย์ลับอย่างปลอดภัยไม่ได้ ใช้ FORGE บน Windows ที่รองรับ DPAPI', 'Secure key entry requires a supported Windows DPAPI installation on this build.'],
  SECRET_BUSY: ['มี FORGE อีกหน้าต่างกำลังบันทึกคีย์อยู่ ปิดหน้าต่างนั้นแล้วลองใหม่ ถ้า FORGE เคยปิดกะทันหัน ให้ปลดล็อกในเครื่องก่อน', 'Credential saves are locked. Close other FORGE instances; recover a stale machine lock after an abrupt stop.'],
  SECRET_SCOPE: ['เลือกโปรเจกต์และการใช้งานให้ตรงกับคีย์นี้', 'Select the exact project and purpose for this key.'],
  SECRET_INPUT: ['ตรวจชื่อคีย์ และกรอกค่าคีย์เป็นบรรทัดเดียว', 'Check the key name and enter a single-line credential.'],
};

export default function SecretManager(props) {
  return <ProjectSecrets key={props.projectId || 'none'} {...props} />;
}

function ProjectSecrets({ t = (th, _en) => th, state, projectId, run, busy, onSaved }) {
  const [status, setStatus] = useState(null), [secrets, setSecrets] = useState([]);
  const [purpose, setPurpose] = useState('provider'), [name, setName] = useState('');
  const [selected, setSelected] = useState(null), [saved, setSaved] = useState(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const password = useRef(null), live = useRef(true), lock = useRef(false);
  const pendingWrite = useRef(null); // In memory only; cleared on unmount/project switch.
  const project = state?.projects?.find(p => p.id === projectId);
  useEffect(() => { live.current = true; return () => { live.current = false; pendingWrite.current = null; if (password.current) password.current.value = ''; }; }, []);
  function report(e) {
    if (!live.current) return;
    const pair = messages[e?.code];
    setError(pair ? t(...pair) : t('ยังไม่รู้ผลการบันทึก ตรวจรายการคีย์ก่อนลองอีกครั้ง', 'The outcome could not be confirmed. Check saved keys before trying again.'));
  }
  async function refresh() {
    const nextStatus = await request('/api/secrets/status', { projectId });
    const result = nextStatus.supported ? await request('/api/secrets/list', { projectId }) : { secrets: [] };
    if (live.current) { setStatus(nextStatus); setSecrets(result.secrets); }
    return result;
  }
  useEffect(() => {
    if (!projectId || !project) return;
    let cancelled = false;
    setLoading(true);
    refresh().catch(e => { if (!cancelled) report(e); }).finally(() => { if (!cancelled && live.current) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);
  async function act(fn) {
    if (lock.current) return;
    lock.current = true; setLoading(true); setError('');
    try { if (run) await run(fn); else await fn(); }
    catch (e) { report(e); }
    finally { lock.current = false; if (live.current) setLoading(false); }
  }
  async function write(method, body, { retry = false } = {}) {
    await act(async () => {
      const op = retry ? pendingWrite.current : { method, body: { ...body, operationId: operationId(), projectId } };
      if (!op) return;
      pendingWrite.current = op;
      try {
        const result = await request(`/api/secrets/${op.method}`, op.body);
        // Drop plaintext and clear the native input immediately on successful save,
        // before the list refresh which can fail independently.
        pendingWrite.current = null;
        if (password.current) password.current.value = '';
        if (live.current) {
          setUncertain(false); setSelected(null);
          if (op.method === 'set') { setSaved(result.secret); onSaved?.(result.secret); }
          else setSaved(null);
        }
        await refresh();
        return result;
      } catch (e) {
        if (e.status && e.status < 500) { pendingWrite.current = null; if (live.current) setUncertain(false); }
        else if (pendingWrite.current && live.current) setUncertain(true);
        // Do not pass server/network messages through the global run error UI.
        const pair = messages[e.code];
        throw Object.assign(new Error(pair ? t(...pair) : t('ยังไม่รู้ผลการบันทึก ตรวจรายการคีย์ก่อนลองใหม่', 'Check saved keys before retrying; the save outcome is uncertain.')), { code: e.code });
      }
    });
  }
  const disabled = busy || loading || !status?.supported || uncertain;
  if (!project) return <Empty>{t('เลือกโปรเจกต์ก่อนจัดการคีย์', 'Select a project before managing keys.')}</Empty>;
  return <section className="panel" aria-label={t('คีย์ลับ', 'Private keys')}>
    <h2>{t('คีย์ลับในเครื่องนี้', 'Private keys on this machine')}</h2>
    <p>{t('เก็บคีย์ API ของบริการ AI, MCP, เครื่องประมวลผล, KOB หรือ Hermes ไว้ที่นี่ แล้วเลือกชื่อคีย์ในหน้าตั้งค่า คีย์แต่ละอันใช้ได้เฉพาะโปรเจกต์และการใช้งานที่เลือก', 'Enter provider API keys including KOB, MCP, compute or Hermes keys here, then use the reference name in setup. Each key belongs to this project and purpose.')}</p>
    <p className="help">{t('คีย์ถูกเข้ารหัสด้วยบัญชี Windows ที่ใช้อยู่ และไม่ถูกรวมในไฟล์ส่งออก ถ้าย้ายเครื่องต้องกรอกใหม่ การบันทึกยังไม่ได้เชื่อมต่อบริการใด', 'Encrypted for the current Windows account. Keys are excluded from exports and need setup on another machine. Saving does not connect to a service.')}</p>
    {status && <p role="status"><Badge>{status.status}</Badge>{!status.supported && <> {t('FORGE รุ่นนี้บน macOS หรือระบบอื่นยังเก็บคีย์ลับอย่างปลอดภัยไม่ได้ ใช้ Windows ที่รองรับ DPAPI', 'Secure key entry on macOS/other systems is not supported in this build. Use Windows with DPAPI.')}</>}</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy || loading} onClick={() => act(refresh)}>{t('โหลดข้อมูลล่าสุด', 'Refresh keys')}</button>
    {uncertain && <div role="status"><p>{t('ยังไม่รู้ว่าบันทึกสำเร็จหรือไม่ ตรวจรายการคีย์ หรือกดส่งคำสั่งเดิมอีกครั้ง อย่าเปลี่ยนค่าคีย์ก่อนรู้ผล', 'The save outcome is uncertain. Check the list or retry the same operation before changing its value.')}</p>
      <button type="button" disabled={busy || loading} onClick={() => write(null, null, { retry: true })}>{t('ส่งคำสั่งเดิมอีกครั้ง', 'Retry same operation')}</button>
      <button type="button" disabled={busy || loading} onClick={() => { pendingWrite.current = null; if (password.current) password.current.value = ''; setUncertain(false); setSelected(null); }}>{t('ล้างช่องกรอกแล้วดูรายการคีย์', 'Clear entry and review list')}</button>
    </div>}
    <form autoComplete="off" onSubmit={e => {
      e.preventDefault(); if (disabled) return;
      void write('set', { purpose, ...(name ? { name } : {}), value: password.current?.value ?? '', expectedRevision: selected?.revision ?? 0, ...(selected ? { reference: selected.reference } : {}) });
    }}>
      <Field label={t('ใช้กับ', 'Purpose')}><select value={purpose} disabled={disabled || !!selected} onChange={e => setPurpose(e.target.value)}>{purposes.map(p => <option key={p} value={p}>{p}</option>)}</select></Field>
      <Field label={t('ชื่อคีย์', 'Key reference name')} hint={t('เช่น FORGE_KOB_KEY หรือเว้นว่างให้ระบบตั้งชื่อให้ แล้วเลือกชื่อนี้ตอนตั้งค่าการเชื่อมต่อ', 'Use a name such as FORGE_KOB_KEY, or leave blank to generate one. Select that name in connection setup.')}><input value={name} disabled={disabled || !!selected} onChange={e => setName(e.target.value)} pattern="[A-Za-z_][A-Za-z0-9_]{0,127}" maxLength={128} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="FORGE_KOB_KEY" /></Field>
      <Field label={selected ? t('ค่าคีย์ใหม่', 'New key value') : t('ค่าคีย์', 'Key value')}><input ref={password} type="password" required disabled={disabled} maxLength={16384} autoComplete="off" autoCapitalize="none" spellCheck={false} /></Field>
      {selected && <p>{t('กำลังเปลี่ยนค่าคีย์ ฉบับที่', 'Rotating revision')} {selected.revision}</p>}
      <div className="actions"><button type="submit" className="primary" disabled={disabled}>{selected ? t('บันทึกค่าคีย์ใหม่', 'Save rotated key') : t('บันทึกคีย์', 'Save key')}</button>
        {selected && <button type="button" disabled={disabled} onClick={() => { setSelected(null); setName(''); if (password.current) password.current.value = ''; }}>{t('ยกเลิกการเปลี่ยน', 'Cancel rotation')}</button>}
      </div>
    </form>
    {saved && <p role="status">{t('บันทึกแล้ว เลือกชื่อ', 'Saved. Use name')} <code>{saved.envName}</code> {t('หรือใช้รหัสอ้างอิง', 'or reference')} <code>{saved.reference}</code></p>}
    {!secrets.length ? <Empty>{t('ยังไม่มีคีย์ในโปรเจกต์นี้', 'No saved keys in this project.')}</Empty> : <ul className="list">{secrets.map(secret => <li key={secret.id}>
      <strong>{secret.envName}</strong> · {secret.purpose} · {t('ฉบับที่', 'revision')} {secret.revision} · {date(secret.updatedAt)}
      <div className="actions"><button type="button" disabled={disabled} onClick={() => { setSelected(secret); setPurpose(secret.purpose); setName(secret.name); setSaved(null); if (password.current) { password.current.value = ''; password.current.focus(); } }}>{t('เปลี่ยนค่าคีย์', 'Rotate key')}</button>
        <button type="button" disabled={disabled} onClick={() => write('remove', { purpose: secret.purpose, reference: secret.reference, expectedRevision: secret.revision })}>{t('ลบคีย์', 'Remove key')}</button></div>
    </li>)}</ul>}
  </section>;
}
