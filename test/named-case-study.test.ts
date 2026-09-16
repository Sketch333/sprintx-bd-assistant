import assert from 'node:assert/strict';
import test from 'node:test';
import { PgVectorStore } from '../src/lib/vector-store';
import { conversationSearchQuery } from '../src/lib/conversation-context';

test('a standalone Dream question does not inherit a previous count question', () => {
  const question = 'What is tech stacked mentioned in Dream case study';
  assert.equal(conversationSearchQuery(question, [{ role: 'user', content: 'How many case studies are in Google Drive?' }, { role: 'assistant', content: 'The Fiverr webpage does not contain a count.' }]), question);
});

test('named Drive sources outside the vector shortlist are included and outrank webpages', async () => {
  const store = new PgVectorStore('postgres://fixture');
  let calls = 0;
  (store as any).pool = { query: async (_sql: string, _params: unknown[]) => {
    calls++;
    if (calls === 1) return { rows: [{ id: 'site', score: .95, content: 'Tech experts offer development services.', sourceId: 'site-fiverr', sourceTitle: 'www.fiverr.com', sourcePath: 'https://www.fiverr.com', sourceType: 'site', chunkIndex: 0 }] };
    return { rows: [{ id: 'dream', score: .1, content: 'Technology stack: React, Node.js, PostgreSQL.', sourceId: 'gdrive-dream', sourceTitle: 'Dream Case Study', sourcePath: 'Google Drive/Dream', sourceType: 'document', chunkIndex: 0 }] };
  } };
  const results = await store.search('What is tech stacked mentioned in Dream case study', 5);
  assert.equal(calls, 2);
  assert.equal(results[0]?.sourceId, 'gdrive-dream');
});
