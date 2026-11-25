# FORGE checkpoint for continuation at home

Status: **IMPLEMENTATION_INCOMPLETE — HOME_UAT_NOT_RUN**.

The Owner requested an early `main` checkpoint on 25 November 2026 because the
work machine was about to become unavailable. This is a source checkpoint, not
a complete-product release or a signed desktop installer. Earlier dated status
and media records remain historical evidence, not verification of this tree.

## เปิดที่เครื่องบ้าน

1. ตรวจ `git status` ใน clone ของ FORGE ก่อน อนุรักษ์งานที่ยังไม่ commit ไว้
   หาก main สะอาดและไม่ diverge ใช้ `git pull --ff-only origin main`.
   ไม่ใช้ `reset --hard` เพื่ออัปเดตตามปกติ
2. ต้องมี Node.js 24.13 ขึ้นไป และ Git ดับเบิลคลิก `Start-FORGE.cmd`.
   ครั้งแรก launcher ติดตั้ง dependencies จาก lockfile และ build หน้าจอ
   แล้วเปิด browser เมื่อ localhost พร้อม ตรวจ revision ที่แอปแสดง
3. ใช้ข้อมูลแอปและบัญชีของเครื่องบ้านตามปกติ Git ไม่ย้ายฐานข้อมูล ความจำ
   credentials, native sessions หรือ private compiled caches จากเครื่องทำงาน
4. เลือก workspace ของงานแยกจาก source ของ FORGE ตั้งค่า provider/model ใน
   Settings ของเครื่องนี้ ห้ามเปิด prototype หรือซื้อ compute เพื่อทดสอบ
5. ใช้ `Stop-FORGE.cmd` เพื่อหยุด service; ปิด browser อย่างเดียวไม่หยุดแอป

This checkpoint contains the source and pinned setup pipelines for the private
native derivative. Its compiled Windows images are **not in Git**. Settings
owns installation/check jobs. The new unified pipeline's verified-cache copy,
source/image pins and process cancellation were tested; a fresh full source
build of this latest pipeline was **NOT_RUN**. Keep ordinary workbench flows
usable if this optional setup needs investigation. Do not copy machine keys or
relax image/provenance checks to get past setup.

## What was integrated

- Existing workbench, Missions/Delivery, isolated Workspace, scoped Memory/MCP,
  measured usage/Budgets, workflow presets and local Research flows remain.
- Unified private T3/OpenCode purpose separation: the existing three Guarded
  file tools and a distinct supervised selection-only frontend purpose.
- Owner intent/start/pending/result/Stop routes, restore safety and saved Docs
  selection controls mounted in Office. New intents have one absolute five-minute
  deadline including setup and Owner response. Existing deadlines are not reset.
- Research component contexts forwarded through Workspace and T3, canonical
  selection/Context checks, fixed output bootstrap, shared native resource hooks,
  cohort outcome projection, UI controls and authenticated headless service route.
- Horizontal Diagram Design assets with dark-label contrast corrected to 5.053:1.
- Vast MCP preset and actual transport checks. The linked repository at the
  inspected pin is a **synthetic, read-only test server**, not live Vast rental
  execution or billing. See [Vast setup](vast-mcp.md).

## Required continuation — implementation gaps

1. **Research assembled native attestation.** The latest real application test
   completed the frontend selection turn, but Research timed out during native
   attestation, before any upstream model request. Its run was retained failed /
   not-dispatched; no Research effect or automatic replay occurred. Investigate
   repeated synchronous image/route checks through Research callbacks under the
   same writer. Preserve current route/account/image/Stop fences and the 30-second
   native transport timeout. Reduce redundant work with evidence; do not create
   proof from configuration, increase a running deadline or bypass attestation.
2. **Complete Research cohort qualification.** Unit/service fixtures exercise
   real Git/SQLite/Workspace/Adaptive/Context/Budget/checkers with injected native
   observations. Full assembled native skills/staffing/adaptation and the mounted
   GUI/headless journey are not yet qualified. Preserve exact cohort contexts,
   aggregate limits, output ownership, independent evidence and once-only Stop.
3. **Finish product review and media.** Office selection module/browser checks
   and actual product HTTP/native result return were exercised separately.
   Repeat the mounted Office-to-native user journey, review the new cohort UI,
   then refresh screenshots/GIFs and public-site qualification/source copy.
   Existing media has dated provenance and explicitly injected provider data.
4. **Run final affected and full checks.** A prior serial suite reported
   698 pass / 9 explicit skips before these last integrations. It does not qualify
   the final checkpoint. Use the current checkpoint report and logs below; do
   not inherit older release approval. Keep the goal open until required gaps close.

The opt-in assembled test is reproducible with:

```powershell
$env:FORGE_RUN_PRIVATE_ROUTES_NATIVE='1'
$env:FORGE_GUARDED_TEST_CACHE='<verified unified generation directory>'
node --test tests/product-private-routes-native.test.mjs
```

The test's default skip explicitly records missing assembled qualification.
Its last executed outcome was **FAIL**, after frontend completed and Research
attestation timed out. It is not a green release gate.

## Evidence available before checkpoint

- Actual production Guarded activation on the unified generation: **1 PASS**,
  110.2 seconds, 4 loopback model-protocol requests, 3 actions/receipts, 1 run,
  3 visible AG-UI observations; zero external provider requests.
- Worker unified native integration: **15 PASS**, including purpose separation,
  sequential frontend attempts, real Stop and restore; private module/adapter
  fixtures do not replace the assembled product qualification above.
- Frontend facade/SDK tests after integration: **18 PASS**.
- New cohort admission, opaque recovery Stop and result projection: **3 PASS**.
- Native owner/pending allocation guards: **9 PASS**.
- Earlier production admission/Context/Research targeted subset: **33 PASS**.
- Final checkpoint production build: **PASS**, 15.84 seconds. Final affected
  backend/admission/Context subset: **52 PASS**, zero failures/skips. Additional
  mounted frontend/Univer and application boundaries: **5 PASS**, zero skips.
  Whitespace check passed and protected legacy paths have no changes in this
  final integration delta. The source commit can be read from Git.

No live account/model-quality run, paid GPU campaign, public deployment, native
macOS qualification or home UAT was performed. Native monetary accounting still
has `cost:null` and `final:false`; this is an unsupported billing contract,
separate from missing credentials. Do not claim hard spending finality.

## Suggested first checks at home

Open the workbench, switch TH/EN, create a disposable project, save/reopen Docs
and Sheets, run a small local Python job, export an existing report and stop /
restart the app. Use the local Research fixture before trying the unfinished
agent integration. Preserve actual errors, revision and redacted logs if a step
fails. Continue from this checkout rather than rebuilding the project or changing
provider catalogs, approval authority or legacy portable payloads.
