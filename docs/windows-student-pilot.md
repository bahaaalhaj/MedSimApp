# Temporary Windows student pilot

The pilot serves `dist/` and the existing `/api`, `/agent`, and `/tts` routes in
one FastAPI process on **127.0.0.1:8788**. It does not run Vite, use Vercel
rewrites, start a language model, install models, or start ngrok. Run one process:
active attempts and anonymous session signatures are process-local.

## Start and stop

From the repository root in PowerShell, replace `YOUR-ASSIGNED-HOST.ngrok-free.app`
with the exact lowercase hostname assigned to your ngrok account. Use your actual
domain suffix; this is an example, not a reserved domain.

```powershell
powershell -NoProfile -File .\scripts\start-pilot.ps1 -PilotHost YOUR-ASSIGNED-HOST.ngrok-free.app -TextOnly
```

Omit `-TextOnly` to retain the configured optional Kokoro provider. The switch
only overrides the launched process; it does not edit provider configuration.
The script restores the calling shell's environment overrides after launch.

Every start validates the hostname, type-checks, builds the frontend, scans the
production JavaScript for server-only clinical answers, and makes an online
SQLite backup before starting the service. Backup uses SQLite's backup API,
including committed WAL data, opens the source read-only, and checks the backup
with `PRAGMA integrity_check`. Existing databases are never copied as live files
or replaced. Backups are in `backend/data/pilot-backups/`. A first-ever startup
with no database reports that fact instead.

```powershell
# Local production/API smoke: no accounts, inference, or synthesis requests.
.\backend\.venv\Scripts\python.exe .\backend\pilot_smoke.py --pilot-host YOUR-ASSIGNED-HOST.ngrok-free.app

# Stop the managed launcher and interpreter child; retain DB, backups and logs.
powershell -NoProfile -File .\scripts\stop-pilot.ps1
```

The stop script checks creation time, entry-point command line, and child-process
identity before stopping anything. It refuses reused PIDs or unexpected children.
Logs and process state are under `backend/data/pilot/`, outside the served build.
Stopping or restarting discards active attempts. Saved account encounters remain
in SQLite. Guests' saved history remains namespaced in their browser storage.

## Ngrok configuration (do not run until ready to expose)

Install/configure the ngrok CLI separately and obtain its assigned domain before
starting MedSim. Do not put the ngrok authtoken in frontend variables or this
repository. Keep your usual ngrok authentication configuration private.

When public exposure is explicitly authorized later, the command is:

```powershell
ngrok http http://127.0.0.1:8788 --url https://YOUR-ASSIGNED-HOST.ngrok-free.app --inspect=false
```

