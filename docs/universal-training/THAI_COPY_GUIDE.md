# FORGE plain-Thai UI copy guide (seed v1, lead-owned)

Audience: no-code users. Every Thai string should make sense on a first read, without knowing how FORGE works inside.

## Rules
1. Use short sentences and everyday words. Limit each sentence to one idea. Split a long help text into a short line, plus a "รายละเอียด" line only if it's really needed.
2. Buttons start with a verb and name the result: "บันทึก", "เริ่มเทรน", "อนุมัติแผน", "เปิดโปรเจกต์". Avoid vague labels such as "ดำเนินการ", "ใช้คำสั่งและบันทึก", or "เดินหน้าตามขั้น".
3. Errors and warnings follow the pattern "what happened + what to do next": "เชื่อมต่อบริการ AI ไม่ได้ ตรวจคีย์ใน ตั้งค่า → บริการ AI แล้วลองใหม่".
4. Don't put internal or engineering words on screen: reconcile, revision, hash, receipt, admission, lease, idempotent, operationId, binding, fixture, qualified, observed. Say what it means for the user instead. Technical identifiers (paths, IDs, raw values) may appear only as secondary detail in a smaller muted line, never as the main sentence.
5. Use one term per concept (see the glossary). Don't mix synonyms.
6. Keep English only for words Thai users already use: AI, GPU, CPU, CSV, PDF, Python, API, URL, MCP, SSH, Colab, Jupyter, Docker, GitHub, model names. Write the rest in Thai.
7. Don't write "ไทย / English" pairs inside a Thai string. The English argument of t() already covers that.
8. Keep a polite, friendly, neutral tone. Don't end strings with "ครับ" or "ค่ะ". Put the subject first when it helps: "ไฟล์นี้ใหญ่เกินไป (สูงสุด 16 MB)".
9. Keep numbers, units and placeholders (`${n}`, {name}) exactly as they are in the code.
10. Never change meaning or remove safety information. If a string carries a safety or authorization boundary, such as "ยังไม่อนุมัติ" or "จะมีค่าใช้จ่าย", keep the boundary and say it plainly.

## Glossary (use exactly these)
| Concept (EN) | Thai to use | Avoid |
|---|---|---|
| Project | โปรเจกต์ | โครงการ (in UI chrome) |
| Workspace directory | โฟลเดอร์งาน | พื้นที่ทำงาน (for the folder) |
| Bot / agent | ผู้ช่วย AI | บอท (alone), เอเจนต์ |
| Bot team | ทีมผู้ช่วย AI | ทีมบอท |
| Conversation | แชต | ห้องสนทนา |
| Plan / phase / task | แผนงาน / ช่วงงาน / งานย่อย | |
| Approve / approved | อนุมัติ / อนุมัติแล้ว | ยืนยันสิทธิ์ |
| Acceptance criteria | เกณฑ์ว่างานเสร็จ | เกณฑ์ตรวจรับ |
| Evidence | หลักฐาน | |
| Mission | ภารกิจ | |
| Artifact | ไฟล์ผลลัพธ์ | อาร์ทิแฟกต์ |
| Provider (OpenAI, Claude…) | บริการ AI | provider |
| Connection | การเชื่อมต่อ | |
| Model | โมเดล | |
| Compute target | เครื่องประมวลผล | เป้าหมายประมวลผล |
| Serving / deployment | เปิดใช้งานโมเดล (deploy) | การให้บริการ |
| Inference / prediction | การทำนาย | |
| Dataset | ชุดข้อมูล | |
| Train / fine-tune | เทรน / ปรับจูน | ฝึก (mixed) |
| Evaluate | วัดผล | ประเมินผล (OK in long text) |
| Notebook | สมุดโค้ด Python | สมุดงาน |
| Session | รอบการทำงาน | เซสชัน |
| Strategy / skill | กลยุทธ์ / ทักษะ | |
| Memory | ความจำของ AI | |
| Budget / usage | งบ / การใช้งาน | |
| Governance / permission | สิทธิ์และการอนุญาต | |
| Secret / API key | คีย์ลับ | ซีเคร็ต |
| Refresh state | โหลดข้อมูลล่าสุด | |
| Revision conflict (409) | "มีการแก้ไขข้อมูลนี้ก่อนหน้า ระบบโหลดข้อมูลล่าสุดแล้ว ตรวจอีกครั้งแล้วลองใหม่" | |
| Reconcile / unknown outcome | ตรวจสถานะล่าสุด / ยังไม่รู้ผล | reconcile |
| sha256 / hash | รหัสตรวจไฟล์ | hash |
| Settings | ตั้งค่า | |
| Desktop / browser automation | ให้ AI ใช้คอมพิวเตอร์/เบราว์เซอร์ | |
