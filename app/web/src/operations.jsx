import React, { useEffect, useState } from "react";
import { Play, Square, Download } from "lucide-react";
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
  useRevisionForm,
} from "./ui.jsx";
import { Run } from "./work.jsx";

export function Notebooks({ t, state, projectId, mutate, run, busy }) {
  const notebooks = scoped(state, "notebooks", projectId),
    jobs = scoped(state, "jobs", projectId).filter((j) => j.notebookId);
  const [selected, setSelected] = useState(""),
    [logs, setLogs] = useState({});
  const notebook = notebooks.find((n) => n.id === selected);
  const [notebookBase, acceptNotebook] = useRevisionForm(notebook);
  return (
    <>
      <Heading
        title={t("Notebooks · สมุดงาน Python", "Notebooks")}
        description={t(
          "บันทึกโค้ดก่อนเรียกใช้ ผลลัพธ์และ log มาจาก job จริงของบริการในเครื่อง",
          "Save source before execution. Status and logs come from actual local jobs.",
        )}
      />
      <div className="split">
        <section className="panel">
          <button onClick={() => setSelected("")}>
            {t("+ สมุดงานใหม่", "+ New notebook")}
          </button>
          <Collection
            items={notebooks}
            selected={selected}
            onSelect={setSelected}
            subtitle={(n) => `${n.language || "python"} · r${n.revision}`}
          />
          {!notebooks.length && (
            <Empty>{t("ยังไม่มีสมุดงาน", "No notebooks yet.")}</Empty>
          )}
          <Field label={t("นำเข้าไฟล์ .py หรือ .ipynb", "Import .py or .ipynb")}>
            <input
              type="file"
              accept=".py,.ipynb"
              onChange={(e) =>
                run(async () => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 2_000_000)
                    throw new Error("Notebook import limit: 2 MB");
                  let code = await f.text(),
                    cells;
                  if (f.name.endsWith(".ipynb")) {
                    const nb = JSON.parse(code);
                    cells = nb.cells;
                    code = (nb.cells || [])
                      .filter((c) => c.cell_type === "code")
                      .map((c) =>
                        Array.isArray(c.source) ? c.source.join("") : c.source,
                      )
                      .join("\n\n");
                  }
                  const r = await command("notebook.create", projectId, {
                    name: f.name,
                    language: "python",
                    code,
                    ...(cells ? { cells } : {}),
                  });
                  setSelected(r.entity.id);
                  return r;
                })
              }
            />
          </Field>
        </section>
        <section className="panel">
          <form
            key={notebook?.id || "new"}
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              const r = await mutate(
                notebook ? "notebook.update" : "notebook.create",
                {
                  name: d.get("name"),
                  code: d.get("code"),
                  language: "python",
                },
                notebookBase,
              );
              if (r) {
                acceptNotebook(r.entity);
                setSelected(r.entity.id);
              }
            }}
          >
            <Field label={t("ชื่อสมุดงาน", "Notebook name")}>
              <input required name="name" defaultValue={notebook?.name || ""} />
            </Field>
            <Field
              label={t("โค้ด Python", "Python source")}
              hint={t(
                "รันด้วยสภาพแวดล้อม Python ในเครื่องตามการตั้งค่าบริการ",
                "Runs in the local service Python environment.",
              )}
            >
              <textarea
                className="source"
                name="code"
                spellCheck="false"
                required
                rows={16}
                defaultValue={notebook?.code || ""}
              />
            </Field>
            <div className="actions">
              <Submit busy={busy}>{t("บันทึกสมุดงาน", "Save notebook")}</Submit>
              {notebook && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      request("/api/jobs/start", {
                        operationId: operationId(),
                        projectId,
                        notebookId: notebook.id,
                      }),
                    )
                  }
                >
                  <Play size={15} />
                  {t("รันเวอร์ชันที่บันทึก", "Run saved revision")}
                </button>
              )}
            </div>
          </form>
          <h2>{t("ประวัติการรัน", "Job history")}</h2>
          {jobs
            .filter((j) => j.notebookId === notebook?.id)
            .map((j) => (
              <article className="run" key={j.id}>
                <div className="record-head">
                  <strong>{j.id}</strong>
                  <Badge>{j.status}</Badge>
                </div>
                <p>
                  {date(j.createdAt)} · {t("ซอร์สเวอร์ชัน", "Source revision")}{" "}
                  {j.notebookRevision ?? j.sourceRevision ?? "—"}
                </p>
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await request(
                          `/api/jobs/${encodeURIComponent(j.id)}`,
                        );
                        setLogs((s) => ({
                          ...s,
                          [j.id]: result.logs ?? result.job?.logs ?? result,
                        }));
                        return result;
                      })
                    }
                  >
                    {t("โหลด log ล่าสุด", "Read current logs")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        request(`/api/jobs/${encodeURIComponent(j.id)}/stop`, {
                          operationId: operationId(),
                        }),
                      )
                    }
                  >
                    <Square size={14} />
                    {t("ขอหยุด", "Request stop")}
                  </button>
                </div>
                <pre className="code logs">
                  {typeof (logs[j.id] ?? j.logs) === "string"
                    ? (logs[j.id] ?? j.logs)
                    : JSON.stringify(logs[j.id] ?? j.logs ?? [], null, 2)}
                </pre>
                {j.error && (
                  <p className="error-text">
                    {typeof j.error === "string" ? j.error : j.error.message}
                  </p>
                )}
              </article>
            ))}
        </section>
      </div>
    </>
  );
}

