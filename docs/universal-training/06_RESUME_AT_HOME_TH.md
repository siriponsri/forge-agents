# จุดพักงานและเริ่มต่อที่บ้าน — 26 พฤศจิกายน 2026

Owner ขอปิดรอบ เก็บ checkpoint แล้ว merge/push main ไม่ใช่การรับรองว่า Universal Training App เสร็จครบ เอกสารนี้เป็นลำดับงานล่าสุด แทนข้อความ pending worker เก่าในแชต

## 1. เปิดงานที่บ้าน

1. ตรวจ `git status --short` และสำรอง/commit งานบ้านที่ค้างก่อน ห้าม reset/clean ทิ้งงาน
2. เมื่อสะอาด: `git fetch origin`, `git switch main`, `git pull --ff-only origin main` แล้วจด `git rev-parse HEAD`
3. ใช้ Node >=24.13; `npm ci` หากยังไม่มี dependency ตาม lock เปิด `Start-FORGE.cmd`; application คือ `/app`, หน้าเริ่มต้น `/welcome`
4. หาก instance เก่ายังรัน ให้หยุดผ่าน launcher ของ instance นั้นแล้วเปิดใหม่เพื่อใช้ build ล่าสุด ห้ามใช้ข้อมูลผู้ใช้หรือ port 4317 เป็น test fixture
5. ใช้ keys/settings ของเครื่องบ้านเอง ไม่ copy vault, private keys หรือ provider sessions จากเครื่องทำงาน
6. อ่าน [ขอบเขต](00_HANDOFF_TH.md), [แผน U0–U8](01_PRODUCT_PLAN_TH.md), [SSH/cloud](02_HOME_DR_TRAIN_TH.md), [Cardiac](03_CARDIAC_PROJECT_TH.md), [Cloudflare](04_CLOUDFLARE_TH.md) และ [security](05_SECURITY_AND_VERIFICATION.md)

## 2. สิ่งที่รวมแล้ว

- Desktop shell/navigation แบบ application และหน้า `/welcome` ที่รับต่อจาก Claude; ไม่ใช่การ deploy เว็บไซต์สาธารณะ
- Studio: เป้าหมาย → สัมภาษณ์ → ทบทวน brief → draft mission ผ่าน canonical state/API เดิม ไม่อนุมัติหรือเริ่ม training จาก flow นี้
- ภาษาไทย 25 หน้า พร้อมแก้ expected copy ของ tests; ไม่ได้แปล raw backend statuses/editor ภายนอกทั้งหมด
- Python CLI แยก profile/version, hashed locks, upgrade candidate, explicit activate/rollback; งานเดิม pin environment เดิม
- ทุก ordinary HTTP POST ต้องมี browser session/CSRF ก่อน body และตรวจซ้ำก่อน effects; signed relay/private MCP ใช้ authority แยกเดิม
- แผน Universal Training, Cardiac home project, Cloudflare template และต้นฉบับแนบพร้อม SHA-256

Commits ก่อนปิดรอบ: `cc6cfac` Studio, `5475aae` Thai, `d557b8c` HTTP auth, `1c288fa` Python, `6590cf6` welcome, `9204803`/`b86a347` shell. Corrections/เอกสาร/packaging อยู่ commits ถัดมา ใช้ `git log` และ `apps/website/public/downloads/manifest.json` ดู exact source revision

## 3. ทำก่อนขยายฟีเจอร์: review FIX 4 ข้อยังเปิด

Review ที่ `cc6cfac122e099d3cb91beb763f7cfa503df4167` ให้ FIX ไม่ใช่ SHIP Owner ขอ checkpoint ก่อนแก้:

| ข้อ | จุดแก้ | Acceptance ที่ต้องเพิ่ม |
|---|---|---|
| Studio เขียนทับข้อความ Owner | `app/web/src/studio/ProductStudio.jsx`, `answerRound()` สร้าง brief ห้าส่วนใหม่เมื่อเปลี่ยนคำตอบ | แก้ acceptance/risks เอง แล้วเปลี่ยน local_api → batch ข้อความต้องไม่หาย; รักษา edited sections หรือแสดง diff ให้ยืนยัน |
| คำตอบค้างข้าม brief | `QuestionRound` key มีเฉพาะ question IDs แต่ answers อยู่ local state | เลือกใน A แล้วสลับ B รอบคำถามเดียวกัน ต้องไม่มีคำตอบ A เข้า B; รวม workflow ID/revision/round identity หรือ reset ที่เหมาะสม |
| Selection ยังสีฟ้า | `app-shell.css` ใช้ --accent/--selected-fg; Dark Modern ใน `themes.mjs` ยังฟ้า | ทำ orange accent ตาม Owner ในขอบเขต shell โดยรักษา named-theme semantics/contrast; ตรวจ desktop/mobile |
| Deploy copy กว้างกว่าความสามารถ | `Landing.jsx` ขั้น Deploy เทียบ `app/serving/bindings.mjs` | ระบุ local loader รองรับเฉพาะ forge.linear.v1 + forge.standardize.v1; โมเดลอื่นต้องมี inference endpoint ของตนเอง |

ระหว่างนี้สำเนาข้อความ Studio ที่แก้เองก่อนเปลี่ยนคำตอบ และ reload เมื่อสลับ brief เพื่อล้าง local state อย่าใช้เป็นที่เก็บเงื่อนไขสำคัญเพียงแห่งเดียว วิธีเลี่ยงนี้ไม่ใช่การแก้ defect

หลังแก้ให้ fresh reviewer ตรวจสี่ findings พร้อมหลักฐานใหม่ ไม่ใช้ 17 tests เดิมแทนหลักฐานว่าบั๊กหาย

