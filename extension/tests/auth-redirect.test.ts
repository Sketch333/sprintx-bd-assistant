// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getWebAuthRedirectUrl } from '../src/supabase';

describe('web OAuth redirect URL', () => {
  it('adds a trailing slash to a Vercel origin', () => {
    expect(getWebAuthRedirectUrl('https://sprintx-bd-assistant.vercel.app'))
      .toBe('https://sprintx-bd-assistant.vercel.app/');
  });

  it('does not duplicate an existing trailing slash', () => {
    expect(getWebAuthRedirectUrl('https://preview.example.com/'))
      .toBe('https://preview.example.com/');
  });
});
