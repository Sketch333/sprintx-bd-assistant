import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

test('oversized JSON payloads are rejected', async () => {
  const app = require('../src/server').default as import('express').Express;
  const server = app.listen(0);

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'x'.repeat(110_000) }),
    });

    assert.equal(response.status, 413);
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error !== 'string') {
      assert.fail('Expected a string error message');
    }
    assert.match(payload.error, /request entity too large/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
  }
});
