import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryVectorStore } from '../src/lib/vector-store';
import { ingestDriveFolder } from '../src/lib/ingest';
import { boundConversationContext, conversationSearchQuery } from '../src/lib/conversation-context';

test('a missing local root fails without deleting knowledge', async () => {
  const store = new MemoryVectorStore();
  await store.addSource({ id: 'source-existing', sourceType: 'document', sourceTitle: 'Existing', sourcePath: 'Docs/existing.md', status: 'active', updatedAt: new Date().toISOString() });
  await assert.rejects(ingestDriveFolder('missing-review-fixture-root', store), /directory/i);
  assert.equal((await store.getStats()).sourceCount, 1);
});

test('local reconciliation preserves other roots and legacy sources', async () => {
  const store = new MemoryVectorStore();
  const source = { sourceType: 'document' as const, sourceTitle: 'Fixture', sourcePath: 'fixture', status: 'active' as const, updatedAt: new Date().toISOString() };
  await store.addSource({ ...source, id: 'source-one', metadata: { ingestionRoot: 'one' } });
  await store.addSource({ ...source, id: 'source-two', metadata: { ingestionRoot: 'two' } });
  await store.addSource({ ...source, id: 'source-legacy' });
  assert.equal(await store.removeSourcesExcept('source-', new Set(), 'one'), 1);
  assert.equal((await store.getStats()).sourceCount, 2);
});

test('generation context is bounded and retrieval resolves previous turns', () => {
  const context = boundConversationContext(Array.from({ length: 100 }, () => ({ role: 'assistant' as const, content: 'x'.repeat(10000) })));
  assert.ok(context.length <= 12);
  assert.ok(context.reduce((size, message) => size + message.content.length, 0) <= 12000);
  assert.match(conversationSearchQuery('Make that shorter', [{ role: 'user', content: 'growth marketing' }]), /growth marketing/);
});
