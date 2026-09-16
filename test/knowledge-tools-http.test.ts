import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { config } from '../src/config';
import { z } from 'zod';

const responseSchema = z.object({
  ok: z.literal(true), question: z.string(), answer: z.string(), usedGemini: z.boolean(),
  sources: z.array(z.object({ title: z.string(), path: z.string(), snippet: z.string(), url: z.string().optional() })),
  userId: z.string().nullable(), conversationId: z.string().nullable(),
});

test('Ask HTTP dispatches inventory questions before search and preserves response shape and authentication', async () => {
  const oldAuth = config.requireAuth;
  const oldDatabase = config.databaseUrl;
  // Use a genuinely empty local memory KB, never production persistence.
  config.databaseUrl = '';
  config.requireAuth = false;
  const app = require('../src/server').default as import('express').Express;
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const post = (question: string) => fetch(`http://127.0.0.1:${port}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
    const response = await post('How many documents are in Google Drive?');
    assert.equal(response.status, 200);
    const payload = responseSchema.parse(await response.json());
    assert.equal(payload.ok, true);
    assert.match(payload.answer, /There are 0 document/);
    assert.deepEqual(payload.sources, []);
    assert.equal(payload.usedGemini, false);
    assert.equal(payload.userId, null);
    assert.equal(payload.conversationId, null);
    const list = await post('List case studies in Google Drive');
    const listed = responseSchema.parse(await list.json());
    assert.equal(list.status, 200);
    assert.match(listed.answer, /There are 0 case studies/);
    assert.deepEqual(listed.sources, []);
    config.requireAuth = true;
    const protectedResponse = await post('How many documents are in Google Drive?');
    assert.equal(protectedResponse.status, 401);
    assert.deepEqual(await protectedResponse.json(), { ok: false, error: 'Authentication required' });
  } finally {
    config.requireAuth = oldAuth;
    config.databaseUrl = oldDatabase;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
