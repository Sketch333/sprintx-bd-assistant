const assert = require('node:assert/strict');
const test = require('node:test');

test('compiled server loads in a CommonJS runtime without requiring ESM dependencies', () => {
  assert.doesNotThrow(() => require('../dist/src/server.js'));
});

test('compiled ingestion module loads in a CommonJS runtime without requiring ESM dependencies', () => {
  assert.doesNotThrow(() => require('../dist/src/lib/ingest.js'));
});
