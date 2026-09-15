import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

process.env.REQUIRE_AUTH = 'true';

test('admin endpoints reject unauthenticated requests', async () => {
  const app = require('../src/server').default as import('express').Express;
  const server = app.listen(0);

  try {
    const { port } = server.address() as AddressInfo;
    const endpoints = [
      '/api/users',
      '/api/kb/ingest',
      '/api/kb/drive-sync',
    ];

    for (const endpoint of endpoints) {
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
        method: endpoint === '/api/users' ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: endpoint === '/api/users' ? undefined : '{}',
      });

      assert.equal(response.status, 401, endpoint);
      assert.deepEqual(await response.json(), { ok: false, error: 'Authentication required' });
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
  }
});
