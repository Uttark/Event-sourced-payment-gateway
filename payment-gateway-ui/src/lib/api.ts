import { ApiError } from '../types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:3000';

let currentToken: string | null = null;
let logoutHandler: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  currentToken = token;
}

export function setLogoutHandler(handler: () => void): void {
  logoutHandler = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, headers: extraHeaders } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
    ...extraHeaders,
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw {
      statusCode: 0,
      message: 'Unable to reach the server. Please check your connection.',
    } satisfies ApiError;
  }

  if (response.status === 401 && !endpoint.includes('/auth/login')) {
    logoutHandler?.();
    throw {
      statusCode: 401,
      message: 'Your session has expired. Please log in again.',
    } satisfies ApiError;
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({})) as Record<string, unknown>;

    const retryAfterHeader  = response.headers.get('Retry-After');
    const retryAfterSeconds = retryAfterHeader !== null
      ? parseInt(retryAfterHeader, 10)
      : undefined;

    throw {
      statusCode:  response.status,
      message:     buildErrorMessage(response.status, errorBody),

      ...(retryAfterSeconds !== undefined && !isNaN(retryAfterSeconds)
        ? { retryAfter: retryAfterSeconds }
        : {}),
    } satisfies ApiError;
  }

  return response.json() as Promise<T>;
}

function buildErrorMessage(
  status: number,
  body: Record<string, unknown>,
): string {
  if (status === 429) return 'Too many requests. Please wait before trying again.';
  if (status >= 500) return 'Something went wrong on our end. Your card was not charged.';

  const nested = (body?.error as Record<string, unknown>)?.message;
  const direct = body?.message;
  const msg = nested ?? direct;
  return typeof msg === 'string' ? msg : 'An unexpected error occurred.';
}