import { randomUUID } from 'node:crypto';
import { signBridgeBody } from '../relay/common.mjs';

export function privateEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('RELAY_PRIVATE_LOOPBACK_REQUIRED');
  return url;
}
/** FORGE is only a loopback client target; no public listener/tunnel is created. */
export function createBridgeClient({ endpoint, bindingId, gatewayId, accountId, secret, fetchImpl = fetch }) {
  const url = privateEndpoint(endpoint);
  signBridgeBody('', secret); // Missing machine credential is a load-time readiness error.
  return async (kind, extra = {}) => {
    const body = JSON.stringify({ version: 1, kind, bindingId, gatewayId, accountId, issuedAt: Date.now(), nonce: randomUUID(), ...extra });
    const result = await fetchImpl(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Forge-Relay-Signature': signBridgeBody(body, secret) }, body, signal: AbortSignal.timeout(10000) });
    if (!result.ok) throw new Error(`RELAY_HTTP_${result.status}`); // Never log bodies or credentials.
    return result.json();
  };
}

/** No send retries: Telegram native sends have no FORGE remote idempotency key. */
export async function deliverOne({ request, route, send }) {
  const { delivery } = await request('poll');
  if (!delivery) return false;
  let status = 'unknown', remoteMessageId;
  if (['gatewayId', 'accountId', 'platform', 'chatId', 'threadId', 'ownerId'].some(k => delivery.route?.[k] !== route[k])) status = 'rejected';
  else {
    try { const result = await send(delivery.content); if (result) { status = 'delivered'; remoteMessageId = String(result); } } catch { /* Unknown: send may have reached the platform. */ }
  }
  // A lost receipt leaves delivering/unknown and MUST NOT cause another send.
  await request('receipt', { receipt: { outboxId: delivery.id, lease: delivery.lease, status, ...(remoteMessageId ? { remoteMessageId } : {}) } });
  return true;
}
