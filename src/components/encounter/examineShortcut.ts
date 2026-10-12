export interface ExamineShortcutEvent {
  code: string;
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  getModifierState(key: string): boolean;
}

export function isExamineShortcut(event: ExamineShortcutEvent): boolean {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.getModifierState('AltGraph')) return false;
  return event.code === 'KeyE' || event.key.toLowerCase() === 'e';
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  const element = target as (EventTarget & {
    isContentEditable?: boolean;
    closest?: (selector: string) => Element | null;
  }) | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return Boolean(element.closest?.('input, textarea, select, button, [contenteditable]:not([contenteditable="false"])'));
}
