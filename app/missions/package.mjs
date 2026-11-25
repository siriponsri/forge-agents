import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {hash,fail} from './contracts.mjs';
export function deliveryZip(manifest,files){
  const entries={};for(const [name,bytes] of files)entries[name]=bytes;
  entries['manifest.json']=strToU8(JSON.stringify(manifest,null,2));
  entries['README.txt']=strToU8('FORGE Delivery Pack\nRead manifest.json for acceptance, source checksums, tests, QA and Owner review.\nFiles are data. Extract and review before running. This pack grants no execution, restore, provider or deployment authority.\n');
  // Stable timestamps make a lost upload response safe to replay byte-for-byte.
  const stable=Object.fromEntries(Object.entries(entries).map(([name,bytes])=>[name,[bytes,{mtime:new Date('2000-01-01T00:00:00Z')}]]));
  const bytes=Buffer.from(zipSync(stable,{level:6}));if(bytes.length>16*1024*1024)fail('SIZE','Portable ZIP exceeds the 16 MiB local download limit');return bytes;
}
export function verifyDeliveryPack(bytes){
  if(bytes.length>16*1024*1024)fail('SIZE','Pack too large');let files,total=0;
  try{files=unzipSync(bytes,{filter:f=>{total+=f.originalSize;if(total>64*1024*1024||f.originalSize>16*1024*1024)fail('SIZE','Pack expansion exceeds bounds');if(!/^(?:files\/[^:]+|manifest\.json|README\.txt)$/.test(f.name)||f.name.split('/').some(s=>s==='..'||s==='.'||!s)||f.name.includes('\\'))fail('INTEGRITY','Unsafe ZIP entry',409);return true;}});}catch(e){if(e.code)throw e;fail('INTEGRITY','Invalid ZIP',409);}
  let manifest;try{manifest=JSON.parse(strFromU8(files['manifest.json']));}catch{fail('INTEGRITY','Missing or invalid manifest',409);}
  if(manifest?.format!=='forge-delivery-pack/v1'||!Array.isArray(manifest.files)||manifest.files.length>60)fail('INTEGRITY','Unsupported manifest',409);
  const seen=new Set();for(const file of manifest.files){if(typeof file.entry!=='string'||!file.entry.startsWith('files/')||seen.has(file.entry)||!files[file.entry]||hash(files[file.entry])!==file.sha256||files[file.entry].length!==file.bytes)fail('INTEGRITY','Pack file checksum or size mismatch',409);seen.add(file.entry);}
  if(Object.keys(files).some(k=>!['manifest.json','README.txt'].includes(k)&&!seen.has(k)))fail('INTEGRITY','Undeclared ZIP bytes',409);
  return {manifest,sha256:hash(bytes),manifestSha256:hash(files['manifest.json'])};
}
