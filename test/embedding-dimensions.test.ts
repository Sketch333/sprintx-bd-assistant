import assert from 'node:assert/strict';
import test from 'node:test';

import { coerceEmbeddingDimensions } from '../src/lib/gemini-models';

test('Gemini embeddings are normalized to the pgvector schema dimension', () => {
  const providerEmbedding = new Array<number>(3072).fill(1);

  const result = coerceEmbeddingDimensions(providerEmbedding, 1536);

  assert.equal(result.length, 1536);
  const magnitude = Math.sqrt(result.reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(magnitude - 1) < 1e-12);
});
