import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

process.env.REQUIRE_AUTH = 'true';

test('knowledge search rejects unauthenticated requests', async () => {
  const app = require('../src/server').default as import('express').Express;
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/kb/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'SprintX' }) });
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('protected endpoints return 401 when authentication is missing', async () => {
  const app = require('../src/server').default as import('express').Express;
  const server = app.listen(0);

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/kb/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    test('draft endpoint rejects unauthenticated requests', async () => {
      const app = require('../src/server').default as import('express').Express;
      const server = app.listen(0);

      try {
        const { port } = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${port}/api/draft`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'cold-email',
            audience: 'A SaaS founder',
            objective: 'Book a call',
            tone: 'professional',
            length: 'short',
          }),
        });

        test('conversation history rejects unauthenticated requests', async () => {
          const app = require('../src/server').default as import('express').Express;
          const server = app.listen(0);

          try {
            const { port } = server.address() as AddressInfo;
            const response = await fetch(`http://127.0.0.1:${port}/api/conversations`);
            assert.equal(response.status, 401);
            assert.deepEqual(await response.json(), { ok: false, error: 'Authentication required' });
          } finally {
            await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
          }
        });

        test('conversation management rejects unauthenticated requests', async () => {
          const app = require('../src/server').default as import('express').Express;
          const server = app.listen(0);

          try {
            const { port } = server.address() as AddressInfo;
            const patchResponse = await fetch(`http://127.0.0.1:${port}/api/conversations/00000000-0000-0000-0000-000000000000`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ title: 'Renamed' }),
            });
            const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/conversations/00000000-0000-0000-0000-000000000000`, { method: 'DELETE' });
            assert.equal(patchResponse.status, 401);
            assert.equal(deleteResponse.status, 401);
          } finally {
            await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
          }
        });

        test('Gemini key profile endpoint rejects unauthenticated requests', async () => {
          const app = require('../src/server').default as import('express').Express;
          const server = app.listen(0);

          try {
            const { port } = server.address() as AddressInfo;
            const response = await fetch(`http://127.0.0.1:${port}/api/me`);
            assert.equal(response.status, 401);
            assert.deepEqual(await response.json(), { ok: false, error: 'Authentication required' });
          } finally {
            await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
          }
        });

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { ok: false, error: 'Authentication required' });
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
      }
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: 'Authentication required' });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
  }
});