## 4. Implementation gaps แยกจาก credentials

- Universal executable recipes/data contracts/actual evaluation/model export ยังไม่ครบตาม phases U0–U8; Studio เป็น planning only
- Python CLI ยังไม่มี Compute GUI/API และ remote interpreter/env receipt binding; SSH worker เรียก python3 คงที่ ต้อง implement validated selection ห้ามเปลี่ยน PATH หลบข้อจำกัด
- Linux/dr-train, Python3.11, scientific dependencies, GPU/network installs ยังไม่ qualified; env manager ไม่รองรับ macOS ใน scope นี้
- RunPod/Vast/Colab provisioning/MCP lifecycle ต้องตรวจ actual adapter/tool schema ก่อน; ไม่มีหลักฐานบัญชีจริง create/start/stop/delete
- Native monetary finality ยังเป็นข้อจำกัดเดิม ห้ามแปลง unknown cost เป็นศูนย์
- ZIP เป็น unsigned development source launcher ไม่ใช่ signed installer/notarized macOS app; private native setup มีหลักฐาน Windows x64 เท่านั้น

Native session-return เก่ามี correction `246daac` และหลักฐานผ่านใน handoff ก่อนหน้าแล้ว อย่ากลับไป promote diagnostic images/pins จากข้อความ worker เก่า ส่วน real-product home qualification ยังต้องทำ

## 5. Verification และวิธีรันต่อ

[verification.json](verification.json) เก็บผลรอบปิดจริง Broad serial regression หยุดตามคำขอ Owner ก่อนจบ จึงไม่มี full-suite PASS พบ Chat graph timeout ใน aggregate; หลัง final rebuild รันไฟล์เดิมใหม่ผ่าน 1/1 ผล aggregate ยังเป็น interrupted ไม่เปลี่ยนเป็น all green

```powershell
npm ci
npm run build
node --test --test-concurrency=1 tests/studio.test.mjs tests/studio-resume.test.mjs tests/studio-http.test.mjs tests/app-shell-routes.test.mjs tests/agent-workspace-ui.test.mjs
node --test --test-concurrency=1 tests/product-browser-command-auth.test.mjs tests/product-final-admission.test.mjs tests/launcher-downloads.test.mjs
python tests/training-env.test.py
node app/web/tests/smoke.mjs
```

ใช้ disposable state แยกจากข้อมูลจริง `npm test` มี native/browser checks ที่ใช้เวลานาน ให้จัด serial และไม่ทับซ้อน heavy native builds/tests เก็บ failures/skips จริง

Security reviewer พบ positive-path fixtures ไม่ส่ง CSRF (partial-body restore race และ smoke setup หลายหน้า) ปรับ test clients โดยรักษา production guard; ชุดปิดงานพบ normalized Office declined-path fixture อีกจุดและเพิ่ม session headers เพื่อให้ยังตรวจ admission/restore ได้ การเรียก private MCP ด้วย browser credentials ยังไม่ได้รับ model authority

## 6. dr-train / cloud / deployment

Owner เลือก SSH; ยังต้องตรวจ host/user/port/fingerprint ผ่านช่องทางเชื่อถือได้ก่อน ใช้ read-only preflight → tiny job → Stop/reconnect/hash ตาม runbook Adapter ใช้ `-F none` จึงไม่อ่าน alias dr-train อัตโนมัติ ต้องกรอก resolved host/user/port/identity refs และ pin machineId จริง

งบที่เสนอ **ยังไม่ใช่ spending approval**: RunPod30นาที/US$3, Vast30นาที/US$3 ทำทีละเจ้า รวมUS$6; ColabCPU/free15นาที; dr-train CPU-first4CPU-hours/พื้นที่เป้าหมาย5GB เมื่อจะใช้เงินจริงให้ยืนยันราคา/storage/egress/เพดานกับ Owner ก่อน ไม่มี resource เปิดในรอบนี้ Stop อาจยังเสีย storage ต้องมี cleanup receipt

Cardiac เริ่ม M0/data-label audit และ public AHE ซึ่งเป็น hypotension ไม่ใช่ cardiac arrest; IHCA ต้องมีข้อมูล/สิทธิ์/event time ที่รองรับ ห้ามอ้าง clinical validity จาก synthetic demo หรือเปลี่ยน endpoint เพื่อให้คะแนนดี

Cloudflare ใช้ทีมที่มี ai-cie.com ไม่แตะ Worker cwn2026 เดิม Template: `tools/cloudflare/wrangler.example.jsonc` เท่านั้น Deploy ที่บ้านหลังตรวจ final assets/downloads แยก static website จาก privileged local app ห้ามเปิด backend ผ่าน public tunnel โดยไม่มี remote auth design

## 7. Prompt พร้อมใช้ session ถัดไป

> อ่าน AGENTS.md และ docs/universal-training/06_RESUME_AT_HOME_TH.md กับ 00_HANDOFF_TH.md ตรวจ HEAD/status ก่อน แก้ Studio/GUI review FIX 4 ข้อพร้อม regression/fresh review จากนั้นทำ phases U0–U8 ตาม implementation จริง ตรวจ dr-train SSH และ env binding ก่อน Cardiac M0–M4 แยก injected/local/live evidence ยืนยันงบก่อน paid RunPod/Vast และตรวจ config/assets ก่อน Cloudflare อย่าอ่านประวัติ worker เป็นสถานะ HEAD และอย่าลด authority/CSRF/Stop/unknown-replay fences เพื่อให้ smoke ผ่าน
