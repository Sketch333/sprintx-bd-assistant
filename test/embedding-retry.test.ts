import assert from 'node:assert/strict';
import test from 'node:test';
import { generateGeminiEmbedding } from '../src/lib/gemini-models';

const { GoogleGenerativeAI } = require('@google/generative-ai');

test('embedding recovers from a transient provider failure in the same vector space', async () => {
  const original = GoogleGenerativeAI.prototype.getGenerativeModel;
  let attempts = 0;
  GoogleGenerativeAI.prototype.getGenerativeModel = () => ({
    embedContent: async (request: any, options: any) => {
      assert.equal(request.outputDimensionality, 1536);
      assert.ok(options?.timeout > 0 && options.timeout <= 20000);
      if (++attempts === 1) throw Object.assign(new Error('provider unavailable'), { status: 503 });
      return { embedding: { values: new Array(1536).fill(1) } };
    },
  });
  try {
    const result = await generateGeminiEmbedding('Dream tech stack', 'test-key');
    assert.equal(result.length, 1536);
    assert.equal(attempts, 2);
  } finally { GoogleGenerativeAI.prototype.getGenerativeModel = original; }
});

test('embedding failure logs only allowlisted quota diagnostics from SDK error details', async () => {
  const original = GoogleGenerativeAI.prototype.getGenerativeModel;
  const originalWarn = console.warn;
  const logs: string[] = [];
  let attempts = 0;
  console.warn = (value) => { logs.push(String(value)); };
  GoogleGenerativeAI.prototype.getGenerativeModel = () => ({ embedContent: async () => {
    if (++attempts > 1) return { embedding: { values: new Array(1536).fill(1) } };
    throw Object.assign(new Error('private-key provider URL and PDF content'), { status: 429, errorDetails: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [
        { quotaMetric: 'generativelanguage.googleapis.com/embed_content_free_tier_requests', quotaId: 'EmbedContentRequestsPerMinutePerProject-FreeTier', quotaValue: '100', description: 'private-key', quotaDimensions: { secret: 'private-key' } },
        { quotaMetric: 'private-key', quotaId: 'private-key', quotaValue: 'private-key' },
      ] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12.5s' },
      { '@type': 'unknown', message: 'private-key' },
    ] });
  } });
  try {
    await generateGeminiEmbedding('private PDF text', 'private-key');
    const event = JSON.parse(logs[0]);
    assert.deepEqual(event.quotaViolations, [{ quotaMetric: 'generativelanguage.googleapis.com/embed_content_free_tier_requests', quotaId: 'EmbedContentRequestsPerMinutePerProject-FreeTier', quotaValue: '100' }]);
    assert.equal(event.retryDelaySeconds, 12.5);
    assert.doesNotMatch(logs.join(''), /private-key|PDF|description|quotaDimensions/);
  } finally {
    GoogleGenerativeAI.prototype.getGenerativeModel = original;
    console.warn = originalWarn;
  }
});

test('permanent embedding rejection is not retried and never exposes provider secrets', async () => {
  const original = GoogleGenerativeAI.prototype.getGenerativeModel;
  let attempts = 0;
  GoogleGenerativeAI.prototype.getGenerativeModel = () => ({ embedContent: async () => {
    attempts++;
    throw Object.assign(new Error('secret-key in provider URL'), { status: 403 });
  } });
  try {
    await assert.rejects(generateGeminiEmbedding('Dream', 'test-key'), (error: any) => {
      assert.match(error.message, /HTTP 403/);
      assert.doesNotMatch(error.message, /secret-key|test-key/);
      return true;
    });
    assert.equal(attempts, 1);
  } finally { GoogleGenerativeAI.prototype.getGenerativeModel = original; }
});
