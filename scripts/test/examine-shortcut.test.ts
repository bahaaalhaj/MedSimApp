import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isEditableShortcutTarget, isExamineShortcut, type ExamineShortcutEvent } from '../../src/components/encounter/examineShortcut.ts';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

function event(overrides: Partial<ExamineShortcutEvent> = {}): ExamineShortcutEvent {
  return {
    code: 'KeyE',
    key: 'e',
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    getModifierState: () => false,
    ...overrides,
  };
}

test('Examine shortcut accepts physical KeyE and the legacy key fallback', () => {
  assert.equal(isExamineShortcut(event({ code: 'KeyE', key: 'e' })), true);
  assert.equal(isExamineShortcut(event({ code: 'KeyE', key: 'ث' })), true);
  assert.equal(isExamineShortcut(event({ code: 'KeyQ', key: 'E' })), true);
});

test('Examine shortcut rejects repeats and modifier combinations', () => {
  assert.equal(isExamineShortcut(event({ repeat: true })), false);
  assert.equal(isExamineShortcut(event({ ctrlKey: true })), false);
  assert.equal(isExamineShortcut(event({ altKey: true })), false);
  assert.equal(isExamineShortcut(event({ metaKey: true })), false);
  assert.equal(isExamineShortcut(event({ getModifierState: (key) => key === 'AltGraph' })), false);
});

test('Examine shortcut suppresses editable controls and their descendants', () => {
  assert.equal(isEditableShortcutTarget({ closest: () => ({}) } as EventTarget), true);
  assert.equal(isEditableShortcutTarget({ isContentEditable: true } as EventTarget), true);
  assert.equal(isEditableShortcutTarget({ closest: () => null } as EventTarget), false);
  const helper = read('src/components/encounter/examineShortcut.ts');
  assert.match(helper, /input, textarea, select, button, \[contenteditable\]/);
});

test('keyboard and visible Examine button use the same stable openExamine path', () => {
  const encounter = read('src/components/EncounterScreen.tsx');
  assert.match(encounter, /const openExamine = useCallback/);
  assert.match(encounter, /isExamineShortcut\(e\)[\s\S]*isEditableShortcutTarget\(e\.target\)[\s\S]*openExamine\(\)/);
  assert.match(encounter, /onClick=\{\(e\) => \{[\s\S]*openExamine\(\);/);
  assert.match(encounter, /usesGlobalExamineShortcut/);
  const player = read('src/components/three/Player.tsx');
  assert.match(player, /usesGlobalExamineShortcut && active\.kind === 'bed'/);
});
