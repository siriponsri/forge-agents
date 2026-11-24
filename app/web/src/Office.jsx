import React, { useEffect, useRef, useState } from "react";
import { Save, Undo2, Redo2, Download, ImagePlus } from "lucide-react";
import { command, date, operationId, request, scoped } from "./api.mjs";
import {
  Badge,
  Collection,
  Empty,
  Field,
  Heading,
  Json,
  Submit,
} from "./ui.jsx";
import { mountEditor, newSnapshot, PACKAGE_VERSION } from "./univer.mjs";

export default function Office({
  t,
  state,
  projectId,
  mutate,
  run,
  busy,
  onDirty,
  themeKind='dark',
  themeId='dark-modern',
}) {
  const documents = scoped(state, "documents", projectId),
    [selected, setSelected] = useState(""),
    [opening, setOpening] = useState(false),
    [dirty, setDirty] = useState(false),
    [reload, setReload] = useState(0);
  const record = documents.find((d) => d.id === selected);
  const choose = (id) => {
    if (
      !dirty ||
      window.confirm(t("ทิ้งการแก้ไขที่ยังไม่บันทึก?", "Discard unsaved edits?"))
    ) {
      setSelected(id);
      setDirty(false);
      onDirty(false);
    }
  };
  return (
    <>
      <Heading
        title={t("Docs & sheets · เอกสารและตาราง", "Docs & sheets")}
        description={t(
          "Univer ในแอป บันทึก native snapshot พร้อมประวัติเวอร์ชัน แยกจากไฟล์ Office ที่ส่งออก",
          "Embedded Univer. Native snapshots and revision history are separate from Office exports.",
        )}
      >
        <button onClick={() => setOpening(!opening)}>
          {t("+ สร้างเอกสาร", "+ Create document")}
        </button>
      </Heading>
      {opening && (
        <form
          className="panel inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget),
              kind = d.get("kind"),
              name = d.get("name");
            const result = await mutate("document.create", {
              kind,
              name,
              snapshot: newSnapshot(kind, name),
              packageVersion: PACKAGE_VERSION,
              resources: [],
              history: [],
            });
            if (result) {
              choose(result.entity.id);
              setOpening(false);
            }
          }}
        >
          <Field label={t("ชื่อเอกสาร", "Document name")}>
            <input name="name" required />
          </Field>
          <Field label={t("ประเภท", "Kind")}>
            <select name="kind">
              <option value="sheet">Sheets</option>
              <option value="doc">Docs</option>
            </select>
          </Field>
          <Submit busy={busy}>{t("สร้างและเปิด", "Create & open")}</Submit>
        </form>
      )}
      <div className="office-layout">
        <aside className="panel document-list">
          <Collection
            items={documents}
            selected={selected}
            onSelect={choose}
            subtitle={(d) =>
              `${d.kind === "sheet" ? "Sheets" : "Docs"} · r${d.revision}`
            }
          />
          {!documents.length && (
            <Empty>
              {t(
                "ยังไม่มีเอกสาร สร้างตารางหรือเอกสารใหม่",
                "Create your first workbook or document.",
              )}
            </Empty>
          )}
        </aside>
        <section className="office-content">
          {record ? (
            <Editor
              key={`${record.id}:${reload}`}
              {...{ t, state, projectId, record, run, busy,themeKind,themeId }}
              onDirty={(value) => {
                setDirty(value);
                onDirty(value);
              }}
              onReload={() => {
                setDirty(false);
                onDirty(false);
                setReload((n) => n + 1);
              }}
            />
          ) : (
            <Empty>
              {t("เลือกเอกสารเพื่อแก้ไขในแอป", "Select a document to edit here.")}
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
function Editor({ t, state, projectId, record, run, busy, onDirty, onReload,themeKind,themeId }) {
  const container = useRef(null),
    editor = useRef(null),
    base = useRef(record),
    baseline = useRef(""),
    pending = useRef(null),
    documentName = useRef(record.name),
    saving = useRef(false),
    imageInput = useRef(null),
    editorSessionId = useRef(operationId()),
    editorLease = useRef(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(null),
    [dirty, setDirty] = useState(false),
    [locked, setLocked] = useState(false),
    [dark, setDark] = useState(themeKind==='dark'),
    [receipt, setReceipt] = useState(null),
    [recoverUrl, setRecoverUrl] = useState(null),
    [reviewed, setReviewed] = useState(null),
    [queuePending, setQueuePending] = useState(false);
  const queueRequests=(state.officeAgent?.requests||[]).filter(r=>r.projectId===projectId&&r.documentId===record.id);
  const queueLocked=queuePending||queueRequests.some(r=>['applying','uncertain'].includes(r.status));
  const [agent, setAgent] = useState(false),
    [history, setHistory] = useState(false);
  const dirtyCallback = useRef(onDirty);
  dirtyCallback.current = onDirty;
  const changed = () => {
    if (!editor.current) return;
    const value =
      JSON.stringify(editor.current.rawSnapshot()) !== baseline.current ||
      documentName.current !== base.current.name;
    setDirty(value);
    dirtyCallback.current(value);
  };
  useEffect(() => {
    let cancelled = false,
      owned;
    Promise.resolve()
      .then(() =>
        cancelled
          ? null
          : mountEditor(container.current, base.current, changed),
      )
      .then((value) => {
        if (!value) return;
        owned = value;
        if (cancelled) {
          value.dispose();
          return;
        }
        editor.current = value;
        value.dark(themeKind==='dark');
        baseline.current = JSON.stringify(value.rawSnapshot());
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
      editor.current = null; // Defer React-root disposal until this React commit has finished.
      if (owned) queueMicrotask(() => owned.dispose());
      dirtyCallback.current(false);
      if(editorLease.current){const {projectId,documentId,editorSessionId,leaseToken}=editorLease.current;request('/api/office/agent/release',{projectId,documentId,editorSessionId,leaseToken}).catch(()=>{});}
    };
  }, []);
  useEffect(()=>{if(ready&&editor.current){const value=themeKind==='dark';setDark(value);editor.current.dark(value);}},[themeKind,themeId,ready]);
  useEffect(() => {
    const prevent = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(
    () => () => {
      if (recoverUrl) URL.revokeObjectURL(recoverUrl);
    },
    [recoverUrl],
  );
  const persist = async (change) => {
    if (!editor.current || saving.current) return;
    saving.current = true;
    setLocked(true);
    setError(null);
    try {
      const snapshot = editor.current.snapshot(),
        edit = pending.current || change;
      if(edit?.saveCommand)edit.commandInput??={
        ...edit.saveCommand,data:{...edit.saveCommand.data,snapshot,name:documentName.current,resources:snapshot.resources||[]},
      };
      const result = edit?.saveCommand ? await request('/api/command',edit.commandInput) : await command(
        "document.save",
        projectId,
        {
          snapshot,
          name: documentName.current,
          packageVersion: PACKAGE_VERSION,
          resources: snapshot.resources || [],
          summary: edit?.summary || t("แก้ไขโดยผู้ใช้", "Human edits"),
          actor: edit?.actor || { kind: "human" },
          ...(edit?.operation ? { edit: edit.operation } : {}),
        },
        base.current,
        edit?.operationId || operationId(),
      );
      base.current = result.entity;
      baseline.current = JSON.stringify(snapshot);
      setReceipt(result.receipt);
      // A save reply is the durable authority; ack only reconciles that receipt.
      // Keep the same command on a lost reply and never apply the edit again.
      if(edit?.queueScope)await request('/api/office/agent/ack',{
        ...edit.queueScope,editorSessionId:editorSessionId.current,leaseToken:editorLease.current.leaseToken,
      });
      pending.current = null;
      setQueuePending(false);setReviewed(null);
      changed();
      return result;
    } catch (e) {
      setError(e);
      changed();
      throw e;
    } finally {
      saving.current = false;
      setLocked(false);
    }
  };
  const scopeFor=r=>Object.fromEntries(['projectId','documentId','botId','taskId','runId','attemptId','operationId'].map(k=>[k,r[k]]));
  const reconcileQueued=async r=>run(async()=>{
    const result=await request('/api/office/agent/status',scopeFor(r));
    if(result.request.status==='completed'&&pending.current?.queueScope?.operationId===r.operationId){
      const latest=await request('/api/state'),saved=latest.receipts.find(x=>x.operationId===r.operationId)?.result;
      if(saved){base.current=saved.entity;baseline.current=JSON.stringify(saved.entity.snapshot);setReceipt(saved.receipt);}
      pending.current=null;setQueuePending(false);setReviewed(null);changed();
    }
    return result;
  });
  const reviewQueued=async r=>run(async()=>{
    if(!ready||dirty||pending.current||saving.current)throw new Error(t('บันทึกงานปัจจุบันก่อนตรวจคำขอ','Save current edits before reviewing a request.'));
    const clean={projectId,documentId:record.id,editorSessionId:editorSessionId.current,expectedRevision:base.current.revision,dirty:false};
    const lease=editorLease.current
      ? await request('/api/office/agent/renew',{...clean,leaseToken:editorLease.current.leaseToken}).then(x=>({...editorLease.current,...x}))
      : await request('/api/office/agent/claim',clean);
    editorLease.current={...clean,leaseToken:lease.leaseToken};
    const result=await request('/api/office/agent/review',{...scopeFor(r),...editorLease.current});
    setReviewed(result.request.status==='review'?r.operationId:null);return result;
  });
  const applyQueued=async r=>run(async()=>{
    if(!editor.current||dirty||pending.current||reviewed!==r.operationId)throw new Error(t('ตรวจคำขอและบันทึกงานปัจจุบันก่อน','Review the request and save current edits first.'));
    const result=await request('/api/office/agent/begin-apply',{...scopeFor(r),...editorLease.current});
    if(!result.mayApply)return result;
    setQueuePending(true);setLocked(true);
    // Retain the permit even if the editor throws: an issued apply is never replayed.
    pending.current={saveCommand:result.saveCommand,queueScope:scopeFor(r)};
    try{editor.current.apply(r.edit);changed();return await persist(pending.current);}
    catch(e){setError(e);throw e;}finally{setLocked(false);}
  });
  const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  useEffect(()=>{
    if(!reviewed)return;
    const timer=setInterval(()=>{
      if(!editorLease.current||dirtyRef.current||saving.current||pending.current)return;
      request('/api/office/agent/renew',{...editorLease.current,expectedRevision:base.current.revision,dirty:false})
        .catch(e=>{editorLease.current=null;setReviewed(null);setError(e);});
    },10000);
    return()=>clearInterval(timer);
  },[reviewed]);
  const applyAgent = async (e) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    await run(async () => {
      if (!editor.current || dirty || pending.current || queueLocked)
        throw new Error(
          t(
            "บันทึกการแก้ไขปัจจุบันก่อนใช้คำสั่งบอท",
            "Save current changes before applying an agent operation.",
          ),
        );
      setLocked(true);
      setError(null);
      try {
        const latest = await request("/api/state");
        const current = latest.documents.find(
          (doc) => doc.id === record.id && doc.projectId === projectId,
        );
        if (!current || current.revision !== base.current.revision)
          throw new Error(
            t(
              "เวอร์ชันเปลี่ยนแล้ว โปรดเปิดเวอร์ชันล่าสุดก่อนใช้คำสั่ง",
              "Revision changed. Reopen the latest revision before applying the command.",
            ),
          );
        const edit = {
          kind: record.kind === "sheet" ? "sheet.setValues" : "doc.insertText",
          range: d.get("range"),
          index: d.get("index"),
          text: d.get("text"),
        };
        const result = editor.current.apply(edit);
        pending.current = {
          operationId: operationId(),
          summary: result.summary,
          actor: { kind: "agent", botId: d.get("botId") },
          operation: {
            ...edit,
            region: result.region,
            expectedRevision: base.current.revision,
          },
        };
        changed();
        return await persist(pending.current);
      } finally {
        setLocked(false);
      }
    });
  };
  const recover = () => {
    const snapshot = editor.current?.rawSnapshot() || record.snapshot;
    setRecoverUrl(
      URL.createObjectURL(
        new Blob([JSON.stringify({ ...record, snapshot }, null, 2)], {
          type: "application/json",
        }),
      ),
    );
  };
  const newer = record.revision !== base.current.revision;
  return (
    <>
      <div className="editor-toolbar">
        <div>
          <input
            className="document-name"
            aria-label={t("เปลี่ยนชื่อเอกสาร", "Rename document")}
            defaultValue={record.name}
            disabled={locked||queueLocked}
            onChange={(e) => {
              documentName.current = e.target.value;
              changed();
            }}
          />{" "}
          <Badge>
            {dirty ? t("ยังไม่บันทึก", "unsaved") : t("บันทึกแล้ว", "saved")}
          </Badge>
          <small>
            r{base.current.revision} · Univer {PACKAGE_VERSION}
          </small>
        </div>
        <div className="actions">
          <button
            disabled={!ready || locked || busy || (!dirty&&!pending.current) || (queueLocked&&!pending.current)}
            className="primary"
            onClick={() => run(() => persist())}
          >
            <Save size={15} />
            {t("บันทึก", "Save")}
          </button>
          <button
            disabled={!ready || locked || queueLocked}
            title={t("ย้อนกลับใน session ปัจจุบัน", "Undo in current session")}
            aria-label="Undo"
            onClick={() =>
              run(async () => {
                await editor.current.undo();
                changed();
              })
            }
          >
            <Undo2 size={16} />
          </button>
          <button
            disabled={!ready || locked || queueLocked}
            aria-label="Redo"
            onClick={() =>
              run(async () => {
                await editor.current.redo();
                changed();
              })
            }
          >
            <Redo2 size={16} />
          </button>
          <button onClick={() => setHistory(!history)}>
            {t("ประวัติ", "History")}
          </button>
          <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg" onChange={e=>{
            const file=e.target.files?.[0];e.target.value='';if(!file)return;
            run(async()=>{setLocked(true);try{await editor.current.insertImage(file);changed();}finally{setLocked(false);}});
          }}/>
          <button disabled={!ready||locked||queueLocked} onClick={()=>imageInput.current.click()}><ImagePlus size={16}/>{t('แทรกรูป','Insert image')}</button>
          <button
            disabled={!ready}
            onClick={() => {
              setDark(!dark);
              editor.current.dark(!dark);
            }}
          >
            {t("ธีม", "Theme")}
          </button>
        </div>
      </div>
      <div className="editor-notice">
        {t(
          "เมนูตัวแก้ไขเป็นอังกฤษ (ไม่มี Thai locale ในแพ็กเกจ 1.6.1) พิมพ์ไทยได้ บันทึก native ไม่ต้องใช้บริการเชิงพาณิชย์",
          "Editor menus use English (1.6.1 ships no Thai locale). Thai content is supported. Native save needs no commercial service.",
        )}
      </div>
      {newer && (
        <div className="alert">
          {t(
            "มีเวอร์ชันใหม่จากบริการ การแก้ไขนี้ยังอยู่ในแท็บและจะไม่เขียนทับเวอร์ชันใหม่",
            "A newer durable revision exists. This tab retains its edits and will not overwrite that revision.",
          )}
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          <div>
            <strong>
              {error.code || t("เอกสารมีข้อผิดพลาด", "Document error")}
            </strong>
            <p>{error.message}</p>
            <div className="actions">
              <button onClick={recover}>
                {t("เตรียม snapshot กู้คืน", "Prepare recovery snapshot")}
              </button>
              {recoverUrl && (
                <a href={recoverUrl} download={`${record.name}.forge.json`}>
                  {t("ดาวน์โหลด snapshot", "Download snapshot")}
                </a>
              )}
            </div>
          </div>
        </div>
      )}
      <div
        className={`editor-frame ${locked||queueLocked ? "locked" : ""}`}
        inert={locked || queueLocked || undefined}
      >
        <div className="univer-container" ref={container} />
        {!ready && !error && (
          <div className="editor-loading" role="status">
            {t("กำลังโหลดตัวแก้ไข…", "Loading editor…")}
          </div>
        )}
      </div>
      {queueRequests.length>0&&<section className="panel office-agent-queue" aria-label={t('คำขอแก้ไขจาก agent','Agent edit requests')}>
        <h3>{t('คำขอแก้ไขจาก agent','Agent edit requests')}</h3>
        <p className="help">{t('ตรวจข้อความและขอบเขตก่อนใช้ การแก้ไขจะผ่าน editor นี้แล้วบันทึกเป็น revision เดียว','Review the text and region. The operation applies through this editor and saves one durable revision.')}</p>
        {queueLocked&&<p role="status">{t('กำลังยืนยันผลคำขอ ห้ามใช้คำสั่งซ้ำ หากขาดการเชื่อมต่อให้บันทึกคำสั่งเดิมอีกครั้ง','Reconciling an issued operation. Do not apply again. If the save response was lost, retry Save with the same command.')}</p>}
        {queueRequests.map(r=><article className="history-row" key={r.operationId}>
          <div><strong>{r.region} · r{r.expectedRevision}</strong> <Badge>{r.status}</Badge>
            <small>{scoped(state,'bots',projectId).find(b=>b.id===r.botId)?.name||r.botId} · {r.operationId}</small>
            <pre className="agent-edit-preview">{r.edit.text}</pre>{r.reason&&<small>{r.reason}</small>}
          </div>
          <div className="actions">
            {['pending','review'].includes(r.status)&&<>
              <button disabled={!ready||busy||locked||dirty||queueLocked||newer} onClick={()=>reviewQueued(r)}>{t('ตรวจคำขอ','Review request')}</button>
              <button className="primary" disabled={busy||locked||dirty||queueLocked||reviewed!==r.operationId||newer} onClick={()=>applyQueued(r)}>{t('ใช้คำขอและบันทึก','Apply request & save')}</button>
              <button disabled={busy||reviewed!==r.operationId} onClick={()=>run(()=>request('/api/office/agent/reject',{...scopeFor(r),editorSessionId:editorSessionId.current,leaseToken:editorLease.current.leaseToken}))}>{t('ปฏิเสธ','Reject')}</button>
            </>}
            {(['applying','uncertain'].includes(r.status)||(queuePending&&pending.current?.queueScope?.operationId===r.operationId))&&<button disabled={busy} onClick={()=>reconcileQueued(r)}>{t('ตรวจผลบันทึก','Reconcile save')}</button>}
          </div>
        </article>)}
      </section>}
      <div className="toolbar">
        <button
          disabled={!ready || locked || dirty || queueLocked}
          onClick={() => setAgent(!agent)}
        >
          {t("คำสั่งแก้ไขแบบจำกัดขอบเขต", "Bounded agent edit")}
        </button>
        <button
          onClick={() => {
            if (
              !dirty ||
              window.confirm(
                t(
                  "ทิ้งการแก้ไขและเปิดเวอร์ชันล่าสุด?",
                  "Discard edits and reopen the latest revision?",
                ),
              )
            )
              onReload();
          }}
        >
          {t("เปิดเวอร์ชันล่าสุด", "Reopen latest revision")}
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(() =>
              command("document.create", projectId, {
                kind: record.kind,
                name: `${record.name} (${t("สำเนา", "copy")})`,
                snapshot: {
                  ...(editor.current?.snapshot() || record.snapshot),
                  id: crypto.randomUUID(),
                },
                packageVersion: PACKAGE_VERSION,
                resources: record.resources || [],
                history: [],
              }),
            )
          }
        >
          {t("ทำสำเนา", "Duplicate")}
        </button>
      </div>
      {agent && (
        <form className="panel" onSubmit={applyAgent}>
          <h3>
            {t("ตรวจทานคำสั่งบอทก่อนใช้", "Review a bounded agent operation")}
          </h3>
          <p className="help">
            {t(
              "ใช้ Facade ของเอกสารที่เปิดอยู่ เกิดหนึ่ง undo step แล้วบันทึกผ่าน revision เดียวกับผู้ใช้ ไม่มีการเรียกโมเดลจากฟอร์มนี้",
              "Applies to this mounted editor as one undo step, then saves through its revision boundary. This form does not invoke a model.",
            )}
          </p>
          <div className="form-grid">
            <Field label={t("บอทผู้แก้ไข", "Actor bot")}>
              <select required name="botId">
                <option value="">{t("เลือกบอท", "Select bot")}</option>
                {scoped(state, "bots", projectId).map((b) => (
                  <option value={b.id} key={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            {record.kind === "sheet" ? (
              <Field
                label={t(
                  "ช่วงเซลล์ (ไม่เกิน 1000)",
                  "Cell range (up to 1000 cells)",
                )}
              >
                <input required name="range" defaultValue="A1" />
              </Field>
            ) : (
              <Field
                label={t("ตำแหน่งข้อความ (เริ่มที่ 0)", "Text offset (zero-based)")}
              >
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  name="index"
                  defaultValue="0"
                />
              </Field>
            )}
          </div>
          <Field
            label={
              record.kind === "sheet"
                ? t(
                    "ค่า / สูตร ใช้ Tab คั่นคอลัมน์และขึ้นบรรทัดใหม่คั่นแถว",
                    "Values / formulas: tab-separated columns, newline-separated rows",
                  )
                : t("ข้อความที่จะเพิ่มในย่อหน้า", "Text to insert in the paragraph")
            }
          >
            <textarea name="text" required rows={3} maxLength={10000} />
          </Field>
          <Submit busy={busy || locked || dirty || queueLocked}>
            {t("ใช้คำสั่งและบันทึก", "Apply & save")}
          </Submit>
        </form>
      )}
      {receipt && (
        <div className="save-receipt" role="status">
          {t("บริการยืนยันการบันทึก", "Durable save acknowledged")} ·{" "}
          {receipt.operationId} · r{receipt.revision}
        </div>
      )}
      {history && (
        <section className="panel">
          <h3>{t("ประวัติเวอร์ชันถาวร", "Durable revision history")}</h3>
          <p className="help">
            {t(
              "Undo/redo ใช้ใน session ปัจจุบันเท่านั้น การกู้เวอร์ชันสร้าง revision ใหม่",
              "Undo/redo belongs to this live session. Restoring history creates a new revision.",
            )}
          </p>
          {!(record.history || []).length && (
            <Empty>{t("ยังไม่มีประวัติการบันทึก", "No saved history yet.")}</Empty>
          )}
          {[...(record.history || [])].reverse().map((h, i) => (
            <div className="history-row" key={h.revision ?? i}>
              <div>
                <strong>
                  r{h.revision ?? h.sourceRevision} ·{" "}
                  {h.summary || h.actor?.kind || "snapshot"}
                </strong>
                <small>{date(h.createdAt || h.timestamp || h.at)}</small>
              </div>
              <button
                disabled={busy || dirty || queueLocked}
                onClick={() =>
                  run(async () => {
                    const r = await command(
                      "document.restore",
                      projectId,
                      {
                        sourceRevision: h.revision ?? h.sourceRevision,
                        actor: { kind: "human" },
                      },
                      base.current,
                    );
                    base.current = r.entity;
                    onReload();
                    return r;
                  })
                }
              >
                {t("กู้เวอร์ชันนี้", "Restore revision")}
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
