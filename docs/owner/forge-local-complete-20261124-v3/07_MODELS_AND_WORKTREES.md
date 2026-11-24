# เลือกโมเดลและแบ่งงานพัฒนา FORGE ด้วย Branch / Worktree

ทบทวนวันที่ **24 พฤศจิกายน 2026 (Asia/Bangkok)** เอกสารนี้ใช้เลือกเครื่องมือสำหรับ **พัฒนา FORGE ให้ครบและเปิด localhost ได้สำหรับผู้ใช้ no-code** ไม่ใช่การกำหนดโมเดลตายตัวให้ผู้ใช้ผลิตภัณฑ์ FORGE และยังไม่สร้าง product ต้นแบบในรอบนี้

## เริ่มงานได้ทันทีด้วยโมเดลที่ใช้ได้จริง

ใช้ **GPT-6.1 xhigh ที่เลือกและรันได้จริงใน T3 ของคุณ** เป็นค่าเริ่มต้น บันทึก exact model ID จาก provider ก่อนเรียกชื่อรุ่นย่อย เพราะคำว่า “GPT-6.1 xhigh” ที่ผู้ใช้ระบุยังไม่ยืนยันว่าเป็น Sol หรือ Astra การเขียนชื่อโมเดลลงใน prompt ไม่ได้เปลี่ยนโมเดลของ thread ต้องเลือกผ่าน controls ที่มีจริงและตรวจผลการรัน

เราไม่ได้เชื่อมต่อ T3 บนเครื่อง Windows ของคุณในบทสนทนานี้ จึงยังไม่ยืนยัน installed version, connection mode, account/workspace, executable ที่ใช้ หรือรายการโมเดลจริง งานพัฒนา FORGE เดินต่อได้โดยไม่ต้องรอแก้ model picker ให้มี 6.2 ก่อน

## Top 3 รูปแบบตามความพร้อมของเครื่อง

ลำดับนี้เป็นทางเลือกในการจัดงาน **ไม่ใช่ผล benchmark ว่าโมเดลใดเก่งกว่า ถูกกว่า หรือเร็วกว่า** เลือกแบบแรกที่ทำงานได้ครบเงื่อนไขของคุณ

| ทางเลือก | การจัดบทบาท | เหมาะเมื่อ | เงื่อนไขก่อนใช้ |
|---|---|---|---|
| **1 — แนะนำให้เริ่มตอนนี้** | GPT-6.1 xhigh ที่ใช้ได้จริงเป็นผู้ลงมือหลัก ทำ foundation, implementation และ integration ตามลำดับ; ให้ผู้ตรวจอีก thread ช่วยเฉพาะจุดได้เมื่อพร้อม | ต้องการเริ่มทันที ลดภาระตั้งค่าหรือแบ่งงาน | ยืนยัน model ID, reasoning option และ request สำเร็จบน provider ที่เลือก |
| **2 — เพิ่มผู้ประสานงานเมื่อมี Astra** | Astra ที่เข้าถึงได้เป็น lead/integrator/reviewer; GPT-6.1 xhigh ที่ใช้ได้จริงเป็น coding worker เริ่มจากไม่เกินสองงานอิสระพร้อมกัน | contracts ชัดเจนและงานแยก ownership ได้จริง | Astra และ worker มี connection ที่รองรับ; ถ้าไม่มี orchestration tools ให้ใช้ thread แยกกับ assignment ที่ชัด หรือทำต่อแบบลำดับ |
| **3 — ใช้ 6.2 หลังตรวจการเชื่อมต่อแล้ว** | GPT-6.2 Astra เป็น lead/reviewer และ GPT-6.2 Sol เป็น coding worker; ยังคงจำนวน worker เริ่มต้นน้อย | provider route เดียวกับที่จะใช้งานจริงรองรับทั้งสองรุ่นแล้ว | โมเดลที่ต้องการถูกค้นพบหรือยอมรับจริง, ส่ง request สั้นสำเร็จ และมี reasoning options ที่ provider รองรับ |

ใช้เฉพาะ effort/options ที่ provider ของโมเดลนั้นประกาศ ถ้า `xhigh` ใช้ไม่ได้ให้แสดงตัวเลือกจริงและตัดสินใจอย่างชัดเจน ห้ามตั้ง label ให้ดูเหมือนกำลังใช้รุ่นหรือ effort ที่ไม่ได้รัน การให้ lead ใช้ Astra เป็นข้อเสนอเรื่องบทบาท ไม่ใช่ข้อบังคับที่ทำให้งานหยุดเมื่อไม่มี Astra

## อาการ T3 ไม่แสดง 6.2: ข้อมูลที่ตรวจพบจริง

