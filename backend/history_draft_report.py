"""Reproducible, development-only physician review export and retrieval traces."""
from __future__ import annotations
import csv
import io
import json
from pathlib import Path
from local_ai import LOCAL_AI_CASES, sanitize_patient_response
from patient_memory import compose_fact, derive_memory, retrieve
from patient_memory_report import coverage_report

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/development'

def artifacts() -> dict[str, str]:
    source = json.loads((ROOT / 'src/clinical/history-drafts.json').read_text(encoding='utf-8'))
    rows = source['additions']
    stream = io.StringIO(newline='')
    columns = ['caseId', 'patientName', 'age', 'coreHistoryDomain', 'id', 'question', 'answer', 'rationale', 'reviewStatus', 'clinicianDecision', 'reviewerId', 'reviewedAt', 'reviewerName', 'reviewEvidence']
    writer = csv.DictWriter(stream, fieldnames=columns, lineterminator='\n')
    writer.writeheader()
    for row in rows:
        patient = LOCAL_AI_CASES[row['caseId']]['patient']
        writer.writerow({**{key: row.get(key) for key in columns}, 'patientName': patient['displayName'], 'age': patient['age']})
    baseline = json.loads((OUT / 'history-draft-before.json').read_text())
    traces = []
    for before in baseline:
        case = LOCAL_AI_CASES[before['caseId']]
        result = retrieve(derive_memory(case), before['question'])
        text = compose_fact(result.candidates[0], before['question'], is_parent=case['patient']['age'] < 14) if result.immediate and result.candidates else None
        traces.append({'caseId': before['caseId'], 'question': before['question'], 'immediate': result.immediate,
                       'reason': result.reason, 'factIds': [f.fact_id for f in result.candidates], 'text': text,
                       'passesResponseGuard': text is not None and sanitize_patient_response(text, case, authored_response=text) == text,
                       'reviewRequirements': {f.fact_id: f.review_status for f in result.candidates}})
    report = coverage_report()
    matrix = ['# Core history coverage and review', '',
              f"Coverage measures authored data, not medical approval. Supplemental additions: {report['approvedClinicalReviewCount']} approved, {report['pendingClinicalReviewCount']} pending review. Approval records the project owner's attestation; reviewer identity and review date are not independently verified. See history-additions-approval.md.", '',
              '| Case | ' + ' | '.join(report['coreHistoryContract']) + ' |', '|---|' + '---|' * 7]
    for case in report['cases']:
        labels = {'requires-clinical-review': 'supplemental; review pending', 'clinician-approved': 'supplemental; clinician approved, owner-reported'}
        cells = [v['coverage'] + ' (' + labels.get(v['reviewRequirement'], 'original') + ')' for v in case['coreHistory'].values()]
        matrix.append('| ' + case['caseId'] + ' | ' + ' | '.join(cells) + ' |')
    return {'history-draft-clinician-review.csv': stream.getvalue(), 'history-draft-after.json': json.dumps(traces, indent=2) + '\n',
            'history-draft-coverage.md': '\n'.join(matrix) + '\n'}

if __name__ == '__main__':
    import sys
    check = '--check' in sys.argv
    for name, text in artifacts().items():
        path = OUT / name
        if check:
            if not path.exists() or path.read_text(encoding='utf-8') != text:
                raise SystemExit(f'Stale report: {name}')
        else:
            path.write_text(text, encoding='utf-8')
    print('PASS history draft review exports' + (' (check)' if check else ''))
