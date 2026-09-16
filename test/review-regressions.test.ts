import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryVectorStore } from '../src/lib/vector-store';
import { ingestDriveFolder } from '../src/lib/ingest';

test('a missing local root fails without deleting knowledge', async () => {
  const store = new MemoryVectorStore();
  await store.addSource({ id: 'source-existing', sourceType: 'document', sourceTitle: 'Existing', sourcePath: 'Docs/existing.md', status: 'active', updatedAt: new Date().toISOString() });
  await assert.rejects(ingestDriveFolder('missing-review-fixture-root', store), /directory/i);
  assert.equal((await store.getStats()).sourceCount, 1);
});
