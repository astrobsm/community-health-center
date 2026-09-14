import type { ProblemDetails } from '@chc/contracts';

/**
 * The HTTP client.
 *
 * Three things it does that a bare `fetch` wrapper would not:
 *
 *  - Refreshes the access token ONCE on a 401 and replays the request, with a
 *    shared in-flight promise so ten concurrent calls do not each rotate the
 *    refresh token and trigger reuse detection.
 *  - Surfaces Problem Details as a typed error carrying the traceId, so a user
 *    can quote a reference that appears in the server log.
 *  - Distinguishes "offline" from "failed", because the two mean entirely
 *    different things to someone standing in a facility.
 */

const API_ROOT = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get traceId(): string {
    return this.problem.traceId;
  }

  /** Field-level validation messages, ready to attach to inputs. */
  get fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const issue of this.problem.errors ?? []) {
      if (issue.field) errors[issue.field] = issue.message ?? issue.code;
    }
    return errors;
  }
}

/**
 * The request could not leave the device, or never reached the server.
 *
 * Kept distinct from ApiError so the UI can say "you are offline — this is
 * saved on the device and will sync" rather than "something went wrong".
 */
export class OfflineError extends Error {
  constructor() {
    super('No connection. Your work is saved on this device and will sync when you are back online.');
    this.name = 'OfflineError';
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

type TokenListener = (tokens: Tokens | null) => void;

let tokens: Tokens | null = null;
let deviceIdentifier: string | undefined;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<TokenListener>();

export function setTokens(next: Tokens | null): void {
  tokens = next;
  for (const listener of listeners) listener(next);
}

export function getAccessToken(): string | null {
  return tokens?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  return tokens?.refreshToken ?? null;
}

export function onTokensChanged(listener: TokenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setDeviceId(id: string): void {
  deviceIdentifier = id;
}

/**
 * Refresh the access token.
 *
 * Deduplicated: concurrent 401s share one refresh. Without this, several
 * parallel requests would each present the same refresh token, and the second
 * would look exactly like theft — the server would revoke the whole family and
 * sign the user out (doc 07 §2).
 */
async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = tokens?.refreshToken;
  if (!refreshToken) return false;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_ROOT}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken, deviceId: deviceIdentifier }),
      });

      if (!response.ok) {
        setTokens(null);
        return false;
      }

      const body = (await response.json()) as { accessToken: string; refreshToken: string };
      setTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken });
      return true;
    } catch {
      // A network failure is not an invalid session: keep the tokens so the
      // user is not signed out merely for walking out of signal.
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Mandatory for offline-originated writes; makes a retry provably the same record. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Internal: prevents an infinite refresh loop. */
  retrying?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (tokens?.accessToken) headers['Authorization'] = `Bearer ${tokens.accessToken}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (deviceIdentifier) headers['X-Device-Id'] = deviceIdentifier;

  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new OfflineError();
  }

  if (response.status === 401 && !options.retrying && tokens?.refreshToken) {
    if (await refreshTokens()) {
      return request<T>(path, { ...options, retrying: true });
    }
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const problem = (parsed ?? {
      type: 'about:blank',
      title: response.statusText,
      status: response.status,
      traceId: response.headers.get('x-trace-id') ?? 'unknown',
    }) as ProblemDetails;

    throw new ApiError(response.status, problem);
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
