import type { AskResponse, DraftInput, DraftResponse } from './types';

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

export function askAssistant(question: string, accessToken: string, signal?: AbortSignal): Promise<AskResponse> {
  return postJson<AskResponse>('/api/ask', { question, limit: 5 }, accessToken, signal);
}

export function draftMessage(input: DraftInput, accessToken: string, signal?: AbortSignal): Promise<DraftResponse> {
  return postJson<DraftResponse>('/api/draft', input, accessToken, signal);
}
