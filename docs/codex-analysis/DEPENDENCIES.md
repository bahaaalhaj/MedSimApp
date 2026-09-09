# Dependencies and Configuration

## Frontend/runtime inventory

| Package | Resolved version | Purpose |
| --- | ---: | --- |
| React / React DOM | 18.3.1 | SPA UI and external-store bindings |
| Three.js | 0.170.0 | 3D rendering |
| `@react-three/fiber` | 8.18.0 | React renderer for Three.js |
| `@react-three/drei` | 9.122.0 | Three.js helpers and controls |
| `livekit-client` | 2.18.6 | Browser WebRTC room/audio/transcription/RPC |
| Zod | 3.25.76 | Agent custom-tool payload validation |
| TypeScript | 5.9.3 | Static checking and native TS scripts |
| Vite | 5.4.21 | Dev server, proxy, and production bundling |

There is no routing library, Redux/Zustand runtime dependency, HTTP client library, frontend test framework, CSS framework, animation package, or 3D physics engine. CSS is handwritten in `src/styles/global.css`; component animation is CSS/Three.js code.

`package.json` uses compatible ranges, so the lockfile’s resolved Zod/TypeScript/Vite versions are newer than the manifest minima. `node_modules` is included in the archive and appears platform-specific: TypeScript succeeds, but the Linux Rollup native optional package is absent, so Vite build fails in this environment. Do not treat archived `node_modules` as portable.

## Python inventory

HTTP environment (`backend/requirements.txt`): FastAPI 0.136.1, Uvicorn 0.46.0, Pydantic 2.13.3, Anthropic SDK ≥0.88.0, LiveKit API ~0.8, HTTPX 0.28.1, SlowAPI 0.1.9, Argon2-CFFI 25.1.0, and email-validator 2.3.0.

Voice environment (`backend/voice_agent_requirements.txt`): `livekit-agents` ~1.0 with Deepgram, Cartesia, Anthropic, Silero, and turn-detector extras; `python-dotenv` ~1.0. Separate environments avoid dependency collisions.

`argon2-cffi` provides Argon2id password hashing and `email-validator` backs Pydantic email validation. SQLite uses Python's standard library. `httpx` supports FastAPI's test client and other HTTP paths. The application imports no paid auth, analytics, monitoring, or error-reporting package.

## Environment variables

| Variable | Used by | Purpose | Required? | Sensitive? |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | `backend/server.py`, voice worker through provider plugin | Attending and patient LLMs | Yes for AI | Yes |
| `MEDSIM_AGENT_ID` | `backend/server.py` | Persistent Managed Agent identity | Yes after bootstrap for debrief | Internal identifier |
| `MEDSIM_ENV_ID` | `backend/server.py` | Persistent Managed Agent environment | Yes after bootstrap for debrief | Internal identifier |
| `LIVEKIT_URL` | server and voice worker | WebSocket endpoint | Yes for voice | Usually no, operational |
| `LIVEKIT_API_KEY` | server and voice worker | LiveKit credential ID | Yes for voice | Yes |
| `LIVEKIT_API_SECRET` | server and voice worker | Token signing | Yes for voice | Yes |
| `DEEPGRAM_API_KEY` | voice worker/provider plugin | Streaming speech-to-text | Yes for voice | Yes |
| `CARTESIA_API_KEY` | voice worker/provider plugin | Streaming speech synthesis | Yes for voice | Yes |
| `BACKEND_SHARED_SECRET` | Vercel middleware and FastAPI | Edge-to-backend shared header | Required for deployed protection | Yes |
| `EHR_API_TOKEN` | FastAPI fake vault | Enables EHR demo | Only for vault demo | Yes |
| `MEDSIM_DATABASE_PATH` | authentication repository | SQLite account/progress file | Defaults locally; persistent path required in production | Operational |
| `MEDSIM_ENVIRONMENT` | authentication settings | Secure-cookie production default | Recommended | No |
| `MEDSIM_SESSION_HOURS` / `MEDSIM_REMEMBER_DAYS` | authentication service | Session expiry policy | Defaults provided | No |
| `MEDSIM_COOKIE_SECURE` / `MEDSIM_COOKIE_SAMESITE` / `MEDSIM_COOKIE_DOMAIN` | authentication API | Cookie deployment policy | Production-specific | No |
| `PORT` | Procfile/Uvicorn command | Hosting port | Hosting supplied | No |

`backend/.env.example` documents backend protection, authentication, AI, voice, and optional EHR variables with placeholders only. `BACKEND_SHARED_SECRET` must also be configured in Vercel.

## Infrastructure

- Development: Vite on 5173 proxies `/api/*`, `/agent/*`, and `/voice/*` to FastAPI on 8787.
- Frontend deployment: Vercel SPA rewrites plus Edge middleware.
- Backend deployment: Procfile targets Uvicorn and the voice worker; comments/name imply Render.
- External services: Anthropic, LiveKit Cloud, Deepgram, Cartesia, remote Three.js/Khronos GLBs, and Wikimedia images.
- No Docker, Compose, CI workflow, infrastructure-as-code, monitoring integration, database hosting, or object storage configuration exists.

No dependency upgrades or current-vulnerability assertions were made in this audit. A lockfile vulnerability scan still needs to run in an environment with registry access.
