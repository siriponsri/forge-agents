import React, { useEffect, useRef, useState } from "react";
import { Play, Square, ExternalLink } from "lucide-react";
import { date, operationId, request, runEvents, scoped } from "./api.mjs";
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

export function Team({ t, state, projectId, mutate, busy }) {
  const bots = scoped(state, "bots", projectId),
    [selected, setSelected] = useState("");
  const bot = bots.find((b) => b.id === selected);
  const [botBase, acceptBot] = useRevisionForm(bot);
  return (
    <>
      <Heading
        title={t("Bot team · ทีมประจำ", "Bot team")}
        description={t(
          "ตัวตนและหน้าที่บอทคงอยู่ข้ามงาน บอทผู้ช่วยผูกกับงานที่ระบุ",
          "Resident identities persist across tasks. Helpers are scoped to an assigned task.",
        )}
      />
      <div className="split">
        <section className="panel">
          <button onClick={() => setSelected("")}>
            {t("+ เพิ่มบอท", "+ Add bot")}
          </button>
          <Collection
            items={bots}
            selected={selected}
            onSelect={setSelected}
            subtitle={(b) => `${b.kind || "resident"} · ${b.role || "—"}`}
          />
          {!bots.length && (
            <Empty>
              {t(
                "ยังไม่มีบอท ตั้งชื่อและกำหนดหน้าที่ให้ทีมของคุณ",
                "No bots yet. Name a bot and assign its role.",
              )}
            </Empty>
          )}
        </section>
        <section className="panel">
          <h2>
            {bot
              ? t("แก้ไขสมาชิก", "Edit team member")
              : t("สมาชิกใหม่", "New member")}
          </h2>
          <form
            key={bot?.id || "new"}
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              const result = await mutate(
                bot ? "bot.update" : "bot.create",
                {
                  name: d.get("name"),
                  role: d.get("role"),
                  kind: d.get("kind"),
                  taskId: d.get("taskId") || undefined,
                  instructions: d.get("instructions"),
                },
                botBase,
              );
              if (result) {
                acceptBot(result.entity);
                setSelected(result.entity.id);
              }
            }}
          >
            <Field label={t("ชื่อบอท", "Bot name")}>
              <input name="name" required defaultValue={bot?.name || ""} />
            </Field>
            <Field label={t("หน้าที่", "Role")}>
              <input name="role" required defaultValue={bot?.role || ""} />
            </Field>
            <Field label={t("ประเภท", "Membership")}>
              <select name="kind" defaultValue={bot?.kind || "resident"}>
                <option value="resident">{t("ประจำทีม", "Resident")}</option>
                <option value="helper">
                  {t("ผู้ช่วยเฉพาะงาน", "Task helper")}
                </option>
              </select>
            </Field>
            <Field
              label={t(
                "งานที่รับผิดชอบ (สำหรับผู้ช่วย)",
                "Assigned task (for helpers)",
              )}
            >
              <select name="taskId" defaultValue={bot?.taskId || ""}>
                <option value="">—</option>
                {scoped(state, "tasks", projectId).map((task) => (
                  <option value={task.id} key={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("คำแนะนำและบริบท", "Instructions & context")}>
              <textarea
                name="instructions"
                rows={6}
                defaultValue={bot?.instructions || ""}
              />
            </Field>
            <Submit busy={busy}>{t("บันทึกสมาชิก", "Save member")}</Submit>
          </form>
        </section>
      </div>
    </>
  );
}

export function Chat({ t, state, projectId, mutate, busy }) {
  const rooms = scoped(state, "conversations", projectId),
    bots = scoped(state, "bots", projectId);
  const [selected, setSelected] = useState(""),
    [draft, setDraft] = useState("");
  const room = rooms.find((r) => r.id === selected) || rooms[0];
  return (
    <>
      <Heading
        title={t("Conversations · ห้องสนทนา", "Conversations")}
        description={t(
          "ข้อความในเครื่อง ไม่มีการสร้างคำตอบบอทอัตโนมัติ เรียกใช้งานจริงจากแผนงานหรือพื้นที่ T3",
          "Local message history. Execute tasks from the plan or T3 coding surface.",
        )}
      />
      <div className="split chat-layout">
        <section className="panel">
          <Collection
            items={rooms}
            selected={room?.id}
            onSelect={(id) => {
              setSelected(id);
              setDraft("");
            }}
            title={(r) =>
              r.name ||
              (r.kind === "private"
                ? bots.find((b) => b.id === r.botId)?.name || "Private"
                : "Team")
            }
            subtitle={(r) => r.kind}
          />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              const botId = d.get("botId");
              const result = await mutate("conversation.create", {
                name: d.get("name"),
                kind: botId ? "private" : "team",
                ...(botId ? { botId } : {}),
                messages: [],
              });
              if (result) setSelected(result.entity.id);
            }}
          >
            <h3>{t("เปิดห้องใหม่", "New conversation")}</h3>
            <Field label={t("ชื่อห้อง", "Room name")}>
              <input name="name" required />
            </Field>
            <Field label={t("ผู้รับ", "Audience")}>
              <select name="botId">
                <option value="">{t("ทั้งทีม", "Team room")}</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {t("ส่วนตัว", "private")}
                  </option>
                ))}
              </select>
            </Field>
            <Submit busy={busy}>{t("สร้างห้อง", "Create room")}</Submit>
          </form>
        </section>
        <section className="panel conversation">
          <h2>{room?.name || t("เลือกห้องสนทนา", "Choose a conversation")}</h2>
          <div className="messages" aria-live="polite">
            {room?.messages?.map((m, i) => (
              <article
                className={`message ${m.role === "user" ? "user" : ""}`}
                key={m.id || i}
              >
                <div className="message-meta">
                  {m.role || "user"} · {date(m.createdAt || m.timestamp)}
                </div>
                <p>{m.text || m.content}</p>
              </article>
            ))}
            {!room?.messages?.length && (
              <Empty>
                {t("ยังไม่มีข้อความในห้องนี้", "No messages in this conversation.")}
              </Empty>
            )}
          </div>
          {room && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                const r = await mutate(
                  "message.send",
                  { conversationId: room.id, text: draft, role: "user" },
                  room,
                );
                if (r) setDraft("");
              }}
            >
              <Field label={t("ข้อความ", "Message")}>
                <textarea
                  required
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                />
              </Field>
              <Submit busy={busy}>{t("ส่งข้อความ", "Send message")}</Submit>
            </form>
          )}
        </section>
      </div>
    </>
  );
}

