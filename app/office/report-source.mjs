// Deliberate, bounded native-snapshot -> ReportSpec projection. No Office round trip.
export function extractReportSource(document,{sheetId,range='A1:B5',formulaMode='expressions'}={}){
  const snapshot=document.snapshot;
  if(document.kind==='doc')return {section:{heading:document.name,text:(snapshot?.body?.dataStream??'').replace(/\r\n?$/,'').replace(/\r/g,'\n')},mapping:'univer-doc-text-v1',warnings:['Paragraph text only; document styles, embedded tables and images are not converted.']};
  if(document.kind!=='sheet')throw new Error('Choose a native Docs or Sheets document.');
  const match=/^([A-Z]{1,3})([1-9]\d{0,5}):([A-Z]{1,3})([1-9]\d{0,5})$/i.exec(range.trim());
  if(!match)throw new Error('Choose a rectangular range such as A1:B5.');
  const column=text=>[...text.toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
  const left=column(match[1]),right=column(match[3]),top=Number(match[2])-1,bottom=Number(match[4])-1;
  if(right<left||bottom<top||right-left>=63||(right-left+1)*(bottom-top+1)>1000)throw new Error('Select up to 1000 cells and 63 columns.');
  const selected=sheetId??snapshot.sheetOrder?.[0],sheet=snapshot.sheets?.[selected];
  if(!sheet||bottom>=sheet.rowCount||right>=sheet.columnCount)throw new Error('The selected range is outside this saved sheet.');
  if(!['expressions','cached-values'].includes(formulaMode))throw new Error('Choose formula expressions or saved values.');
  const values=[];for(let row=top;row<=bottom;row++){
    const result=[];for(let col=left;col<=right;col++){
      const cell=sheet.cellData?.[row]?.[col];
      if(cell?.f&&formulaMode==='expressions')result.push(cell.f);
      else if(cell?.f&&cell.v===undefined)throw new Error('A formula has no saved result. Save a recalculated sheet, or import formula expressions.');
      else result.push(cell?.v??cell?.p?.body?.dataStream?.replace(/\r\n?$/,'')??'');
    }values.push(result);
  }
  return {section:{heading:`${document.name} · ${sheet.name} · ${range.toUpperCase()}`,text:'',table:{values,header:true}},mapping:'univer-sheet-range-v1',sheetId:selected,range:range.toUpperCase(),formulaMode,warnings:['Selected cells only; workbook styles, merged cells, charts and images are not converted.',formulaMode==='expressions'?'Formula expressions are text in the report, not recalculated.':'Uses saved scalar values; the report renderer does not recalculate workbook formulas.']};
}
