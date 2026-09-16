import { afterEach, expect, it, vi } from 'vitest';
import { syncGoogleDrive } from '../src/api';

afterEach(() => vi.unstubAllGlobals());
it('explains non-JSON Vercel timeouts instead of displaying a generic assistant error', async () => {
  vi.stubGlobal('fetch', async () => new Response('FUNCTION_INVOCATION_TIMEOUT', { status: 504, headers: { 'content-type': 'text/plain' } }));
  await expect(syncGoogleDrive('fixture-token')).rejects.toThrow(/timed out.*saved progress/i);
});