export function Artifacts({ t, state, projectId, run, busy }) {
  const items = scoped(state, "artifacts", projectId),
    [kind, setKind] = useState("all");
  return (
    <>
      <Heading
        title={t("Artifacts · ไฟล์และผลลัพธ์", "Artifacts")}
        description={t(
          "ลงทะเบียนไฟล์ที่มีอยู่จริง บริการตรวจไฟล์ ขนาด และ SHA256 ก่อนบันทึก",
          "Register an existing file. The service verifies its bytes and SHA256 before registration.",
        )}
      />
      <form
        className="panel inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          await run(() =>
            request("/api/artifacts/register", {
              projectId,
              path: d.get("path"),
              kind: d.get("kind"),
            }),
          );
        }}
      >
        <Field label={t("พาธไฟล์ในโครงการ", "Project file path")}>
          <input name="path" required />
        </Field>
        <Field label={t("ประเภทไฟล์", "Artifact kind")}>
          <select name="kind">
            {[
              "dataset",
              "model",
              "weights",
              "config",
              "notebook",
              "report",
              "file",
            ].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Submit busy={busy}>{t("ตรวจและลงทะเบียน", "Verify & register")}</Submit>
      </form>
      <div className="toolbar">
        <Field label={t("กรองประเภท", "Filter kind")}>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">{t("ทั้งหมด", "All")}</option>
            {[...new Set(items.map((i) => i.kind))].filter(Boolean).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <span>
          {items.length} {t("รายการจริง", "registered records")}
        </span>
      </div>
      {!items.length ? (
        <Empty>{t("ยังไม่มีไฟล์ที่ลงทะเบียน", "No verified artifacts yet.")}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  t("ไฟล์", "File"),
                  t("ประเภท", "Kind"),
                  t("ขนาด", "Bytes"),
                  "SHA256 / provenance",
                  t("ดาวน์โหลด", "Download"),
                ].map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items
                .filter((i) => kind === "all" || i.kind === kind)
                .map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>
                        {a.name ||
                          a.filename ||
                          a.path?.split(/[\\/]/).pop() ||
                          a.id}
                      </strong>
                      <small>{a.path}</small>
                    </td>
                    <td>
                      {a.kind}
                      <Badge>{a.status || "registered"}</Badge>
                    </td>
                    <td>{a.sizeBytes ?? a.bytes ?? a.size ?? "—"}</td>
                    <td>
                      <code className="hash">{a.sha256 || a.hash || "—"}</code>
                      <small>
                        {a.runId || a.jobId || a.sourceId || "—"} · r
                        {a.sourceRevision ?? a.revision}
                      </small>
                    </td>
                    <td>
                      <a className="button" href={downloadUrl(a.id)} download>
                        <Download size={15} />
                        {t("ดาวน์โหลด", "Download")}
                      </a>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function Monitoring(props) {
  const { t, state, projectId } = props,
    runs = scoped(state, "runs", projectId),
    jobs = scoped(state, "jobs", projectId);
  return (
    <>
      <Heading
        title={t("Monitor · ติดตามการทำงาน", "Monitor")}
        description={t(
          "แสดงสถานะที่บันทึกไว้ ไม่มีการประมาณความสำเร็จหรือสร้างตัวเลขฝึกโมเดล",
          "Persisted observations only. No inferred completion or synthetic training metrics.",
        )}
      />
      <div className="monitor-summary">
        <div>
          <strong>{runs.length}</strong>
          <span>{t("การรันของ agent", "Agent runs")}</span>
        </div>
        <div>
          <strong>{jobs.length}</strong>
          <span>{t("งานประมวลผล", "Compute jobs")}</span>
        </div>
        <div>
          <strong>{scoped(state, "artifacts", projectId).length}</strong>
          <span>{t("ไฟล์ที่ลงทะเบียน", "Registered artifacts")}</span>
        </div>
      </div>
      <h2>{t("การทำงานผ่าน T3", "T3 execution")}</h2>
      {!runs.length && (
        <Empty>
          {t(
            "ยังไม่มีการรัน เริ่มจากรายละเอียดงาน",
            "No runs yet. Start from a task detail.",
          )}
        </Empty>
      )}
      {[...runs].reverse().map((r) => (
        <Run key={r.id} {...props} runRecord={r} />
      ))}
      <h2>{t("งานประมวลผลและรายงาน", "Compute & report jobs")}</h2>
      {!jobs.length && <Empty>{t("ยังไม่มีงานประมวลผล", "No jobs yet.")}</Empty>}
      {[...jobs].reverse().map((j) => (
        <article className="run" key={j.id}>
          <div className="record-head">
            <strong>{j.name || j.id}</strong>
            <Badge>{j.status}</Badge>
          </div>
          <p>
            {j.kind || j.type || "job"} · {date(j.updatedAt)} ·{" "}
            {t("เวอร์ชันต้นทาง", "Source revision")}{" "}
            {j.sourceRevision ?? j.notebookRevision ?? "—"}
          </p>
          {j.error && (
            <p className="error-text">
              {typeof j.error === "string" ? j.error : j.error.message}
            </p>
          )}
          {j.metrics ? (
            <details>
              <summary>
                {t("ตัวชี้วัดที่ job ส่งมา", "Metrics emitted by job")}
              </summary>
              <Json value={j.metrics} />
            </details>
          ) : (
            <p className="help">
              {t("งานนี้ยังไม่ส่งตัวชี้วัด", "No measured metrics emitted by this job.")}
            </p>
          )}
          <details>
            <summary>{t("ข้อมูลแหล่งที่มาและ log", "Provenance & logs")}</summary>
            <Json
              value={{
                id: j.id,
                notebookId: j.notebookId,
                reportId: j.reportId,
                engine: j.engine,
                logs: j.logs,
                outputs: j.outputs,
                artifactIds: j.artifactIds,
              }}
            />
          </details>
        </article>
      ))}
    </>
  );
}

export function SettingsPage({
  t,
  state,
  projectId,
  project,
  mutate,
  run,
  busy,
  health,
}) {
  const connections = (state.connections || []).filter(
    (c) => !c.projectId || c.projectId === projectId,
  );
  const [selected, setSelected] = useState(""),
    [result, setResult] = useState(null),
    [tab, setTab] = useState("project");
  const connection = connections.find((c) => c.id === selected),
    profile = project.profile || {};
  const [projectBase, acceptProject] = useRevisionForm(project);
  const [connectionBase, acceptConnection] = useRevisionForm(connection);
  const [profileDraft, setProfileDraft] = useState(profile),
    [backup, setBackup] = useState(null);
  return (
    <>
      <Heading
        title={t("Settings · ตั้งค่าโครงการ", "Project settings")}
        description={t(
          "โปรไฟล์แต่ละโครงการแยกอิสระ การเชื่อมต่อพร้อมใช้ต้องผ่านการตรวจจริง",
          "Each project has an independent profile. Saved configuration does not establish readiness.",
        )}
      />
      <div className="tabs section-tabs">
        {[
          ["project", "โครงการ", "Project"],
          ["connections", "การเชื่อมต่อ", "Connections"],
          ["recovery", "สำรองและสถานะระบบ", "Recovery & health"],
        ].map(([id, th, en]) => (
          <button
            className={tab === id ? "selected" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            {t(th, en)}
          </button>
        ))}
      </div>
      {tab === "project" && (
        <>
          <form
            className="panel"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              const saved = await mutate(
                "project.update",
                {
                  name: d.get("name"),
                  workspace: d.get("workspace"),
                  description: d.get("description"),
                  profile: profileDraft,
                },
                projectBase,
              );
              if (saved) acceptProject(saved.entity);
            }}
          >
            <h2>{t("พื้นที่ทำงาน", "Workspace")}</h2>
            <div className="form-grid">
              <Field label={t("ชื่อโครงการ", "Project name")}>
                <input required name="name" defaultValue={project.name} />
              </Field>
              <Field label={t("โฟลเดอร์งาน", "Workspace directory")}>
                <input
                  required
                  name="workspace"
                  defaultValue={project.workspace}
                />
              </Field>
            </div>
            <Field label={t("เป้าหมาย", "Goal")}>
              <textarea name="description" defaultValue={project.description} />
            </Field>
            <h2>{t("โปรไฟล์การทำงาน", "Execution profile")}</h2>
            <ProviderProfile
              t={t}
              run={run}
              profile={profileDraft}
              setProfile={setProfileDraft}
            />
            <div className="form-grid">
              {["serving", "storage", "mcp", "desktop"].map((key) => (
                <Field key={key} label={key}>
                  <select
                    value={
                      key === "mcp"
                        ? profileDraft.mcp?.[0] || ""
                        : profileDraft[key]?.connectionId || ""
                    }
                    onChange={(e) =>
                      setProfileDraft((s) => ({
                        ...s,
                        [key]:
                          key === "mcp"
                            ? e.target.value
                              ? [e.target.value]
                              : []
                            : {
                                ...(s[key] || {}),
                                connectionId: e.target.value,
                              },
                      }))
                    }
                  >
                    <option value="">{t("ยังไม่เลือก", "Not selected")}</option>
                    {connections.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name} · {c.kind || c.type}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
            <details>
              <summary>
                {t(
                  "ขั้นสูง: ขีดจำกัดและค่า override รายขั้นตอน",
                  "Advanced: limits & phase overrides",
                )}
              </summary>
              <ProfileJson
                name="limits"
                label="Limits"
                draft={profileDraft}
                setDraft={setProfileDraft}
              />
              <ProfileJson
                name="phaseOverrides"
                label="Phase overrides"
                draft={profileDraft}
                setDraft={setProfileDraft}
              />
            </details>
            <Submit busy={busy}>
              {t("บันทึกโครงการและโปรไฟล์", "Save project & profile")}
            </Submit>
          </form>
        </>
      )}
      {tab === "connections" && (
        <div className="split">
          <section className="panel">
            <button
              onClick={() => {
                setSelected("");
                setResult(null);
              }}
            >
              {t("+ เพิ่มการเชื่อมต่อ", "+ Add connection")}
            </button>
            <Collection
              items={connections}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                setResult(null);
              }}
              subtitle={(c) =>
                `${c.kind || c.type || "connection"} · ${c.status || c.readiness || "unchecked"}`
              }
            />
          </section>
          <section className="panel">
            <form
              key={selected || "new"}
              onSubmit={async (e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                const config = {
                  ...(connection?.config || {}),
                  url: d.get("url"),
                  command: d.get("command"),
                  args: d.get("args")?.split("\n").filter(Boolean),
                  model: d.get("model"),
                  secretRef: d.get("secretRef"),
                };
                const r = await mutate(
                  connection ? "connection.update" : "connection.create",
                  {
                    name: d.get("name"),
                    kind: d.get("kind"),
                    route: d.get("route"),
                    url: d.get("url") || undefined,
                    command: d.get("command") || undefined,
                    args: d.get("args")?.split("\n").filter(Boolean),
                    enabled: d.get("enabled") === "on",
                    config,
                  },
                  connectionBase,
                );
                if (r) {
                  acceptConnection(r.entity);
                  setSelected(r.entity.id);
                }
              }}
            >
              <h2>
                {connection
                  ? t("แก้ไขการเชื่อมต่อ", "Edit connection")
                  : t("การเชื่อมต่อใหม่", "New connection")}
              </h2>
              <Field label={t("ชื่อ", "Name")}>
                <input
                  name="name"
                  required
                  defaultValue={connection?.name || ""}
                />
              </Field>
              <div className="form-grid">
                <Field label={t("ประเภท", "Kind")}>
                  <select name="kind" defaultValue={connection?.kind || "mcp"}>
                    {[
                      "provider",
                      "compute",
                      "serving",
                      "storage",
                      "tracker",
                      "mcp",
                      "desktop",
                    ].map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={t("Adapter ที่บริการรองรับ", "Service-supported adapter")}
                >
                  <input
                    name="adapter"
                    required
                    defaultValue={connection?.adapter || ""}
                    list="adapter-names"
                  />
                  <datalist id="adapter-names">
                    {[
                      "mcp-stdio",
                      "mcp-http",
                      "litserve",
                      "local",
                      "git",
                      "drive",
                      "codex",
                      "claude",
                      "gemini",
                      "openrouter",
                    ].map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </datalist>
                </Field>
              </div>
              <Field label={t("URL (เมื่อใช้ HTTP)", "URL (HTTP transport)")}>
                <input
                  name="url"
                  type="url"
                  defaultValue={connection?.url || ""}
                />
              </Field>
              <Field
                label={t(
                  "อ้างอิง credential ที่จัดเก็บในเครื่อง",
                  "Local credential reference",
                )}
                hint={t(
                  "อย่าป้อนรหัสลับลงในฟอร์มนี้",
                  "Do not enter secret values in this form.",
                )}
              >
                <input
                  name="secretRef"
                  defaultValue={connection?.config?.secretRef || ""}
                />
              </Field>
              <details>
                <summary>
                  {t(
                    "ขั้นสูง: executable และโมเดล",
                    "Advanced: executable & model",
                  )}
                </summary>
                <Field label="Command">
                  <input
                    name="command"
                    defaultValue={connection?.command || ""}
                  />
                </Field>
                <Field
                  label={t(
                    "Arguments (หนึ่งค่าต่อบรรทัด)",
                    "Arguments (one per line)",
                  )}
                >
                  <textarea
                    name="args"
                    defaultValue={(connection?.args || []).join("\n")}
                  />
                </Field>
                <Field label="Exact model ID">
                  <input
                    name="model"
                    defaultValue={connection?.config?.model || ""}
                  />
                </Field>
              </details>
              <label className="check">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={connection?.enabled ?? true}
                />
                {t("เปิดใช้ในโครงการ", "Enable in project")}
              </label>
              <Submit busy={busy}>
                {t("บันทึกการเชื่อมต่อ", "Save connection")}
              </Submit>
            </form>
            {connection && (
              <>
                <hr />
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await request(
                          `/api/connections/${encodeURIComponent(connection.id)}/check`,
                          {},
                        );
                        setResult(r);
                        return r;
                      })
                    }
                  >
                    {t("ตรวจการเชื่อมต่อจริง", "Check connection")}
                  </button>
                  {connection.kind === "mcp" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const r = await request(
                            `/api/mcp/${encodeURIComponent(connection.id)}/discover`,
                            {},
                          );
                          setResult(r);
                          return r;
                        })
                      }
                    >
                      {t("ค้นหาเครื่องมือ MCP", "Discover MCP tools")}
                    </button>
                  )}
                </div>
                <p className="help">
                  {t(
                    "การบันทึกฟอร์มไม่ยืนยันสิทธิ์หรือความพร้อม ดูผลตรวจและความสามารถที่ค้นพบด้านล่าง",
                    "Saving does not confirm access or readiness. Inspect actual checks and discovered capabilities below.",
                  )}
                </p>
                {result && <Json value={result} />}
                <details>
                  <summary>
                    {t("ความสามารถและหลักฐาน", "Capabilities & evidence")}
                  </summary>
                  <Json
                    value={{
                      capabilities: connection.capabilities,
                      readiness: connection.readiness,
                      lastCheck: connection.lastCheck,
                      tools: connection.lastCheck?.capabilities,
                    }}
                  />
                </details>
                {connection.kind === "mcp" && (
                  <McpCall
                    connection={connection}
                    t={t}
                    run={run}
                    busy={busy}
                  />
                )}
              </>
            )}
          </section>
        </div>
      )}
      {tab === "recovery" && (
        <div className="panel">
          <h2>{t("สถานะบริการในเครื่อง", "Local service health")}</h2>
          <Json value={health || { status: "unavailable" }} />
          <h2>{t("สำรองข้อมูล", "Backup")}</h2>
          <p>
            {t(
              "การสำรองและกู้คืนต้องผ่านบริการและตรวจข้อมูลจริง เก็บพาธสำรองที่บริการส่งกลับ",
              "Backup and restore are verified by the service. Keep the returned backup location.",
            )}
          </p>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await request("/api/storage/backup", { projectId });
                setBackup(r);
                return r;
              })
            }
          >
            {t("สร้างข้อมูลสำรอง", "Create backup")}
          </button>
          {backup && <Json value={backup} />}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              run(() =>
                request("/api/storage/restore", {
                  id: d.get("id"),
                  expectedRevision: state.revision,
                }),
              );
            }}
          >
            <Field label={t("พาธข้อมูลสำรองที่ตรวจแล้ว", "Verified backup ID")}>
              <input required name="id" />
            </Field>
            <button disabled={busy} type="submit">
              {t("กู้คืนข้อมูลสำรอง", "Restore backup")}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
