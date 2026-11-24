# Cognitive Memory worker handoff — 2026-11-24

## Follow-up: Central Owner Memory + explicit project sharing

Owner ยืนยัน requirement เพิ่มเติม: Owner Memory เป็น **ต้นฉบับส่วนกลางข้ามโครงการ** แต่ทุกโครงการเริ่มต้นไม่มีสิทธิ์อ่าน ต้องให้ Owner เลือกชื่อโครงการแล้วแชร์ revision นั้นอย่างชัดเจน โค้ด follow-up อยู่ใน worktree/branch เดิมและแก้เฉพาะ `app/memory/**`, `Memory.jsx`, `tests/memory*`, เอกสารนี้ ไม่มีการแก้ shared main/context/authority/storage/api/styles/manifests

### Canonical architecture / authorization

- `app/memory/owner.mjs` เพิ่ม `createOwnerMemoryService({store,dataDir,authorize,now?})` เป็นบริการส่วนกลาง ใช้ existing `state.events` ประเภท `owner-memory.record`, `.grant`, `.tombstone`, `.operation` **ไม่มี projectId ของต้นฉบับ ไม่มี hidden/synthetic project ไม่มี collection หรือ canonical database ใหม่** ดัชนี Owner ใช้ derived tables `owner_rows/owner_grants/owner_fts` ใน `dataDir/memory/index.sqlite` ไฟล์เดียวกับ project keyword cache ไม่มีสำเนา text แยกตามโครงการ
- Export `OWNER_MEMORY_SCOPE={kind:'owner',id:'local-owner'}` เป็น identity scope คงที่ของ installation ไม่รับ Owner identity จาก body `authorize({action,scope,callerContext,state})` ต้องคืน literal true แบบ synchronous จาก opaque caller ที่ host ออกให้ ไม่มี body `actor`, `approved`, `ownerId`, grants หรือ callbacks
- CRUD ส่วนกลาง: read ใช้ `owner.read`; remember/update/forget ใช้ `owner.write`; grant/revoke ใช้ `owner.share`; export ใช้ `owner.export`; sensitive source ต้องมี `owner.sensitive` เพิ่ม Root ต้องอนุญาต owner.* ให้ human browser-session handle เท่านั้น **ห้ามออก owner.* ให้ provider/run** Provider ไม่มี Owner write MCP tool และไม่สามารถแชร์เอง
- Project view ใช้ `read` บน `{projectId,kind:'project',id:projectId}` ของโครงการจริงที่มีอยู่ใน canonical state แล้วตรวจ grant ปัจจุบันอีกชั้นหนึ่ง แม้ caller เป็น human Owner การเรียก projectContext ก็ยังต้องมี grant; ส่วน Owner.list เป็น authority/route คนละเส้นทาง Sensitive view ต้องมี existing `sensitive` project grant เพิ่ม
- `sourceRefs?:[{projectId,kind,id}]` ของ source ต้องเป็น run/task/artifact/verification ที่มีจริงใน project ซึ่ง caller มี read grant เก็บ revision/hash จาก canonical records ไม่รับข้อความหลักฐานที่แต่งขึ้น Project context **ไม่เผย sourceRefs ของโครงการอื่น ไม่เผยชื่อผู้รับแชร์รายอื่น หรือ metadata ของ source ที่ยังไม่แชร์** provenance ที่ส่งออกเป็น minimal source/grant identity
- Private content, credential/hidden-reasoning filters, revision/timestamp/provenance และ `trust:'untrusted-data', executable:false` ยังบังคับเหมือนเดิม Central Owner content ไม่เปลี่ยนคำสั่ง Owner/permissions/acceptance หรือ verified project state

### Exact service and root integration seam

```js
import {
  createOwnerMemoryService, OWNER_MEMORY_SCOPE, OWNER_GRANT_PREFIX,
  mergeOwnerMemorySafety,
} from '../memory/owner.mjs';
import {createOwnerMemoryHttpHandler} from '../memory/http.mjs';

const ownerMemory=await createOwnerMemoryService({store,dataDir,authorize:authority.authorize});
// Root resolves an authenticated HttpOnly session + CSRF into an opaque human handle:
const ownerHttp=createOwnerMemoryHttpHandler({service:ownerMemory,resolveCaller});
// Dedicated GUI prefix POST /api/owner-memory/{method}; root shared api helper
// must include this prefix in its existing X-Forge-CSRF handling.
```

