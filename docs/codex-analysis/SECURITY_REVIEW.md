# Static Security Review

This is a source-only review. No vulnerability exploitation or live dependency scan was performed.

## Critical

No confirmed critical vulnerability was found from static inspection.

## High

### Localhost header spoof bypasses backend authorization

**Location:** `backend/server.py:require_shared_secret`  
Requests bypass `BACKEND_SHARED_SECRET` when `Origin` equals a development origin or `Referer` begins with one. These headers are attacker-controlled outside a browser and can be supplied directly to the deployed backend. This exposes cost-bearing and mutation endpoints.  
**Direction:** Make development bypass conditional on an explicit development mode and/or the actual peer being loopback; never trust Origin/Referer as authentication.

### Public application users can reach administrative agent operations

**Location:** `/agent/bootstrap`, `/agent/refresh`, shared middleware  
Vercel injects the shared backend secret for browser requests, so any visitor to the public frontend can invoke bootstrap and refresh. Refresh mutates the shared Managed Agent version; bootstrap can create billable resources when IDs are absent.  
**Direction:** Separate internal/admin endpoints from end-user proxy routes and require administrator authentication.

### No user/session authorization or ownership check

**Location:** `/agent/sessions/{session_id}*`  
The service has one edge secret, no user identity, and no ownership binding between callers and Anthropic session IDs. Anyone who can use the frontend and learns an ID can retrieve/send/stream that session.  
**Direction:** Introduce authenticated users or signed opaque session handles and enforce ownership server-side before multi-user deployment.

## Medium

### Unrestricted Managed Agent environment and native toolset

**Location:** bootstrap config in `backend/server.py`  
The environment uses unrestricted networking and enables the default agent toolset. Debrief content is placed in a user message. Current case content is static, but future user-authored/imported content would create a prompt-injection path with broad tool/network reach.  
**Direction:** Disable unused native tools, restrict egress, treat all case/transcript content as untrusted, and test prompt-injection handling.

### Cost-bearing request bodies lack useful bounds

**Location:** patient stream, voice token, session events, list-events limit  
Strings/lists accept no explicit lengths; `events` is arbitrary JSON; event history limit is not bounded; voice room metadata includes a caller-provided prompt. The global 120/minute limit does not control token/body size.  
**Direction:** Add schema length/count constraints, request-size limits, provider budgets, and bounded pagination.

### Backend/provider exceptions are reflected to clients

**Location:** most `except Exception` handlers and SSE `proxy_error`  
Raw exception strings can expose internal provider, configuration, or topology details.  
**Direction:** Return stable public error codes; log sanitized details server-side.

### Public health endpoint exposes internal identifiers

**Location:** `/health`  
It returns Managed Agent and environment IDs. These are not API secrets, but disclose internal resource identifiers unnecessarily.  
**Direction:** expose booleans publicly and keep identifiers in authenticated diagnostics.

### Clinical/evaluation data stored unencrypted in localStorage

**Location:** conversation storage and `gr_eval_history`  
Data is synthetic, but transcripts and learner performance may still be sensitive. Any same-origin script can read them, and there is no retention consent beyond a 100-entry cap.  
**Direction:** document retention, minimize stored content, validate on read, and use server-side protected storage if real users/clinical data are introduced.

## Low / informational

- CORS is an explicit allowlist, which is good, but `allow_methods` and `allow_headers` are broad.
- Secrets stay server-side and `.env.local` is gitignored.
- EHR token redaction has dedicated tests; the EHR itself is only an in-memory stub.
- Case IDs are sanitized before inclusion in room names; JWTs are minted per room with scoped room grants.
- No SQL, file upload, template rendering, shell execution, dynamic `eval`, or database injection surface exists.
- Remote GLB and Wikimedia assets are trusted at runtime without integrity pinning.
- Content Security Policy, security headers, audit logging, and dependency scanning configuration are absent.

## Deployment caution

Do not expose the Render/FastAPI origin publicly until the localhost-header bypass is removed and admin/session authorization is designed. Confirm `BACKEND_SHARED_SECRET` is configured at both edge and backend; it is missing from `.env.example`.
