# โครงการจริงบน dr-train: Cardiac Arrest master plan

เอกสารนี้แปลงแผนที่ Owner แนบเป็นลำดับทดสอบ FORGE ที่บ้าน ไม่ใช่รายงานผลวิจัย
ไม่มี dataset download, training, clinical prediction หรือ deployment ในรอบเตรียม

## Scope ที่ต้องเห็นในทุกหน้าจอ

| Task | เป้าหมายบ้าน | ข้อห้ามในการตีความ |
|---|---|---|
| `AHE_1H` | public benchmark ความดันต่ำในชั่วโมงถัดไป เริ่ม CPU | ห้ามเรียกผลนี้ cardiac arrest risk |
| `IHCA_24H` | ตรวจ schema/label/event timing/grouping ก่อน | ไม่มีโมเดลให้แสดง MODEL_NOT_AVAILABLE พร้อม score null |
| `IHCA_6H/12H`, ECG/VA | conditional research ภายหลัง | ไม่รวมเป็นโมเดลเดียว/ไม่เทียบ metric ข้าม endpoint |
| Synthetic replay | ทดสอบ UI/API/leakage contracts | ไม่ใช่ performance หรือการรับรองclinical |

Official [PhysioNet Challenge 2009 v1.0.0](https://physionet.org/content/challenge-2009/1.0.0/)
เป็น acute hypotension และเปิดเผย test answers/future segments แล้ว จึงต้องแยก
training inputs ออกจาก answer/future files อย่างเข้มงวด ล็อก protocol ก่อนอ่านผล test
หน้า source/ชื่อ archive ไม่พอ ต้องตรวจจริง channel/cadence/index และ checksum

## Milestone mapping เป็นงานจริงใน FORGE

| Milestone | Canonical tasks / outputs | Acceptance |
|---|---|---|
| M0 | project แยก, approved brief, env lock, source registry, data governance, disk audit | envverifyจริง; ไม่มีความลับ/ข้อมูลดิบในGit; access/resource envelope |
| M1 | smoke record acquisition, bounded numeric parser, endpoint/index/quality, frozen split | actualbytes+hash; causal features; group/officialsplit tests; full waveform mirrorไม่จำเป็น |
| M2 | B0/B1/B2/B3 และ B4ถ้าเหมาะ, validation, frozen selection, officialA/B evaluation | actualfit+heldoutpredictions+metric recomputation; เก็บpoor/failedruns |
| M3 | trusted model/preprocessor registry, offline replayAPI, researchGUI | inferenceตรงoffline; wrongtask/corrupt/missingmodelถูกปฏิเสธ; syntheticชัด |
| M4 | demoICU schema/label feasibility, report/modelcard/decisionmemo | แยก auditจากtrainedIHCA; ระบุaccess/clinicalreviewที่ยังขาด |
| M5–M7 | credentialedIHCA, externalvalidation, prospectiveproposal | ทำต่อเมื่อdataaccess/labels/clinicalgovernanceอนุมัติแยก |

แนะนำเริ่ม DAG สำหรับ known M0→M1→M2→M3 และ generator/verifier สำหรับตรวจ
pipeline/metrics โดย reviewerใช้ distinct approved task/workspace และอ่าน evidenceจริง
Parallel ใช้กับเอกสาร/adapterที่ไม่มี sharedmutableoutput ไม่ให้หลายworkerแก้splitเดียว
Supervisor แตกงานได้ แต่คำกล่าวของagentไม่ใช่ผลverificationหรือclinicalapproval

## Dataset / leakage gates

- ดิบ immutable นอกGit; manifestระบุ version/license/source/hash และ data class
- outcome tableแยกfeaturetable; future perturbationไม่เปลี่ยน featureที่เวลาt
- patient/groupไม่ข้ามsplit; demoกับfullอาจทับซ้อน ไม่ใช้เป็นexternalvalidationอิสระ
- fit imputer/scaler/selection/calibrationบนdevelopmentเท่านั้น
- officialtestใช้งานครั้งที่แผนล็อกไว้ ไม่ปรับthresholdหลังดูtestเพื่อให้ผลดีขึ้น
- eventtime/negativecensoringไม่ชัด → BLOCKED_LABELS สำหรับIHCA ไม่สร้างlabelเดา
- controlled rows/weights/logsไม่ส่งไปLLM/cloud/publicdashboard; publicsourceยังต้องตามlicense

## Environment และการทดลอง

ใช้ Python3.11/3.12 target lock, CPU workers<=4 และ seed42 ตามแผนต้นฉบับ
เริ่ม logisticล่าสุด/temporalก่อนdeepmodel ไม่จำเป็นต้องมีGPUหรือLLMpredictor
dependency inputควรมี numpy,pandas,pyarrow,scikit-learn,wfdb,joblib,pytest
เพิ่มxgboost/matplotlib/PyTorchเฉพาะแผนที่ต้องใช้และresolveบนเครื่องtargetจริง
versionsในinputไม่เท่ากับlockที่ผ่านfit ให้บันทึกactualversions/hashes

CLI `python -m caews ...` ในต้นฉบับยังเป็น **proposed interfaces** ไม่มีpackageนี้ในFORGE
สร้างsourceprojectแยกเมื่อเริ่มบ้าน อย่ารันคำสั่งแล้วสรุปว่าFORGEมีCA-EWSimplementation
Studioรอบนี้ใช้ช่วยสร้างcanonicalbrief/mission; recipeexecution/registryต้องผ่านU1–U6
หาก operatorใช้SSH/CLIสร้างpublicPoCได้ก่อน ให้รายงานผลเป็นprojectverification
แยกจาก no-code FORGE end-to-end qualification

## สิ่งส่งมอบทุก attempt

run/attemptID, sourcecommit, recipe/confighash, data/splithash, envlock/interpreter,
start/end/machine/limit, realexit/logs, model+transformhash, predictions, metricJSON,
uncertainty/counts, plots และfailedreason ห้ามcommitrawpatientdataหรือpickleจากแหล่งไม่น่าเชื่อถือ
วัดAP/AUROC/calibrationตามข้อมูลที่estimable; ไม่แปลงจำนวนrecordAHEเป็นwardalarmburden

## Definition of done รอบบ้านแรก

1. SSHและenvironment qualification ผ่านพร้อมหลักฐาน
2. อย่างน้อยbaselineกับtemporalcomparatorfitจริงบนpublicAHEและholdoutถูกต้อง
3. replayใช้savedAHEmodelจริง; IHCAยัง unavailable จนtrainedvalidmodelมีจริง
4. มีIHCAfeasibilityและสิ่งที่ต้องขอaccess/clinicalreview ไม่มีclinicaldeployment
5. ผลcloudlifecycleแยกจากscientificresults พร้อมcleanup/billing
6. README/reproductioncommand/testreport/knownlimitations/Ownerdecisionครบ

ผลโมเดลแย่หรือinconclusiveเป็นผลที่ยอมรับได้ ห้ามเปลี่ยนendpoint/testเพื่อmanufacture success
