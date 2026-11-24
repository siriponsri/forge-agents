# คู่มือตรวจ T3 ไม่แสดง GPT-6.2

ทบทวนวันที่ **24 พฤศจิกายน 2026 (Asia/Bangkok)** ใช้ตรวจ environment สำหรับพัฒนา FORGE เป้าหมายคือแยกสาเหตุให้ชัดและใช้โมเดลที่พร้อมทำงานต่อ ไม่ต้องรอ 6.2 เพื่อเริ่มพัฒนา FORGE ให้ครบ

## สิ่งที่รู้แล้ว และสิ่งที่ยังไม่รู้

มี upstream issue ที่ตรงกับอาการ: [#38609](https://github.com/pingdotgg/t3code/issues/38609) รายงาน `gpt-6.2-sol` หายจาก picker เพราะ catalog refresh ช้าเกินสามวินาทีแล้ว T3 ใช้ข้อมูลเก่า ผู้รายงานใช้ T3 0.1.10, Codex CLI 0.169.0, macOS arm64 และ ChatGPT sign-in จึงยังไม่ยืนยันว่าเครื่อง Windows ของคุณเกิดจากสาเหตุเดียวกัน

[PR #38889](https://github.com/pingdotgg/t3code/pull/38889) ที่เสนอแก้ปัญหายัง **open / unmerged** ในวันที่ตรวจ โค้ด main revision `8a9e8d12a86fd5640a609ea277afba948a9470dd` ยังมีขีดจำกัดสามวินาที ส่วน release ล่าสุดที่ตรวจคือ [v0.1.11](https://github.com/pingdotgg/t3code/releases/tag/v0.1.11) ลงวันที่ 20 พฤศจิกายน **ยังไม่มีหลักฐานให้บอกว่า release นี้แก้ issue ดังกล่าวแล้ว** ก่อนแนะนำเวอร์ชันที่แก้ ต้องตรวจ merged commit และ release ที่รวม commit นั้นอีกครั้ง

สิ่งที่ยังไม่รู้คือ T3 version ที่คุณติดตั้ง, local/remote server, provider instance ที่ thread ใช้, managed/manual mode, runtime path/version จริง, account/workspace และ model list ของ connection นั้น ห้ามเติมข้อมูลเหล่านี้ด้วยการเดา

## เริ่มตรวจอย่างไร

เปิด T3 thread ด้วย **GPT-6.1 xhigh ที่เลือกและรันได้จริง** แล้วคัดลอกข้อความทั้งหมดจาก [DIAGNOSE_T3_MODELS.txt](prompts/DIAGNOSE_T3_MODELS.txt) วางเป็นคำสั่ง การตรวจรอบแรกเป็น read-only: อ่านสถานะและ source/config metadata ที่ไม่ใช่ความลับ ไม่เปลี่ยน settings, ไม่ login ใหม่, ไม่ลบ cache/credential และไม่แก้ source ของ T3 ที่ติดตั้ง

หาก agent ใน T3 เข้าถึง UI/provider status ไม่ได้ ให้ส่งเฉพาะข้อมูลที่ขาดจากหน้า About, Providers และ thread model picker แทน ไม่จำเป็นต้องส่งไฟล์ authentication หรือ log ทั้งชุด

### ข้อมูลขั้นต่ำที่ต้องบันทึก

| รายการ | ตรวจจากที่ใด | เหตุผล |
|---|---|---|
| T3 desktop และ server version | About/status/diagnostic ที่มีจริง | desktop กับ remote server อาจไม่ใช่ runtime เดียวกัน |
| thread / provider instance | thread controls และ Providers | ชื่อ provider เหมือนกันอาจมีหลาย connection |
| managed หรือ existing CLI login | หน้า setup ของ provider | ใช้เส้นทางบัญชีและ catalog ต่างกัน |
| Codex executable/path/version ที่ provider ใช้ | provider metadata หรือ config เฉพาะ non-secret fields | `codex` บน PATH อาจเป็นคนละตัวกับ T3 |
| account/workspace ที่เลือก | UI metadata แบบปกปิดข้อมูลส่วนบุคคลที่ไม่จำเป็น | entitlement/catalog อาจต่างกันระหว่าง workspace |
| requested / selected / effective model | picker, capability output, request metadata ที่มีจริง | label หรือข้อความ prompt ไม่พิสูจน์โมเดลที่รัน |
| freshness และ error ที่เกี่ยวข้อง | sanitized provider diagnostics | แยก stale catalog, authentication, unavailable model และ execution error |

ถ้าจำเป็นต้องตรวจ command resolution ใน PowerShell ใช้คำสั่งอ่านข้อมูลนี้ได้:

```powershell
Get-Command codex -All | Select-Object Name, Source
```

ผลเป็นเพียงรายการ executable ที่ shell หาเจอ **ยังไม่ยืนยันว่า T3 ใช้ตัวนั้น** ให้เทียบกับ provider metadata ก่อนเรียก `--version` ด้วย absolute path ที่ยืนยันแล้ว ไม่อ่าน `auth.json`, token, cookie, API key หรือ environment dump เพื่อหาคำตอบนี้

## Decision tree สำหรับแยกสาเหตุ

### 1. ระบุ provider route ของ thread ได้หรือยัง

- **ยังไม่ได้:** เก็บข้อมูล provider instance และ managed/manual mode ก่อน ไม่มีเหตุผลให้แก้ cache หรือ update CLI ที่ยังไม่รู้ว่าใช้อยู่
- **ได้แล้ว:** ใช้ข้อมูลของ connection นี้ตลอดการเปรียบเทียบ อย่าสลับ workspace หรือ runtime แล้วสรุปว่าเป็นผลจากการแก้ catalog

### 2. Runtime ตัวจริงผ่าน prerequisite หรือไม่

OpenAI ระบุ Codex CLI **0.166.0 ขึ้นไป** สำหรับ GPT-6.2 Astra/Sol พร้อมเงื่อนไข plan, seat และ workspace [เอกสาร OpenAI](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex)

- **ต่ำกว่า:** รายงานว่า version เป็น prerequisite ที่ยังไม่ผ่าน และเสนอ supported update ของ installation นั้น รอบ read-only นี้ยังไม่สั่ง update
- **ผ่านแล้ว:** ไปขั้นต่อไป อย่าสรุปว่า entitlement หรือ cache ต้องถูกต้อง เพราะ #38609 รายงานกับ CLI 0.169.0
- **ไม่ทราบ:** ระบุว่า `NOT_VERIFIED` และบอกข้อมูลที่ต้องดูเพิ่ม ห้ามใช้ global CLI version แทนโดยอัตโนมัติ

### 3. ถ้าเป็น managed “Connect with ChatGPT”

ตรวจ catalog และ workspace ของ managed connection ก่อน T3 มีขั้นตอนแยกสำหรับ **Use an existing Codex login**; การรัน `codex login` ไม่ได้แทน managed login ของ T3 โดยอัตโนมัติ [คู่มือ T3](https://github.com/pingdotgg/t3code/blob/8a9e8d12a86fd5640a609ea277afba948a9470dd/docs/user/providers-codex.md)

ถ้า CLI ใช้โมเดลได้แต่ managed connection ไม่มี ให้บันทึกเป็น **route/catalog difference** ก่อน ข้อเสนอหนึ่งคือเพิ่ม existing CLI login เป็น provider instance แยกผ่าน wizard ที่มีจริง แล้วเลือก instance นั้นชัดเจน โดยคง managed connection เดิมไว้ ไม่ย้ายหรือคัดลอก credential files ระหว่าง runtime homes

### 4. ถ้าเป็น native / existing CLI route และพบ catalog เก่า

ตรวจ timestamp และ warning ที่เกี่ยวข้องกับ refresh ใน diagnostic ที่ได้รับอนุญาต เมื่อจะลงมือแก้ขั้นถัดไปจึงใช้ปุ่ม refresh/status ที่มีจริง รอ refresh จบแล้วอ่าน catalog ใหม่ วิธีนี้ **อาจช่วย** แต่ไม่รับประกันว่าจะพ้น bug

หากพบข้อความเกี่ยวกับ refresh ไม่ทันและคืน cached catalog ให้เทียบกับ #38609 โดยแนบ versions, route และ non-secret timestamps เพื่อสนับสนุนข้อสันนิษฐาน ไม่ต้องลบ cache ก่อน และอย่าเพิ่ม timeout ทั่วไปแล้วอ้างว่าแก้แล้ว: `T3CODE_CODEX_PROBE_TIMEOUT_MS` เป็น deadline ของ provider check แต่โค้ดที่ตรวจมี catalog wait cap สามวินาทีแยกอยู่ [CodexProvider.ts](https://github.com/pingdotgg/t3code/blob/8a9e8d12a86fd5640a609ea277afba948a9470dd/apps/server/src/provider/CodexProvider.ts)

### 5. Picker ไม่มีชื่อ แต่ connection เดียวกันยอมรับ model ID จริงหรือไม่

ถ้ามีหลักฐาน request สำเร็จบน runtime/account/workspace เดียวกัน ให้แยก **discovery/picker issue** ออกจาก **model execution** การเพิ่ม custom model ทำได้เฉพาะเมื่อ integration รองรับ และต้องตรวจ reasoning/options กับ request จริงภายหลัง การเพิ่มชื่อเองไม่ได้สร้าง entitlement และ managed route อาจไม่ใช้ custom entry อย่างที่คาด [Composer documentation](https://github.com/pingdotgg/t3code/blob/main/docs/user/composer.md)

การทดสอบ request สั้นเป็นขั้นยืนยันหลังเลือก route/model แล้ว ไม่ใช่หลักฐานที่ได้จากการดู label อย่างเดียว ถ้า agent ไม่มีช่องทางส่งหรืออ่านผลจริงให้บันทึก `NOT_RUN` ไม่อ้างว่าสำเร็จ

### 6. ทั้ง catalog และ request ยังไม่รองรับ

แยกผลเป็น version prerequisite, account/workspace access, authentication error, catalog staleness, invalid model ID หรือข้อจำกัดของ integration ตามหลักฐาน ใช้ `UNKNOWN` เมื่อยังแยกไม่ได้ ไม่เปลี่ยนเป็นการวินิจฉัยเรื่องสิทธิ์โดยไม่มี error รองรับ

**กลับมาพัฒนา FORGE ด้วย GPT-6.1 xhigh ที่ใช้งานได้ทันที** บันทึกเรื่อง 6.2 เป็น environment issue แยกจาก product implementation ไม่ใช้เป็นเหตุข้าม acceptance หรือสร้าง prototype แทน scope ที่ตกลง

## รูปแบบรายงานผลที่ต้องได้

1. **Observed facts:** versions, route, actual runtime และ model/options ที่เห็นจริง พร้อมที่มาที่ไม่มี secret
2. **Diagnosis:** confirmed / likely / unknown แยกแต่ละสาเหตุ พร้อมหลักฐานที่สนับสนุนและข้อมูลที่ยังขาด
3. **การตั้งค่าที่ทำงานต่อได้ตอนนี้:** exact provider/model ID และ effort ที่รองรับ ถ้าไม่รู้ ID ให้ระบุว่ายังไม่ยืนยัน
4. **Next action ที่เล็กที่สุด:** เช่น refresh ที่ route เดิม, supported runtime update หรือเพิ่ม provider instance แยก ไม่เสนอหลายการเปลี่ยนพร้อมกันจนแยกสาเหตุไม่ได้
5. **สถานะการทดสอบ:** สิ่งที่อ่านแล้ว, request ที่ส่งจริงหรือ `NOT_RUN`, สิ่งที่ยังไม่เปลี่ยน และวิธีย้อนกลับหากมีการแก้ภายหลัง

ไม่ส่ง token, cookie, credential file, URL ที่ฝัง secret หรือ log ทั้งชุด แหล่งข้อมูลและผลตรวจ source โดยละเอียดอยู่ใน [T3_MODEL_DISCOVERY_RESEARCH.md](reference/research/T3_MODEL_DISCOVERY_RESEARCH.md) ส่วนการจัดงานพัฒนาต่ออยู่ใน [07_MODELS_AND_WORKTREES.md](07_MODELS_AND_WORKTREES.md)