| Method | Input before opaque caller |
|---|---|
| remember | `{operationId,title,content,sourceRefs?,staleAt?,expiresAt?,sensitive?}` |
| list / recall | `{query?,limit?,includeStale?}`; recall ต้องมี query |
| update | `{operationId,id,expectedRevision,patch:{title?,content?,pinned?,staleAt?,expiresAt?,sourceRefs?}}` |
| forget | `{operationId,id,expectedRevision}` |
| grant / revoke | `{operationId,id,expectedRevision,projectId,expectedGrantRevision}` |
| status / export | `{}` |
| ownerContext / projectContext (aliases) | `{projectId,query?,limit?,maxCharacters?,includeStale?}` |
| resolveOwnerRefs / resolveProjectRefs (aliases) | `{projectId,refs:[{id,revision,sha256}]}` |

HTTP helper whitelist เฉพาะ Owner CRUD/list/search/status/export/grant/revoke ไม่มี lifecycle/context/provider methods และรับ POST JSON ไม่เกิน 64 KiB ต้อง mount หลัง existing Host/Origin/session/CSRF checks; helper ไม่สร้าง public listenerหรือรับ identity จาก request body Root สามารถ route ตรงเข้า service methods ด้วย parser เดิมได้

Grant เริ่ม `expectedGrantRevision:0` และผูกกับ **exact current source revision + raw content SHA-256** Revoke/re-share เพิ่ม grantRevision ทุกรอบ ทุก grant/revoke มี event UUID ใหม่ **แก้ไข source (รวม pin/expiry) ทำให้ grant เดิม ineffective จน Owner แชร์ revision ใหม่** ไม่มี auto-follow การเปลี่ยนแปลง ไม่มี auto-share ให้โครงการใหม่

Project context คืน standard memory shape ที่ context worker ใช้ได้โดยไม่แก้ shared contract:

```js
{kind:'forge.memory.data',trust:'untrusted-data',executable:false,
 items:[{
   id:'owner-grant:<active-grant-event-UUID>', // read view ID <=200 chars
   revision:sourceRevision,sha256:rawUtf8ContentHash,
   scope:{projectId,kind:'project',id:projectId},title,content,
   sourceRefs:[],verification:{status:'unverified'},stale,conflicts:[],
   trust:'untrusted-data',executable:false,
   provenance:{kind:'owner-memory',sourceMemoryId,sourceRevision,grantId,grantRevision}
 }],provenance,metrics,authority}
```

`OWNER_GRANT_PREFIX='owner-grant:'` เป็น **view identity ที่คำนวณตอนอ่าน ไม่ใช่ shadow record** Root สามารถ union `memory.context()` กับ `ownerMemory.projectContext()` เฉพาะ project scope และต้องจัดงบ characters/tokens รวมอีกชั้นหนึ่ง ไม่ใช่ concatenate สอง budgets แล้วอ้างว่าผ่าน budget เดียวกัน

`resolveProjectRefs` รับ standard refs `{id,revision,sha256}` ที่ context service strip ไว้อยู่แล้ว Lookup ต้องพบ **currently-active grant event UUID เดียวกัน**, project เดียวกัน, source revision/hash ตรง, source ไม่หมดอายุ/ถูกลบ และ caller ยังอ่านโครงการนั้นได้ Revoke/edit/delete จึง invalidates old refs ทันทีและหลัง restart Revoke → regrant source revision เดิมก็เป็น UUID ใหม่ จึงไม่ทำให้ old refs กลับมาใช้ได้

Root split refs ตาม `OWNER_GRANT_PREFIX` ก่อนเรียก `memory.resolveRefs`/`ownerMemory.resolveProjectRefs` ทุก resolve/compaction/dispatch **เก็บเพียง refs ไม่เก็บ private memory text ใน context snapshots/spills/receipts/summaries** Ref ที่ missing ห้าม fallback ไป cached content Context ที่ยังไม่ dispatch ต้อง re-resolve เพื่อรับผล revoke/forget ล่าสุด ไม่มี grant = items ว่างโดยไม่มี source record metadata

**Root projection boundary:** `owner-memory.*` เป็น global events ที่ไม่มี projectId ห้าม generic `/api/state`, project export, provider snapshot หรือ project backup ส่ง global source events ให้ project/provider caller Owner GUI อ่านผ่าน dedicated authorized service endpoints; canonical/installation backup ที่ได้รับอนุญาตอาจเก็บ full Owner history แต่ project backup ห้ามสร้างสำเนาหรือ remap grants อัตโนมัติ

### Trusted restore hooks: keyword only, no model side effects

ก่อน restore/import snapshot เก่า root ต้อง pause incoming operations/run dispatch แล้วทำใน existing canonical restore transaction:

