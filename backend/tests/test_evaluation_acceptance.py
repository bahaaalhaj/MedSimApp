from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from local_ai import LOCAL_AI_CASES, normalize_evaluation  # noqa: E402


class FrozenEvaluationAcceptance(unittest.TestCase):
    def test_authoritative_scores_match_frozen_fixtures(self):
        fixture_path = Path(__file__).parent / "fixtures" / "evaluation_acceptance.json"
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        self.assertEqual(payload["schemaVersion"], "1.0.0")

        for fixture in payload["fixtures"]:
            with self.subTest(fixture=fixture["name"]):
                result = normalize_evaluation(
                    LOCAL_AI_CASES[fixture["caseId"]],
                    fixture["evidence"],
                    fixture["serverOrders"],
                    None,
                )
                projection = {
                    "domainScores": result["domain_scores"],
                    "criterionVerdicts": [
                        {
                            "criterionId": item["criterion_id"],
                            "weight": item["weight"],
                            "verdict": item["verdict"],
                        }
                        for item in result["criteria"]
                    ],
                    "globalRating": result["global_rating"],
                    "safetyBreach": result["safety_breach"] is not None,
                }
                self.assertEqual(projection, fixture["expected"])


if __name__ == "__main__":
    unittest.main()
