import React, { useEffect, useState } from "react";
import { Download, Play, Square } from "lucide-react";
import {
  command,
  date,
  downloadUrl,
  operationId,
  request,
  scoped,
} from "./api.mjs";
import {
  Badge,
  Collection,
  Empty,
  Field,
  Heading,
  Json,
  Submit,
} from "./ui.jsx";

const initial = {
  schemaVersion: 1,
  title: "",
  language: "th",
  fontFamily: "Tahoma",
  template: { id: "engineering", version: 1 },
  sections: [{ heading: "", text: "" }],
  citations: [],
  inputs: [],
};
export default function Reports({ t, state, projectId, mutate, run, busy }) {
  const reports = scoped(state, "reports", projectId),
    artifacts = scoped(state, "artifacts", projectId),
    documents = scoped(state, "documents", projectId);
  const [selected, setSelected] = useState(""),
    [engines, setEngines] = useState(null),
    [preview, setPreview] = useState(null),
    [configure, setConfigure] = useState(false);
  const record = reports.find((r) => r.id === selected);
  useEffect(() => {
    request("/api/reports/health")
      .then(setEngines)
      .catch((e) => setEngines({ error: e.message }));
  }, []);
  const jobs = scoped(state, "jobs", projectId).filter(
    (j) => j.reportId === record?.id,
  );
  const pdfs = artifacts.filter(
    (a) =>
      a.kind === "pdf" ||
      a.contentType === "application/pdf" ||
      /\.pdf$/i.test(a.filename || a.name || a.path || ""),
  );
  const previewImage=preview&&artifacts.find(a=>a.kind==='png'&&((a.jobId&&a.jobId===preview.jobId)||a.parentArtifactIds?.includes(preview.id)));
  return (
    <>
      <Heading
        title={t("Report Studio · รายงาน", "Report Studio")}
        description={t(
          "บันทึก ReportSpec → สร้าง DOCX/PDF จากเวอร์ชันเดียว → ตรวจและดาวน์โหลดไฟล์จริง",
          "Save ReportSpec → generate DOCX/PDF from one revision → inspect verified output files.",
        )}
      >
        <button onClick={() => setConfigure(!configure)}>
          {t("ตั้งค่า engine และฟอนต์", "Engines & fonts")}
        </button>
      </Heading>
      <div className="engine-strip">
        <span>WordCraft / PdfCraft</span>
        {['wordcraft','pdfcraft'].map(name => <span key={name} role="status">
          {name === 'wordcraft' ? 'WordCraft' : 'PdfCraft'} · {engines?.engines?.[name]?.ready
            ? `${engines.engines[name].identity?.version ?? ''} ${t('พร้อมใช้งาน','Ready')}`
            : engines?.engines?.[name]?.recovery || t('ตรวจสอบก่อนใช้งาน','Check setup')}
        </span>)}
        <button
          onClick={() =>
            run(async () => {
              const h = await request("/api/reports/health");
              setEngines(h);
              return h;
            })
          }
        >
          {t("ตรวจความพร้อม", "Check readiness")}
        </button>
        <details>
          <summary>{t("ผลตรวจจริง", "Observed readiness")}</summary>
          <Json value={engines || { status: "checking" }} />
        </details>
      </div>
      {configure && (
        <EngineSettings key={JSON.stringify(engines?.config)} health={engines} t={t} run={run} busy={busy} onHealth={setEngines} />
      )}
      <div className="split report-layout">
        <aside className="panel">
          <button onClick={() => setSelected("")}>
            {t("+ แหล่งรายงานใหม่", "+ New report source")}
          </button>
          <Collection
            items={reports}
            selected={selected}
            onSelect={setSelected}
            subtitle={(r) => `r${r.revision} · ${r.spec?.language || "—"}`}
          />
          {!reports.length && (
            <Empty>{t("ยังไม่มีแหล่งรายงาน", "No report sources yet.")}</Empty>
          )}
        </aside>
        <section>
          <SourceEditor
            key={record?.id || "new"}
            {...{ t, record, mutate, busy, artifacts, documents }}
            onSaved={(r) => setSelected(r.entity.id)}
          />
          {record && (
            <section className="panel">
              <div className="record-head">
                <h2>
                  {t("สร้างไฟล์จากแหล่งที่บันทึก", "Generate from saved source")}
                </h2>
                <span>r{record.revision}</span>
              </div>
              <p>
                {t(
                  "สร้างไฟล์จากเวอร์ชันนี้ แล้วตรวจฟอนต์และการจัดหน้าก่อนดาวน์โหลด",
                  "Generate this saved revision, then review fonts and pagination before downloading.",
                )}
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    request("/api/reports/generate", {
                      operationId: operationId(),
                      projectId,
                      reportId: record.id,
                      expectedRevision: record.revision,
                    }),
                  )
                }
              >
                <Play size={15} />
                {t("สร้าง DOCX และ PDF", "Generate DOCX & PDF")}
              </button>
              {jobs.map((job) => (
                <ReportJob
                  key={job.id}
                  {...{ t, job, run, busy, artifacts, setPreview }}
                />
              ))}
            </section>
          )}
        </section>
      </div>
      <section className="panel">
        <h2>{t("ตรวจและประมวลผล PDF", "PDF inspection & processing")}</h2>
        {!pdfs.length ? (
          <Empty>
            {t(
              "ต้องมี PDF ที่ลงทะเบียนและผ่านการตรวจแล้ว",
              "Register a verified PDF or generate a report first.",
            )}
          </Empty>
        ) : (
          <>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                run(async () => {
                  const result = await request("/api/reports/pdf-operation", {
                    operationId: operationId(),
                    projectId,
                    artifactId: d.get("artifactId"),
                    expectedRevision: pdfs.find(
                      (a) => a.id === d.get("artifactId"),
                    ).revision,
                    operation: d.get("operation"),
                    degrees: Number(d.get("degrees")),
                    pages: d
                      .get("pages")
                      .split(",")
                      .filter(Boolean)
                      .map(Number),
                    page: Number(d.get("pages").split(",")[0]) || 1,
                  });
                  return result;
                });
              }}
            >
              <Field label="PDF">
                <select name="artifactId">
                  {pdfs.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name || a.filename || a.id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("การดำเนินการ", "Operation")}>
                <select name="operation">
                  <option value="inspect">
                    {t("ตรวจโครงสร้าง", "Inspect")}
                  </option>
                  <option value="render">
                    {t("สร้างภาพหน้าเอกสาร", "Render pages")}
                  </option>
                  <option value="rotate">{t("หมุนหน้า", "Rotate pages")}</option>
                </select>
              </Field>
              <Field
                label={t(
                  "หน้าเอกสารตามที่ adapter รองรับ",
                  "Pages supported by adapter",
                )}
              >
                <input name="pages" placeholder="1" defaultValue="1" />
              </Field>
              <Field label={t("องศาการหมุน", "Rotation degrees")}>
                <select name="degrees">
                  <option>90</option>
                  <option>180</option>
                  <option>270</option>
                </select>
              </Field>
              <Submit busy={busy}>
                {t("ดำเนินการด้วย PdfCraft", "Run PdfCraft operation")}
              </Submit>
            </form>
            <div className="actions">
              {pdfs.map((a) => (
                <button key={a.id} onClick={() => setPreview(a)}>
                  {t("ดู PDF", "Preview PDF")} · {a.name || a.filename || a.id}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
      <p className="help">
        {t(
          "การแปลง XLSX/DOCX ผ่าน Univer Exchange เป็นส่วนเสริมที่ยังไม่เปิดใช้ Native snapshots ยังคงแก้ไขและบันทึกได้ ข้อจำกัดฟอนต์และการจัดหน้าให้ตรวจจากไฟล์ที่สร้างจริง",
          "Univer Exchange XLSX/DOCX conversion is not enabled. Native editing is independent. Verify fonts and pagination in the actual generated files.",
        )}
      </p>
      {preview && (
        <div className="modal-backdrop">
          <section
            className="modal preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
          >
            <div className="record-head">
              <h2 id="preview-title">
                {preview.name || preview.filename || preview.id}
              </h2>
              <div className="actions">
                <a className="button" href={downloadUrl(preview.id)} download>
                  <Download size={14} />
                  {t("ดาวน์โหลด", "Download")}
                </a>
                <button onClick={() => setPreview(null)}>
                  {t("ปิด", "Close")}
                </button>
              </div>
            </div>
            <p className="help">
              {t("ไฟล์จริงจาก artifact ที่บันทึกแล้ว", "Actual registered artifact")} ·
              SHA256 {preview.sha256 || preview.hash || "—"}
            </p>
            {previewImage?<div className="report-page-preview"><p className="help">{t('หน้าที่ 1 · ภาพจากไฟล์ PDF ที่ตรวจแล้ว','Page 1 · rendered from the verified PDF')}</p><img src={downloadUrl(previewImage.id)} alt={t('ภาพหน้ารายงานที่สร้างจริง','Rendered report page')} style={{display:'block',maxWidth:'100%',height:'auto',margin:'0 auto'}}/></div>:<div className="overview-empty"><p>{t('ยังไม่มีภาพตัวอย่างของ PDF นี้','A rendered preview is not available yet.')}</p><button disabled={busy} onClick={()=>run(()=>request('/api/reports/pdf-operation',{operationId:operationId(),projectId,artifactId:preview.id,expectedRevision:preview.revision,operation:'render',page:1}))}>{t('สร้างภาพตัวอย่าง','Render preview')}</button></div>}
            <a className="button" href={downloadUrl(preview.id)} target="_blank" rel="noreferrer">{t('เปิด PDF แบบเต็ม','Open full PDF')}</a>
          </section>
        </div>
      )}
    </>
  );
}
function SourceEditor({
  t,
  record,
  mutate,
  busy,
  artifacts,
  documents,
  onSaved,
}) {
  const [spec, setSpec] = useState(() =>
      structuredClone(record?.spec || initial),
    ),
    [name, setName] = useState(record?.name || ""),
    [dirty, setDirty] = useState(false),
    [base, setBase] = useState(record);
  const update = (patch) => {
    setSpec((s) => ({ ...s, ...patch }));
    setDirty(true);
  };
  const section = (i, patch) =>
    update({
      sections: spec.sections.map((s, index) =>
        index === i ? { ...s, ...patch } : s,
      ),
    });
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await mutate(
          base ? "report.save" : "report.create",
          { name, spec },
          base,
        );
        if (r) {
          setBase(r.entity);
          setDirty(false);
          onSaved(r);
        }
      }}
    >
      <div className="record-head">
        <h2>{t("แหล่งรายงาน", "Report source")}</h2>
        <Badge>
          {dirty
            ? t("ยังไม่บันทึก", "unsaved")
            : base
              ? `r${base.revision}`
              : t("ใหม่", "new")}
        </Badge>
      </div>
      <div className="form-grid">
        <Field label={t("ชื่อแหล่งรายงาน", "Source name")}>
          <input
            value={name}
            required
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        <Field label={t("ชื่อเรื่องในเอกสาร", "Report title")}>
          <input
            value={spec.title}
            required
            onChange={(e) => update({ title: e.target.value })}
          />
        </Field>
        <Field label={t("ภาษา", "Language")}>
          <select
            value={spec.language}
            onChange={(e) => update({ language: e.target.value })}
          >
            <option value="th">ไทย</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label={t("ฟอนต์ที่ engine ตรวจพบ", "Font available to engine")}>
          <input
            value={spec.fontFamily}
            required
            onChange={(e) => update({ fontFamily: e.target.value })}
          />
        </Field>
      </div>
      <details>
        <summary>{t("แม่แบบและเวอร์ชัน", "Template & version")}</summary>
        <div className="form-grid">
          <Field label="Template ID">
            <input
              value={spec.template?.id || ""}
              required
              onChange={(e) =>
                update({ template: { ...spec.template, id: e.target.value } })
              }
            />
          </Field>
          <Field label="Template version">
            <input
              value={spec.template?.version || ""}
              required
              onChange={(e) =>
                update({
                  template: {
                    ...spec.template,
                    version: Number(e.target.value),
                  },
                })
              }
            />
          </Field>
        </div>
      </details>
      {spec.sections.map((s, i) => (
        <fieldset className="report-section" key={i}>
          <legend>
            {t("ส่วนที่", "Section")} {i + 1}
          </legend>
          <Field label={t("หัวข้อ", "Heading")}>
            <input
              value={s.heading || ""}
              onChange={(e) => section(i, { heading: e.target.value })}
            />
          </Field>
          <Field label={t("เนื้อหา", "Text")}>
            <textarea
              value={s.text || ""}
              rows={4}
              onChange={(e) => section(i, { text: e.target.value })}
            />
          </Field>
          <details>
            <summary>
              {t(
                "ตาราง / รูปอ้างอิง (ขั้นสูง)",
                "Table / figure references (advanced)",
              )}
            </summary>
            <Field
              label={t("ตาราง JSON ตาม ReportSpec", "ReportSpec table JSON")}
            >
              <textarea
                defaultValue={s.table ? JSON.stringify(s.table, null, 2) : ""}
                onChange={(e) => {
                  try {
                    const value = e.target.value
                      ? JSON.parse(e.target.value)
                      : undefined;
                    e.target.setCustomValidity("");
                    section(i, { table: value });
                  } catch {
                    e.target.setCustomValidity("Invalid JSON");
                  }
                }}
              />
            </Field>
            <Field label={t("Figure artifact ID", "Figure artifact ID")}>
              <select
                value={s.figure?.artifactId || ""}
                onChange={(e) =>
                  section(i, {
                    figure: e.target.value
                      ? {
                          artifactId: e.target.value,
                          revision: artifacts.find(
                            (a) => a.id === e.target.value,
                          )?.revision,
                        }
                      : undefined,
                  })
                }
              >
                <option value="">—</option>
                {artifacts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.filename || a.id}
                  </option>
                ))}
              </select>
            </Field>
          </details>
          <button
            type="button"
            disabled={spec.sections.length === 1}
            onClick={() =>
              update({ sections: spec.sections.filter((_, n) => n !== i) })
            }
          >
            {t("ลบส่วนนี้", "Remove section")}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          update({ sections: [...spec.sections, { heading: "", text: "" }] })
        }
      >
        {t("+ เพิ่มส่วน", "+ Add section")}
      </button>
      <Field
        label={t(
          "อ้างอิงและหลักฐาน (หนึ่งรายการต่อบรรทัด)",
          "Citations / evidence (one per line)",
        )}
      >
        <textarea
          value={spec.citations
            .map((c) =>
              typeof c === "string" ? c : c.text || c.url || JSON.stringify(c),
            )
            .join("\n")}
          onChange={(e) =>
            update({ citations: e.target.value.split("\n").filter(Boolean) })
          }
        />
      </Field>
      <Field
        label={t(
          "อินพุตจาก artifact เวอร์ชันที่บันทึก (เลือกหลายรายการด้วย Ctrl)",
          "Input artifact revisions (Ctrl for multiple)",
        )}
      >
        <select
          multiple
          value={spec.inputs
            .filter((i) => i.artifactId)
            .map((i) => i.artifactId)}
          onChange={(e) =>
            update({
              inputs: Array.from(e.target.selectedOptions).map((o) => {
                const a = artifacts.find((a) => a.id === o.value);
                return {
                  artifactId: a.id,
                  revision: a.revision,
                  sha256: a.sha256,
                };
              }),
            })
          }
        >
          {artifacts.map((a) => (
            <option value={a.id} key={a.id}>
              {a.name || a.filename || a.id} · r{a.revision}
            </option>
          ))}
        </select>
      </Field>
      <details>
        <summary>
          {t(
            "นำเข้าเนื้อหา plain text จาก native Doc ที่บันทึก",
            "Import plain text from a saved native Doc",
          )}
        </summary>
        <p className="help">
          {t(
            "นำเข้าเฉพาะข้อความ ไม่แมป styles/tables/images เป็นการเชื่อมแหล่งที่มาอย่างชัดเจน",
            "Text only; styles, tables and images are not mapped. Input document identity and revision are recorded.",
          )}
        </p>
        {documents
          .filter((d) => d.kind === "doc")
          .map((d) => (
            <button
              type="button"
              key={d.id}
              onClick={() =>
                update({
                  sections: [
                    ...spec.sections,
                    {
                      heading: d.name,
                      text: (d.snapshot?.body?.dataStream || "")
                        .replace(/\r\n?$/g, "")
                        .replace(/\r/g, "\n"),
                    },
                  ],
                  inputs: [
                    ...spec.inputs,
                    {
                      documentId: d.id,
                      revision: d.revision,
                      mapping: "plain-text-v1",
                    },
                  ],
                })
              }
            >
              {d.name} · r{d.revision}
            </button>
          ))}
      </details>
      <div className="actions">
        <Submit busy={busy}>{t("บันทึกแหล่งรายงาน", "Save report source")}</Submit>
        <small>
          {t(
            "บันทึกแหล่งข้อมูลแยกจากการสร้างและส่งไฟล์",
            "Source save is separate from generation and delivery.",
          )}
        </small>
      </div>
    </form>
  );
}
function ReportJob({ t, job, run, busy, artifacts, setPreview }) {
  const outputs = artifacts.filter(
    (a) =>
      a.jobId === job.id ||
      (job.artifactIds || []).includes(a.id) ||
      (job.outputs || []).some((o) => o.artifactId === a.id),
  );
  const [details, setDetails] = useState(null);
  return (
    <article className="run">
      <div className="record-head">
        <strong>{job.id}</strong>
        <Badge>{job.status}</Badge>
      </div>
      <p>
        {date(job.createdAt)} · {t("เวอร์ชันแหล่งรายงาน", "Source revision")}{" "}
        {job.sourceRevision ?? job.reportRevision ?? "—"}
      </p>
      {job.error && (
        <p className="error-text">
          {typeof job.error === "string" ? job.error : job.error.message}
        </p>
      )}
      <div className="actions">
        <button
          onClick={() =>
            run(async () => {
              const r = await request(
                `/api/reports/jobs/${encodeURIComponent(job.id)}`,
              );
              setDetails(r);
              return r;
            })
          }
        >
          {t("ตรวจสถานะ / log", "Inspect status / logs")}
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(() =>
              request(`/api/reports/jobs/${encodeURIComponent(job.id)}/stop`, {
                operationId: operationId(),
              }),
            )
          }
        >
          <Square size={14} />
          {t("ขอหยุด job", "Request job stop")}
        </button>
        {outputs.map((a) => (
          <React.Fragment key={a.id}>
            <a className="button" href={downloadUrl(a.id)} download>
              <Download size={14} />
              {a.name || a.filename || a.kind || "file"}
            </a>
            {/pdf/i.test(
              a.contentType || a.filename || a.name || a.kind || "",
            ) && (
              <button onClick={() => setPreview(a)}>
                {t("ดู PDF จริง", "Preview PDF")}
              </button>
            )}
          </React.Fragment>
        ))}
      </div>
      {details && (
        <details open>
          <summary>{t("ผลจากบริการ", "Service result")}</summary>
          <Json value={details} />
        </details>
      )}
    </article>
  );
}
function EngineSettings({ t, run, busy, onHealth, health }) {
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        run(async () => {
          const r = await request("/api/reports/configure", {
            ...(d.get("wordcraftPath")
              ? { wordcraft: { path: d.get("wordcraftPath") } }
              : {}),
            ...(d.get("pdfcraftPath")
              ? { pdfcraft: { path: d.get("pdfcraftPath") } }
              : {}),
            fonts: [
              {
                family: d.get("fontFamily"),
                version: d.get("fontVersion"),
                paths: d
                  .get("fontPaths")
                  .split("\n")
                  .map((p) => p.trim())
                  .filter(Boolean),
                license: "local system font; not redistributed",
              },
            ],
          });
          onHealth(await request("/api/reports/health"));
          return r;
        });
      }}
    >
      <h2>{t("ตั้งค่า engine บนเครื่องนี้", "Machine-local engines")}</h2>
      <div className="actions">
        {["wordcraft", "pdfcraft"].map((engine) => (
          <React.Fragment key={engine}>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const h = await request("/api/reports/configure", {
                    action: "discover",
                    engine,
                  });
                  onHealth(h);
                  return h;
                })
              }
            >
              {t("ค้นหา", "Discover")} {engine}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const h = await request("/api/reports/configure", {
                    action: "install",
                    engine,
                  });
                  onHealth(h);
                  return h;
                })
              }
            >
              {t("ติดตั้งรุ่นที่ตรวจสอบแล้ว", "Install verified release")} {engine}
            </button>
          </React.Fragment>
        ))}
      </div>
      <div className="form-grid">
        <Field label="WordCraft executable">
          <input name="wordcraftPath" defaultValue={health?.config?.wordcraft?.path ?? ''} />
        </Field>
        <Field label="PdfCraft executable">
          <input name="pdfcraftPath" defaultValue={health?.config?.pdfcraft?.path ?? ''} />
        </Field>
        <Field label={t("ป้ายเวอร์ชันโปรไฟล์ฟอนต์", "Font profile version label")}>
          <input required name="fontVersion" defaultValue={health?.config?.fonts?.[0]?.version ?? 'system-local'} />
        </Field>
        <Field label={t("ฟอนต์", "Font family")}>
          <input required name="fontFamily" list="report-font-families" defaultValue={health?.config?.fonts?.[0]?.family ?? 'Tahoma'} />
          <datalist id="report-font-families">{(health?.engines?.wordcraft?.fonts?.families??[]).map(f=><option key={f} value={f}/>)}</datalist>
        </Field>
        <Field
          label={t(
            "ไฟล์ฟอนต์ในเครื่อง (หนึ่งพาธต่อบรรทัด)",
            "Local font files (one path per line)",
          )}
        >
          <textarea name="fontPaths" rows={2} defaultValue={(health?.config?.fonts?.[0]?.files??[]).map(f=>f.path).join('\n')} />
        </Field>
      </div>
      <p className="help">
        {t(
          "พาธเป็นการตั้งค่าของเครื่องนี้ บริการต้องตรวจเวอร์ชันและความพร้อมก่อนรัน",
          "Paths are machine-local. The service verifies actual binaries and readiness before execution.",
        )}
      </p>
      <Submit busy={busy}>
        {t("บันทึกและตรวจ engine", "Save & inspect engines")}
      </Submit>
    </form>
  );
}
