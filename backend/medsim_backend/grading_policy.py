"""Versioned assessment scope; authored rubrics and historical attempts stay intact."""
from __future__ import annotations

import copy
from typing import Any

EXAMINATION_EXCLUDED = "examination-excluded-v1"


def assessment_case(case: dict[str, Any], policy: str | None) -> tuple[dict[str, Any], dict[str, Any] | None]:
    if policy != EXAMINATION_EXCLUDED:
        return case, None
    scoped = copy.deepcopy(case)
    rubric = scoped["evaluation"]["rubric"]
    excluded = [rule for rule in rubric if rule["sourceDomain"] == "examination"]
    scoped["evaluation"]["rubric"] = [rule for rule in rubric if rule["sourceDomain"] != "examination"]
    return scoped, {"policy": EXAMINATION_EXCLUDED, "excluded_criteria": [
        {"criterion_id": rule["criterionId"], "title": rule["description"],
         "domain": rule["domain"], "original_weight": rule["weight"],
         "reason": "Examination actions are not available in this encounter UI."}
        for rule in excluded
    ]}
