import assert from 'node:assert/strict';
import test from 'node:test';
import { generateEmbedding } from '../src/lib/embeddings';
import { EMBEDDING_MODELS } from '../src/lib/gemini-models';

test('production never silently creates local vectors', async () => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = '1';
  try { await assert.rejects(generateEmbedding('fixture'), /embedding|Gemini/i); }
  finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
});

test('embedding requests use one compatible vector space', () => {
  assert.deepEqual(EMBEDDING_MODELS, ['gemini-embedding-001']);
});