```js
const restored=mergeOwnerMemorySafety(
  mergeMemoryTombstones(restoredSnapshot,previousCanonicalState),
  previousCanonicalState,
);
// Commit restored through the existing store transaction, then BEFORE reopening API:
await memory.afterRestore();
await ownerMemory.afterRestore();
```

`mergeOwnerMemorySafety(restored,previous)` เก็บ canonical installation Owner history ปัจจุบันไว้ร่วมกับ restored snapshot; projection เลือก record/grant revisions ล่าสุดและให้ tombstone ชนะเสมอ Helper preserve **source edits และ latest revoke/grant decisions** ด้วย ไม่ใช่เพียง tombstones จึงไม่ให้ old backup คืนสิทธิ์แชร์หรือ source revision เก่า ปกป้องกรณี project restore ไม่ควร overwrite central Owner store และ scrub deleted text/source refs ในทุก Owner record event

ทั้ง `afterRestore()` เป็น **internal/trusted no-argument lifecycle seam** ไม่ออกเป็น HTTP/MCP tool `memory.afterRestore` รอ in-flight derived work, purge/dispose optional adapters, ล้าง known managed cache paths ของ Qdrant/Mem0 history แบบ static แม้ restored metadata ไม่มี backend config เดิม แล้ว rebuild project FTS จาก canonical state `ownerMemory.afterRestore` rebuild Owner FTS/grant index จาก canonical stateเท่านั้น **ไม่เรียก factory, embeddings, extraction model, setup หรือ provider** Result มี `modelCalls:0` ซึ่งมี spy assertions ทดสอบจริง

Optional vector backend ถูก suspend หลัง restore จนมี explicit authorized `rebuild` ให้ผู้ใช้เลือกเอง Keyword core ใช้งานได้ต่อ Cache cleanup ไม่ลบ Python env, root authority store หรือไฟล์นอก managed cache roots Injected adapter ควรมี pure `purge()`; ถ้าไม่มี จะรายงาน warning และ suspend เพื่อให้ host จัดการ derived cache ภายนอก ไม่แอบใช้ replace([]) ที่อาจเรียกโมเดล

### GUI and verification for this follow-up

Memory Studio เพิ่มปุ่ม **Central Owner memory** ใช้ได้แม้ยังไม่มี project มีค้นหา สร้าง private source แก้ revision/pin/expiry แสดง source/provenance/share receipts เลือกแชร์จาก **ชื่อโครงการจริง** ถอนสิทธิ์ Export JSON และ forget source ไม่มี target project ที่เลือกไว้ล่วงหน้า ไม่ใช้ UUID input ใน share flow

Project scope และ share destination เปลี่ยนเป็น dropdown ของ canonical project/bot/conversation/task records: team ใช้ project team หรือ team conversations, session ใช้ conversation records ตาม host authority, Owner ใช้ fixed Local Owner identity ใน project scope Existing six scoped native APIs ยังอยู่และไม่ย้าย project-scoped owner records เดิมไปส่วนกลางอัตโนมัติ

New tests: `tests/memory-owner.test.mjs` ทดสอบ real SQLite/shared index, central source โดยไม่มี project, default no grants, opaque authorization, explicit project isolation, exact revision grants, edit/revoke/delete/regrant, source+grant restart, idempotency, provenance privacy, stale/expired/sensitive handling, tombstone+revoke+source-edit restore and keyword-only cache recovery แบบไม่เรียกโมเดล

`tests/memory-owner-browser.test.mjs` เปิด Chromium จริงและ component จริงผ่าน isolated Vite+native HTTP handlers ทดสอบ named task dropdown → task memory create → private Owner create → explicit Alpha share → revoke → regrant → revision edit invalidation → explicit Beta share → JSON download export → forget และ lifecycle route ไม่เปิดให้เรียก ไม่มี browser page exceptions Fixture มี opaque session/cookie/CSRF token ที่ host สร้างเองสำหรับการทดสอบ **ไม่ใช่ production authentication implementation** และไม่ใช้ body approved claims

Verification command `node --test tests/memory-*.test.mjs tests/adaptive-improvement.test.mjs` ผ่าน **36 tests, 0 fail, 0 skip** รวม real Mem0/Qdrant regression เดิม, official SDK in-memory MCP เดิม, Owner core ใหม่และ Chromium UI ใหม่ ไม่มี provider/model calls เพิ่ม ไม่มี dependency/manifests ใหม่

Remaining root integration: instantiate central service/Owner-only authority actions; add owner-memory prefixใน shared CSRF helper; mount route; union granted view with project context + split refs resolution; filter generic state/backup projections; call both safety mergesและทั้ง afterRestore hooks; close both services on shutdown Worker ไม่แก้ shared files เหล่านี้

