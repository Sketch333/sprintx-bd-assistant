import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

process.env.REQUIRE_AUTH = 'true';

test('API responses include request and rate-limit metadata', async () => {
  const app = require('../src/server').default as import('express').Express;
  const server = app.listen(0);

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/conversations`);

    assert.equal(response.status, 401);
    assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
    assert.equal(response.headers.get('x-ratelimit-limit'), '120');
    const remaining = Number(response.headers.get('x-ratelimit-remaining'));
    assert.ok(remaining >= 0 && remaining <= 119);
    assert.ok(response.headers.get('x-ratelimit-reset'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
  }
});
