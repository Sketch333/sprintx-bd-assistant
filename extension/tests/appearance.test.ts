// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as appearance from '../src/appearance';
const auth = vi.hoisted(() => ({ imports: vi.fn(), getSession: vi.fn().mockResolvedValue({ data: { session: null } }), signIn: vi.fn() }));
vi.mock('../src/supabase', () => {
  auth.imports();
  return { signInWithGoogle: auth.signIn, supabase: { auth: { getSession: auth.getSession, onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } };
});

import { App } from '../src/App';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('malformed or extra appearance fields cannot enter the theme transport', () => {
  expect(appearance.validatePageAppearance({ theme: 'dark', accent: '#22aabb' })).toEqual({ theme: 'dark', accent: '#22aabb' });
  for (const value of [{ theme: 'dark', accent: 'url(secret)' }, { theme: 'auto', accent: null }, { theme: 'light', accent: '#fff', token: 'secret' }, null]) {
    expect(appearance.validatePageAppearance(value)).toBeNull();
  }
});

test('disabled adaptive accent ignores page colors and explicit theme overrides page theme', () => {
  expect(appearance.resolveAppearance({ theme: 'light', adaptiveAccent: false }, { theme: 'dark', accent: '#22aabb' }, true)).toEqual({ theme: 'light', accent: null });
  expect(appearance.resolveAppearance({ theme: 'auto', adaptiveAccent: true }, { theme: 'dark', accent: '#22aabb' }, false)).toEqual({ theme: 'dark', accent: '#22aabb' });
});

test('a framed surface is denied without nonce or successful private authorization', async () => {
  const send = vi.fn().mockResolvedValue({ authorized: false });
  expect(await appearance.authorizePresentation({ framed: true, href: 'chrome-extension://unit/index.html', send })).toBe(false);
  expect(send).not.toHaveBeenCalled();
  expect(await appearance.authorizePresentation({ framed: true, href: 'chrome-extension://unit/index.html?overlay=abc', send })).toBe(false);
  expect(send).toHaveBeenCalledWith({ type: 'sprintx:authorize', nonce: 'abc' });
  send.mockResolvedValue({ authorized: true });
  expect(await appearance.authorizePresentation({ framed: true, href: 'chrome-extension://unit/index.html?overlay=abc', send })).toBe(true);
});

test('unauthorized root neither imports authentication nor mounts account content', async () => {
  const gate = vi.spyOn(appearance, 'authorizePresentation').mockResolvedValue(false);
  auth.getSession.mockClear();
  render(React.createElement(App));
  expect(await screen.findByText('Open SprintX from the extension toolbar.')).toBeTruthy();
  expect(auth.imports).not.toHaveBeenCalled();
  expect(auth.getSession).not.toHaveBeenCalled();
  cleanup(); gate.mockRestore();
});

test('framed storage failure exposes a trusted extension window fallback', async () => {
  vi.spyOn(appearance, 'authorizePresentation').mockResolvedValue(true);
  vi.spyOn(appearance, 'isFramedPresentation').mockReturnValue(true);
  const trusted = vi.spyOn(appearance, 'requestTrustedWindow').mockResolvedValue(undefined);
  auth.getSession.mockRejectedValueOnce(new Error('Storage blocked'));
  render(React.createElement(App));
  fireEvent.click(await screen.findByRole('button', { name: 'Open trusted SprintX window' }));
  await waitFor(() => expect(trusted).toHaveBeenCalledTimes(1));
  expect(auth.signIn).not.toHaveBeenCalled();
});

test('authorized framed sign-in uses trusted window even if OAuth helper is available', async () => {
  vi.spyOn(appearance, 'authorizePresentation').mockResolvedValue(true);
  vi.spyOn(appearance, 'isFramedPresentation').mockReturnValue(true);
  const trusted = vi.spyOn(appearance, 'requestTrustedWindow').mockResolvedValue(undefined);
  render(React.createElement(App));
  fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
  await waitFor(() => expect(trusted).toHaveBeenCalledTimes(1));
  expect(auth.signIn).not.toHaveBeenCalled();
});