NOT_RUN qualifications remain: production App/session/CSRF end-to-end with root wiring, production provider/MCP transport mount, live provider recall, model quality/token billing/resource costs and HOME_UAT ห้ามใช้ component browser fixture เป็นหลักฐาน live/provider quality

ผู้พัฒนา: **gpt-6.1-sol, xhigh** ผ่าน Codex harness ใน T3 Code (ข้อมูล runtime ที่ได้รับ ไม่อ้างว่าเรียก provider เพิ่ม)
Branch: `t3/local-memory-core`; ฐาน `65b78e9`; ไม่มี push, PR หรือแก้ main

## สิ่งที่ทำจริง

MEM-01/02: `app/memory/index.mjs` มี working/episodic/semantic/procedural/collective/owner memory ถาวรใน **existing FORGE `state.events`** เท่านั้น ไม่มี collection/schema migration ใหม่ ไม่มี task DB หรือ planner ใหม่ SQLite FTS5 trigram ที่ `dataDir/memory/index.sqlite` เป็นดัชนีทิ้งได้ รองรับข้อความไทยที่ไม่มีเว้นวรรคและ English substring; คำสั้นกว่า 3 ตัวใช้ bounded authorized substring matching ไม่ได้อ้างว่าเป็น semantic retrieval ดัชนีตรวจ hash ของ canonical memory events แทนการเชื่อ revision อย่างเดียว จึงรองรับ restore ที่ revision เท่าเดิมได้

MEM-03: `mem0-adapter.mjs` + `mem0_worker.py` ใช้ **Mem0 OSS SDK จริง** และ Qdrant local disk จริง เป็น optional replaceable adapter ไม่มี external API credentials ในค่าเริ่มต้น Local core ใช้ Node SQLite ที่มีอยู่แล้ว ไม่ต้องติดตั้ง Python, Mem0, Ollama หรือโมเดล เพื่อเปิด FORGE/ใช้ keyword memory

MEM-04: exact scopes `{projectId,kind,id}` ครบ project/owner/team/agent/session/task ทุก native operation บังคับตรวจสิทธิ์ที่ backend; project scope มี id เท่ากับ projectId; project ต้องมีจริง การแชร์ให้สิทธิ์อ่านเท่านั้น การเขียนต้องใช้ primary scope ของ record และต้องมี write grant ของ scope นั้น การแชร์ต้องมี share grant ของทั้ง source และ destination ห้ามข้าม project ในการแชร์

MEM-05: `context()` ส่ง bounded memory DATA + revision/content hash/provenance ให้ context-compaction worker; `resolveRefs()` resolve ใหม่จาก canonical records ด้วยสิทธิ์ปัจจุบันเท่านั้น ไม่คืนเนื้อหาของรายการที่ลบ หมดอายุ revision เปลี่ยน หรือ hash ไม่ตรง Fixture เปลี่ยน trusted caller harness ระหว่าง Codex/Claude Code/DeepSeek/OpenCode โดยไม่คัดลอก native harness stores ไม่ได้อ้างว่าได้เรียก runtime เหล่านั้นจริง

MEM-06: procedural memory เป็น draft และ `executable:false` เสมอ `proposeLesson()` เรียก **existing `adaptive.candidate`** พร้อมแหล่งหลักฐานจริง ไม่เขียน skills โดยอิสระ ไม่ promote/evaluate อัตโนมัติ GUI ส่ง instructions ที่มนุษย์เลือกแยกต่างหากจาก lesson DATA การประเมินและ promote ยังอยู่ใน Adaptive review เดิม ทดสอบ real adaptive route ว่าสร้างได้เพียง candidate และ promote โดยอ้างผลตรวจปลอมไม่ได้

MEM-07: `app/web/src/Memory.jsx` default props `{t,state,projectId,run,busy}` ใช้ tokens/components เดิม มีค้นหา เลือก scope/types เพิ่ม/แก้ revision ปักหมุด ลืม ส่งออก JSON ตั้ง expiry/stale time ลบรายการหมดอายุ แชร์ read-only แสดง provenance/conflicts และ backend/model config พร้อมปุ่มติดตั้ง dependencies แยก ตรวจ health และ rebuild ไม่แก้ App/styles/api.mjs ที่เป็นของ lead

MEM-08: มี native service, HTTP mount helper และ **official MCP SDK Server** (`mcp.mjs`) tools `memory.remember`, `memory.recall`, `memory.update`, `memory.list`, `memory.forget` Fixture ใช้ official SDK Client และ InMemoryTransport จริงเพื่อเรียก protocol/dispatch ทั้งห้า operations ไม่ได้ใช้ client/server mock

