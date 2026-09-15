import type { AskResponse } from './types';

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

export async function askAssistant(question: string, accessToken: string, signal?: AbortSignal): Promise<AskResponse> {
  if (!apiBaseUrl) {
    throw new ApiError('The API URL is not configured for this extension build.', 0);
  }

  const response = await fetch(`${apiBaseUrl}/api/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ question, limit: 5 }),
    signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok || !payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true) {
    throw new ApiError(readError(payload), response.status);
  }
  return payload as AskResponse;
}
