export const EXAMINE_TABS = ['history', 'chat', 'tests', 'results', 'diagnose', 'rx'] as const;
export type ExamineTab = typeof EXAMINE_TABS[number];

/** Removed/unknown tabs, including persisted examination references, open History. */
export function normalizeExamineTab(value: unknown): ExamineTab {
  return EXAMINE_TABS.includes(value as ExamineTab) ? value as ExamineTab : 'history';
}