MEM-09: ประเมิน Graphiti เป็น optional temporal graph; ใช้ Letta shared-block architecture เป็น reference เท่านั้น รายละเอียด pins/license/API ด้านล่าง ไม่มี graph daemon หรือ competing orchestrator

MEM-10: regression fixtures จริงครอบคลุม persistence/restart/FTS5/Thai-English/all six scopes/conflict/source drift/staleness/retention/deletion/rebuild/restored tombstone union/prompt injection/sensitive restrictions/cross-harness context/SDK MCP/native HTTP และ Mem0/Qdrant จริง

## สัญญาที่ lead ต้อง wire

```js
import {createMemoryService,makeScopeAuthorizer,mergeMemoryTombstones} from '../memory/index.mjs';
import {createMemoryHttpHandler} from '../memory/http.mjs';
import {createMemoryMcpServer} from '../memory/mcp.mjs';

const authorize=makeScopeAuthorizer((callerContext,state)=>trustedCallers.get(callerContext));
const memory=await createMemoryService({store,dataDir,authorize,adaptive});
// trustedCallers stores server-created opaque object handles, NEVER body claims:
// {subject,grants:[{scope:{projectId,kind,id},actions:['read','write',...]}]}
const handler=createMemoryHttpHandler({service:memory,resolveCaller});
// resolveCaller validates existing localhost Host/Origin, browser session and CSRF.
// MCP context must be fixed/server-created from the authenticated run/task binding:
const mcp=createMemoryMcpServer({service:memory,callerContext:trustedRunHandle});
```

`authorize({action,scope,callerContext,state})` ต้อง return literal `true` **synchronously** เท่านั้น missing callback/context, async callback หรือ body ที่ปลอม actor/grants ถูกปฏิเสธ default action grants:

| Operation | Required action |
|---|---|
| list/recall/context/resolveRefs/status/backend/health | read |
| remember/update/forget/retention | write |
| export | export |
| configure | configure (project scope เท่านั้น) |
| setup | setup (project scope เท่านั้น) |
| rebuild | rebuild |
| proposeLesson | proposeLesson + exact current memory and base skill revisions |
| update shares | write + share on primary and each destination scope |
| link real verifier receipt | write + verify |
| explicitly flagged sensitive record | sensitive เพิ่มจาก read/write/export |

สิทธิ์ read/write primary scope ต้องออกจาก authenticated session/run/task state ของ server ไม่ใช่เพียงสิ่งที่ model แสดงใน tool schemas `state` ที่ส่งให้ authorizer เป็น canonical snapshot เพื่อ revalidate run ownership/revocation ได้

HTTP exact routes: `POST /api/memory/{remember|recall|update|list|forget|export|configure|backend|status|health|setup|rebuild|retention|context|resolveRefs|proposeLesson}`; JSON body ไม่เกิน 64 KiB ทุก body มี `projectId,scope` และ fields ตาม operation; `GET /api/memory/status?projectId=...` ได้เฉพาะ project status ไม่มี content และยังต้อง authenticate ทุก method

Lead production `GET /api/session -> {csrf}` + HttpOnly browser session และ shared request helper ที่ใส่ `X-Forge-CSRF` เป็นของ lead **ไม่ได้แก้ shared api.mjs ใน worker นี้** HTTP fixture ใช้ isolated-only `x-engineering-fixture` resolver ไม่ใช่ production authentication ไม่ได้อ้างว่าทดสอบ production CSRF ใน worker นี้ HTTP helper ปฏิเสธการสร้างเมื่อไม่มี resolver แต่ Host/Origin/session/CSRF implementation เป็นหน้าที่ host/lead

MCP export เป็น SDK Server ให้ host attach transport เดิมอย่างมี authentication ไม่สร้าง listener/public endpoint/credential flow ใหม่เอง Fixture ทดสอบ official SDK protocol ใน memory จริง; stdio/HTTP MCP mount และ provider runtime connections เป็น integration checks ของ lead

### Native inputs/results

