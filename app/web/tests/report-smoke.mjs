// Explicit real-engine GUI engineering qualification. No user product/provider run.
import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import {chooseTheme, openRoute, openThemePicker, setLanguage} from '../../../tests/support/app-shell.mjs';
import { createApplication } from '../../server/main.mjs';
import {newSnapshot} from '../src/univer.mjs';
if(process.env.FORGE_REPORT_GUI!=='1')throw new Error('Set FORGE_REPORT_GUI=1 to run native report GUI qualification.');
const temp=await mkdtemp(path.join(os.tmpdir(),'forge-report-gui-'));
const app=await createApplication({dataDir:path.join(temp,'state')});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1500,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(20000);
const state=async()=>(await page.request.get(app.url+'/api/state')).json();
const click=name=>page.getByRole('button',{name,exact:true}).click();
async function wait(predicate){for(let n=0;n<160;n++){const s=await state();if(predicate(s))return s;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out waiting for real report state');}
try{
  await page.goto(app.url);await setLanguage(page,'en');await click('Create first project');
  await page.getByLabel('Project name',{exact:true}).fill('Disposable report GUI qualification');await page.getByLabel('Workspace directory').fill(path.join(temp,'workspace'));await page.getByRole('dialog').getByRole('button',{name:'Create project',exact:true}).click();await wait(s=>s.projects.length===1);
  const projectId=(await state()).projects[0].id;
  const snapshot=newSnapshot('sheet','รายงานจากตาราง');snapshot.sheets.sheet1.cellData={0:{0:{v:'รายการ'},1:{v:'จำนวน'}},1:{0:{v:'Engineering value'},1:{f:'=2+3',v:5}}};
  const created=await page.request.post(app.url+'/api/command',{data:{type:'document.create',operationId:crypto.randomUUID(),projectId,data:{name:'รายงานจากตาราง',kind:'sheet',snapshot,packageVersion:'1.6.1'}}});assert.equal(created.status(),200);
  await openRoute(page,'Artifacts');
  await page.getByLabel('Upload a file (up to 16 MB)',{exact:true}).setInputFiles('app/web/public/forge-workbench-preview.png');await page.getByLabel('Uploaded artifact kind',{exact:true}).selectOption('figure');await click('Upload & verify');await wait(s=>s.artifacts.some(a=>a.kind==='png'&&a.source?.kind==='browser-upload'));
  await openRoute(page,'Report Studio');
  await click('Engines & fonts');
  const cache=path.join(process.env.LOCALAPPDATA,'FORGE','report-engine-research');
  await page.getByLabel('WordCraft executable',{exact:true}).fill(path.join(cache,'wordcraft-0.18.1','wordcraft-0.18.1-windows-x64-portable','wordcraft-cli.exe'));
  await page.getByLabel('PdfCraft executable',{exact:true}).fill(path.join(cache,'pdfcraft-0.22.0','pdfcraft-0.22.0-windows-x64-portable','pdfcraft-cli.exe'));
  await page.getByLabel('Font profile version label',{exact:true}).fill('Windows font files hashed in fixture');
  await page.getByLabel('Local font files (one path per line)',{exact:true}).fill([path.join(process.env.WINDIR,'Fonts','tahoma.ttf'),path.join(process.env.WINDIR,'Fonts','tahomabd.ttf')].join('\n'));
  const configured=page.waitForResponse(r=>r.url().endsWith('/api/reports/configure')&&r.request().method()==='POST');await click('Save & inspect engines');assert.equal((await configured).status(),200);
  await page.getByText(/WordCraft · .*Ready/).waitFor();await page.getByText(/PdfCraft · .*Ready/).waitFor();
  await page.getByLabel('Source name',{exact:true}).fill('GUI report source');await page.getByLabel('Report title',{exact:true}).fill('FORGE รายงานทดสอบ / GUI qualification');
  await page.getByLabel('Heading',{exact:true}).fill('ผลการตรวจสอบ Mixed Thai/English');await page.getByLabel('Text',{exact:true}).fill('สวัสดี น้ำ กำลัง เก้าอี้\nEngineering fixture generated from the saved ReportSpec revision.');
  await page.getByText('Import from Docs or a Sheets range',{exact:true}).click();const native=(await state()).documents[0];await page.getByLabel('Source document',{exact:true}).selectOption(native.id);await page.getByLabel('Import range',{exact:true}).fill('A1:B2');await page.getByLabel('Report formulas',{exact:true}).selectOption('cached-values');await click('Preview import');await click('Add this content to report source');
  await page.getByText('Table and figure',{exact:true}).first().click();const figure=(await state()).artifacts.find(a=>a.source?.kind==='browser-upload');await page.getByLabel('Figure artifact ID',{exact:true}).first().selectOption(figure.id);await page.getByLabel('Figure caption',{exact:true}).fill('ภาพหน้าจอจาก fixture ที่อัปโหลด');
  await click('Save report source');await wait(s=>s.reports.length===1);await click('Generate DOCX & PDF');
  let s=await wait(s=>s.jobs.some(j=>j.owner==='reports'&&['ready','failed','unknown'].includes(j.status)));const report=s.jobs.find(j=>j.kind==='report');assert.equal(report.status,'ready',JSON.stringify(report.error));
  const pdf=s.artifacts.find(a=>a.kind==='pdf'),docx=s.artifacts.find(a=>a.kind==='docx');assert.ok(pdf&&docx);assert.equal(report.frozenSource.inputDocuments[0].revision,native.revision);assert.deepEqual(report.frozenSource.spec.sections[1].table.values,[['รายการ','จำนวน'],['Engineering value',5]]);
  await page.getByRole('button',{name:'Preview PDF',exact:true}).first().click();await page.getByRole('dialog').waitFor();const rendered=page.getByRole('dialog').getByRole('img',{name:'Rendered report page'});await rendered.waitFor();await rendered.evaluate(img=>img.decode());assert.ok(await rendered.evaluate(img=>img.naturalWidth>0));
  const pdfResponse=await page.request.get(app.url+`/api/artifacts/${pdf.id}/download`);assert.equal(pdfResponse.status(),200);assert.equal((await pdfResponse.body()).subarray(0,5).toString(),'%PDF-');
  const wordResponse=await page.request.get(app.url+`/api/artifacts/${docx.id}/download`);assert.equal(wordResponse.status(),200);assert.equal((await wordResponse.body()).subarray(0,2).toString(),'PK');
  await page.screenshot({path:path.join(temp,'report-preview.png'),fullPage:true});await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByLabel('Operation',{exact:true}).selectOption('rotate');await click('Run PdfCraft operation');s=await wait(s=>s.jobs.some(j=>j.kind==='pdf'&&['ready','failed','unknown'].includes(j.status)));const rotated=s.jobs.find(j=>j.kind==='pdf');assert.equal(rotated.status,'ready',JSON.stringify(rotated.error));assert.ok(s.artifacts.some(a=>a.parentArtifactIds?.includes(pdf.id)));
  assert.deepEqual(errors,[]);const evidence={result:'PASSED',kind:'real Windows native report GUI qualification',fixtureDir:temp,checks:['GUI browser image upload with verified bytes','GUI engine/font configuration','saved ReportSpec revision','selected native sheet range + saved formula value + snapshot lineage','real WordCraft DOCX/PDF with uploaded figure and imported table','decoded native PNG preview','verified DOCX/PDF download bytes','real PdfCraft rotate + parent lineage','no browser exceptions'],jobs:[report.id,rotated.id],outputs:s.artifacts.map(a=>({kind:a.kind,sha256:a.sha256,bytes:a.bytes}))};await writeFile(path.join(temp,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(e){await page.screenshot({path:path.join(temp,'failure.png'),fullPage:true}).catch(()=>{});console.error('FIXTURE_DIR',temp);throw e;}finally{await browser.close();await app.close();}
