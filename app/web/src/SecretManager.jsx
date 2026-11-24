import React, { useEffect, useRef, useState } from 'react';
import { request, operationId, date } from './api.mjs';
import { Field, Badge, Empty } from './ui.jsx';

const purposes = ['provider', 'mcp', 'compute', 'relay', 'storage'];
const messages = {
  SECRET_REVISION_CONFLICT: ['ข้อมูลเปลี่ยนแล้ว โหลดรายการใหม่และตรวจรุ่นก่อนบันทึก', 'This key changed. Refresh and review its revision before saving.'],
  SECRET_OPERATION_REUSE: ['รหัสการบันทึกนี้ถูกใช้แล้ว ตรวจสถานะก่อนเริ่มใหม่', 'This operation ID was already used. Check the list before starting again.'],
  SECRET_UNSUPPORTED: ['ระบบนี้ยังไม่รองรับการเก็บคีย์อย่างปลอดภัย ใช้ Windows ที่รองรับ DPAPI', 'Secure key entry requires a supported Windows DPAPI installation on this build.'],
  SECRET_BUSY: ['มีการบันทึกคีย์อยู่ ปิด FORGE อีกหน้าต่างแล้วลองใหม่ หากหยุดผิดปกติให้กู้คืนตัวล็อกในเครื่อง', 'Credential saves are locked. Close other FORGE instances; recover a stale machine lock after an abrupt stop.'],
  SECRET_SCOPE: ['เลือกโปรเจกต์และวัตถุประสงค์ที่ตรงกับคีย์', 'Select the exact project and purpose for this key.'],
  SECRET_INPUT: ['ตรวจชื่อคีย์และกรอกค่าคีย์หนึ่งบรรทัด', 'Check the key name and enter a single-line credential.'],
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
    setError(pair ? t(...pair) : t('ยังยืนยันผลไม่ได้ ตรวจรายการคีย์ก่อนลองบันทึกอีกครั้ง', 'The outcome could not be confirmed. Check saved keys before trying again.'));
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
        throw Object.assign(new Error(pair ? t(...pair) : t('ตรวจรายการก่อนลองใหม่ ผลการบันทึกยังไม่แน่นอน', 'Check saved keys before retrying; the save outcome is uncertain.')), { code: e.code });
      }
    });
  }
  const disabled = busy || loading || !status?.supported || uncertain;
  if (!project) return <Empty>{t('เลือกโปรเจกต์ก่อนจัดการคีย์', 'Select a project before managing keys.')}</Empty>;
  return <section className="panel" aria-label={t('คีย์ส่วนตัว', 'Private keys')}>
    <h2>{t('คีย์ส่วนตัวในเครื่อง', 'Private keys on this machine')}</h2>
    <p>{t('กรอกคีย์ API ของผู้ให้บริการรวม KOB, MCP, compute หรือ Hermes ที่นี่ แล้วใช้ชื่ออ้างอิงในหน้าตั้งค่า คีย์ผูกกับโปรเจกต์และวัตถุประสงค์นี้', 'Enter provider API keys including KOB, MCP, compute or Hermes keys here, then use the reference name in setup. Each key belongs to this project and purpose.')}</p>
    <p className="help">{t('เข้ารหัสด้วยบัญชี Windows ปัจจุบัน ไม่รวมคีย์ในข้อมูลส่งออก ต้องตั้งค่าใหม่บนเครื่องอื่น การบันทึกจะไม่เชื่อมต่อบริการ', 'Encrypted for the current Windows account. Keys are excluded from exports and need setup on another machine. Saving does not connect to a service.')}</p>
    {status && <p role="status"><Badge>{status.status}</Badge>{!status.supported && <> {t('รุ่น macOS/ระบบอื่นยังไม่รองรับการกรอกคีย์อย่างปลอดภัย ใช้ Windows ที่รองรับ DPAPI', 'Secure key entry on macOS/other systems is not supported in this build. Use Windows with DPAPI.')}</>}</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy || loading} onClick={() => act(refresh)}>{t('โหลดรายการใหม่', 'Refresh keys')}</button>
    {uncertain && <div role="status"><p>{t('ผลการบันทึกยังไม่แน่นอน ตรวจรายการหรือส่งคำขอเดิมอีกครั้ง ห้ามเปลี่ยนค่าแล้วลองซ้ำ', 'The save outcome is uncertain. Check the list or retry the same operation before changing its value.')}</p>
      <button type="button" disabled={busy || loading} onClick={() => write(null, null, { retry: true })}>{t('ลองคำขอเดิมอีกครั้ง', 'Retry same operation')}</button>
      <button type="button" disabled={busy || loading} onClick={() => { pendingWrite.current = null; if (password.current) password.current.value = ''; setUncertain(false); setSelected(null); }}>{t('ล้างช่องกรอกและตรวจรายการ', 'Clear entry and review list')}</button>
    </div>}
    <form autoComplete="off" onSubmit={e => {
      e.preventDefault(); if (disabled) return;
      void write('set', { purpose, ...(name ? { name } : {}), value: password.current?.value ?? '', expectedRevision: selected?.revision ?? 0, ...(selected ? { reference: selected.reference } : {}) });
    }}>
      <Field label={t('วัตถุประสงค์', 'Purpose')}><select value={purpose} disabled={disabled || !!selected} onChange={e => setPurpose(e.target.value)}>{purposes.map(p => <option key={p} value={p}>{p}</option>)}</select></Field>
      <Field label={t('ชื่อคีย์สำหรับอ้างอิง', 'Key reference name')} hint={t('กรอกชื่อ เช่น FORGE_KOB_KEY หรือเว้นว่างเพื่อสร้างชื่อ แล้วเลือกชื่อนี้ในหน้าตั้งค่าการเชื่อมต่อ', 'Use a name such as FORGE_KOB_KEY, or leave blank to generate one. Select that name in connection setup.')}><input value={name} disabled={disabled || !!selected} onChange={e => setName(e.target.value)} pattern="[A-Za-z_][A-Za-z0-9_]{0,127}" maxLength={128} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="FORGE_KOB_KEY" /></Field>
      <Field label={selected ? t('ค่าคีย์ใหม่', 'New key value') : t('ค่าคีย์', 'Key value')}><input ref={password} type="password" required disabled={disabled} maxLength={16384} autoComplete="off" autoCapitalize="none" spellCheck={false} /></Field>
      {selected && <p>{t('กำลังเปลี่ยนคีย์รุ่น', 'Rotating revision')} {selected.revision}</p>}
      <div className="actions"><button type="submit" className="primary" disabled={disabled}>{selected ? t('บันทึกคีย์ใหม่', 'Save rotated key') : t('บันทึกคีย์', 'Save key')}</button>
        {selected && <button type="button" disabled={disabled} onClick={() => { setSelected(null); setName(''); if (password.current) password.current.value = ''; }}>{t('ยกเลิก', 'Cancel rotation')}</button>}
      </div>
    </form>
    {saved && <p role="status">{t('บันทึกแล้ว ใช้ชื่อ', 'Saved. Use name')} <code>{saved.envName}</code> {t('หรืออ้างอิง', 'or reference')} <code>{saved.reference}</code></p>}
    {!secrets.length ? <Empty>{t('ยังไม่มีคีย์ในโปรเจกต์นี้', 'No saved keys in this project.')}</Empty> : <ul className="list">{secrets.map(secret => <li key={secret.id}>
      <strong>{secret.envName}</strong> · {secret.purpose} · {t('รุ่น', 'revision')} {secret.revision} · {date(secret.updatedAt)}
      <div className="actions"><button type="button" disabled={disabled} onClick={() => { setSelected(secret); setPurpose(secret.purpose); setName(secret.name); setSaved(null); if (password.current) { password.current.value = ''; password.current.focus(); } }}>{t('เปลี่ยนคีย์', 'Rotate key')}</button>
        <button type="button" disabled={disabled} onClick={() => write('remove', { purpose: secret.purpose, reference: secret.reference, expectedRevision: secret.revision })}>{t('ลบคีย์', 'Remove key')}</button></div>
    </li>)}</ul>}
  </section>;
}
