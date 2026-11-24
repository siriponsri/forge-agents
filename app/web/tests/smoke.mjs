// Developer fixture only. Uses the real service with disposable state; no provider calls.
// npm run build; npm install --no-save --package-lock=false playwright; node app/web/tests/smoke.mjs
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createApplication } from "../../server/main.mjs";

const temp = await mkdtemp(path.join(os.tmpdir(), "forge-ui-worker-"));
let app = await createApplication({
  dataDir: path.join(temp, "state"),
  port: 0,
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORGE_TEST_BROWSER
    ? { executablePath: process.env.FORGE_TEST_BROWSER }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => {
  errors.push(error.message);
  console.error("PAGEERROR", error.message);
});
const state = async () =>
  (await page.request.get(`${app.url}/api/state`)).json();
const click = (name) => page.getByRole("button", { name, exact: true }).click();
const nav = (name) =>
  page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
const waitState = async (predicate) => {
  for (let i = 0; i < 80; i++) {
    const s = await state();
    if (predicate(s)) return s;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("State condition timed out");
};
try {
  await page.goto(app.url);
  await page.getByText("เริ่มพื้นที่ทำงาน", { exact: true }).waitFor();
  await page.getByLabel("Language").selectOption("en");
  await click("Create first project");
  await page.getByLabel("Project name").fill("Disposable UI verification");
  await page
    .getByLabel("Workspace directory")
    .fill(path.join(temp, "workspace"));
  await page
    .getByLabel("Goal", { exact: true })
    .fill("Engineering fixture. No owner product.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await waitState((s) => s.projects.length === 1);
  await nav("Bot team");
  await page.getByLabel("Bot name").fill("Fixture reviewer");
  await page
    .getByLabel("Role", { exact: true })
    .fill("Bounded document verification");
  await click("Save member");
  await waitState((s) => s.bots.length === 1);
  await nav("Conversations");
  await page.getByLabel("Room name").fill("Fixture room");
  await click("Create room");
  await waitState((s) => s.conversations.length === 1);
  await page
    .getByLabel("Message", { exact: true })
    .fill("ข้อความทดสอบ / real persisted message");
  await click("Send message");
  await waitState((s) => s.conversations[0].messages.length === 1);
  assert.equal((await state()).conversations[0].messages[0].role, "user");
  await nav("Plan & tasks");
  await click("+ Create plan");
  await page.getByLabel("Plan name").fill("Verification plan");
  await click("Save plan");
  await waitState((s) => s.plans.length === 1);
  await page.getByLabel("Reviewed and approved for execution").click();
  await waitState((s) => s.plans[0].approved);
  await click("+ Phase");
  await page.getByLabel("Phase name").fill("Verification");
  await click("Add phase");
  await waitState((s) => s.phases.length === 1);
  await click("+ Task");
  await page.getByLabel("Task title").fill("Inspect saved records");
  await page
    .getByLabel("Phase", { exact: true })
    .selectOption({ label: "Verification" });
  await click("Save task");
  await waitState((s) => s.tasks.length === 1);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await click("Kanban");
  await page.getByRole("button", { name: /Inspect saved records/ }).waitFor();
  await click("Canvas");
  await nav("Notebooks");
  await page.getByLabel("Notebook name").fill("Bounded Python");
  await page
    .getByLabel("Python source")
    .fill("print('FORGE UI real Python smoke')");
  await click("Save notebook");
  await waitState((s) => s.notebooks.length === 1);
  await click("Run saved revision");
  const jobs = await waitState((s) =>
    s.jobs.some(
      (j) =>
        j.notebookId && ["completed", "ready", "failed"].includes(j.status),
    ),
  );
  assert.match(JSON.stringify(jobs.jobs), /FORGE UI real Python smoke/);
  await nav("Docs & sheets");
  await click("+ Create document");
  await page.getByLabel("Document name").fill("Fixture workbook");
  await click("Create & open");
  await page
    .getByRole("button", { name: "Bounded agent edit", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Bounded agent edit",
      )?.disabled,
    { timeout: 30000 },
  );
  await click("Bounded agent edit");
  await page
    .getByLabel("Actor bot")
    .selectOption({ label: "Fixture reviewer" });
  await page.getByLabel("Cell range (up to 1000 cells)").fill("A1:B2");
  await page.getByLabel("Values / formulas:").fill("12\t8\n=SUM(A1:B1)\tทดสอบ");
  await click("Apply & save");
  let s = await waitState((s) => s.documents[0]?.revision === 2);
  assert.equal(s.documents[0].snapshot.sheets.sheet1.cellData[0][0].v, 12);
  assert.equal(
    s.documents[0].snapshot.sheets.sheet1.cellData[1][0].f,
    "=SUM(A1:B1)",
  );
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await waitState((s) => s.documents[0].revision === 3);
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "Redo", exact: true })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await waitState((s) => s.documents[0].revision === 4);
  await page.screenshot({
    path: path.join(temp, "sheets.png"),
    fullPage: true,
  });
  // Human keyboard edits go through the same Univer session and live undo stack.
  const nameBox = page.locator('[data-u-comp="defined-name"] input');
  await nameBox.fill("C3");
  await nameBox.press("Enter");
  await page.keyboard.type("31");
  await page.keyboard.press("Enter");
  await click("Save");
  s = await waitState((s) => s.documents[0].revision === 5);
  assert.equal(s.documents[0].snapshot.sheets.sheet1.cellData[2][2].v, 31);
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await click("Save");
  s = await waitState((s) => s.documents[0].revision === 6);
  assert.ok(!s.documents[0].snapshot.sheets.sheet1.cellData[2]?.[2]?.v);
  await page.getByLabel("Cell range (up to 1000 cells)").fill("C4");
  await page.getByLabel("Values / formulas:").fill("42");
  await click("Apply & save");
  await waitState((s) => s.documents[0].revision === 7);
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "Redo", exact: true })
    .click();
  assert.equal(
    await page.getByRole("button", { name: "Save", exact: true }).isDisabled(),
    true,
  );
  // Force a genuine optimistic-revision conflict from another client, retaining local edits.
  s = await state();
  const doc = s.documents[0];
  await page.request.post(`${app.url}/api/command`, {
    data: {
      operationId: crypto.randomUUID(),
      type: "document.save",
      projectId: doc.projectId,
      id: doc.id,
      expectedRevision: doc.revision,
      data: { snapshot: doc.snapshot, summary: "Independent client revision" },
    },
  });
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "REVISION_CONFLICT" })
    .first()
    .waitFor();
  assert.equal((await state()).documents[0].revision, doc.revision + 1);
  page.once("dialog", (dialog) => dialog.accept());
  await click("Reopen latest revision");
  await click("+ Create document");
  await page.getByLabel("Document name").fill("Fixture document");
  await page.getByLabel("Kind", { exact: true }).selectOption("doc");
  await click("Create & open");
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Bounded agent edit",
      )?.disabled,
    { timeout: 30000 },
  );
  await click("Bounded agent edit");
  await page
    .getByLabel("Actor bot")
    .selectOption({ label: "Fixture reviewer" });
  await page
    .getByLabel("Text to insert in the paragraph")
    .fill("ทดสอบไทย English 123");
  await click("Apply & save");
  s = await waitState((s) =>
    s.documents.some((d) => d.kind === "doc" && d.revision === 2),
  );
  assert.match(
    s.documents.find((d) => d.kind === "doc").snapshot.body.dataStream,
    /ทดสอบไทย English 123/,
  );
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await click("Save");
  await waitState((s) =>
    s.documents.some((d) => d.kind === "doc" && d.revision === 3),
  );
  await page
    .locator(".editor-toolbar")
    .getByRole("button", { name: "Redo", exact: true })
    .click();
  await click("Save");
  await waitState((s) =>
    s.documents.some((d) => d.kind === "doc" && d.revision === 4),
  );
  await page.screenshot({ path: path.join(temp, "docs.png"), fullPage: true });
  await nav("Settings");
  await page.getByLabel("Project name").fill("Updated fixture");
  await page
    .getByLabel("T3-supported model ID")
    .fill("fixture-only-no-execution");
  await click("Save project & profile");
  await waitState((s) => s.projects[0].name === "Updated fixture");
  await click("Recovery & health");
  await click("Create backup");
  await page
    .getByText("Domain metadata and native snapshots only.", { exact: false })
    .waitFor();
  await nav("Report Studio");
  await page.getByLabel("Source name", { exact: true }).fill("Fixture source");
  await page.getByLabel("Report title").fill("รายงานทดสอบ");
  await page.getByLabel("Heading", { exact: true }).fill("Evidence");
  await page.getByLabel("Text", { exact: true }).fill("Only observed records.");
  await click("Save report source");
  await waitState((s) => s.reports.length === 1);
  await page.screenshot({
    path: path.join(temp, "report-source.png"),
    fullPage: true,
  });
  // Native snapshots reopen after process restart, not just cached tab navigation.
  const port = Number(new URL(app.url).port);
  await page.goto("about:blank");
  await app.close();
  app = await createApplication({ dataDir: path.join(temp, "state"), port });
  await page.goto(app.url);
  await nav("Docs & sheets");
  await page.getByRole("button", { name: /Fixture workbook/ }).click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Bounded agent edit",
      )?.disabled,
    { timeout: 30000 },
  );
  s = await state();
  assert.equal(
    s.documents.find((d) => d.kind === "sheet").snapshot.sheets.sheet1
      .cellData[1][0].f,
    "=SUM(A1:B1)",
  );
  await page.getByRole("button", { name: /Fixture document/ }).click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Bounded agent edit",
      )?.disabled,
    { timeout: 30000 },
  );
  assert.match(
    (await state()).documents.find((d) => d.kind === "doc").snapshot.body
      .dataStream,
    /ทดสอบไทย English 123/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(temp, "mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        result: "PASSED",
        fixtureDir: temp,
        checks: [
          "Thai default/English switch",
          "project/team/chat/plan/task persistence",
          "real Python execution",
          "Univer Sheets and Docs mounted",
          "bounded edits + shared undo/redo",
          "stale save rejected",
          "native snapshots reopened after service restart",
          "report source persistence",
          "backup",
          "mobile render",
          "no uncaught browser errors",
        ],
      },
      null,
      2,
    ),
  );
} catch (e) {
  await page
    .screenshot({ path: path.join(temp, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error("FIXTURE_DIR", temp);
  throw e;
} finally {
  await browser.close();
  await app.close();
}
