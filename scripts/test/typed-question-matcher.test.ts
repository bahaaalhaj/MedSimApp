import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTypedQuestion } from '../../src/game/matchTypedQuestion.ts';
import type { AnamnesisQA } from '../../src/game/types.ts';

const questions: AnamnesisQA[] = [
  { id: 'onset', question: 'When did the pain start?', answer: 'Yesterday.', relevant: true },
  { id: 'radiation', question: 'Does the pain travel anywhere?', answer: 'To my arm.', relevant: true },
];

test('matches learner wording only to an authored question', () => {
  assert.equal(matchTypedQuestion('When did your pain start?', questions)?.question.id, 'onset');
});

test('abstains when the input has no meaningful authored overlap', () => {
  assert.equal(matchTypedQuestion('Tell me about your pets', questions), null);
});

test('abstains on stop words and punctuation', () => {
  assert.equal(matchTypedQuestion('Could you please?', questions), null);
});

