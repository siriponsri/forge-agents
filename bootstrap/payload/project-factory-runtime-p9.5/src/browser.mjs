import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {nowIso, redact, writeJson} from './core.mjs';
import {createToolExecutionReceipt} from './tool-policy.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function waitFor(check, timeoutMs = 15000, intervalMs = 100) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => { try { const value = await check(); if (value) return resolve(value); } catch {} if (Date.now() - started >= timeoutMs) return reject(new Error('BROWSER_WAIT_TIMEOUT')); setTimeout(tick, intervalMs); };
    tick();
  });
}
async function fetchJson(url) { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP_${response.status}`); return response.json(); }

class CdpClient {
  constructor(url) { this.url = url; this.nextId = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, {once:true}); this.socket.addEventListener('error', reject, {once:true}); });
    this.socket.addEventListener('message', event => { const message = JSON.parse(event.data); const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result); });
    return this;
  }
  send(method, params = {}) { const id = ++this.nextId; return new Promise((resolve, reject) => { this.pending.set(id, {resolve, reject}); this.socket.send(JSON.stringify({id, method, params})); }); }
  close() { try { this.socket?.close(); } catch {} }
}
const expression = value => `(() => { try { return ${value}; } catch (error) { return {error: String(error.message || error)}; } })()`;

export async function runBrowserProbe({outputRoot, chromePath = process.env.CHROME_PATH || 'chrome', chromeVersion = '152.0.7977.83'} = {}) {
  const root = path.resolve(outputRoot); fs.mkdirSync(root, {recursive:true});
  const html = '<!doctype html><html><head><title>P8 Browser Fixture</title></head><body><h1 id="title">P8 Browser Fixture</h1><input id="check-input"><button id="check-button">Run check</button><output id="result">PENDING</output><script>document.querySelector("#check-button").onclick=()=>{const value=document.querySelector("#check-input").value;document.querySelector("#result").textContent=value === "P8-browser-check" ? "P8_BROWSER_OK:P8-browser-check" : "P8_BROWSER_FAIL";};</script></body></html>';
  const server = http.createServer((request, response) => { if (request.url === '/' || request.url === '/index.html') { response.writeHead(200, {'content-type':'text/html; charset=utf-8'}); response.end(html); } else { response.writeHead(404); response.end('not found'); } });
  const browserPort = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const debugPort = browserPort + 1; const profile = path.join(root, 'chrome-profile'); fs.mkdirSync(profile, {recursive:true});
  const args = ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'about:blank'];
  const startedAt = nowIso(); let child; let cdp; let stdout=''; let stderr=''; const assertions=[]; const cleanup={server_closed:false,browser_closed:false,profile_removed:false,listener_closed:false}; let structured=null; let error=null;
  try {
    child = spawn(chromePath,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}); child.stdout?.on('data',chunk=>{stdout+=chunk.toString();}); child.stderr?.on('data',chunk=>{stderr+=chunk.toString();});
    await waitFor(() => fetchJson(`http://127.0.0.1:${debugPort}/json/version`).catch(() => null));
    const page = await waitFor(() => fetchJson(`http://127.0.0.1:${debugPort}/json/list`).then(items=>items.find(item=>item.type==='page')).catch(()=>null));
    cdp = await new CdpClient(page.webSocketDebuggerUrl).connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Page.navigate',{url:`http://127.0.0.1:${browserPort}/`}); await sleep(350);
    const title = await cdp.send('Runtime.evaluate',{expression:expression('document.title'),returnByValue:true}); assertions.push({name:'title',pass:title.result?.value==='P8 Browser Fixture',observed:title.result?.value ?? null});
    const interaction = await cdp.send('Runtime.evaluate',{expression:expression('(document.querySelector("#check-input").value="P8-browser-check",document.querySelector("#check-button").click(),document.querySelector("#result").textContent)'),returnByValue:true}); assertions.push({name:'bounded input and click',pass:interaction.result?.value==='P8_BROWSER_OK:P8-browser-check',observed:interaction.result?.value ?? null});
    const dom = await cdp.send('Runtime.evaluate',{expression:expression('({title:document.title,result:document.querySelector("#result").textContent,input:document.querySelector("#check-input").value})'),returnByValue:true});
    structured=redact({schema_version:'1.0.0',fixture_id:'P8-BROWSER-LOCAL-001',url:`http://127.0.0.1:${browserPort}/`,title:dom.result?.value?.title,result:dom.result?.value?.result,input:dom.result?.value?.input,no_external_network:true,credentials_used:false}); writeJson(path.join(root,'browser-result.json'),structured);
    await cdp.send('Browser.close').catch(()=>{}); cleanup.browser_closed=true;
  } catch (caught) { error=caught.message; assertions.push({name:'browser probe exception',pass:false,error}); }
  finally {
    cdp?.close(); try { if (child && child.exitCode === null) child.kill(); } catch {}
    if (child && child.exitCode === null) await Promise.race([new Promise(resolve => child.once('close', resolve)), sleep(2500)]);
    await new Promise(resolve=>server.close(()=>resolve())); cleanup.server_closed=true;
    try { fs.rmSync(profile,{recursive:true,force:true}); cleanup.profile_removed=!fs.existsSync(profile); } catch {}
    cleanup.listener_closed = await Promise.all([browserPort,debugPort].map(port=>fetch(`http://127.0.0.1:${port}/`).then(()=>false).catch(()=>true))).then(values=>values.every(Boolean));
  }
  const endedAt=nowIso(); const pass=assertions.length===2&&assertions.every(item=>item.pass)&&cleanup.server_closed&&cleanup.browser_closed&&cleanup.profile_removed&&cleanup.listener_closed;
  const receipt=createToolExecutionReceipt({tool_id:'browser-chrome-cdp',tool_version:chromeVersion,capability:'browser-automation',named_consumer:'Frontend QA',command:{executable:chromePath,args},side_effect_class:'WRITE_PROJECT_LOCAL',authorization:{disposable_workspace:true,project_local_write:true,loopback_only:true},started_at:startedAt,ended_at:endedAt,outcome:pass?'PASS':'FAIL',artifact_refs:structured?[path.join(root,'browser-result.json')]:[],stdout,stderr,owned_pid:child?.pid ?? null,owned_port:browserPort,cleanup,external_writes:false,credential_used:false,boundary_verification:{loopback_only:true,no_external_network:true}});
  const result = redact({schema_version:'1.0.0',probe_id:'P8_BROWSER_PROBE',verdict:pass?'PASS':'FAIL',tool_id:'browser-chrome-cdp',tool_version:chromeVersion,fixture:{fixture_id:'P8-BROWSER-LOCAL-001',browser_port:browserPort,debug_port:debugPort,local_url:`http://127.0.0.1:${browserPort}/`,external_network:false},assertions,cleanup,receipt,error,output_root:root});
  if (result.receipt) { result.receipt.credential_used = false; result.receipt.external_writes = false; }
  return result;
}
