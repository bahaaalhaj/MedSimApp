/**
 * Compatibility formatter for legacy callers.
 *
 * There is deliberately no default-result registry. A missing case-specific
 * value is explicit and can never be converted into a reassuring report.
 * Curated encounters use server-owned investigation snapshots instead.
 */
export interface TestReport {
  text: string;
  abnormal: boolean;
  available: boolean;
}

export function getTestReport(
  _testId: string,
  caseSpecificResult?: string,
  abnormal = false,
): TestReport {
  if (caseSpecificResult?.trim()) return { text: caseSpecificResult, abnormal, available: true };
  return {
    text: 'UNAVAILABLE / NOT MODELED — no case-specific result exists for this case version.',
    abnormal: false,
    available: false,
  };
}