Use the same exact hostname for `-PilotHost` and `--url`. Preserve the public
Host header: do not enable `host-header=rewrite` or policies that replace Host,
Origin, or Referer. Do not add compression/buffering policies to the SSE route.
If the hostname changes, stop and restart MedSim with the new hostname. Ngrok's
current [CLI documentation](https://ngrok.com/docs/gateway/agent/cli) documents
`--url` and `--inspect`; no ngrok config or public endpoint was created here.

Students must use the **HTTPS** URL. Cookies are Secure, host-only, and
SameSite=Lax; account and guest identity cookies are HttpOnly. Secure cookies
are not weakened to accommodate HTTP. The smoke client explicitly replays them
only over loopback to test the same backend without a public tunnel. The local
root page is available at `http://localhost:8788` for an initial visual check;
the full HTTPS browser journey is a separate acceptance check.

Close the ngrok terminal with **Ctrl+C**, then run `stop-pilot.ps1` to end a
future public session. The stop script never kills an unrelated ngrok process.

## Security and identity behavior

- The pilot requires an actual loopback peer and one exact public Host. Only
  `localhost:8788` and `127.0.0.1:8788` are accepted as local diagnostic hosts.
- Public requests with Origin must match the configured HTTPS origin. Writes
  without Origin need a matching Referer. Cross-site Fetch Metadata is rejected.
  The origin check is a CSRF boundary, not a student login mechanism.
- Uvicorn does not trust forwarded headers. Identity and cookie security do not
  derive from `Forwarded` or `X-Forwarded-*`.
- The legacy localhost header bypass is restricted to development mode and an
  actual loopback peer; deployed non-pilot access still supports the shared edge
  secret. Pilot access uses its outer host/origin/peer boundary and existing
  route ownership/CSRF checks; no secret is sent to JavaScript.
- Anonymous owners use a cryptographically random, signed browser-session cookie,
  independent of IP and User-Agent. Forging just an ID cannot acquire ownership.
  A restart invalidates these signatures alongside the in-memory attempts.
- Account attempt ownership and saved encounters are bound to server-side user
  IDs. Tests cover read/mutation/deletion denial across users and guests sharing
  an identical IP and User-Agent.
- Only the build index, compiled assets of approved file types, and the public
  music file are served. There is no arbitrary SPA fallback. Source maps,
  manifests, backend/source files, SQLite, environment files and API docs are
  denied. Resolved asset paths must remain inside `dist/`.
- Public `/health` reports process liveness only, without provider diagnostics or
  provider requests. It does not establish model readiness.

Use separate browser profiles/devices for students. A shared browser profile
shares cookies and localStorage by design; logging out does not erase prior
guest history. Existing shared-IP rate limits are retained: stagger account
registration (five per minute per tunnel peer) for a small group.

Clinical content, human review states, scoring, schemas and history formats are
unchanged. Synthetic training content is not medical guidance. This setup does
not establish clinical or educational validity.

## Recheck before a session

Latest browser follow-up: [actual browser fixes, capability findings and acceptance limits](pilot-browser-acceptance-verification.md).

Navigation/recovery follow-up: see [current investigation and acceptance checklist](pilot-navigation-recovery-verification.md).
The original preparation report describes an earlier verification run, not current readiness.

The SPA now uses fragment routes (for example `/#/library` and
`/#/brief?case=id-004`). Keep the slash before `#`; do not use `/library`.
Fragments do not reach the server or expand its file allowlist. Browser history
holds an attempt reference; owner-namespaced `sessionStorage` holds only the last
route/case/attempt reference. Transcripts, hidden answers and rubrics are not
written to recovery storage. Recovery fetches learner-visible evidence from the
owner-authorized server. Opening the root while signed in does not start a case;
use **Resume previous encounter** in the same tab/session when available.

Account sessions currently expire after **24 hours**, or **30 days** with Remember
me (registration uses Remember me). Non-remembered cookies are browser-session
cookies; browser session-restore settings can retain them. Server expiry/revocation
still applies. The app rechecks identity on visibility/pageshow and every minute
while visible; backend authorization applies on every protected request.
Attempts expire **six hours after creation**, are limited to 32 per owner, and
are lost on backend restart. Anonymous signing keys also change on restart.
Refreshing/reopening does not intentionally log out an account. Logout must reach
the server to revoke the session; a failed logout is reported as still active.

Pending grading survives a disconnected HTTP caller while this process remains
alive. Retry retrieves a cached result or joins the same grading task. Saved
reviews are deduplicated per account/guest and server attempt. An expired or
missing attempt is explained with retry/history/new-case actions; saved account
history is separate and persists in SQLite. Unsent text, unsubmitted form drafts,
actions not yet acknowledged by the backend and new-tab
active-encounter discovery are not durable recovery features.

Examine now has six tabs: History, Chat, Order tests, Results, Diagnose and Rx.
Vital signs remain visible; the Examination action panel is removed. A selected
tab survives refresh and Back/Forward in its overlay history entry; tab changes
replace that entry, and a removed Examination reference safely opens History.
New encounters exclude its 15-point criterion: total raw maximum **85**,
data-gathering maximum **50**, other weights/critical rules unchanged.
Examination is labelled **Not assessed**, never automatically performed.
Historical reviews keep their original scores, rubric and examination evidence.
See [assessment scope and verification](examination-tab-removal.md).

```powershell
.\backend\.venv\Scripts\python.exe .\backend\run_pilot_tests.py
npm.cmd test
npm.cmd run verify
npm.cmd run build
npm.cmd run security:scan-frontend
npm.cmd run security:scan
```

The backend runner uses temporary SQLite and blocks external Python networking;
it disables speech/local inference and never uses hosted completion quota. It
preserves the actual provider configuration files. The optional read-only
`scripts/check-openrouter.ps1` checks the configured catalogue without inference.

Before inviting students, manually check the production UI, guest entry, account
login, case selection, authored/typed dialogue, optional-audio failure behavior,
finish/debrief/history and two separate browser profiles. Verify HTTPS cookies
and SSE through the actual hostname after public exposure is authorized. Local
tests cannot establish tunnel buffering, browser cookie behavior or live model
completion success.
