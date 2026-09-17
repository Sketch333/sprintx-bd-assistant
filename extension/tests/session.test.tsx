// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const fixtures = vi.hoisted(() => ({ listeners: [] as Array<(_event: string, session: any) => void>, session: null as any, role: 'intern', sync: vi.fn(), list: vi.fn(), messages: vi.fn(), ask: vi.fn() }));
vi.mock('../src/supabase', () => ({ signInWithGoogle: vi.fn(), supabase: { auth: {
  getSession: async () => ({ data: { session: fixtures.session } }),
  onAuthStateChange: (callback: any) => { fixtures.listeners.push(callback); return { data: { subscription: { unsubscribe: () => { fixtures.listeners = fixtures.listeners.filter((item) => item !== callback); } } } }; },
  signOut: async () => ({ error: null }),
} } }));
vi.mock('../src/api', () => ({ ApiError: class extends Error { constructor(message: string, public status: number) { super(message); } }, listConversations: fixtures.list, getConversationMessages: fixtures.messages, askAssistant: fixtures.ask,
  syncGoogleDrive: fixtures.sync, listUsers: async () => ({ users: [] }),
  getProfile: async () => ({ geminiKeyConfigured: false, user: { role: fixtures.role } }) }));
import { App } from '../src/App';
const conversation = (id: string) => ({ id, title: id, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), userId: 'alice' });
const session = (id: string, token = id) => ({ user: { id }, access_token: token });
async function changeSession(next: any) { fixtures.session = next; await act(async () => { for (const callback of [...fixtures.listeners]) callback('TOKEN_REFRESHED', next); }); }
beforeEach(() => {
  localStorage.clear();
  fixtures.session = session('alice'); fixtures.listeners = [];
  fixtures.list.mockReset().mockResolvedValue({ conversations: [conversation('Latest'), conversation('Older')] });
  fixtures.messages.mockReset().mockResolvedValue({ messages: [] });
  fixtures.ask.mockReset();
  fixtures.role = 'intern'; fixtures.sync.mockReset();
});
afterEach(cleanup);
test('changing accounts clears the unsaved raw key', async () => {
  render(<App />); await screen.findByText('Settings'); fireEvent.click(screen.getByText('Settings'));
  fireEvent.change(screen.getByLabelText('Replace key'), { target: { value: 'fixture-secret' } });
  await changeSession(session('bob'));
  await screen.findByText('Settings');
  if (!screen.queryByLabelText('Replace key')) fireEvent.click(screen.getByText('Settings'));
  expect((screen.getByLabelText('Replace key') as HTMLInputElement).value).toBe('');
});
test('leaving settings clears the unsaved masked key', async () => {
  render(<App />); fireEvent.click(await screen.findByText('Settings'));
  fireEvent.change(screen.getByLabelText('Replace key'), { target: { value: 'fixture-secret' } });
  fireEvent.click(screen.getByText('Settings')); fireEvent.click(screen.getByText('Settings'));
  expect((screen.getByLabelText('Replace key') as HTMLInputElement).value).toBe('');
});
test('secondary views are mutually exclusive', async () => {
  fixtures.role = 'admin'; render(<App />); fireEvent.click(await screen.findByText('Settings'));
  expect(screen.queryByRole('region', { name: 'Message composer' })).toBeNull();
  fireEvent.click(await screen.findByText('Admin'));
  expect(screen.queryByLabelText('Replace key')).toBeNull();
  fireEvent.click(await screen.findByText('Conversation: Latest'));
  expect(screen.queryByText('Admin controls')).toBeNull();
  expect(screen.getByText('Conversation history')).toBeTruthy();
});
test('a failed request preserves editable question input', async () => {
  fixtures.ask.mockRejectedValue(new Error('Synthetic request failure'));
  render(<App />); await screen.findByText('Conversation: Latest');
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Keep this question' } });
  fireEvent.click(screen.getByText('Ask SprintX')); await screen.findByRole('alert');
  expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).value).toBe('Keep this question');
  expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).disabled).toBe(false);
});
test('saved answers group duplicate evidence without renumbering citations and reject unsafe links', async () => {
  fixtures.messages.mockResolvedValue({ messages: [{ id: 'saved', conversationId: 'Latest', role: 'assistant', content: 'Evidence [1] [2] [3]', citations: [
    { title: 'Services', path: '/services', url: 'https://example.test/services', snippet: 'First excerpt' },
    { title: 'Unsafe', path: '/unsafe', url: 'javascript:alert(1)', snippet: 'Untrusted excerpt' },
    { title: 'Services', path: '/services', url: 'https://example.test/services', snippet: 'Second excerpt' },
  ], createdAt: new Date().toISOString() }] });
  render(<App />); await screen.findByText('Evidence [1] [2] [3]');
  expect(screen.getAllByText('Services')).toHaveLength(1);
  expect(screen.getByText('[1], [3]')).toBeTruthy();
  expect(screen.getByText('First excerpt')).toBeTruthy(); expect(screen.getByText('Second excerpt')).toBeTruthy();
  expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
});
test('raw answer HTML is text, never executable markup', async () => {
  fixtures.messages.mockResolvedValue({ messages: [{ id: 'saved', conversationId: 'Latest', role: 'assistant', content: '<img src=x onerror=alert(1)>', citations: [], createdAt: new Date().toISOString() }] });
  render(<App />); await screen.findByText('<img src=x onerror=alert(1)>'); expect(document.querySelector('img')).toBeNull();
});
test('Refine and Use in Draft stage bounded input without sending', async () => {
  fixtures.messages.mockResolvedValue({ messages: [{ id: 'saved', conversationId: 'Latest', role: 'assistant', content: 'Grounded response '.repeat(400), citations: [], createdAt: new Date().toISOString() }] });
  render(<App />); fireEvent.click(await screen.findByText('Refine'));
  expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).value.length).toBeLessThanOrEqual(2200);
  fireEvent.click(screen.getByText('Use in Draft'));
  expect((screen.getByLabelText('Additional context (optional)') as HTMLTextAreaElement).value.length).toBe(2000);
  expect(await screen.findByText(/2,000 characters/)).toBeTruthy(); expect(fixtures.ask).not.toHaveBeenCalled();
});
test('copy failure is reported without losing the answer', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
  fixtures.messages.mockResolvedValue({ messages: [{ id: 'saved', conversationId: 'Latest', role: 'assistant', content: 'Copy fixture answer', citations: [], createdAt: new Date().toISOString() }] });
  render(<App />); fireEvent.click(await screen.findByText('Copy'));
  expect(await screen.findByText(/Could not copy/)).toBeTruthy(); expect(screen.getByText('Copy fixture answer')).toBeTruthy();
});
test('explicit appearance preference survives settings exit and takes precedence over system', async () => {
  render(<App />); fireEvent.click(await screen.findByText('Settings'));
  fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
  expect(document.documentElement.dataset.theme).toBe('dark');
  fireEvent.click(screen.getByText('Settings')); fireEvent.click(screen.getByText('Settings'));
  expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark');
});
test('a successful request has one answer in the timeline and clears only the sent question', async () => {
  fixtures.ask.mockResolvedValue({ ok: true, question: 'Services?', answer: 'Single timeline answer', sources: [], usedGemini: false, userId: 'alice', conversationId: 'Latest' });
  render(<App />); await screen.findByText('Conversation: Latest');
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Services?' } }); fireEvent.click(screen.getByText('Ask SprintX'));
  await screen.findByText('Single timeline answer'); expect(screen.getAllByText('Single timeline answer')).toHaveLength(1);
  expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).value).toBe('');
  const latest = screen.getByRole('link', { name: 'Latest response' }) as HTMLAnchorElement;
  expect(latest.getAttribute('href')).toBe('#latest-message');
  expect(document.querySelector('#latest-message')?.textContent).toContain('Single timeline answer');
});
test('token refresh preserves the selected thread', async () => {
  render(<App />); await screen.findByText('Conversation: Latest');
  fireEvent.click(screen.getByText('Conversation: Latest')); fireEvent.click(screen.getByText('Older'));
  await screen.findByText('Conversation: Older'); await changeSession(session('alice', 'refreshed'));
  await waitFor(() => expect(fixtures.list).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Conversation: Older')).toBeTruthy();
});
test('thread switching is blocked while an answer is in flight', async () => {
  fixtures.ask.mockReturnValue(new Promise(() => {}));
  render(<App />); await screen.findByText('Conversation: Latest');
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'Services?' } });
  fireEvent.click(screen.getByText('Ask SprintX')); await waitFor(() => expect(fixtures.ask).toHaveBeenCalled());
  expect((screen.getByRole('button', { name: 'New conversation' }) as HTMLButtonElement).disabled).toBe(true);
});

test('startup restores the latest transcript', async () => {
  fixtures.messages.mockResolvedValue({ messages: [{ id: 'saved', conversationId: 'Latest', role: 'assistant', content: 'Saved fixture transcript', citations: [], createdAt: new Date().toISOString() }] });
  render(<App />); expect(await screen.findByText('Saved fixture transcript')).toBeTruthy();
});

test('admin Drive sync displays progress before the final batch completes', async () => {
  fixtures.role = 'admin';
  const batch = { discovered: 2, chunks: 1, sources: 2, removed: 0, failedFiles: [], skippedFiles: 0, newEmbeddings: 1, complete: false };
  let finish: (value: any) => void = () => {};
  fixtures.sync.mockResolvedValueOnce({ result: batch }).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<App />);
  fireEvent.click(await screen.findByText('Admin'));
  fireEvent.click(await screen.findByText('Sync Google Drive'));
  await screen.findByText(/Google Drive sync in progress: batch 1/);
  expect(screen.queryByText(/Google Drive sync complete:/)).toBeNull();
  await act(async () => { finish({ result: { ...batch, complete: true } }); });
  expect(await screen.findByText(/Google Drive sync complete:/)).toBeTruthy();
});
