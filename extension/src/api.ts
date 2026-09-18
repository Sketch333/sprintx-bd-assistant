import type { AskResponse, Conversation, ConversationMessage, DraftInput, DraftResponse, ProfileResponse, ProvisionedUser } from './types';
import type { AskMode } from './types';
import type { DriveSyncResult } from './drive-sync';

export function resolveApiBaseUrl(configured = import.meta.env.VITE_API_BASE_URL, href = window.location.href): string {
  const explicit = typeof configured === 'string' ? configured.trim() : '';
  if (explicit) return explicit.replace(/\/$/, '');
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

const apiBaseUrl = resolveApiBaseUrl();

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

function readError(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const value = payload.error;
    return typeof value === 'string' ? value : 'The assistant request was rejected.';
  }
  return 'The assistant request failed. Please try again.';
}

async function postJson<T>(path: string, body: unknown, accessToken: string, signal?: AbortSignal): Promise<T> {
  if (!apiBaseUrl) throw new ApiError('The API URL is not configured for this extension build.', 0);
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
    signal,
  });
  return parseResponse<T>(response);
}

export function askAssistant(question: string, accessToken: string, conversationId?: string, signal?: AbortSignal, mode: AskMode = 'knowledge'): Promise<AskResponse> {
  return postJson<AskResponse>('/api/ask', { question, limit: 5, conversationId, mode }, accessToken, signal);
}

export function draftMessage(input: DraftInput, accessToken: string, conversationId?: string, signal?: AbortSignal): Promise<DraftResponse> {
  return postJson<DraftResponse>('/api/draft', { ...input, conversationId }, accessToken, signal);
}

export function listConversations(accessToken: string): Promise<{ ok: true; conversations: Conversation[] }> {
  return getJson('/api/conversations', accessToken);
}

export function createConversation(accessToken: string, title?: string): Promise<{ ok: true; conversation: Conversation }> {
  return postJson('/api/conversations', { title }, accessToken);
}

export function getConversationMessages(accessToken: string, conversationId: string): Promise<{ ok: true; messages: ConversationMessage[] }> {
  return getJson(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, accessToken);
}

export function renameConversation(accessToken: string, conversationId: string, title: string): Promise<{ ok: true; conversation: Conversation }> {
  return patchJson(`/api/conversations/${encodeURIComponent(conversationId)}`, { title }, accessToken);
}

export function deleteConversation(accessToken: string, conversationId: string): Promise<{ ok: true }> {
  return deleteJson(`/api/conversations/${encodeURIComponent(conversationId)}`, accessToken);
}

export function getProfile(accessToken: string): Promise<ProfileResponse> {
  return getJson('/api/me', accessToken);
}

export function listUsers(accessToken: string): Promise<{ ok: true; users: ProvisionedUser[] }> {
  return getJson('/api/users', accessToken);
}

export function createUser(accessToken: string, input: { email: string; name: string; role: 'admin' | 'intern' }): Promise<{ ok: true; user: ProvisionedUser }> {
  return postJson('/api/users', input, accessToken);
}

export function syncGoogleDrive(accessToken: string, signal?: AbortSignal): Promise<{ ok: true; result: DriveSyncResult }> {
  const timeout = AbortSignal.timeout(210000);
  return postJson('/api/kb/drive-sync', {}, accessToken, signal ? AbortSignal.any([signal, timeout]) : timeout);
}

export function syncCaseStudyFacts(accessToken: string, signal?: AbortSignal): Promise<{ ok: true; result: { processed: number; refreshed: number; unchanged: number; failed: number; failures: string[] } }> {
  return postJson('/api/kb/facts-sync', { limit: 10 }, accessToken, signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000));
}

export function crawlWebsites(accessToken: string): Promise<{ ok: true; result: { crawled: number; chunks: number; sources: number } }> {
  return postJson('/api/kb/site-sync', {}, accessToken);
}

export function setGeminiKey(accessToken: string, apiKey: string): Promise<{ ok: true; geminiKeyConfigured: true }> {
  return postJson('/api/me/api-key', { apiKey }, accessToken);
}

export function removeGeminiKey(accessToken: string): Promise<{ ok: true; geminiKeyConfigured: false }> {
  return deleteJson('/api/me/api-key', accessToken);
}

async function getJson<T>(path: string, accessToken: string): Promise<T> {
  if (!apiBaseUrl) throw new ApiError('The API URL is not configured for this extension build.', 0);
  return parseResponse<T>(await fetch(`${apiBaseUrl}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } }));
}

async function patchJson<T>(path: string, body: unknown, accessToken: string): Promise<T> {
  if (!apiBaseUrl) throw new ApiError('The API URL is not configured for this extension build.', 0);
  return parseResponse<T>(await fetch(`${apiBaseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  }));
}

async function deleteJson<T>(path: string, accessToken: string): Promise<T> {
  if (!apiBaseUrl) throw new ApiError('The API URL is not configured for this extension build.', 0);
  return parseResponse<T>(await fetch(`${apiBaseUrl}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  }));
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true) {
    const message = !payload && response.status === 504
      ? 'The server request timed out. Drive sync saved progress can be resumed by restarting sync.'
      : !payload && response.status >= 500 ? `The API returned HTTP ${response.status}. Inspect the latest Vercel request logs; saved Drive progress is preserved.`
      : readError(payload);
    throw new ApiError(message, response.status);
  }
  return payload as T;
}
