"""Explicitly synthesize authored patient audio into MedSim's persistent cache.

This command never downloads model assets. Kokoro must already be present in
the verified canonical cache.
"""
from __future__ import annotations

import argparse
import asyncio
import time

from local_ai import LOCAL_AI_CASES, SAFE_UNKNOWN_RESPONSE, compose_patient_answer, deterministic_patient_match, opening_greeting
from tts import TTSRequest, get_tts_manager, inspect_kokoro_cache


async def prepare(case_ids: list[str]) -> int:
    manager = get_tts_manager()
    cache = inspect_kokoro_cache(manager.settings.model_cache_dir)
    if not cache.ready:
        print(f"error={cache.state}")
        print("setup=python backend/prepare_kokoro.py")
        return 1
    started = time.perf_counter()
    hits = generated = failures = 0
    for case_id in case_ids:
        case = LOCAL_AI_CASES[case_id]
        patient = case["patient"]
        is_parent = int(patient["age"]) < 14
        utterances = [opening_greeting(patient), SAFE_UNKNOWN_RESPONSE]
        utterances.extend(
            deterministic_patient_match(case, question, is_parent=is_parent, profile=patient).response
            for question in ("What is your name?", "How old are you?", "What brought you here?")
        )
        utterances.extend(compose_patient_answer(str(row["answer"]), str(row["question"]), is_parent=is_parent) for row in patient["history"])
        for text in dict.fromkeys(utterances):
            try:
                result = await manager.synthesize(TTSRequest(
                    text=text, case_id=case_id, case_version=str(case["caseVersion"]),
                    gender=str(patient["gender"]), is_pediatric=is_parent,
                    is_opening_greeting=text == utterances[0], cacheable=True,
                ))
                hits += int(result.cache_hit)
                generated += int(not result.cache_hit)
                print(f"case={case_id} voice={result.voice} cache={'hit' if result.cache_hit else 'generated'}")
            except Exception as exc:
                failures += 1
                print(f"case={case_id} error={type(exc).__name__}")
    stats = manager.health()
    elapsed = time.perf_counter() - started
    print(f"elapsed_seconds={elapsed:.3f}")
    print(f"cache_hits={hits} generated={generated} failures={failures}")
    print(f"persistent_entries={stats.get('persistent_audio_cache_entries', 0)} bytes={stats.get('persistent_audio_cache_bytes', 0)}")
    if generated and not failures:
        # Conservative linear projection; --all retains one loaded model and
        # normally completes faster because identical utterances deduplicate.
        print(f"estimated_all_cases_seconds_upper_bound={elapsed / generated * 72 * 11:.0f}")
    else:
        print("estimated_all_cases_seconds_upper_bound=not-measured-cache-hot")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare persistent authored Kokoro audio without runtime downloads.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--case-id", choices=sorted(LOCAL_AI_CASES))
    group.add_argument("--all", action="store_true", help="Prepare all 72 cases sequentially; this can take a long time.")
    args = parser.parse_args()
    ids = sorted(LOCAL_AI_CASES) if args.all else [args.case_id]
    return asyncio.run(prepare(ids))


if __name__ == "__main__":
    raise SystemExit(main())