const statuses = ["backlog", "ready", "running", "blocked", "review", "done"];
const statusTh = {
  backlog: "รายการรอ",
  ready: "พร้อม",
  running: "กำลังทำ",
  blocked: "ติดขัด",
  review: "ตรวจทาน",
  done: "เสร็จพร้อมหลักฐาน",
};
export function Planning(props) {
  const { t, state, projectId, mutate, busy, run } = props;
  const plans = scoped(state, "plans", projectId),
    phases = scoped(state, "phases", projectId),
    tasks = scoped(state, "tasks", projectId),
    bots = scoped(state, "bots", projectId);
  const [planId, setPlanId] = useState(""),
    [view, setView] = useState("canvas"),
    [taskId, setTaskId] = useState(null),
    [newPlan, setNewPlan] = useState(false),
    [newPhase, setNewPhase] = useState(false);
  const plan = plans.find((p) => p.id === planId) || plans[0],
    visible = tasks.filter((task) => task.planId === plan?.id),
    phaseList = phases.filter((p) => p.planId === plan?.id);
  const task = tasks.find((item) => item.id === taskId);
  const [taskBase, acceptTask] = useRevisionForm(task);
  const card = (task) => (
    <button
      className="task-card"
      key={task.id}
      onClick={() => setTaskId(task.id)}
    >
      <span className="task-ref">
        {task.id.slice(0, 8)} ·{" "}
        {bots.find((b) => b.id === task.botId)?.name ||
          t("ยังไม่มอบหมาย", "Unassigned")}
      </span>
      <strong>{task.title}</strong>
      <Badge>{task.status}</Badge>
      {task.dependsOn?.length > 0 && (
        <small>
          {t("รอ / เชื่อมกับ", "Depends on")}{" "}
          {task.dependsOn
            .map((id) => tasks.find((t) => t.id === id)?.title || id)
            .join(", ")}
        </small>
      )}
      <small>
        {task.runIds?.length || 0} runs · {task.artifactIds?.length || 0}{" "}
        artifacts · {task.evidence?.length || 0} evidence
      </small>
    </button>
  );
  return (
    <>
      <Heading
        title={t("Plan & tasks · แผนงาน", "Plan & tasks")}
        description={t(
          "วางภาพรวมก่อนเริ่มงาน ทุกมุมมองใช้แผน ขั้นตอน และงานชุดเดียวกัน",
          "Plan before execution. Canvas, board and task details share the same records.",
        )}
      >
        <button onClick={() => setNewPlan(!newPlan)}>
          {t("+ สร้างแผน", "+ Create plan")}
        </button>
      </Heading>
      {newPlan && (
        <form
          className="panel inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            const r = await mutate("plan.create", {
              name: d.get("name"),
              title: d.get("name"),
              description: d.get("description"),
            });
            if (r) {
              setPlanId(r.entity.id);
              setNewPlan(false);
            }
          }}
        >
          <Field label={t("ชื่อแผน", "Plan name")}>
            <input name="name" required />
          </Field>
          <Field label={t("เป้าหมายและเกณฑ์รับงาน", "Goal & acceptance")}>
            <textarea name="description" rows={2} />
          </Field>
          <Submit busy={busy}>{t("บันทึกแผน", "Save plan")}</Submit>
        </form>
      )}
      {!plan ? (
        <Empty>
          {t(
            "ยังไม่มีแผน สร้างภาพรวมก่อนเพิ่มงาน",
            "No plan yet. Create the plan before adding tasks.",
          )}
        </Empty>
      ) : (
        <>
          <div className="toolbar">
            <select
              aria-label={t("แผนงาน", "Plan")}
              value={plan.id}
              onChange={(e) => setPlanId(e.target.value)}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.title}
                </option>
              ))}
            </select>
            <div className="tabs">
              {["canvas", "board", "list"].map((v) => (
                <button
                  key={v}
                  className={view === v ? "selected" : ""}
                  onClick={() => setView(v)}
                >
                  {v === "canvas"
                    ? "Canvas"
                    : v === "board"
                      ? "Kanban"
                      : t("รายการ", "List")}
                </button>
              ))}
            </div>
            <button onClick={() => setNewPhase(!newPhase)}>
              {t("+ ขั้นตอน", "+ Phase")}
            </button>
            <button className="primary" onClick={() => setTaskId("new")}>
              {t("+ งาน", "+ Task")}
            </button>
          </div>
          <p className="plan-description">{plan.description}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={!!plan.approved}
              disabled={busy}
              onChange={(e) =>
                mutate("plan.update", { approved: e.target.checked }, plan)
              }
            />
            {t(
              "ตรวจทานและอนุมัติแผนก่อนเริ่มงาน",
              "Reviewed and approved for execution",
            )}
          </label>
          {newPhase && (
            <form
              className="panel inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                if (
                  await mutate("phase.create", {
                    planId: plan.id,
                    name: d.get("name"),
                    title: d.get("name"),
                    order: phaseList.length,
                  })
                )
                  setNewPhase(false);
              }}
            >
              <Field label={t("ชื่อขั้นตอน", "Phase name")}>
                <input name="name" required />
              </Field>
              <Submit busy={busy}>{t("เพิ่มขั้นตอน", "Add phase")}</Submit>
            </form>
          )}
          {view === "canvas" && (
            <div className="plan-canvas">
              {[
                ...phaseList,
                { id: "", name: t("ยังไม่จัดขั้นตอน", "Unphased") },
              ].map((phase, i) => (
                <section className="phase" key={phase.id}>
                  <header>
                    <span className="phase-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h2>{phase.name || phase.title}</h2>
                      <small>
                        {
                          visible.filter(
                            (task) => (task.phaseId || "") === phase.id,
                          ).length
                        }{" "}
                        {t("งาน", "tasks")}
                      </small>
                    </div>
                  </header>
                  <div className="phase-tasks">
                    {visible
                      .filter((task) => (task.phaseId || "") === phase.id)
                      .map(card)}
                  </div>
                </section>
              ))}
            </div>
          )}
          {view === "board" && (
            <div className="kanban">
              {statuses.map((status) => (
                <section key={status} className="kanban-column">
                  <h2>
                    {t(statusTh[status], status)}{" "}
                    <span>
                      {visible.filter((task) => task.status === status).length}
                    </span>
                  </h2>
                  {visible.filter((task) => task.status === status).map(card)}
                </section>
              ))}
            </div>
          )}
          {view === "list" && (
            <div className="task-list">{visible.map(card)}</div>
          )}
          {!visible.length && (
            <Empty>
              {t(
                "เพิ่มงานและหลักฐานที่ต้องตรวจให้แผนนี้",
                "Add tasks and acceptance evidence to this plan.",
              )}
            </Empty>
          )}
        </>
      )}
      {taskId && (
        <div className="modal-backdrop">
          <section
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-title"
          >
            <Heading
              title={
                <span id="task-title">
                  {task
                    ? t("รายละเอียดงาน", "Task detail")
                    : t("เพิ่มงาน", "Add task")}
                </span>
              }
              description={task?.id || plan?.name}
            >
              <button onClick={() => setTaskId(null)}>
                {t("ปิด", "Close")}
              </button>
            </Heading>
            <form
              key={task?.id || "new"}
              onSubmit={async (e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                const evidence = d
                  .get("evidence")
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (d.get("status") === "done" && !evidence.length) {
                  e.currentTarget
                    .querySelector("[name=evidence]")
                    .setCustomValidity(
                      t(
                        "ต้องมีหลักฐานก่อนปิดงาน",
                        "Evidence is required before completion.",
                      ),
                    );
                  e.currentTarget.reportValidity();
                  return;
                }
                const r = await mutate(
                  task ? "task.update" : "task.create",
                  {
                    title: d.get("title"),
                    description: d.get("description"),
                    status: d.get("status"),
                    planId: plan?.id,
                    phaseId: d.get("phaseId"),
                    botId: d.get("botId"),
                    dependsOn: d.getAll("dependsOn"),
                    evidence,
                    threadId: d.get("threadId") || undefined,
                  },
                  taskBase,
                );
                if (r) {
                  acceptTask(r.entity);
                  setTaskId(r.entity.id);
                }
              }}
            >
              <div className="form-grid">
                <Field label={t("ชื่องาน", "Task title")}>
                  <input
                    name="title"
                    required
                    defaultValue={task?.title || ""}
                  />
                </Field>
                <Field label={t("สถานะ", "Status")}>
                  <select
                    name="status"
                    defaultValue={task?.status || "backlog"}
                  >
                    {statuses.map((s) => (
                      <option value={s} key={s}>
                        {t(statusTh[s], s)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("ขั้นตอน", "Phase")}>
                  <select name="phaseId" defaultValue={task?.phaseId || ""}>
                    <option value="">—</option>
                    {phaseList.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name || p.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("ผู้รับผิดชอบ", "Owner bot")}>
                  <select name="botId" defaultValue={task?.botId || ""}>
                    <option value="">—</option>
                    {bots.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field
                label={t("รายละเอียด / เกณฑ์ตรวจ", "Description / acceptance")}
              >
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={task?.description || ""}
                />
              </Field>
              <Field
                label={t(
                  "ต้องทำหลังงาน (เลือกหลายรายการด้วย Ctrl)",
                  "Dependencies (Ctrl to select multiple)",
                )}
              >
                <select
                  name="dependsOn"
                  multiple
                  defaultValue={task?.dependsOn || []}
                >
                  {tasks
                    .filter((t) => t.id !== task?.id)
                    .map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </Field>
              <p className="help">
                T3 thread:{" "}
                {task?.threadId ||
                  t(
                    "บริการจะผูกเมื่อเริ่มงาน",
                    "Assigned by the service on execution",
                  )}
              </p>
              <Field
                label={t(
                  "หลักฐานตรวจรับ (หนึ่งรายการต่อบรรทัด)",
                  "Acceptance evidence (one per line)",
                )}
              >
                <textarea
                  name="evidence"
                  rows={3}
                  onChange={(e) => e.target.setCustomValidity("")}
                  defaultValue={(task?.evidence || [])
                    .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
                    .join("\n")}
                />
              </Field>
              <Submit busy={busy}>{t("บันทึกงาน", "Save task")}</Submit>
            </form>
            {task && (
              <>
                <hr />
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        request("/api/runs/start", {
                          operationId: operationId(),
                          projectId,
                          taskId: task.id,
                        }),
                      )
                    }
                  >
                    <Play size={16} />
                    {t("เริ่มงานผ่าน T3", "Start through T3")}
                  </button>
                </div>
                <p className="help">
                  {t(
                    "ต้องลงทะเบียนพื้นที่ทำงานและผูก thread ใน T3 ก่อนเริ่ม การเปลี่ยนสถานะการ์ดไม่ใช่หลักฐานว่างานสำเร็จ",
                    "Register the workspace and bind a thread in T3 first. Moving a card does not prove successful execution.",
                  )}
                </p>
                {scoped(state, "runs", projectId)
                  .filter((r) => r.taskId === task.id)
                  .map((r) => (
                    <Run key={r.id} runRecord={r} {...props} />
                  ))}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

export function Run({ runRecord: r, t, run, busy }) {
  const [events, setEvents] = useState(null);
  const [live,setLive]=useState(false),[recovery,setRecovery]=useState(null),stream=useRef(null),cursor=useRef(0);
  useEffect(()=>()=>stream.current?.close(),[r.id]);
  const watch=()=>{stream.current?.close();if(cursor.current===0)setEvents([]);setLive(true);const source=new EventSource(`/api/runs/${encodeURIComponent(r.id)}/stream?afterSequence=${cursor.current}`);stream.current=source;
    source.addEventListener('agui',message=>{const record=JSON.parse(message.data);if(record.sequence<=cursor.current)return;cursor.current=record.sequence;setEvents(rows=>[...(rows??[]),record.event]);});
    source.onerror=()=>{source.close();setLive(false);};
  };
  return (
    <article className="run">
      <div className="record-head">
        <strong>{r.id}</strong>
        <Badge>{r.status}</Badge>
      </div>
      <p>
        {t("งาน", "Task")} {r.taskId || "—"} · {t("บอท", "Bot")}{" "}
        {r.botId || "—"} · thread {r.threadId || "—"}
      </p>
      <small>
        {date(r.createdAt)} · {t("โปรไฟล์", "Profile")} r
        {r.profileRevision ?? "—"}
      </small>
      <p>{t('การสังเกต','Observation')}: {r.connection?.status??'not connected'}{r.stopRequest&&<> · {t('คำขอหยุด','Stop request')}: {r.stopRequest.status}</>}</p>
      {r.error && (
        <p className="error-text">
          {typeof r.error === "string" ? r.error : r.error.message}
        </p>
      )}
      <div className="actions">
        <button disabled={live} onClick={watch}>{t('ดูเหตุการณ์สด','Watch live events')}</button>
        <button disabled={busy} onClick={()=>run(async()=>{stream.current?.close();setLive(false);return request(`/api/runs/${r.id}/disconnect`,{});})}>{t('ตัดการสังเกต (ไม่หยุดงาน)','Detach observation (keeps execution)')}</button>
        <button disabled={busy} onClick={()=>run(async()=>{const result=await request(`/api/runs/${r.id}/reconnect`,{});watch();return result;})}>{t('เชื่อมการสังเกตเดิมอีกครั้ง','Reconnect existing observation')}</button>
        <button onClick={()=>run(async()=>{const result=await request(`/api/runs/${r.id}/recovery`);setRecovery(result);return result;})}>{t('ตรวจ snapshot สำหรับกู้คืน','Read recovery snapshot')}</button>
        <button
          disabled={busy}
          onClick={() =>
            run(() =>
              request(`/api/runs/${encodeURIComponent(r.id)}/reconcile`, {}),
            )
          }
        >
          {t("ตรวจสถานะจริง", "Reconcile status")}
        </button>
        <button
          disabled={busy}
          onClick={() =>
            run(() =>
              request(`/api/runs/${encodeURIComponent(r.id)}/stop`, {
                operationId: operationId(),
              }),
            )
          }
        >
          <Square size={14} />
          {t("ขอหยุด", "Request stop")}
        </button>
        <button
          onClick={() =>
            run(async () => {
              const result = await runEvents(r.id);
              stream.current?.close();setLive(false);cursor.current=0;
              setEvents(Array.isArray(result) ? result : result.events || []);
              return result;
            })
          }
        >
          {t("เหตุการณ์ที่บันทึก", "Recorded events")}
        </button>
        {r.url && (
          <a href={r.url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            T3
          </a>
        )}
      </div>
      {recovery&&<details open><summary>{t('Snapshot จากข้อมูลที่บันทึก','Persisted recovery snapshot')}</summary><Json value={recovery}/></details>}
      {r.protocolMessages?.filter(message=>message.role==='assistant').map(message=><p className="message" key={message.id} style={{whiteSpace:'pre-wrap'}}>{typeof message.content==='string'?message.content:''}</p>)}
      {Object.values(r.toolObservations??{}).map(tool=><div className="run" key={tool.id??tool.toolCallId}><strong>{tool.name??tool.toolCallName??tool.id}</strong> <Badge>{tool.status??'observed'}</Badge><details><summary>{t('อาร์กิวเมนต์และผลที่สังเกตได้','Observed arguments & result')}</summary><Json value={tool}/></details></div>)}
      {r.pendingInputs?.map(input=><form key={input.requestId} className="panel" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);run(()=>request(`/api/runs/${r.id}/input`,{operationId:operationId(),requestId:input.requestId,answers:Object.fromEntries(data)}));}}><h3>{t('คำถามจากการรันนี้','Question from this run')}</h3>{input.questions?.map(question=><Field key={question.id} label={question.question??question.header??question.id}><input required name={question.id}/></Field>)}<Submit busy={busy}>{t('ส่งคำตอบสำหรับคำถามนี้','Answer this question')}</Submit></form>)}
      {r.pendingApprovals?.map(input=><section className="panel" key={input.requestId}><h3>{t('คำขอสิทธิ์จากการรันนี้','Permission requested by this run')}</h3><p>{input.prompt??input.reason??input.requestKind}</p><div className="actions">{[['accept','อนุญาตครั้งนี้','Allow once'],['decline','ปฏิเสธ','Decline'],['cancel','ยกเลิกคำขอ','Cancel request']].map(([decision,th,en])=><button key={decision} disabled={busy} onClick={()=>run(()=>request(`/api/runs/${r.id}/approval`,{operationId:operationId(),requestId:input.requestId,decision}))}>{t(th,en)}</button>)}</div></section>)}
      {events && (
        <ol className="event-list">
          {events.map((e, i) => (
            <li key={e.id || i}>
              <strong>{e.type}</strong>{" "}
              <small>{date(e.timestamp || e.createdAt)}</small>
              {e.type?.startsWith("TEXT_MESSAGE") && (
                <p>{e.delta || e.content || ""}</p>
              )}
              {e.type?.startsWith("TOOL_CALL") && (
                <p>
                  {e.toolCallName || e.toolCallId || ""}{" "}
                  {e.type === "TOOL_CALL_RESULT"
                    ? t("ผลลัพธ์บันทึกแล้ว", "Result recorded")
                    : ""}
                </p>
              )}
              {e.type === "RUN_ERROR" && <p>{e.message}</p>}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
