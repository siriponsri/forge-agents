import { createBridgeClient, deliverOne } from '../client.mjs';

const routeKeys = ['gatewayId', 'accountId', 'platform', 'chatId', 'threadId', 'ownerId'];
/** Load as an OpenClaw native plugin at the pinned source contract in PRIMARY_SOURCES.
 * inbound_claim is native transport context, not an HTTP/model tool argument.
 */
export function installOpenClawRelay(api, options) {
  const cfg = options ?? api.pluginConfig;
  if (cfg?.platform !== 'telegram' || routeKeys.some(k => k !== 'threadId' && typeof cfg[k] !== 'string') || !(cfg.threadId === null || typeof cfg.threadId === 'string')) throw new Error('RELAY_NATIVE_ROUTE_REQUIRED');
  // Dedicated env ref in the native gateway process, never a model/domain value.
  if (!/^FORGE_RELAY_[A-Z0-9_]+$/.test(cfg.secretEnv ?? '')) throw new Error('RELAY_SECRET_ENV_REQUIRED');
  const secret = process.env[cfg.secretEnv];
  // Do not pass the signing credential to future model-launched child processes.
  delete process.env[cfg.secretEnv];
  const request = createBridgeClient({ ...cfg, secret });
  const route = Object.fromEntries(routeKeys.map(k => [k, cfg[k]]));
  let timer, pumping = false;
  const pump = async () => {
    if (pumping) return; pumping = true;
    try {
      await deliverOne({ request, route, send: async content => {
        const adapter = await api.runtime.channel.outbound.loadAdapter('telegram');
        if (!adapter?.sendText) throw new Error('RELAY_NATIVE_SEND_UNAVAILABLE');
        const receipt = await adapter.sendText({ cfg: api.config, to: cfg.chatId, accountId: cfg.accountId, threadId: cfg.threadId, text: content });
        return receipt?.messageId;
      } });
    } catch { /* Local readiness/unknown remains visible in FORGE, never log payloads. */ }
    finally { pumping = false; }
  };
  api.on('inbound_claim', async (event, ctx) => {
    const content = event.content;
    if (typeof content !== 'string' || !content.startsWith('FORGE ')) return { handled: false };
    // All provenance is derived from trusted hook context. Never use bodyForAgent,
    // senderIsOwner, model tool args, supplied actors or quoted/replied text.
    const native = { platform: ctx.channelId, chatId: ctx.conversationId, threadId: event.threadId == null ? null : String(event.threadId), ownerId: ctx.senderId, messageId: ctx.messageId, text: content };
    const trusted = native.platform === cfg.platform && ctx.accountId === cfg.accountId && native.chatId === cfg.chatId && native.threadId === cfg.threadId && native.ownerId === cfg.ownerId && typeof native.messageId === 'string' && native.messageId.length > 0 && (!event.messageId || event.messageId === native.messageId);
    if (trusted) { try { await request('event', { native }); } catch { /* No fallback agent turn on relay command failure. */ } }
    return { handled: true }; // Relay commands never reach an LLM, even on auth/transport failure.
  });
  api.registerService({ id: 'forge-mobile-relay', start() { timer = setInterval(pump, 2000); timer.unref?.(); }, stop() { clearInterval(timer); } });
  return { pump };
}
export default { id: 'forge-mobile-relay', name: 'FORGE Mobile Relay', register: installOpenClawRelay };
