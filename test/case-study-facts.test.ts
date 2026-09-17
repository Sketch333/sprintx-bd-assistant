import assert from 'node:assert/strict';
import test from 'node:test';

import { KnowledgeChunk, SourceRecord } from '../src/types';
import { parseCachedFacts, sourceContentHash, validateFacts } from '../src/lib/case-study-facts';

const source: SourceRecord = {
  id: 'gdrive-dream',
  sourceType: 'document',
  sourceTitle: 'Dream case study.pdf',
  sourcePath: 'Google Drive/Case Studies/Dream case study.pdf',
  status: 'active',
  updatedAt: '2026-09-16T00:00:00.000Z',
};

const chunks: KnowledgeChunk[] = [{
  id: 'gdrive-dream-chunk-0',
  content: 'The Dream case study used React and Node.js to deliver the product.',
  sourceId: source.id,
  sourcePath: source.sourcePath,
  sourceType: source.sourceType,
  sourceTitle: source.sourceTitle,
  chunkIndex: 0,
}];

test('facts validation rejects evidence quotes or chunk IDs not present in indexed chunks', () => {
  const facts = validateFacts({
    version: '1',
    contentHash: sourceContentHash(chunks),
    status: 'current',
    caseStudyName: 'Dream',
    extractedAt: new Date().toISOString(),
    technologies: [
      { name: 'React', evidenceQuote: 'React and Node.js', chunkId: chunks[0].id },
      { name: 'Python', evidenceQuote: 'Python was used', chunkId: 'invented-chunk' },
    ],
  }, source, chunks);
  assert.deepEqual(facts.technologies, [{ name: 'React', evidenceQuote: 'React and Node.js', chunkId: chunks[0].id }]);
});

test('content hash changes when indexed chunk content changes', () => {
  assert.notEqual(sourceContentHash(chunks), sourceContentHash([{ ...chunks[0], content: 'Changed content.' }]));
});

test('cached facts require the current version and valid JSON shape', () => {
  const cached = JSON.stringify({
    version: '1',
    contentHash: 'hash',
    status: 'current',
    caseStudyName: 'Dream',
    technologies: [],
  });
  assert.equal(parseCachedFacts(cached)?.caseStudyName, 'Dream');
  assert.equal(parseCachedFacts('not json'), undefined);
  assert.equal(parseCachedFacts(JSON.stringify({ ...JSON.parse(cached), version: 'old' })), undefined);
});
