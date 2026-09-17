// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const fixtures = vi.hoisted(() => ({ listeners: [] as Array<(_event: string, session: any) => void>, session: null as any, role: 'intern', sync: vi.fn(), list: vi.fn(), messages: vi.fn(), ask: vi.fn() }));
vi.mock('../src/supabase', () => ({ isSupabaseConfigured: true, signInWithGoogle: vi.fn(), supabase: { auth: {
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
  expect((screen.getByText('New') as HTMLButtonElement).disabled).toBe(true);
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
