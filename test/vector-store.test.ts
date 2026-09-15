import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryVectorStore } from '../src/lib/vector-store';

test('MemoryVectorStore returns a relevant chunk for a matching query', async () => {
  const store = new MemoryVectorStore();

  await store.addChunk({
    id: 'case-study-1',
    content: 'SprintX helps SaaS teams with website redesign, lead generation, and conversion optimization for B2B growth objectives.',
    sourceId: 'source-1',
    sourcePath: 'Docs/case-study-1.txt',
    sourceType: 'document',
    sourceTitle: 'case-study-1.txt',
    chunkIndex: 0,
  });

  const results = await store.search('What does SprintX do for website redesign and lead generation?', 5);
  assert.ok(results.length > 0, 'expected at least one result');
  assert.ok(results[0].score > 0.25, 'expected a meaningful match');
});