function ProfileJson({ label, name, draft, setDraft }) {
  return (
    <Field label={label}>
      <textarea
        rows={4}
        defaultValue={JSON.stringify(draft[name] || {}, null, 2)}
        onChange={(e) => {
          try {
            const v = JSON.parse(e.target.value);
            if (!v || Array.isArray(v) || typeof v !== "object")
              throw new Error();
            e.target.setCustomValidity("");
            setDraft((s) => ({ ...s, [name]: v }));
          } catch {
            e.target.setCustomValidity("Enter a JSON object.");
          }
        }}
      />
    </Field>
  );
}
function ProviderProfile({ t, run, profile, setProfile }) {
  const [catalog, setCatalog] = useState(null);
  const provider = profile.provider || {};
  const set = (patch) =>
    setProfile((s) => ({ ...s, provider: { ...s.provider, ...patch } }));
  return (
    <>
      <div className="form-grid">
        <Field
          label={t(
            "Provider instance ID จาก T3",
            "Provider instance ID from T3",
          )}
        >
          <input
            value={provider.instanceId || ""}
            onChange={(e) => set({ instanceId: e.target.value })}
          />
        </Field>
        <Field label={t("โมเดลที่ T3 รองรับ", "T3-supported model ID")}>
          <input
            value={provider.model || ""}
            onChange={(e) => set({ model: e.target.value })}
          />
        </Field>
        <Field
          label={t("Compute ที่รองรับในรุ่นนี้", "Compute implemented in this build")}
        >
          <select
            value="local"
            onChange={() =>
              setProfile((s) => ({ ...s, compute: { kind: "local" } }))
            }
          >
            <option value="local">Local Windows · Python</option>
          </select>
        </Field>
      </div>
      <p className="help">
        {t(
          "กำหนดบัญชีและตรวจโมเดลในพื้นที่ T3 อิสระ การเลือกค่าไม่ยืนยันว่าบัญชีเรียกโมเดลได้จริง",
          "Configure the account and verify models in the independent T3 surface. Selection does not establish successful provider execution.",
        )}
      </p>
      <button
        type="button"
        onClick={() =>
          run(async () => {
            const r = await request("/api/t3/catalog", {});
            setCatalog(r);
            return r;
          })
        }
      >
        {t("โหลด catalog จริงจาก T3", "Read actual T3 catalog")}
      </button>
      {catalog && (
        <details open>
          <summary>
            {t("Catalog และ options ที่ค้นพบ", "Discovered catalog & options")}
          </summary>
          <Json value={catalog} />
        </details>
      )}
      <details>
        <summary>
          {t(
            "ขั้นสูง: provider options ตาม catalog",
            "Advanced: provider options from catalog",
          )}
        </summary>
        <Field label="Options array">
          <textarea
            defaultValue={JSON.stringify(provider.options || [], null, 2)}
            onChange={(e) => {
              try {
                const options = JSON.parse(e.target.value);
                if (!Array.isArray(options)) throw new Error();
                e.target.setCustomValidity("");
                set({ options });
              } catch {
                e.target.setCustomValidity(
                  "Enter an array of catalog-supported options.",
                );
              }
            }}
          />
        </Field>
      </details>
    </>
  );
}
function McpCall({ connection, t, run, busy }) {
  const [result, setResult] = useState(null);
  return (
    <details>
      <summary>{t("เรียกเครื่องมือที่ค้นพบ", "Call a discovered tool")}</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          run(async () => {
            const args = JSON.parse(d.get("args"));
            const r = await request(
              `/api/mcp/${encodeURIComponent(connection.id)}/call`,
              {
                operationId: operationId(),
                projectId: connection.projectId,
                name: d.get("name"),
                arguments: args,
              },
            );
            setResult(r);
            return r;
          });
        }}
      >
        <Field label="Tool name">
          <input required name="name" list="mcp-tools" />
          <datalist id="mcp-tools">
            {(connection.lastCheck?.capabilities || []).map((tool) => (
              <option key={tool.name}>{tool.name}</option>
            ))}
          </datalist>
        </Field>
        <Field
          label={t(
            "Arguments (JSON ตาม schema เครื่องมือ)",
            "Arguments (JSON matching tool schema)",
          )}
        >
          <textarea required name="args" defaultValue="{}" />
        </Field>
        <button disabled={busy}>{t("เรียกเครื่องมือ", "Call tool")}</button>
      </form>
      {result && <Json value={result} />}
    </details>
  );
}
