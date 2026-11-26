import React from 'react';
import { Heading } from '../ui.jsx';

// Placeholder so the shell builds and routes to the studio. The AI Product Studio
// worker's ProductStudio.jsx replaces this file at merge; keep the same contract:
// default export, usual page props plus initialPrompt and onConsumePrompt().
export default function ProductStudio({ t, initialPrompt = '', onConsumePrompt }) {
  return (
    <>
      <Heading title={t('สร้างผลิตภัณฑ์ AI', 'AI Product Studio')}
        description={t('หน้านี้ยังไม่พร้อมใช้งานในเวอร์ชันนี้', 'This page is not available in this build yet.')} />
      {initialPrompt && (
        <section className="panel" aria-label={t('สิ่งที่คุณพิมพ์', 'Your prompt')}>
          <p className="studio-prompt">{initialPrompt}</p>
          <button type="button" onClick={() => onConsumePrompt?.()}>{t('ล้างข้อความ', 'Clear prompt')}</button>
        </section>
      )}
    </>
  );
}
