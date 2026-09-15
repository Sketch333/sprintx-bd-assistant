import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryVectorStore } from '../src/lib/vector-store';
import { createLocalSourceId, createSiteSourceId } from '../src/lib/ingest';

test('local source IDs are stable for the same file path', () => {
  assert.equal(createLocalSourceId('./data/drive/Docs/brief.md'), createLocalSourceId('data/drive/Docs/brief.md'));
  assert.notEqual(createLocalSourceId('data/drive/Docs/brief.md'), createLocalSourceId('data/drive/Docs/other.md'));
});

test('website source IDs are stable for the same URL', () => {
  assert.equal(createSiteSourceId('https://sprintx.net/'), createSiteSourceId('https://sprintx.net/'));
  assert.notEqual(createSiteSourceId('https://sprintx.net/'), createSiteSourceId('https://sprintx.net/about'));
});

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

test('memory chunks are replaced when an existing chunk ID is re-ingested', async () => {
  const store = new MemoryVectorStore();
  const source = {
    id: 'source-local',
    sourceType: 'document' as const,
    sourceTitle: 'Local',
    sourcePath: 'Docs/local.md',
    status: 'active' as const,
    updatedAt: new Date().toISOString(),
  };
  await store.addSource(source);
  const chunk = {
    id: 'source-local-chunk-0',
    content: 'first version',
    sourceId: source.id,
    sourcePath: source.sourcePath,
    sourceType: source.sourceType,
    sourceTitle: source.sourceTitle,
    chunkIndex: 0,
  };
  await store.addChunk(chunk);
  await store.addChunk({ ...chunk, content: 'updated version' });

  assert.deepEqual(await store.getStats(), { chunkCount: 1, sourceCount: 1 });
  const results = await store.search('updated version', 1);
  assert.equal(results[0]?.content, 'updated version');
});
