"""Conservative formative observations, separate from clinical scoring authority.

No provider calls, authored clinical changes, new weights, or elapsed-time rules.
Missing evidence stays not-assessable. A possible repeat is a review prompt.
"""
from __future__ import annotations

import math
import re
from typing import Any


def _timestamp(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _indicator(identifier: str, status: str, evidence: str, counts: dict[str, int], refs: list[str] | None = None) -> dict[str, Any]:
    return {'id': identifier, 'status': status, 'evidence': evidence, 'counts': counts, 'evidence_refs': (refs or [])[:64]}


def assess_consultation_management(case: dict[str, Any], investigation_case: dict[str, Any],
                                   observation: dict[str, Any], evaluation: dict[str, Any]) -> dict[str, Any]:
    """Read a server-captured snapshot; never mutate it or award clinical points."""
    authored = {str(row['id']): row for row in case['patient']['history'] if row.get('scoreable', True)
                and row.get('reviewStatus') not in {'requires-clinical-review', 'pending-clinical-review'}}
    history_turns: list[tuple[str, tuple[str, ...], int]] = []
    transcript = (observation.get('transcript') or [])[-256:]
    if observation.get('evidenceVersion') == 2:
        for index in range(1, len(transcript)):
            question, response = transcript[index - 1], transcript[index]
            audit = response.get('dialogueProvenance') or {}
            if (question.get('role') != 'trainee' or response.get('role') != 'patient'
                    or audit.get('caseId') != case['caseId'] or str(audit.get('caseVersion')) != str(case['caseVersion'])
                    or audit.get('internalProvenance') not in {'predefined-authored', 'deterministic-authored'}):
                continue
            history_ids = {value[len('history:'):] for value in audit.get('matchedFactIds', [])
                           if isinstance(value, str) and value.startswith('history:')}
            # A compound answer may add information outside the assessable
            # bank. Do not discard that addition then call the turn a repeat.
            if not history_ids or not history_ids <= authored.keys():
                continue
            sources = tuple(sorted(history_ids))
            normalized = ' '.join(re.findall(r'[a-z0-9]+', str(question.get('content', '')).lower()))
            if sources and normalized:
                history_turns.append((normalized, sources, index))

    covered = {source for _, sources, _ in history_turns for source in sources}
    relevant = sum(authored[source].get('relevant') is True for source in covered)
    other = len(covered) - relevant
    focus = _indicator('focused-questioning', 'documented' if relevant else 'review-recommended' if covered else 'not-assessable',
                       f'{relevant} authored relevant history source(s) and {other} other authored source(s) were covered in the assessed dialogue window. '
                       'Unmapped questions are not automatically considered irrelevant.',
                       {'relevant_sources': relevant, 'other_sources': other, 'assessed_turns': len(history_turns)},
                       [f'dialogue-pair:{index}' for _, _, index in history_turns])

    seen: set[tuple[str, tuple[str, ...]]] = set()
    repeat_refs = []
    for question, sources, index in history_turns:
        key = (question, sources)
        if key in seen:
            repeat_refs.append(f'dialogue-pair:{index}')
        seen.add(key)
    repetition = _indicator('repetition-review', 'review-recommended' if repeat_refs else 'documented' if history_turns else 'not-assessable',
                            f'{len(repeat_refs)} possible exact repeat(s) of the same question and authored sources. '
                            'Confirmation may be appropriate; review the context. Different wording or new sources is not classified as repetition.',
                            {'possible_repeats': len(repeat_refs), 'assessed_turns': len(history_turns)}, repeat_refs)

    catalogue = {row['testId']: row for row in investigation_case.get('investigations', [])}
    essentials = {key for key, row in catalogue.items() if row.get('role') == 'essential'}
    orders = list((observation.get('orders') or {}).values())
    diagnosis_at = observation.get('diagnosisSubmittedAt')
    harmful = sum(catalogue.get(row.get('investigationId'), {}).get('role') == 'harmful' for row in orders)
    released_before = {row.get('investigationId') for row in orders
                       if _timestamp(diagnosis_at) and _timestamp(row.get('orderedAt')) and _timestamp(row.get('releasedAt'))
                       and row['orderedAt'] <= row['releasedAt'] <= diagnosis_at}
    covered_before = len(essentials & released_before)
    priority_status = ('not-assessable' if not essentials or not _timestamp(diagnosis_at) else
                       'documented' if covered_before == len(essentials) and not harmful else 'review-recommended')
    priority = _indicator('priority-sequencing', priority_status,
                          f'{covered_before} of {len(essentials)} authored essential result(s) were released before the first server-recorded diagnosis; '
                          f'{harmful} authored harmful order(s) were recorded. Release is not proof the learner read a result. '
                          'Missing event order does not establish poor prioritisation.',
                          {'essential_total': len(essentials), 'released_before_diagnosis': covered_before, 'harmful_orders': harmful})

    management_ids = {row['criterionId'] for row in case['evaluation']['rubric'] if row['sourceDomain'] in {'diagnosis', 'investigation'}}
    met = {row['criterion_id'] for row in evaluation.get('criteria', []) if row.get('verdict') == 'met'}
    checks = observation.get('completionChecks')
    completed = sum(checks.get(key) is True for key in ('summaryCompleted', 'safetyNettingCompleted', 'ideasConcernsExpectationsCompleted')) if isinstance(checks, dict) else 0
    safety_breach = bool(evaluation.get('safety_breach'))
    correct = observation.get('submittedDiagnosisId') == case['evaluation']['correctDiagnosisId']
    plan_status = ('not-assessable' if not isinstance(checks, dict) and not safety_breach else
                   'documented' if management_ids and management_ids <= met and completed == 3 and correct and not safety_breach else 'review-recommended')
    plan = _indicator('plan-and-safety', plan_status,
                      f'{len(management_ids & met)} of {len(management_ids)} existing diagnosis/investigation criteria were met; '
                      f'{completed} of 3 completion checks were recorded. '
                      'Checks are learner-reported, not independent proof of spoken explanation or appropriate prescribing. '
                      + ('An existing critical safety failure remains in force.' if safety_breach else 'The original safety assessment is unchanged.'),
                      {'existing_management_met': len(management_ids & met), 'existing_management_total': len(management_ids),
                       'completion_checks': completed, 'critical_safety_failure': int(safety_breach)},
                      [f'criterion:{key}' for key in sorted(management_ids)])

    indicators = [focus, repetition, priority, plan]
    statuses = {row['status'] for row in indicators}
    return {
        'version': '1.0.0', 'mode': 'formative-observation', 'affects_clinical_score': False, 'time_policy': 'context-only',
        'overall': 'review-recommended' if 'review-recommended' in statuses else 'partial-evidence' if 'not-assessable' in statuses else 'documented',
        'indicators': indicators,
        'limitations': [
            'Local formative indicators, not a validated medical rubric or an additional clinical score.',
            'Only retained server-recorded evidence is analysed. Missing evidence is not automatically poor performance.',
            'Elapsed time is context only: no speed bonus or minute-based penalty.',
            'Completion checks are learner-reported; spoken delivery and prescription appropriateness are not independently verified.',
            'Dialogue indicators exclude model-interpreted selections and pending-review draft sources.',
        ],
    }