- `remember({operationId,projectId,scope,memoryType,title,content,factKey?,sourceRefs?:[{kind,id}],sensitive?,staleAt?,expiresAt?},caller)` — ชนิด source: run/task/artifact/verification ที่มีอยู่ใน project เดียวกันเท่านั้น
- `update({operationId,projectId,scope,id,expectedRevision,patch:{title?,content?,pinned?,shares?,staleAt?,expiresAt?,sourceRefs?,verificationRef?}},caller)` — เปลี่ยน content/source ทำให้ evidence link เดิม unverified; verifierRef ต้องเป็น PASSED versioned stored verifier receipt จริง ไม่ใช่ model prose และ evidence-linked ไม่เท่ากับอนุมัติ executable procedure
- `forget({operationId,projectId,scope,id,expectedRevision},caller)` — canonical tombstone + scrub content/title ใน previous memory snapshots; hash/revision/source metadata ยังอยู่เพื่อ audit
- `list({projectId,scope,limit?,includeStale?,memoryType?},caller)` / `recall({...same,query,backend?:'keyword'|'mem0'},caller)` — limit 1..100; default ไม่คืน stale/expired; changed/missing source records ถือว่า provenance stale; conflict IDs เฉพาะ factKey เดียวกันใน exact primary scope ที่อ่านได้
- `export({projectId,scope},caller)` — JSON DATA export + scoped tombstones ไม่มี executable import path; sensitive records ต้องมี sensitive grant
- `retention({operationId,projectId,scope},caller)` — tombstone expired records ของ primary scope นี้ Expiry ซ่อนจาก reads ทันทีที่ครบเวลา; sweep จริงเป็น explicit button/API ไม่ได้แอบตั้ง scheduler
- `configure({operationId,projectId,scope,expectedRevision,config},caller)` — revision เริ่ม 0, keyword config `{backend:'keyword'}` หรือ Mem0 config ด้านล่าง
- `setup/rebuild/health/status/backend({projectId,scope},caller)` — setup ติดตั้งเฉพาะ optional isolated requirements; health เป็น observation จริง ไม่ใช่ status menu ที่อ้างว่ารันแล้ว
- `proposeLesson({operationId,projectId,scope,id,expectedRevision,skillId,skillRevision,version,instructions},caller)` — draft candidate ผ่าน adaptive service เดิมเท่านั้น

Write commands ต้องใช้ operationId คงเดิมเมื่อ delivery ไม่แน่นอน Fingerprint ป้องกัน reuse กับ input อื่น Replay ของ remember ที่ถูกลบแล้วคืน `{replayed:true,id,deleted:true}` ไม่ทำให้ record เกิดใหม่ ไม่ persist copies ของ content ใน operation receipts

### Context-compaction seam

`context({projectId,scope,query?,limit?,maxCharacters?,includeStale?,memoryType?,backend?},caller)` ส่ง:

```js
{kind:'forge.memory.data',trust:'untrusted-data',executable:false,
 items:[{id,revision,sha256,scope,content,sourceRefs,verification,stale,conflicts,
         trust:'untrusted-data',executable:false}],
 provenance:[{id,revision,sha256,sourceRefs}],metrics,authority}
```

`sha256` คือ SHA-256 ของ raw UTF-8 content; sourceRefs คือ `{kind,id,revision,sha256}` ที่ validate จาก canonical source ไม่ copy source text `maxCharacters` 256..64000 (default 12000) นับ serialized item JSON characters จริง ไม่มีการเดา token count

**Context versions/spills/receipts ต้อง persist เฉพาะ `{id,revision,sha256}` refs ห้ามเก็บ memory text เป็น summary ที่จะคืนหลัง forget** เรียก `resolveRefs({projectId,scope,refs:[{id,revision,sha256}]},caller)` ใหม่ทุก resolve/compaction/dispatch Result `{kind,trust,executable,items,missing}`; missing refs ห้าม fallback ไป cached text `resolveRefs` คืน stale annotation เมื่อ source เปลี่ยน host ต้องไม่ให้ข้อมูลนี้ override verified project state / owner requirements / permissions / acceptance criteria

## การลบและ backup/recovery

Canonical `memory.tombstone` ครอบ id ถาวร แม้มี out-of-order `memory.record` เก่าตามมาจาก restored snapshot Projection ไม่เชื่อ vector payload; vector hits ใช้ id/revision เป็น hint และ resolve content ใหม่จาก canonical store พร้อม reauthorize หลัง async vector query

**Lead ต้องเรียก `mergeMemoryTombstones(restoredState,previousState)` ภายใน existing restore transaction ก่อนเปิด read/rebuild** เพื่อ union tombstones จาก pre-restore canonical state/portable metadata ที่เชื่อถือได้เข้า restored state แล้ว scrub old text อย่า restore snapshot เก่าโดยทิ้ง newer canonical tombstones Include memory events/tombstones ใน existing project/portable metadata backups; **ไม่ backup `dataDir/memory` derived caches หรือ Python env** ไม่สร้าง ledger authority แยกใหม่

