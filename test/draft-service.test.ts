import assert from 'node:assert/strict';
import test from 'node:test';

import { createDraft, DraftInput } from '../src/lib/draft-service';

const input: DraftInput = {
  type: 'linkedin',
  audience: 'A B2B SaaS founder',
  objective: 'Book an introductory call',
  tone: 'professional',
  length: 'short',
};

test('createDraft refuses to invent content when no relevant knowledge exists', async () => {
  const result = await createDraft(input, []);

  assert.equal(result.usedGemini, false);
  assert.deepEqual(result.sources, []);
  assert.match(result.draft, /not find enough SprintX knowledge/i);
});
