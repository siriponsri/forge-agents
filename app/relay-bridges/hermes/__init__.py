"""FORGE native Hermes Telegram bridge. No model tools or webhook identity claims.

Pinned native contracts and qualification limits: app/relay/PRIMARY_SOURCES.json.
"""
import asyncio
import hashlib
import hmac
import json
import os
import re
import time
import urllib.request
import urllib.parse
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("RELAY_REDIRECT_REFUSED")


def private_endpoint(value):
    u = urllib.parse.urlparse(value)
    if (u.scheme != "http" or u.hostname not in ("127.0.0.1", "::1")
            or u.username or u.password or u.query or u.fragment):
        raise ValueError("RELAY_PRIVATE_LOOPBACK_REQUIRED")
    return value


class Bridge:
    def __init__(self, config):
        self.config = config
        self.endpoint = private_endpoint(config["endpoint"])
        if config["platform"] != "telegram":
            raise ValueError("RELAY_NATIVE_ROUTE_REQUIRED")
        if not re.fullmatch(r"FORGE_RELAY_[A-Z0-9_]+", config["secretEnv"]):
            raise ValueError("RELAY_SECRET_ENV_REQUIRED")
        # Do not pass the signing credential to later model-launched subprocesses.
        self.secret = os.environ.pop(config["secretEnv"], "").encode()
        if len(self.secret) < 32:
            raise ValueError("RELAY_SECRET_UNAVAILABLE")
        self.task = None

    def close(self):
        if self.task is not None and not self.task.done():
            self.task.get_loop().call_soon_threadsafe(self.task.cancel)

    def request(self, kind, **extra):
        c = self.config
        body = json.dumps(dict(version=1, kind=kind, bindingId=c["bindingId"],
                               gatewayId=c["gatewayId"], accountId=c["accountId"],
                               issuedAt=int(time.time() * 1000), nonce=str(uuid.uuid4()), **extra),
                          ensure_ascii=False, separators=(",", ":")).encode()
        signature = hmac.new(self.secret, b"forge-mobile-relay-v1\n" + body, hashlib.sha256).hexdigest()
        req = urllib.request.Request(self.endpoint, data=body, headers={
            "Content-Type": "application/json", "X-Forge-Relay-Signature": signature})
        # Do not use ambient proxy settings for machine-only loopback traffic.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(req, timeout=10) as response:
            return json.loads(response.read(65536))

    async def pump_one(self, gateway):
        c = self.config
        result = await asyncio.to_thread(self.request, "poll")
        delivery = result.get("delivery")
        if not delivery:
            return
        keys = ("gatewayId", "accountId", "platform", "chatId", "threadId", "ownerId")
        status, remote_id = "unknown", None
        if delivery["route"] != {k: c[k] for k in keys}:
            status = "rejected"
        else:
            try:
                from gateway.config import Platform
                adapter = gateway.adapters[Platform.TELEGRAM]
                # The bot's native identity binds the profile/account, not a supplied actor.
                if str(adapter._bot.id) != c["accountId"]:
                    raise ValueError("RELAY_NATIVE_ACCOUNT_MISMATCH")
                sent = await adapter.send(c["chatId"], delivery["content"],
                                          metadata={"thread_id": c["threadId"]} if c["threadId"] else None)
                if sent.success and sent.message_id:
                    status, remote_id = "delivered", str(sent.message_id)
            except Exception:
                pass  # Send may already have happened; never retry an unknown send.
        receipt = dict(outboxId=delivery["id"], lease=delivery["lease"], status=status)
        if remote_id:
            receipt["remoteMessageId"] = remote_id
        await asyncio.to_thread(self.request, "receipt", receipt=receipt)

    async def pump(self, gateway):
        while True:
            try:
                await self.pump_one(gateway)
            except asyncio.CancelledError:
                raise
            except Exception:
                pass  # FORGE retains readiness/unknown, no credential/payload logs.
            await asyncio.sleep(2)

    async def inbound(self, event, gateway, session_store=None, **kwargs):
        if not isinstance(getattr(event, "text", None), str) or not event.text.startswith("FORGE "):
            return None
        # Catch every relay command failure: Hermes pre_gateway_dispatch is fail-open
        # on exceptions. This bridge must always return skip for FORGE commands.
        try:
            from telegram import Message
            raw = event.raw_message
            c, source = self.config, event.source
            if (not isinstance(raw, Message) or event.internal or not event.allow_gateway_control
                    or source.delivered_via_upstream_relay or source.is_bot
                    or source.platform.value != "telegram" or raw.from_user is None
                    or raw.from_user.is_bot or raw.forward_origin or raw.edit_date
                    or raw.text != event.text or str(raw.message_id) != event.message_id
                    or str(raw.get_bot().id) != c["accountId"]
                    or str(raw.chat.id) != c["chatId"] or str(raw.from_user.id) != c["ownerId"]
                    or (str(raw.message_thread_id) if raw.message_thread_id else None) != c["threadId"]
                    or str(source.user_id) != c["ownerId"] or str(source.chat_id) != c["chatId"]
                    or source.thread_id != c["threadId"]):
                return {"action": "skip", "reason": "forge-relay-native-context-required"}
            native = dict(platform="telegram", chatId=str(raw.chat.id), threadId=c["threadId"],
                          ownerId=str(raw.from_user.id), messageId=str(raw.message_id), text=raw.text)
            await asyncio.to_thread(self.request, "event", native=native)
            if self.task is None or self.task.done():
                self.task = asyncio.create_task(self.pump(gateway))
        except Exception:
            pass
        return {"action": "skip", "reason": "forge-relay-handled"}


def register(ctx):
    # Plugin-relative machine settings; secrets remain only in gateway environment.
    config = ctx.get_config("relay")
    bridge = Bridge(config)
    ctx.on_unload(bridge.close)
    ctx.register_hook("pre_gateway_dispatch", bridge.inbound)
