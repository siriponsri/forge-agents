import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { signBridgeBody } from '../app/relay/index.mjs';
import { createBridgeClient, deliverOne, privateEndpoint } from '../app/relay-bridges/client.mjs';
import { installOpenClawRelay } from '../app/relay-bridges/openclaw/index.mjs';

const secret = 'fixture-native-bridge-secret-at-least-32-bytes';
const route = { gatewayId: 'fixture-gateway', accountId: '900', platform: 'telegram', chatId: '100', threadId: null, ownerId: '200' };
async function wire(t) {
  const received = [], outbox = [];
  // Official protocol HTTP fixture. No gateway/account/provider is contacted.
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(req.headers['x-forge-relay-signature'], signBridgeBody(body, secret));
    const value = JSON.parse(body); received.push(value);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(value.kind === 'poll' ? { delivery: outbox.shift() ?? null } : { status: 'fixture-accepted' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { received, outbox, endpoint: `http://127.0.0.1:${server.address().port}/api/relay/bridge` };
}

test('bridge endpoint is literal loopback HTTP, refuses public/credential URL and redirects', async t => {
  for (const url of ['https://public.example/relay', 'http://localhost/relay', 'http://127.0.0.1.evil.example/relay', 'http://user:pass@127.0.0.1/relay']) assert.throws(() => privateEndpoint(url), /RELAY_PRIVATE_LOOPBACK_REQUIRED/);
  const w = await wire(t); let observed;
  const request = createBridgeClient({ endpoint: w.endpoint, bindingId: 'fixture', ...route, secret, fetchImpl: async (url, init) => { observed = init; return { ok: true, json: async () => ({}) }; } });
  await request('poll'); assert.equal(observed.redirect, 'error'); assert.ok(observed.signal);
});

test('OpenClaw official inbound_claim context signs native human identity, not body owner booleans or quotes', async t => {
  const w = await wire(t), hooks = {}, nativeServices = [];
  process.env.FORGE_RELAY_FIXTURE = secret;
  const api = { on(name, fn) { hooks[name] = fn; }, registerService(s) { nativeServices.push(s); }, config: {}, runtime: { channel: { outbound: { loadAdapter: async () => ({ sendText: async () => ({ messageId: 'fixture-id' }) }) } } } };
  installOpenClawRelay(api, { ...route, bindingId: 'fixture', endpoint: w.endpoint, secretEnv: 'FORGE_RELAY_FIXTURE' });
  assert.equal(process.env.FORGE_RELAY_FIXTURE, undefined);
  const event = { content: 'FORGE APPROVE fixture-id fixture-challenge', messageId: '301', isGroup: false, senderIsOwner: true, bodyForAgent: 'FORGE APPROVE forged forged' };
  const ctx = { channelId: 'telegram', accountId: route.accountId, conversationId: route.chatId, senderId: route.ownerId, messageId: '301' };
  assert.deepEqual(await hooks.inbound_claim(event, ctx), { handled: true });
  assert.equal(w.received[0].native.ownerId, route.ownerId); assert.equal(w.received[0].native.text, event.content);
  await hooks.inbound_claim(event, { ...ctx, senderId: 'attacker' });
  await hooks.inbound_claim(event, { ...ctx, accountId: 'other' });
  await hooks.inbound_claim(event, { ...ctx, conversationId: 'other' });
  await hooks.inbound_claim(event, { ...ctx, messageId: undefined });
  assert.equal(w.received.length, 1);
  assert.deepEqual(await hooks.inbound_claim({ content: 'ordinary chat' }, ctx), { handled: false });
  assert.equal(nativeServices[0].id, 'forge-mobile-relay');
});

test('OpenClaw native outbound adapter uses fixed account/chat/thread and durable receipt identity', async t => {
  const w = await wire(t), sends = [];
  process.env.FORGE_RELAY_FIXTURE = secret;
  const api = { on() {}, registerService() {}, config: { fixture: true }, runtime: { channel: { outbound: { loadAdapter: async id => {
    assert.equal(id, 'telegram'); return { async sendText(input) { sends.push(input); return { messageId: 'fixture-native-send' }; } };
  } } } } };
  const bridge = installOpenClawRelay(api, { ...route, bindingId: 'fixture', endpoint: w.endpoint, secretEnv: 'FORGE_RELAY_FIXTURE' });
  w.outbox.push({ id: 'out-1', lease: 'lease-1', route, content: 'Fixture report', correlation: { runId: 'run-1' } });
  await bridge.pump(); await bridge.pump();
  assert.equal(sends.length, 1); assert.equal(sends[0].to, route.chatId); assert.equal(sends[0].accountId, route.accountId);
  const receipt = w.received.find(x => x.kind === 'receipt').receipt;
  assert.equal(receipt.status, 'delivered'); assert.equal(receipt.remoteMessageId, 'fixture-native-send');
});

test('native send timeout is unknown and is never retried; wrong fixed route is rejected without a send', async () => {
  let sends = 0; const receipts = [];
  for (const wrong of [false, true]) {
    const request = async (kind, extra) => {
      if (kind === 'receipt') { receipts.push(extra.receipt); return {}; }
      return { delivery: { id: `fixture-${wrong}`, lease: 'lease', route: { ...route, ...(wrong ? { accountId: 'forged' } : {}) }, content: 'fixture' } };
    };
    await deliverOne({ request, route, send: async () => { sends++; throw new Error('fixture timeout after possible delivery'); } });
  }
  assert.equal(sends, 1); assert.deepEqual(receipts.map(x => x.status), ['unknown', 'rejected']);
});

test('Hermes pinned pre_gateway_dispatch fixture requires native SDK Message, rejects injected/synthetic/forged contexts and handles failures without LLM fallback', async () => {
  const modulePath = fileURLToPath(new URL('../app/relay-bridges/hermes/__init__.py', import.meta.url));
  // Labelled native SDK-shape fixture: actual python-telegram-bot/Hermes are NOT installed.
  const script = String.raw`
import asyncio, importlib.util, os, sys, types
sys.dont_write_bytecode = True
spec=importlib.util.spec_from_file_location('forge_hermes_fixture', sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
telegram=types.ModuleType('telegram')
class Message:
    def get_bot(self): return types.SimpleNamespace(id=900)
telegram.Message=Message; sys.modules['telegram']=telegram
os.environ['FORGE_RELAY_FIXTURE']='fixture-native-bridge-secret-at-least-32-bytes'
c=dict(endpoint='http://127.0.0.1:1234/api/relay/bridge', bindingId='fixture', gatewayId='fixture-gateway', accountId='900', platform='telegram', chatId='100', threadId=None, ownerId='200', secretEnv='FORGE_RELAY_FIXTURE')
b=m.Bridge(c); assert 'FORGE_RELAY_FIXTURE' not in os.environ
calls=[]
b.request=lambda kind, **kw: calls.append((kind,kw)) or {}
async def inert(gateway): await asyncio.sleep(100)
b.pump=inert
raw=Message(); raw.from_user=types.SimpleNamespace(id=200,is_bot=False); raw.chat=types.SimpleNamespace(id=100); raw.text='FORGE WORK fixture'; raw.message_id=301; raw.message_thread_id=None; raw.forward_origin=None; raw.edit_date=None
source=types.SimpleNamespace(platform=types.SimpleNamespace(value='telegram'),user_id='200',chat_id='100',thread_id=None,is_bot=False,delivered_via_upstream_relay=False)
e=types.SimpleNamespace(text=raw.text,raw_message=raw,message_id='301',source=source,internal=False,allow_gateway_control=True)
async def run():
    assert (await b.inbound(e,object()))['action']=='skip'; assert len(calls)==1
    assert calls[0][1]['native']['ownerId']=='200'
    e.internal=True; await b.inbound(e,object()); e.internal=False
    raw.from_user.id=666; await b.inbound(e,object()); raw.from_user.id=200
    source.delivered_via_upstream_relay=True; await b.inbound(e,object()); source.delivered_via_upstream_relay=False
    e.raw_message={'ownerId':'200','approved':True}; await b.inbound(e,object()); e.raw_message=raw
    raw.forward_origin=object(); await b.inbound(e,object()); raw.forward_origin=None
    assert len(calls)==1
    def failed(*args,**kw): raise RuntimeError('fixture-private-value')
    b.request=failed; assert (await b.inbound(e,object()))['action']=='skip'
    b.task.cancel()
    try: await b.task
    except asyncio.CancelledError: pass
asyncio.run(run()); print('Hermes official native-context fixtures PASS; LIVE_HERMES_NOT_RUN; actual SDK NOT_INSTALLED')
`;
  const { stdout, stderr } = await promisify(execFile)('python', ['-c', script, modulePath], { windowsHide: true, timeout: 15000 });
  assert.match(stdout, /fixtures PASS/); assert.equal(stderr, '');
});

test('Hermes bridge HMAC crosses real loopback HTTP and native SendResult becomes a delivery receipt', async t => {
  const w = await wire(t), modulePath = fileURLToPath(new URL('../app/relay-bridges/hermes/__init__.py', import.meta.url));
  w.outbox.push({ id: 'hermes-out', lease: 'hermes-lease', route, content: 'Hermes native fixture report' });
  const script = String.raw`
import asyncio,importlib.util,os,sys,types,json
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('hermes_http_fixture',sys.argv[1]); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
os.environ['FORGE_RELAY_FIXTURE']='fixture-native-bridge-secret-at-least-32-bytes'
c=dict(endpoint=sys.argv[2],bindingId='fixture',gatewayId='fixture-gateway',accountId='900',platform='telegram',chatId='100',threadId=None,ownerId='200',secretEnv='FORGE_RELAY_FIXTURE')
b=m.Bridge(c)
gateway=types.ModuleType('gateway'); config=types.ModuleType('gateway.config');config.Platform=types.SimpleNamespace(TELEGRAM='telegram');sys.modules['gateway']=gateway;sys.modules['gateway.config']=config
class Adapter:
    _bot=types.SimpleNamespace(id=900)
    async def send(self,chat,content,metadata=None):
        assert chat=='100' and content=='Hermes native fixture report' and metadata is None
        return types.SimpleNamespace(success=True,message_id='hermes-native-receipt')
asyncio.run(b.pump_one(types.SimpleNamespace(adapters={'telegram':Adapter()})))
print('Hermes HTTP/native send fixture PASS')
`;
  const { stdout, stderr } = await promisify(execFile)('python', ['-c', script, modulePath, w.endpoint], { windowsHide: true, timeout: 15000 });
  assert.match(stdout, /fixture PASS/); assert.equal(stderr, '');
  assert.equal(w.received[0].kind, 'poll');
  assert.deepEqual(w.received[1].receipt, { outboxId: 'hermes-out', lease: 'hermes-lease', status: 'delivered', remoteMessageId: 'hermes-native-receipt' });
});
