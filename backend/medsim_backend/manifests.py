import json
from pathlib import Path
from typing import Any

APPLICATION_ROOT = Path(__file__).resolve().parents[2]


def _load_safe_curated_cases() -> list[dict[str, Any]]:
    path = APPLICATION_ROOT / "docs" / "generated" / "curation-manifest.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        cases = payload.get("safeCases", [])
        if payload.get("counts", {}).get("curated") != 72 or len(cases) != 72:
            raise ValueError("curation manifest must contain exactly 72 cases")
        return cases
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid or missing curation manifest: {exc}") from exc


def _load_investigation_cases() -> dict[str, dict[str, Any]]:
    path = APPLICATION_ROOT / "docs" / "generated" / "investigation-manifest.server.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        cases = payload.get("cases", [])
        if len(cases) != 72:
            raise ValueError("investigation manifest must contain exactly 72 cases")
        return {item["caseId"]: item for item in cases}
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid or missing investigation manifest: {exc}") from exc
