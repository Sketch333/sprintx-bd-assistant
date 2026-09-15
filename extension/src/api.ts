import type { AskResponse, Conversation, ConversationMessage, DraftInput, DraftResponse, ProfileResponse, ProvisionedUser } from './types';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '');

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
  if (!apiBaseUrl) {
    throw new ApiError('The API URL is not configured for this extension build.', 0);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true) {
    throw new ApiError(readError(payload), response.status);
  }
  return payload as T;
}

export function askAssistant(question: string, accessToken: string, conversationId?: string, signal?: AbortSignal): Promise<AskResponse> {
  return postJson<AskResponse>('/api/ask', { question, limit: 5, conversationId }, accessToken, signal);
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

export function getProfile(accessToken: string): Promise<ProfileResponse> {
  return getJson('/api/me', accessToken);
}

export function listUsers(accessToken: string): Promise<{ ok: true; users: ProvisionedUser[] }> {
  return getJson('/api/users', accessToken);
}

export function createUser(accessToken: string, input: { email: string; name: string; role: 'admin' | 'intern' }): Promise<{ ok: true; user: ProvisionedUser }> {
  return postJson('/api/users', input, accessToken);
}

export function syncGoogleDrive(accessToken: string): Promise<{ ok: true; result: { discovered: number; chunks: number; sources: number; removed: number } }> {
  return postJson('/api/kb/drive-sync', {}, accessToken);
}

export function crawlWebsites(accessToken: string): Promise<{ ok: true; result: { crawled: number; chunks: number; sources: number } }> {
  return postJson('/api/kb/site-sync', {}, accessToken);
}

export function setGeminiKey(accessToken: string, apiKey: string): Promise<{ ok: true; geminiKeyConfigured: true }> {
  return postJson('/api/me/api-key', { apiKey }, accessToken);
}

export async function removeGeminiKey(accessToken: string): Promise<{ ok: true; geminiKeyConfigured: false }> {
  if (!apiBaseUrl) throw new ApiError('The API URL is not configured for this extension build.', 0);
  const response = await fetch(`${apiBaseUrl}/api/me/api-key`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true) {
    throw new ApiError(readError(payload), response.status);
  }
  return payload as { ok: true; geminiKeyConfigured: false };
}

async function getJson<T>(path: string, accessToken: string): Promise<T> {
  if (!apiBaseUrl) throw new ApiError('The API URL is not configured for this extension build.', 0);
  const response = await fetch(`${apiBaseUrl}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true) {
    throw new ApiError(readError(payload), response.status);
  }
  return payload as T;
}
