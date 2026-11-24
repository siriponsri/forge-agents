import {createHash} from 'node:crypto';
import {find,revision,fail} from '../server/domain.mjs';
import {extractReportSource} from './report-source.mjs';
export const snapshotHash=snapshot=>createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
export function createOfficeService({store}){
  return {extract({projectId,documentId,expectedRevision,...selection}){
    const document=find(store.read(),'documents',documentId,projectId);revision(document,expectedRevision);
    let extracted;try{extracted=extractReportSource(document,selection);}catch(error){fail('OFFICE_MAPPING',error.message);}
    return {...extracted,input:{documentId,revision:document.revision,mapping:extracted.mapping,sourceSha256:snapshotHash(document.snapshot),...(extracted.sheetId?{sheetId:extracted.sheetId,range:extracted.range,formulaMode:extracted.formulaMode}:{})}};
  }};
}