Mem0 replace ล้าง managed Qdrant/history caches **ก่อน** reindex หากโมเดล unavailable เนื้อหาที่ลบจึงไม่ค้างในดัชนีเก่า ปิด backend แล้ว purge derived content ด้วย ไม่ต้องมีโมเดลเพื่อ purge เมื่อ vector indexing ล้มเหลว canonical deletion ยังคงสำเร็จ มี warning และ keyword recall ใช้ได้ Export/old physical backups ที่สร้างไปแล้วไม่ใช่สิ่งที่ service ลบย้อนหลังได้ Logical deletion ไม่ได้อ้างว่า secure erase ทุก WAL/disk sector; host ต้องป้องกันการนำ backup เก่ากลับมาโดยไม่มี tombstone union

## Mem0 setup และขอบเขตจริง

Compatible pins: `mem0ai==2.2.1`, `qdrant-client==1.20.0`, `ollama==0.6.1`; transitive Windows Python 3.12 pins ใน `app/memory/requirements-lock.txt` ซึ่ง requirements.txt ใช้เป็น constraints ไม่แก้ root dependency manifests/lockfiles

```js
{backend:'mem0',vectorStore:'qdrant-local-disk',
 embeddingModel:'<already-installed-local-model>',dimensions:768,
 extractionModel:'<already-installed-local-model>',ollamaUrl:'http://127.0.0.1:11434'}
```

Model names/dimensions ต้องตรงโมเดลในเครื่อง ไม่อ้างว่าค่า example ใช้งานได้ทุกเครื่อง Ollama URL ต้องเป็น HTTP loopback ไม่มี userinfo/query/hash ไม่รับ cloud vector DB/API keys/executable paths จาก GUI/MCP Vectorstore directory เป็น host-managed isolated path (hash ของ projectId) ไม่มี path traversal จาก projectId

GUI: save config → set up isolated dependencies → install local Ollama/models ตามนโยบายเครื่อง → health → rebuild → เลือก Mem0 search ไม่มี auto-download โมเดล Stock Mem0 Ollama embedding class อาจ pull โมเดลเอง จึงใช้ narrow local embedding class ผ่าน real Mem0 factory ที่ตรวจว่า model มีแล้วเท่านั้น Production extraction model ถูก config จริง Adapter มี constructor-only `extractDraft()` ที่ใช้ local `Memory.add(infer=True)` และคืน DATA draft ไม่ expose เป็น auto-ingestion/native write ส่วน canonical reindex ใช้ `infer=False` เสมอ ไม่เรียก LLM

CLI สำหรับ engineering เท่านั้น: `python app/memory/setup.py <absolute-dedicated-backend-dataDir>` GUI เรียก `setup()` seam เดียวกันด้วย static arguments ไม่ใช้ shell commands จากผู้ใช้ Python ต้องติดตั้งในเครื่องก่อน ไม่มีการดาวน์โหลด Python installer/แก้ global environment อัตโนมัติ

Worker telemetry disabled (`MEM0_TELEMETRY=false`, `DO_NOT_TRACK=1`) worker env ส่งเฉพาะ OS essentials + dedicated Mem0 settings ไม่ส่ง inherited provider tokens Mem0 text history ถูก reset หลัง projection write ไม่ใช้เป็น canonical history Public API ไม่ surface stderr/path/env/model output เมื่อ worker ล้มเหลว

## Upstream reuse matrix

ทุก commit/file hashes เก็บใน `app/memory/PRIMARY_SOURCES.json` จาก public primary repositories ที่ owner อนุมัติ ไม่มี source-code vendoring หรือเพิ่ม orchestrator

