import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { fail } from './common.mjs';

export const CALLBACK_PATH = '/api/mcp/oauth/callback';
export const MAX_RESPONSE = 1024 * 1024;
const loopback = url => ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
const blocked = new BlockList();
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(ip,bits,'ipv4');
for (const [ip, bits] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['::ffff:0:0',96]]) blocked.addSubnet(ip,bits,'ipv6');

export function urlValue(value, { query = false } = {}) {
  let url;
  try { if (String(value).length > 16384) throw new Error(); url = new URL(value); } catch { fail('OAUTH_URL','Use a valid absolute OAuth URL',400); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.hash || (!query && url.search)) fail('OAUTH_URL','OAuth URLs must use HTTP(S) without credentials, query or fragment',400);
  return url;
}
export function callbackBase(value) {
  const url = urlValue(value);
  if (!loopback(url) || url.protocol !== 'http:' || url.pathname !== '/') fail('OAUTH_CALLBACK','Use the exact HTTP loopback application origin',400);
  return new URL(CALLBACK_PATH,url).href;
}
export function endpoint(value, resource, { query = false } = {}) {
  const url = urlValue(value,{query});
  // An explicitly selected local MCP fixture/server may use its own origin.
  // Metadata from a remote server may never redirect auth traffic to localhost.
  const local = loopback(resource) && url.origin === resource.origin;
  if (!local && (url.protocol !== 'https:' || loopback(url))) fail('OAUTH_URL','OAuth endpoints require HTTPS; loopback is limited to the selected local MCP origin',400);
  const address = url.hostname.replace(/^\[|\]$/g,'');
  if (!local && isIP(address) && blocked.check(address,isIP(address)===6?'ipv6':'ipv4')) fail('OAUTH_URL','OAuth metadata cannot target private or reserved network addresses',400);
  return url;
}
export async function checkNetwork(url, resource) {
  endpoint(url,resource,{query:true});
  if (loopback(resource) && url.origin === resource.origin) return;
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});
  if (!addresses.length || addresses.some(a=>blocked.check(a.address,a.family===6?'ipv6':'ipv4'))) fail('OAUTH_URL','OAuth metadata cannot target private or reserved network addresses',400);
}
export async function boundedResponse(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE) { await response.body?.cancel(); fail('OAUTH_RESPONSE_SIZE','OAuth response exceeds the supported size',502); }
  const reader = response.body?.getReader();
  if (!reader) return response;
  const chunks=[]; let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if(done)break;
      size+=value.byteLength;
      if(size>MAX_RESPONSE) fail('OAUTH_RESPONSE_SIZE','OAuth response exceeds the supported size',502);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(()=>{}); }
  return new Response(Buffer.concat(chunks),{status:response.status,statusText:response.statusText,headers:response.headers});
}

const messages = {
  OAUTH_URL:'The server advertised an unsafe OAuth URL. Check its HTTPS and metadata configuration.',
  OAUTH_METADATA:'The server OAuth metadata is missing, inconsistent or does not support PKCE S256. Ask its administrator to correct it.',
  OAUTH_REGISTRATION_REQUIRED:'This server requires a pre-registered OAuth client. Configure a machine environment reference containing issuer and client_id, then reconnect.',
  OAUTH_CALLBACK:'The callback does not match this application origin and path. Start Connect again in this window.',
  OAUTH_STATE:'Sign-in expired, was already consumed, or belongs to another application session. Start Connect again.',
  OAUTH_DENIED:'Authorization was declined. Start Connect again when ready.',
  OAUTH_RESPONSE_SIZE:'The OAuth server response exceeded the size limit. Check the selected server.',
  OAUTH_STORAGE:'The machine credential vault is unavailable. Enable the Windows account vault or configure an OS vault on this platform.',
  OAUTH_REFRESH:'Authorization expired or refresh was rejected. Reconnect this MCP connection in Settings.',
  OAUTH_REQUIRED:'Connect this MCP account in Settings before refreshing capabilities or calling tools.',
  CONNECTION_CHANGED:'This MCP connection changed during sign-in. Start Connect again for the selected connection.',
  DISABLED:'Enable this MCP connection before signing in or using its credentials.',
  CLOSED:'MCP OAuth service is closed.',
  OAUTH_NETWORK:'OAuth communication failed or timed out. Check the selected server and reconnect in Settings.',
  OAUTH_OPERATION:'This setup operation was already submitted. Check status; start a new Connect action if needed.',
};
export function safeOAuthError(error, fallback='OAUTH_NETWORK') {
  const code=Object.hasOwn(messages,error?.code)?error.code:fallback;
  return {code,message:messages[code]};
}
export function oauthFailure(error, fallback) {
  const safe=safeOAuthError(error,fallback);
  return Object.assign(new Error(safe.message),safe,{statusCode:409});
}
