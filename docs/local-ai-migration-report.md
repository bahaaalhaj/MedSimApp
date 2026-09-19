# Anthropic-to-provider migration evidence

## Runtime migration

The original patient HTTP 500 was reproduced when the former handler constructed its Anthropic client without `ANTHROPIC_API_KEY`. Active Anthropic patient, Managed Agent, cloud environment/session/event orchestration, SDK dependency, frontend client, credential, and Claude model identifiers have been removed.

| Workload | Current path |
|---|---|
| Patient text | Owner-bound attempt → server-safe case facts → provider interface → OpenRouter by default or explicit llama.cpp offline → buffered/sanitized SSE |
| Patient speech | Durable transcript → local Kokoro; text survives TTS failure |
| Debrief | Bounded learner evidence → one structured provider request → schema/evidence validation → authoritative deterministic arithmetic and fallback |
| Health | Non-secret provider/model/catalogue state plus evaluator and TTS readiness |

## OpenRouter catalogue decision

On 2026-09-15 the live catalogue contained no Qwen-branded `qwen/...:free` model. A focused comparison selected `nex-agi/nex-n2.5-mini:free` as primary and retained `nex-agi/nex-n2.5-pro:free` only as a configuration-disabled option; no paid model or dynamic router is allowed:

| Candidate | Family metadata | Context | Relevant capabilities | Price | Published license |
|---|---|---:|---|---|---|
| `nex-agi/nex-n2.5-mini:free` (selected) | Nex AGI; Qwen3.5-MoE lineage | 262,144 | streaming, instruction following, JSON-schema structured output | $0 input/output | Apache-2.0 |
| `nex-agi/nex-n2.5-pro:free` (supported, disabled) | Nex AGI; Qwen3.5-MoE lineage | 262,144 | instruction following, reasoning control, JSON-schema structured output | $0 input/output | Apache-2.0 |

The final runtime decision answers high-confidence authored and clearly unavailable questions locally, and reserves one Mini attempt capped at 3 seconds for genuinely ambiguous dialogue. Pro is configuration-disabled because the live benchmark produced 20% success and 15.02-second median latency, and is never used sequentially.

Free capacity, model availability, and rate limits can change. OpenRouter is an inference intermediary and records request metadata under its privacy terms. Internet access is required. No free hosted model is claimed clinically validated or equivalent to Claude.

## Privacy and reproducibility

Only synthetic educational content is in scope. The browser never sees the key, configured endpoint, system prompt, case truth, rubric, medication expectations, or guideline allowlist. Dialogue receives only patient-safe facts and recent bounded history. Evaluation receives only necessary recorded evidence while the server restores authoritative truth. Evaluation provenance stores the configured provider/model, actual returned model ID, safe request correlation ID, mode, and fallback category.

Deterministic scoring remains authoritative because hosted availability and semantic output vary. Model output cannot change weights, arithmetic, diagnosis truth, prescription rules, critical failures, criterion IDs, or approved references.

## Remaining reference classification

- Runtime: no active Anthropic/Claude runtime reference is permitted.
- Historical: dated migration/evolution material may describe the removed architecture in past tense.
- Documentation: negative statements explain what was removed and are not configuration.
- Development tooling: `.claude/` and `CLAUDE.md` are provider-independent developer conventions and are not product runtime.
- Tests: Anthropic credential/model strings appear only in negative regression assertions.

## Optional local preservation

The verified llama.cpp b10948 runtime and official Qwen3-1.7B Q8_0 artifact remain ignored local assets. Local configuration, Vulkan/NVIDIA selection, preflight, tests, and documentation remain available, disabled by default. The 2.5 GB memory threshold is unchanged; Qwen 4B was not downloaded.

## Current worktree inventory

The migration worktree is intentionally unstaged. Relative to `HEAD`, it contains 42 modified, 17 deleted, and 22 untracked files. The OpenRouter revision directly created `backend/openrouter_preflight.py`, `backend/tests/test_openrouter.py`, and `scripts/check-openrouter.ps1`; it directly revised `backend/local_llm.py`, `backend/server.py`, `backend/.env.example`, the local start/preflight scripts, patient/evaluator browser contracts and tests, active runtime descriptions, and this report.

Earlier Anthropic cleanup in the same worktree accounts for these exact deletions:

```text
.claude/skills/medsim-attending-debrief/SKILL.md
.claude/skills/medsim-demo-video.md
.claude/skills/medsim-managed-agent-setup.md
agent/skills/README.md
agent/skills/attending-debrief/SKILL.md
agent/skills/case-generator/README.md
agent/skills/case-generator/SKILL.md
agent/skills/case-generator/variant-brief.schema.json
agent/skills/guideline-curator/SKILL.md
agent/skills/patient-roleplay/SKILL.md
agent/skills/simulation-tick/SKILL.md
backend/tests/test_vault.py
scripts/test/custom-tools.test.ts
src/agents/customTools.ts
src/agents/managedAgent.ts
src/agents/useAttendingDebrief.ts
src/voice/claude.ts
```

The exact current modified/untracked paths remain visible with `git status --short`; unrelated user changes were not reverted or staged.
