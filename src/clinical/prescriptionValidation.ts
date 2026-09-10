import { CLINICAL_CASE_BY_ID } from './cases.ts';

export interface CaseSpecificPrescriptionResult {
  status: 'evaluated' | 'insufficient-reviewed-expectation' | 'not-canonical';
  entries: Array<{
    medicationId: string;
    medicationChoice: 'expected' | 'not-listed';
    doseAndDuration: 'matches-reviewed-expectation' | 'does-not-match' | 'not-reviewed';
  }>;
}

export function validateCaseSpecificPrescription(
  caseId: string,
  prescriptions: Array<{ medication_id: string; dose: string; duration: string }>,
): CaseSpecificPrescriptionResult {
  const clinicalCase = CLINICAL_CASE_BY_ID.get(caseId);
  if (!clinicalCase) return { status: 'not-canonical', entries: [] };
  const reviewed = clinicalCase.medicationScoring.enabled
    && clinicalCase.medicationExpectations.length > 0
    && clinicalCase.medicationExpectations.every((m) => m.unit !== 'not-finalized' && !m.dose.includes('requires reviewer confirmation'));
  const entries = prescriptions.map((p) => {
    const expectation = clinicalCase.medicationExpectations.find((m) => m.medicationId === p.medication_id || m.acceptableAlternatives.includes(p.medication_id));
    if (!expectation) return { medicationId: p.medication_id, medicationChoice: 'not-listed' as const, doseAndDuration: 'not-reviewed' as const };
    if (!reviewed) return { medicationId: p.medication_id, medicationChoice: 'expected' as const, doseAndDuration: 'not-reviewed' as const };
    const doseMatches = p.dose.toLowerCase().includes(expectation.dose.toLowerCase()) || p.dose.toLowerCase().includes(`${expectation.dose} ${expectation.unit}`.toLowerCase());
    const durationMatches = p.duration.toLowerCase().includes(expectation.duration.toLowerCase().split(' ')[0]);
    return { medicationId: p.medication_id, medicationChoice: 'expected' as const, doseAndDuration: doseMatches && durationMatches ? 'matches-reviewed-expectation' as const : 'does-not-match' as const };
  });
  return { status: reviewed ? 'evaluated' : 'insufficient-reviewed-expectation', entries };
}