| Component | Decision / pin / license | API & compatibility / verification |
|---|---|---|
| Mem0 OSS | ADAPT; commit `f93aba4b53241ccd9db32903cd19d1ff7f0066f0`, package 2.2.1, Apache-2.0 | `Memory.from_config`, add(infer=False), search(filters), reset, close; source `mem0/memory/main.py`, `utils/factory.py`, `embeddings/ollama.py` Real SDK + factory embedding extension + Qdrant roundtrip verified. 2.2.1 search requires user_id inside filters; custom provider config names rejected upstream, process-local supported ollama factory mapping used. No LLM result quality claim. |
| Qdrant | ADAPT local Python client 1.20.0; server reference commit `23065a0bf6857c3e5da45f6c8939cc746cc0580e`, Apache-2.0 | SDK embedded local path mode; no Rust server dependency. Real disk persistence, filters, shared-scope filter and deletion tested. Ephemeral memory mode deliberately rejected because short-lived workers must survive restart. |
| Graphiti | DEFER runtime, EVALUATED optional; `a61333edfa14cc483365ed7dd1e287ae6096db6c`, Apache-2.0 | `graphiti_core/graphiti.py`: add_episode/reference_time/group_id, search, remove_episode, graph driver lifecycle can model temporal validity. Driver/model/extraction configuration and deletion of all derived graph entities need separate qualification; project scope must map to authorized group_id before query. Existing canonical timestamps/revisions handle local temporal provenance now. No mandatory graph daemon added. |
| Letta | REFERENCE only; default `8816d3a8516893bfdc0fa14bfb1235226012e295`, archive architecture `56ba9c25552605eec89de8ed3dc6394b625c1993`, Apache-2.0 | Current approved repo default README redirects to letta-code; historical block schema/manager inspected on pinned archive branch, not misreported as current runtime. Shared/read-only blocks inform owner/team shared memory and caller-independent write checks; no Letta server, native agent-state duplication or dependency. |
| DeepSeek Harness | REFERENCE; `4b399c39a6d1479cd84ca591b4d7c88e24d38a96`, MIT | Read package/safety contracts and owner DH addendum; context worker owns scoped compaction integration. Memory exposes typed data service, canonical events/replay and replaceable adapter only. No second orchestration plane; developer-preview runtime is not a security boundary. |

## Verification และสถานะที่ยังแยกไว้

Verified on this Windows worktree: Node 24.19.0, Python 3.12.10. Isolated optional test env `app/memory/.qualification-env` อยู่ใน .gitignore ไม่ส่งไป repo Shared installed JS deps ใช้ ignored node_modules junction ไป checkout หลักเพื่ออ่าน dependencies ที่มีอยู่ ไม่แก้ manifests/lockfiles

Commands:

```text
node --test tests/memory-*.test.mjs tests/adaptive-improvement.test.mjs
node --check app/memory/index.mjs
git diff --check
```

Last combined run: **25 passed, 0 failed, 0 skipped** (18 worker test entries including fixture module + 7 existing adaptive regression tests). Real Mem0 test uses deterministic **fixture-only hash embeddings** and a no-inference LLM that throws if invoked; real Memory/Qdrant classes, SDK search/filter, disk restart and deletion remain exercised. This establishes integration behavior, not semantic relevance/model quality. Optional test on a machine without env is explicitly SKIP/NOT_RUN; enable with isolated env or `FORGE_MEMORY_TEST_PYTHON=<absolute-python-path>`.

เพิ่มเติม: เรียก adapter `setup()` จริงใน temporary data directory ใหม่ สร้าง venv ใหม่และติดตั้ง pinned dependencies สำเร็จ `{installed:true}`; จากนั้น `health()` ผ่านด้วย Mem0 2.2.1/Qdrant client 1.20.0/fixture true/inference not-run แล้วลบ qualification directory ตามขอบเขตที่ตรวจแล้ว การทดสอบนี้ยืนยัน static setup command ทำงานบนเครื่องพัฒนา ไม่ใช่เพียงเมนู แต่ไม่แทน clean home-machine/Python-installation UAT

SQLite keyword fixture: English `recovery`, Thai `ภาษาไทย`, short Thai `จำ` resolve the known canonical record; no claim about general multilingual relevance. Metrics record real returned/eligible counts, content/context characters and `performance.now()` retrieval latency per caller/scope. `contextTokens` unknown without provider tokenizer/usage receipt; `resourceCost` unknown; default `retrievalQuality` not-evaluated. No made-up money, token count, accuracy, improvement or paid inference receipt

**Integration work remaining for lead (implementation, not credentials):** import Memory.jsx into App navigation; mount HTTP/MCP with trusted session/run grants; create service/adaptive binding; call restore tombstone union; connect DH-04 context callbacks; propagate configured permissions/protected context boundaries through run dispatch. Worker cannot edit those shared paths. Production CSRF/GUI routing/browser interactions are not claimed verified by isolated fixture.

**Runtime/live checks NOT_RUN:** actual local Ollama embedding and extraction models, model-dependent semantic relevance, production MCP transport/provider-native runtime recall, measured provider token usage/resource cost, Python setup on a clean home machine, browser UAT, HOME_UAT. These do not block SQLite core; missing live credentials are not required for local core or real SDK fixture.

**Implementation limitations disclosed:** Graphiti runtime adapter is not implemented (MEM-09 requires evaluation; intentionally optional); general automatic conversation ingestion and executable skillwriter are intentionally absent; model installation/OS Python acquisition is not automated; token accounting requires the context/provider seam to supply actual usage, not a heuristic. No external accounts/credentials transferred, paid calls, prototype, public hosting or release performed.
