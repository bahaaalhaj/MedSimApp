"""Offline development report. Never registered as a route or frontend asset."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from local_ai import LOCAL_AI_CASES, sanitize_patient_response
from patient_memory import DOMAIN_ALIASES, SCHEMA_VERSION, FactState, compose_fact, derive_memory

CORE_HISTORY = ("current-medication", "drug-allergies", "smoking", "alcohol", "family", "major-medical-history", "relevant-negative-symptoms")


def core_history(case: dict, memory) -> dict:
    """Coverage only: no clinical sign-off or inference from hidden management."""
    import re
    authored = [f for f in memory.facts if f.source_question_id and f.allowed_for_patient_dialogue]
    history = {row["id"]: row for row in case["patient"]["history"]}
    result = {}
    for domain in CORE_HISTORY:
        draft = [f for f in authored if f.core_history_domain == domain]
        if draft:
            facts = draft
        elif domain == "current-medication":
            # A specific NSAID/supplement question is not a complete drug list.
            facts = [f for f in authored if "medication" in f.domains and re.search(r"\b(?:medications?|meds|medicines?|tablets)\b", f.question, re.I)]
        elif domain == "drug-allergies":
            facts = [f for f in authored if "allergies" in f.domains and re.search(r"\b(?:drug|medication|medicine)\b", f.question, re.I)]
        elif domain == "major-medical-history":
            facts = [f for f in authored if "medical-history" in f.domains]
        elif domain == "relevant-negative-symptoms":
            excluded = {"family", "travel", "exposure", "medication", "smoking", "alcohol", "sexual", "menstrual", "obstetric", "medical-history", "surgery"}
            symptom_ids = {"sx", "symptoms", "pain", "chest", "ear-pain", "rest-pain", "fever", "wheeze", "cough", "hemoptysis", "nausea", "vomit", "neuro", "weakness", "jaundice", "blood", "bleeding", "tinnitus", "weight-loss", "redness", "swelling", "instability", "dyspnea", "headache", "gait", "bladder", "rash", "others", "wounds"}
            facts = [f for f in authored if f.status == FactState.NEGATIVE and history[f.source_question_id]["relevant"]
                     and not set(f.domains) & excluded and (f.source_question_id in symptom_ids or "symptoms" in f.question.lower())]
        else:
            facts = [f for f in authored if domain in f.domains]
        partial = [f for f in authored if "medication" in f.domains] if domain == "current-medication" and not facts else []
        supported = facts or partial
        # Explicit supplemental domains retain their actual review status.
        # Unknown/mixed states must never be silently promoted to approval.
        review = ("clinician-approved" if draft and all(f.review_status == "clinician-approved" for f in draft)
                  else "requires-clinical-review" if draft or not facts else "existing-authored-facts-not-clinician-validation")
        result[domain] = {"status": supported[0].status.value if supported else "not-documented",
                          "factIds": [f.fact_id for f in supported],
                          "coverage": "explicit-authored-statement" if facts else "partial-scoped-history" if partial else "not-documented-or-unmapped",
                          "reviewRequirement": review}
    return result


def coverage_report() -> dict:
    cases = []
    totals: Counter = Counter()
    for case in sorted(LOCAL_AI_CASES.values(), key=lambda item: item["caseId"]):
        memory = derive_memory(case)
        counts = Counter(fact.status.value for fact in memory.facts)
        totals.update(counts)
        withheld = []
        for fact in memory.facts:
            if fact.source_question_id and fact.allowed_for_patient_dialogue:
                response = compose_fact(fact, fact.question, is_parent=case["patient"]["age"] < 14)
                if sanitize_patient_response(response, case, authored_response=response) != response:
                    withheld.append(fact.source_question_id)
        available = sorted({domain for fact in memory.facts if fact.allowed_for_patient_dialogue for domain in fact.domains})
        cases.append({
            "caseId": memory.case_id, "caseVersion": memory.case_version,
            "schemaVersion": memory.schema_version,
            "availableDomains": available,
            "stateCounts": {state.value: counts[state.value] for state in FactState},
            "authoredQuestionCount": len(case["patient"]["history"]),
            "unsupportedDomains": sorted(set(DOMAIN_ALIASES) - set(available)),
            "unclassifiedQuestionIds": [f.source_question_id for f in memory.facts if f.category == "unclassified-history"],
            "typedResponseGuardWithheldQuestionIds": withheld,
            "coreHistory": core_history(case, memory),
            "authoredAnswerAudit": [{"factId": f.fact_id, "question": f.question, "domains": list(f.domains),
                                     "status": f.status.value, "sourceField": f.source_case_field,
                                     "mappingReview": "explicit-draft-domain" if f.core_history_domain else "requires-clinical-review" if not f.domains else "question-label-derived",
                                     "reviewStatus": f.review_status}
                                    for f in memory.facts if f.source_question_id],
            "sourceMappings": [{"factId": f.fact_id, "sourceField": f.source_case_field,
                                "state": f.status.value, "allowed": f.allowed_for_patient_dialogue, "reviewStatus": f.review_status}
                               for f in memory.facts if f.status != FactState.UNDOCUMENTED],
        })
    semantic = json.dumps(list(LOCAL_AI_CASES.values()), sort_keys=True, separators=(",", ":"))
    return {
        "intendedUse": "development-only-patient-memory-coverage",
        "schemaVersion": SCHEMA_VERSION,
        "generator": "backend/.venv/Scripts/python.exe backend/patient_memory_report.py",
        "source": "docs/generated/local-ai-manifest.server.json (canonical clinical generator projection)",
        "sourceSemanticSha256": hashlib.sha256(semantic.encode()).hexdigest(),
        "caseCount": len(cases),
        "authoredQuestionCount": sum(c["authoredQuestionCount"] for c in cases),
        "typedResponseGuardWithheldCount": sum(len(c["typedResponseGuardWithheldQuestionIds"]) for c in cases),
        "coreHistoryContract": list(CORE_HISTORY),
        "coreHistoryGapCount": sum(item["coverage"] != "explicit-authored-statement" for c in cases for item in c["coreHistory"].values()),
        "coreHistoryGapCounts": {domain: sum(c["coreHistory"][domain]["coverage"] != "explicit-authored-statement" for c in cases) for domain in CORE_HISTORY},
        "pendingClinicalReviewCount": sum(f.review_status != "clinician-approved" if f.core_history_domain else f.review_status == "requires-clinical-review"
                                          for case in LOCAL_AI_CASES.values() for f in derive_memory(case).facts if f.source_question_id),
        "approvedClinicalReviewCount": sum(f.review_status == "clinician-approved" for case in LOCAL_AI_CASES.values()
                                           for f in derive_memory(case).facts if f.source_question_id and f.core_history_domain),
        "canonicalAudit": "435 original history answers plus 446 supplemental synthetic additions from src/clinical/history-drafts.json. Review status records project-owner-reported clinician approval; it is not independently verified or an approval of the complete cases/guidelines. Additions enter only the server manifest and remain non-scoreable; original canonical history, learner questions and scoring are unchanged. Coverage and clinical review status are independent. Hidden management, differential negatives, vitals and test results are not sources of patient self-history.",
        "stateCounts": {state.value: totals[state.value] for state in FactState},
        "note": "Counts describe explicit authored values, not medical verification. Protected counts are excluded field markers, never copied answer keys. Missing domains are not negative findings.",
        "cases": cases,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--validate-core-history", action="store_true", help="Report missing domains without changing review status; exit 2 means clinical review is required")
    args = parser.parse_args()
    if args.validate_core_history:
        report = coverage_report()
        print(json.dumps({"caseCount": report["caseCount"], "authoredQuestionCount": report["authoredQuestionCount"],
                          "gapCounts": report["coreHistoryGapCounts"], "reviewRequirement": "requires-clinical-review" if report["coreHistoryGapCount"] or report["pendingClinicalReviewCount"] else "supplemental-review-complete",
                          "pendingClinicalReviewCount": report["pendingClinicalReviewCount"],
                          "approvedClinicalReviewCount": report["approvedClinicalReviewCount"],
                          "gaps": {c["caseId"]: [d for d, v in c["coreHistory"].items() if v["coverage"] != "explicit-authored-statement"] for c in report["cases"]}}, indent=2))
        raise SystemExit(2 if report["coreHistoryGapCount"] or report["pendingClinicalReviewCount"] else 0)
    text = json.dumps(coverage_report(), indent=2, ensure_ascii=True) + "\n"
    if args.output:
        # Reports can never be placed under a browser delivery directory.
        root = Path(__file__).resolve().parents[1]
        output = args.output.resolve()
        development_root = root / "docs" / "development"
        if not output.is_relative_to(development_root):
            parser.error("report output must be within docs/development")
        if args.check:
            if not output.exists() or output.read_text(encoding="utf-8") != text:
                raise SystemExit("patient-memory coverage report is stale")
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(text, encoding="utf-8")
        print(json.dumps({"caseCount": 72, "authoredQuestionCount": coverage_report()["authoredQuestionCount"], "check": args.check}))
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
