/**
 * REST client for the backend.
 *
 * Default: same-origin "/api" — next.config.ts rewrites it to BACKEND_URL, so auth cookies are
 * first-party. Set NEXT_PUBLIC_API_URL (e.g. https://api.example.com) only when frontend and
 * backend share a parent domain and you want the browser to call the API directly (CORS mode).
 */
const API_BASE = `${(process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "")}/api`;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query) {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

// One refresh at a time even when many queries hit 401 simultaneously.
let refreshing: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function parse<T>(res: Response): Promise<T> {
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ApiError(res.status, err.code ?? "HTTP_ERROR", err.message ?? `Request failed (${res.status})`, err.details);
  }
  return body as T;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { query?: Query; json?: unknown; skipRefresh?: boolean } = {},
): Promise<T> {
  const { query, json, skipRefresh, ...rest } = init;
  const doFetch = () =>
    fetch(buildUrl(path, query), {
      ...rest,
      credentials: "include",
      headers: { Accept: "application/json", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });

  let res = await doFetch();
  if (res.status === 401 && !skipRefresh && !path.startsWith("/auth/")) {
    if (await refreshSession()) res = await doFetch();
    else if (typeof window !== "undefined") {
      // Full reload clears all client state (Activity keeps hidden routes mounted otherwise)
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string, query?: Query) => apiFetch<{ data: T }>(path, { query }).then((r) => r.data),
  post: <T>(path: string, json?: unknown) => apiFetch<{ data: T }>(path, { method: "POST", json }).then((r) => r.data),
  patch: <T>(path: string, json?: unknown) => apiFetch<{ data: T }>(path, { method: "PATCH", json }).then((r) => r.data),
  del: <T>(path: string) => apiFetch<{ data: T }>(path, { method: "DELETE" }).then((r) => r.data),
};
