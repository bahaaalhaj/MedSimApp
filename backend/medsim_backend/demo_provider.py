"""Conservative cross-instance admission in addition to the existing local gate."""
import hashlib
import asyncio
import secrets
from contextlib import asynccontextmanager
from contextvars import ContextVar

from local_llm import LLMHealth, LLMProviderError, SerializingLocalLLMProvider

demo_owner = ContextVar('demo_owner', default=None)

ADMIT = """
local t = redis.call('TIME'); local now = tonumber(t[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= 1 then return 'busy' end
local windows = {math.floor(now / 60), math.floor(now / 60), math.floor(now / 86400)}
local limits = {6, 3, 40}
for i = 1, 3 do
  local window = redis.call('HGET', KEYS[i+1], 'window')
  if window == tostring(windows[i]) and tonumber(redis.call('HGET', KEYS[i+1], 'count') or '0') >= limits[i] then return 'rate' end
end
for i = 1, 3 do
  local key = KEYS[i+1]
  if redis.call('HGET', key, 'window') ~= tostring(windows[i]) then redis.call('HSET', key, 'window', windows[i], 'count', 0) end
  redis.call('HINCRBY', key, 'count', 1)
  redis.call('EXPIRE', key, i == 3 and 172800 or 120)
end
redis.call('ZADD', KEYS[1], now + 15, ARGV[1]); redis.call('EXPIRE', KEYS[1], 30)
return 'ok'
"""


class DemoProvider(SerializingLocalLLMProvider):
    def __init__(self, delegate, store):
        super().__init__(delegate)
        self.store = store

    @asynccontextmanager
    async def admission(self):
        owner = demo_owner.get()
        if not owner:
            raise LLMProviderError('configuration-invalid', 'Demo session required.', False)
        prefix = self.store.prefix + 'admission:'
        token = secrets.token_urlsafe(24)
        identity = hashlib.sha256(owner.encode()).hexdigest()
        try:
            result = await asyncio.to_thread(self.store.command, 'EVAL', ADMIT, 4, prefix + 'active', prefix + 'minute',
                                        prefix + 'owner:' + identity, prefix + 'day', token)
        except Exception:
            raise LLMProviderError('model-unavailable', 'Demo admission storage is unavailable.', True) from None
        if result != 'ok':
            raise LLMProviderError('rate-limited', 'Demo capacity is limited. Wait before trying again.', True)
        try:
            yield
        finally:
            # ZREM removes only this token; it cannot release another caller.
            await asyncio.to_thread(self.store.command, 'ZREM', prefix + 'active', token)

    async def health(self):
        # Configured readiness, NOT independently verified provider availability.
        # No metadata warmup or hidden health retries during demo evaluation.
        configured = self.delegate.settings
        return LLMHealth('openrouter', configured.patient_model, 'ready', 'hosted', 4096, 1,
                         'not-applicable', None, None, 0, None, 'configured-only', None)

    async def complete_chat(self, request):
        async with self.admission():
            return await super().complete_chat(request)

    async def structured_completion(self, request, schema):
        async with self.admission():
            return await super().structured_completion(request, schema)


class DemoOwnerMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        token = demo_owner.set(scope.get('state', {}).get('guest_id'))
        try:
            await self.app(scope, receive, send)
        finally:
            demo_owner.reset(token)