[Issue #38609](https://github.com/pingdotgg/t3code/issues/38609) ตรงกับอาการที่รายงาน: `gpt-6.2-sol` หายจาก model picker เพราะ T3 รอ catalog refresh สามวินาทีแล้วคืนรายการเก่า ผู้รายงานใช้ T3 **0.1.10**, Codex CLI **0.169.0**, macOS arm64 และ ChatGPT sign-in จึงเป็นหลักฐานว่ามีปัญหาลักษณะนี้จริง แต่ยังไม่ใช่การวินิจฉัยเครื่อง Windows ของคุณ

วันที่ตรวจ issue ยัง **open** และ [PR #38889](https://github.com/pingdotgg/t3code/pull/38889) ยัง **open / unmerged** โค้ด main ที่ตรวจ ณ revision `8a9e8d12a86fd5640a609ea277afba948a9470dd` ยังมี `CODEX_CATALOG_REFRESH_TIMEOUT_MS = 3_000` และ fallback ไป catalog เดิม จึงไม่อ้างว่ามี released fix แล้ว [โค้ดที่ตรวจ](https://github.com/pingdotgg/t3code/blob/8a9e8d12a86fd5640a609ea277afba948a9470dd/apps/server/src/provider/CodexProvider.ts)

T3 แยก managed **Connect with ChatGPT** กับ **Use an existing Codex login** การเข้า CLI ได้ไม่ได้ยืนยัน catalog ของ managed connection และการเพิ่ม custom model slug ไม่ได้เพิ่ม entitlement ให้บัญชี [คู่มือ Codex ของ T3](https://github.com/pingdotgg/t3code/blob/8a9e8d12a86fd5640a609ea277afba948a9470dd/docs/user/providers-codex.md)

OpenAI ระบุ Codex CLI **0.166.0 ขึ้นไป** สำหรับ GPT-6.2 Astra/Sol และยังมีเงื่อนไข plan, seat และ workspace ต้องตรวจ runtime ที่ T3 provider นั้นใช้จริง ไม่ถือว่า `codex` ตัวแรกบน PATH คือ runtime ของ T3 เสมอ และ version ผ่านเพียงอย่างเดียวไม่ตัดปัญหา catalog เพราะ issue ข้างต้นเกิดกับ 0.169.0 [เอกสาร OpenAI](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex)

ทำ read-only diagnosis ตาม [12_T3_MODEL_DIAGNOSTIC_TH.md](12_T3_MODEL_DIAGNOSTIC_TH.md) หรือวาง [DIAGNOSE_T3_MODELS.txt](prompts/DIAGNOSE_T3_MODELS.txt) ใน thread ที่ใช้โมเดลได้อยู่แล้ว ตรวจข้อมูลก่อนเปลี่ยน settings และไม่เริ่มด้วยการลบ cache หรือ credentials

## Orchestrator ต้องมีช่องทางทำงานจริง

Lead ตรวจ capability ของ T3/provider ก่อนสั่ง workers ถ้ามี authenticated orchestration interface ให้ใช้เฉพาะ tools และ parameters ที่ค้นพบจริง รวมถึง model ID, reasoning option, thread/worktree และวิธีติดตามผล T3 มีเอกสารเส้นทางสำหรับ outside agents แต่ต้องตรวจว่าการติดตั้งจริงเปิดใช้และเชื่อมต่อได้ [Outside-agent orchestration](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md)

ถ้าไม่มี tools ดังกล่าว lead ทำงานต่อเองตามลำดับ หรือเตรียม assignment สำหรับเปิด T3 thread แยก ห้ามรายงานว่าเปิด worker แล้วทั้งที่เพียงเขียนแผน Astra ที่ใช้นอก T3 ทำหน้าที่ผ่าน connection ที่มีจริงหรือผ่านไฟล์ review ที่ส่งมอบได้ ไม่ถือว่าบทสนทนานี้ควบคุม T3 บนเครื่องคุณโดยอัตโนมัติ

## Branch และ Worktree: หนึ่งผู้เขียนต่อหนึ่งพื้นที่

Lead รับผิดชอบเวอร์ชันสุดท้ายที่จะส่งเข้า `main` ได้ โดยทำงาน integration ใน branch/worktree แยก Branch แยกประวัติ ส่วน worktree ให้ working directory คนละชุดสำหรับการแก้ไขพร้อมกัน [Git worktree documentation](https://git-scm.com/docs/git-worktree)

| บทบาท | Branch ที่เสนอ | พื้นที่ทำงาน / ownership |
|---|---|---|
| เวอร์ชันส่งมอบ | `main` | revision ที่ตั้งใจให้ pull ไปเครื่องบ้าน ไม่ใช่ directory ให้หลาย agent เขียนร่วมกัน |
| Lead / integrator | `integration/forge-local-complete` | worktree แยก; architecture, shared contracts, schema/migrations, integration, review และ release evidence |
| Worker A | `feat/forge-ui-workflow` | worktree แยก; UI แบบ T3, no-code flows, team/chat, plan/board/settings ภายใต้ contracts ที่ตกลง |
| Worker B | `feat/forge-runtime-connectors` | worktree แยก; runtime/persistence/provider/MCP/compute/storage/serving เฉพาะ assignment |
| งานเฉพาะที่เพิ่มภายหลัง | task-specific branch | worktree แยก; เช่น desktop control, AG-UI bridge, Univer หรือ report adapters เมื่อ dependencies พร้อม |

ชื่อ branch เป็นข้อเสนอ Lead ต้องตรวจ `HEAD`, status, remotes, branches และ worktrees ที่มีอยู่ก่อนจัดพื้นที่ รักษางานเดิมและไม่สลับ branch ใต้ agent ที่กำลังทำงาน ไม่วาง worktree ไว้ใต้ directory ที่อีก worker สแกนเป็น app source ทั้งชุด

## ลำดับเริ่มงานและการแบ่ง ownership

1. **เริ่ม foundation แบบลำดับ:** ตรวจ repository จริง, T3 reuse boundary, startup, data/event/adapter contracts และ acceptance ของผลิตภัณฑ์ก่อน อย่าให้ workers สร้าง backend หรือ persistence schema แข่งกันคนละชุด
2. **ทำให้เอกสารตามไปกับ baseline:** เอกสาร handoff ที่เพิ่งแตก ZIP และยัง untracked จะไม่ติดไป worktree ใหม่อัตโนมัติ ใช้ scoped documentation commit ที่รักษางานอื่น แล้วบันทึก integration base commit หรือให้ reference path ที่เข้าถึงได้ชัดเจน
3. **ค่อยเปิดงานอิสระพร้อมกัน:** แต่ละงานมี Task ID, base commit, branch, absolute worktree path, owned paths, shared interfaces, dependencies, acceptance และ verification ที่ต้องส่งกลับ ใช้ [WORKER.txt](prompts/WORKER.txt) โดย lead กรอก assignment จริงให้ครบ
4. **แยกทรัพยากร runtime:** app แต่ละ instance ใช้ port, state directory, database และ temp artifacts ของตัวเอง Worktree ไม่ได้แยก GUI target, cloud resource หรือ external account ให้เอง จัด controller เจ้าของงานให้ชัด
5. **รวมและตรวจ integrated tree:** รับ diff/commits, หลักฐาน checks, blockers และ integration notes แล้ว merge ตาม dependency ผ่าน isolated worker checks ไม่ได้แปลว่า merged app ผ่าน Lead ต้องตรวจการทำงานที่ได้รับผลกระทบในต้นไม้รวม

Lead เป็นเจ้าของ shared schemas, migrations, root manifests/lockfiles และ central progress เว้นแต่ delegate เฉพาะอย่างชัดเจน Worker เขียน task-specific notes และส่งข้อเสนอเมื่อจำเป็นต้องเปลี่ยน shared contract ไม่แก้ central progress พร้อมกัน ไม่ขยาย scope และไม่ push `main` เอง

## ส่งมอบ main โดยไม่เปลี่ยนเป้าหมายผลิตภัณฑ์

พัฒนาต่อจน FORGE ครบตาม brief และ acceptance ไม่หยุดที่แผน, mock, placeholder หรือ catalog ของ integration แยกสถานะ **implemented / verified / external หรือ HOME_UAT_NOT_RUN** ตามหลักฐานจริง การรอทดสอบบนเครื่องบ้านไม่ใช่เหตุให้เว้น implementation ที่จำเป็น

Lead รวมผลและจัด handoff ตาม [08_RELEASE_MAIN_AND_HOME_HANDOFF.md](08_RELEASE_MAIN_AND_HOME_HANDOFF.md) ผู้ใช้ push เองหรือมอบหมายผ่าน [RELEASE_MAIN.txt](prompts/RELEASE_MAIN.txt) ได้ ถ้ามี authorization อยู่แล้วไม่ต้องถามซ้ำสำหรับงานในขอบเขตนั้น ใช้ normal commits/merges/push ไป remote ที่ยืนยันแล้ว เคารพ branch protection และรายงาน blocker ตามจริง

การใช้หลาย agent เพื่อสร้าง FORGE ไม่ทดแทน multi-bot runtime ของ FORGE เอง ผลิตภัณฑ์ยังต้องมี bot identities, team/private chat, durable tasks, permissions และ execution evidence ตาม requirements พร้อม AG-UI, office/report tools และ desktop/browser use ตาม scope รอบนี้ โดย **ยังไม่สร้าง CA-EWS หรือ product ต้นแบบ**

รายละเอียดแหล่งข้อมูลอยู่ใน [T3_MODEL_DISCOVERY_RESEARCH.md](reference/research/T3_MODEL_DISCOVERY_RESEARCH.md)
