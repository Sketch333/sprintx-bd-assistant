import { afterEach, expect, it, vi } from 'vitest';
import { resolveApiBaseUrl, syncGoogleDrive } from '../src/api';

afterEach(() => vi.unstubAllGlobals());
it('explains non-JSON Vercel timeouts instead of displaying a generic assistant error', async () => {
  vi.stubGlobal('fetch', async () => new Response('FUNCTION_INVOCATION_TIMEOUT', { status: 504, headers: { 'content-type': 'text/plain' } }));
  await expect(syncGoogleDrive('fixture-token')).rejects.toThrow(/timed out.*saved progress/i);
});


it('uses the current web origin when VITE_API_BASE_URL is absent', () => {
  expect(resolveApiBaseUrl(undefined, 'https://sprintx-bd-assistant.vercel.app/index.html'))
    .toBe('https://sprintx-bd-assistant.vercel.app');
});

it('does not invent an API origin for chrome-extension pages', () => {
  expect(resolveApiBaseUrl(undefined, 'chrome-extension://abc123/index.html')).toBe('');
});


it('loads safely when no browser window or location exists', () => {
  expect(resolveApiBaseUrl(undefined, undefined)).toBe('');
});
