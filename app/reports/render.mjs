import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fault, validateBytes } from './files.mjs';

export const TEMPLATES = [{ id: 'engineering', version: 1, name: 'Engineering report' }, { id: 'blank', version: 1, name: 'Plain report' }];
export function validateSpec(spec) {
  if (!spec || spec.schemaVersion !== 1 || typeof spec.title !== 'string' || !spec.title.trim() || !Array.isArray(spec.sections)) throw fault('REPORT_SPEC', 'ReportSpec v1 requires a title and sections.');
  if (!TEMPLATES.some(t => t.id === spec.template?.id && t.version === spec.template?.version)) throw fault('REPORT_TEMPLATE', 'Choose a supported versioned template (engineering/1 or blank/1).');
  if (!['th', 'en', 'th-TH', 'en-US', 'en-GB'].includes(spec.language) || !spec.fontFamily) throw fault('REPORT_SPEC', 'Choose a supported language and an installed font family.');
  if (JSON.stringify(spec).length > 2 * 1024 * 1024 || spec.sections.length > 200) throw fault('REPORT_SPEC', 'Report source exceeds bounded renderer limits.');
  for (const s of spec.sections) {
    if (typeof s.heading !== 'string' || typeof s.text !== 'string') throw fault('REPORT_SPEC', 'Every section needs heading and text strings.');
    if (s.table) {
      const rows = s.table.values;
      if (!Array.isArray(rows) || !rows.length || rows.length > 1000 || !rows[0]?.length || rows[0].length > 63 || rows.some(row => !Array.isArray(row) || row.length !== rows[0].length || row.some(cell => cell !== null && !['string', 'number', 'boolean'].includes(typeof cell)))) throw fault('REPORT_SPEC', 'Table values must be rectangular scalar rows (1000 × 63 maximum).');
    }
    if (s.figure && (!s.figure.artifactId || (s.figure.width !== undefined && (!(s.figure.width > 0) || s.figure.width > 450)))) throw fault('REPORT_SPEC', 'Figures need a project image artifactId and width up to 450 points.');
  }
  if (!Array.isArray(spec.inputs) || !Array.isArray(spec.citations)) throw fault('REPORT_SPEC', 'inputs and citations must be arrays.');
  for (const c of spec.citations) if (typeof c !== 'string' && (!c || typeof c.title !== 'string' || (c.url !== undefined && !/^https?:\/\//.test(c.url)))) throw fault('REPORT_SPEC', 'Citations must be text or a title and HTTP(S) URL.');
}
function stringsFrom(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach(x => stringsFrom(x, result));
  else if (value && typeof value === 'object') {
    // Native inspection interleaves paragraph text with style/type metadata.
    // Only actual text fields form the document stream; styles must not split
    // a user's multi-paragraph source or count as content that was emitted.
    for (const [key, x] of Object.entries(value)) {
      if (key === 'text' && typeof x === 'string') result.push(x);
      else if (x && typeof x === 'object') stringsFrom(x, result);
    }
  }
  return result;
}
export function checkText(data, expected, label) {
  const haystack = stringsFrom(data).join(' ').normalize('NFC').replace(/\s/g, '');
  for (const text of expected) if (text && !haystack.includes(text.normalize('NFC').replace(/\s/g, ''))) throw fault('OUTPUT_CONTENT', `${label} is missing source text: ${text.slice(0, 100)}`, 422);
}
export function expectedText(spec) {
  return [spec.title, ...spec.sections.flatMap(s => [s.heading, s.text, ...(s.table?.values.flat().map(x => x === null ? '' : String(x)) ?? []), s.figure?.caption ?? '']), ...spec.citations.map(c => typeof c === 'string' ? c : c.title)];
}
export async function renderReport(word, spec, root, assets) {
  const fonts = await word.execute('font.list', { all: true });
  if (!fonts.families?.includes(spec.fontFamily)) throw fault('FONT_MISSING', `Font ${spec.fontFamily} is unavailable. Install that font or explicitly select another font profile.`, 422);
  const { id: doc } = await word.call('new_document', { template: 'blank' });
  if (!Number.isInteger(doc)) throw fault('ENGINE_RESPONSE', 'WordCraft did not return a document identity.', 422);
  const cmd = (id, params = {}) => word.execute(id, params, doc);
  for (const [style, size, bold] of [['Normal', 12, false], ['Title', 22, true], ['Heading1', 16, true]]) {
    await cmd('styles.modify', { style, chr: { font: spec.fontFamily, fontCs: spec.fontFamily, size, sizeCs: size, bold, boldCs: bold, lang: spec.language } });
  }
  const para = async (text, style = 'Normal') => {
    await cmd('styles.apply', { style });
    await word.call('type_text', { doc, text, paragraphs: true });
    await cmd('text.newParagraph');
  };
  await para(spec.title, 'Title');
  for (const section of spec.sections) {
    if (section.pageBreakBefore) await cmd('insert.pageBreak');
    await para(section.heading, 'Heading1');
    if (section.text) await para(section.text);
    if (section.table) {
      await word.call('insert_table', { doc, values: section.table.values, header: section.table.header !== false });
      await cmd('caret.docEnd');
      await cmd('text.newParagraph');
    }
    if (section.figure) {
      const asset = assets.find(x => x.id === section.figure.artifactId);
      if (!asset || !['png', 'jpg', 'jpeg'].includes(asset.kind)) throw fault('REPORT_FIGURE', 'Figure must reference a verified PNG/JPEG project artifact.');
      await cmd('insert.picture', { path: asset.stagedPath, alt: section.figure.caption ?? '', width: section.figure.width ?? 360 });
      await cmd('text.newParagraph');
      if (section.figure.caption) await para(section.figure.caption);
    }
  }
  if (spec.citations.length) {
    await para(spec.language.startsWith('th') ? 'แหล่งอ้างอิง' : 'References', 'Heading1');
    for (const c of spec.citations) {
      if (typeof c === 'string') await para(c);
      else if (c.url) {
        await cmd('styles.apply', { style: 'Normal' });
        await cmd('insert.link', { url: c.url, text: c.title });
        await cmd('text.newParagraph');
      } else await para(c.title);
    }
  }
  const missing = await cmd('font.missing');
  if (missing.missing?.length) throw fault('FONT_SUBSTITUTION', 'WordCraft substituted a requested font. Select/install an explicit available font.', 422, missing);
  const strict = await cmd('file.strictReport');
  if (strict.strict !== 'passed') throw fault('STRICT_EXPORT', 'Strict export found missing glyphs or pictures.', 422, strict);
  const inspection = await word.call('inspect_document', { doc });
  const expected = expectedText(spec);
  checkText(inspection, expected, 'WordCraft document');
  const docx = join(root, 'report.docx'), pdf = join(root, 'report.pdf');
  await word.call('save_document', { doc, path: docx });
  await cmd('file.exportPdf', { path: pdf, strict: true });
  const reopened = await word.call('open_document', { path: docx });
  const reopenedDoc = reopened.id;
  checkText(await word.call('inspect_document', { doc: reopenedDoc }), expected, 'Reopened DOCX');
  return { outputs: [{ kind: 'docx', path: docx }, { kind: 'pdf', path: pdf }], validation: { strict, missingFonts: missing, document: inspection, content: 'source-text-verified' } };
}
export async function inspectPDF(pdf, path, { expected = [], page = 1, root, preview = false } = {}) {
  const opened = await pdf.call('doc_open', { path });
  if (!Number.isInteger(opened.doc) || !(opened.pages > 0)) throw fault('INVALID_OUTPUT', 'PdfCraft cannot read the PDF pages.', 422);
  const info = await pdf.call('doc_inspect', { doc: opened.doc });
  if (info.unreadable_objects?.length || info.repairs?.length) throw fault('PDF_REPAIRED', 'PDF needed repair or contains unreadable objects.', 422, info);
  const text = await pdf.call('text_extract', { doc: opened.doc });
  if (text.pages?.some(p => p.truncated)) throw fault('PDF_TRUNCATED', 'PDF text inspection was truncated.', 422);
  checkText(text, expected, 'Searchable PDF');
  const outputs = [];
  let warnings = [];
  if (preview) {
    const result = await pdf.call('render_preview', { doc: opened.doc, page, max_side: 1200 }, true);
    const image = result.content?.find(c => c.type === 'image' && c.mimeType === 'image/png');
    if (!image) throw fault('PREVIEW_MISSING', 'PdfCraft did not produce PNG preview bytes.', 422);
    warnings = result.content.filter(c => c.type === 'text').map(c => c.text);
    if (warnings.length) throw fault('PDF_RENDER_WARNING', 'PDF preview reported incomplete rendering.', 422, warnings);
    const bytes = Buffer.from(image.data, 'base64'); validateBytes('png', bytes);
    const path = join(root, 'preview.png'); await writeFile(path, bytes, { flag: 'wx' });
    outputs.push({ kind: 'png', path });
  }
  return { doc: opened.doc, outputs, validation: { pdf: info, text, renderWarnings: warnings,
    fidelity: 'Searchable text and readability checked; human review of Thai shaping, pagination and copy order is still required.' } };
}
