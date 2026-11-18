"""Demo-only Redis transactions. No process-local attempt cache or fallback.

Short read/modify/write transactions use expiring token locks AND revision fencing.
Provider calls never hold these locks. Separate operation leases fence late workers.
All related keys share a Redis cluster hash tag; EVAL runs on Upstash and test Redis.
"""
from __future__ import annotations

import hashlib
import asyncio
import json
import re
import secrets
import time
from contextlib import contextmanager, asynccontextmanager
from typing import Any

import httpx
from fastapi import HTTPException

from .attempt_store import ATTEMPT_TTL_SECONDS, MAX_ACTIVE_ATTEMPTS_PER_OWNER, AttemptStore


ACQUIRE = """
local raw = redis.call('GET', KEYS[1])
if not raw then return {'missing'} end
local a = cjson.decode(raw)
if a.owner ~= ARGV[1] then return {'missing'} end
if not redis.call('SET', KEYS[2], ARGV[2], 'NX', 'PX', ARGV[3]) then return {'busy'} end
return {'ok', raw}
"""
COMMIT = """
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
local raw = redis.call('GET', KEYS[1])
if not raw then redis.call('DEL', KEYS[2]); return 0 end
local a = cjson.decode(raw)
if (a.revision or 0) ~= tonumber(ARGV[2]) then redis.call('DEL', KEYS[2]); return 0 end
if ARGV[3] ~= '' then redis.call('SET', KEYS[1], ARGV[3], 'KEEPTTL') end
redis.call('DEL', KEYS[2])
return 1
"""
RELEASE = """
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
"""
CREATE = """
local id = redis.call('GET', KEYS[3])
if id then
  local old = redis.call('GET', ARGV[5] .. id)
  if old then return {'existing', old} end
end
local now = redis.call('TIME'); local seconds = tonumber(now[1]) + tonumber(now[2]) / 1000000
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', seconds)
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then return {'limit'} end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('ZADD', KEYS[2], seconds + tonumber(ARGV[3]), ARGV[2])
redis.call('EXPIRE', KEYS[2], ARGV[3])
redis.call('SET', KEYS[3], ARGV[2], 'EX', ARGV[3])
return {'created', ARGV[1]}
"""


class UpstashCommands:
    """One verified HTTPS command per call; no redirects or automatic retries."""

    def __init__(self, url: str, token: str):
        if not re.fullmatch(r'https://[a-z0-9-]+\.upstash\.io', url) or not token:
            raise ValueError('Demo requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN')
        self._url, self._token = url, token

    def __call__(self, *command):
        try:
            # A request-scoped client avoids cross-event-loop/serverless ownership.
            with httpx.Client(timeout=2.0, follow_redirects=False, trust_env=False) as client:
                response = client.post(self._url, headers={'Authorization': 'Bearer ' + self._token}, json=list(command))
                response.raise_for_status()
                body = response.json()
            if 'error' in body or 'result' not in body:
                raise ValueError('Redis command failed')
            return body['result']
        except Exception:
            # Never include transport URLs, authorization or response bodies.
            raise HTTPException(503, 'Demo storage is unavailable. Please try later.') from None


class RedisAttemptStore(AttemptStore):
    def __init__(self, commands, namespace: str):
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,48}', namespace):
            raise ValueError('MEDSIM_DEMO_NAMESPACE must be 1-48 letters, digits, underscores or hyphens')
        self.distributed = True
        self.commands = commands
        self.prefix = 'medsim:demo:{' + namespace + '}:'

    def command(self, *args):
        try:
            return self.commands(*args)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, 'Demo storage is unavailable. Please try later.') from None

    def owner(self, request) -> str:
        value = getattr(request.state, 'guest_id', None)
        if not value:
            raise HTTPException(401, 'Anonymous session required')
        return 'guest:' + value

    def key(self, attempt_id: str) -> str:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{20,100}', attempt_id):
            raise HTTPException(404, 'attempt not found')
        return self.prefix + 'attempt:' + attempt_id

    def create(self, request, attempt: dict[str, Any]) -> dict[str, Any]:
        owner_hash = hashlib.sha256(self.owner(request).encode()).hexdigest()
        identity = [attempt['owner'], attempt['caseId'], attempt['caseVersion'], attempt.get('clientAttemptId') or attempt['attemptId']]
        idem = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
        attempt['revision'] = 0
        response = self.command('EVAL', CREATE, 3, self.key(attempt['attemptId']),
            self.prefix + 'owner:' + owner_hash, self.prefix + 'create:' + idem,
            json.dumps(attempt), attempt['attemptId'], ATTEMPT_TTL_SECONDS, MAX_ACTIVE_ATTEMPTS_PER_OWNER,
            self.prefix + 'attempt:')
        if response[0] == 'limit':
            raise HTTPException(429, 'At most 32 demo encounters per guest in six hours.')
        return json.loads(response[1])

    @staticmethod
    def recover_leases(attempt):
        for kind in ('patientRequest', 'evaluation'):
            lease = attempt.get(kind + 'Lease')
            if lease and lease['expiresAt'] <= time.time():
                attempt[kind + 'Active'] = False
                attempt.pop(kind + 'Lease', None)
                # A patient journal entry survives the lease: its request ID
                # must never dispatch again after an ambiguous interruption.

    @contextmanager
    def transaction(self, request, attempt_id: str):
        key, token = self.key(attempt_id), secrets.token_urlsafe(24)
        response = self.command('EVAL', ACQUIRE, 2, key, key + ':lock', self.owner(request), token, 5000)
        if response[0] == 'missing':
            raise HTTPException(404, 'attempt not found')
        if response[0] == 'busy':
            raise HTTPException(409, 'Encounter update in progress. Try again shortly.')
        original = response[1]
        attempt = json.loads(original)
        revision = attempt.get('revision', 0)
        try:
            if attempt['expiresAt'] <= time.time():
                raise HTTPException(404, 'attempt not found')
            self.recover_leases(attempt)
            yield attempt
            changed = json.dumps(attempt) != original
            attempt['revision'] = revision + 1
            committed = self.command('EVAL', COMMIT, 2, key, key + ':lock', token, revision,
                                     json.dumps(attempt) if changed else '')
            if committed != 1:
                raise HTTPException(409, 'Encounter update lease expired. Recover and try again.')
        except BaseException:
            self.command('EVAL', RELEASE, 1, key + ':lock', token)
            raise

    @asynccontextmanager
    async def atransaction(self, request, attempt_id: str):
        # The same atomic protocol serves sync HTTP handlers and async SSE/
        # evaluation. Network waits must not stall cancellation on the app loop.
        manager = self.transaction(request, attempt_id)
        attempt = await asyncio.to_thread(manager.__enter__)
        try:
            yield attempt
        except BaseException as exc:
            await asyncio.to_thread(manager.__exit__, type(exc), exc, exc.__traceback__)
            raise
        else:
            await asyncio.to_thread(manager.__exit__, None, None, None)
