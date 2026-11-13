export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Calls the API through the web app's /api proxy. Every error comes back in the API's
 * `{ error: { code, message, details } }` shape and is thrown as an ApiError.
 */
export async function api<T>(
  path: string,
  options: { method?: Method; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  });

  // A 401 on a page that needs a session means it expired: go log in. On the login and
  // invite forms a 401 just means "wrong password", which the form itself shows.
  const isCredentialCheck = path === '/auth/login' || path.startsWith('/invites/');
  if (response.status === 401 && !isCredentialCheck && typeof window !== 'undefined') {
    const next = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?next=${next}`);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error.code ?? 'NETWORK',
      body?.error.message ?? 'The server could not be reached. Please try again.',
      body?.error.details,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

/**
 * Turns a VALIDATION_ERROR's `[{ path, message }]` details into `{ field: message }`, so a
 * form can show each message next to its input. A `data.` prefix (form answers) is removed.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const item of error.details as { path?: unknown; message?: unknown }[]) {
    if (typeof item.path !== 'string' || typeof item.message !== 'string') continue;
    const key = item.path.replace(/^data\./, '');
    out[key] ??= item.message;
  }
  return out;
}
