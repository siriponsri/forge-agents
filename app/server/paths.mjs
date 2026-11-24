import os from 'node:os';
import path from 'node:path';
export function defaultDataDir(){
  if(process.env.FORGE_DATA_DIR)return path.resolve(process.env.FORGE_DATA_DIR);
  const base=process.platform==='win32'?(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData','Local')):process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support'):path.join(os.homedir(),'.local','share');
  return path.join(base,'FORGE','workbench');
}
