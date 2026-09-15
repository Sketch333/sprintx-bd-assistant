import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryVectorStore } from '../src/lib/vector-store';

test('source reconciliation removes stale Drive sources and chunks only', async () => {
  const store = new MemoryVectorStore();
  const source = {
    id: 'gdrive-stale',
    sourceType: 'document' as const,
    sourceTitle: 'Stale',
    sourcePath: 'Google Drive/Stale',
    status: 'active' as const,
    updatedAt: new Date().toISOString(),
  };
  await store.addSource(source);
  await store.addChunk({
    id: 'gdrive-stale-chunk-0',
    content: 'stale content',
    sourceId: source.id,
    sourcePath: source.sourcePath,
    sourceType: source.sourceType,
    sourceTitle: source.sourceTitle,
    chunkIndex: 0,
  });
  await store.addSource({
    ...source,
    id: 'manual-source',
    sourceTitle: 'Manual',
    sourcePath: 'manual',
  });

  assert.equal(await store.removeSourcesExcept('gdrive-', new Set()), 1);
  assert.deepEqual(await store.getStats(), { chunkCount: 0, sourceCount: 1 });
});
