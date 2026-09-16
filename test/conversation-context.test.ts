import assert from 'node:assert/strict';
import test from 'node:test';
import { answerQuestion } from '../src/lib/ask-service';
import { createDraft } from '../src/lib/draft-service';
const { GoogleGenerativeAI } = require('@google/generative-ai');
const result = { id: 'fixture', sourceId: 'fixture', sourceType: 'document' as const, sourceTitle: 'SprintX', sourcePath: 'fixture', content: 'SprintX provides growth marketing.', chunkIndex: 0, score: 1 };
const history = [{ role: 'assistant' as const, content: 'Previous fixture answer about growth marketing.' }];
test('Ask and Draft receive previous conversation turns', async () => {
  const previous = GoogleGenerativeAI.prototype.getGenerativeModel;
  GoogleGenerativeAI.prototype.getGenerativeModel = () => ({ generateContent: async (prompt: string) => { assert.match(prompt, /Previous fixture answer/); return { response: { candidates: [{ content: { parts: [{ text: 'Grounded fixture response' }] } }] } }; } });
  try {
    assert.equal((await answerQuestion('Make that shorter', [result], 'fixture-key', history)).usedGemini, true);
    assert.equal((await createDraft({ type: 'follow-up', audience: 'Founder', objective: 'Shorten the earlier message', tone: 'concise', length: 'short' }, [result], 'fixture-key', history)).usedGemini, true);
  } finally { GoogleGenerativeAI.prototype.getGenerativeModel = previous; }
});
