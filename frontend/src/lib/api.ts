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

/** Network drop (status 0) or a 5xx: worth one more try; any 4xx answer is final. */
export function isTransient(err: unknown) {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status >= 500;
}

export const retryTransient = (count: number, err: unknown) => count < 2 && isTransient(err);

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query) {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** API URL for plain links and downloads (e.g. a CSV export), honouring NEXT_PUBLIC_API_URL. */
export const apiUrl = buildUrl;

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
  const text = res.status === 204 ? "" : await res.text().catch(() => "");
  let body: { error?: { code?: string; message?: string; details?: unknown } } | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = body?.error;
    // The frontend (Vercel) is newer than the backend (Plesk): say so instead of "Route ... not found"
    if (res.status === 404 && (err?.code === "ROUTE_NOT_FOUND" || /^Route \S+ \S+ not found$/.test(err?.message ?? ""))) {
      throw new ApiError(404, "ROUTE_NOT_FOUND", `เซิร์ฟเวอร์ backend ยังเป็นเวอร์ชันเก่า ไม่มีฟีเจอร์นี้ — อัปเดตโค้ด backend บน Plesk แล้วกด Restart App (${err?.message})`);
    }
    if (err?.message) throw new ApiError(res.status, err.code ?? "HTTP_ERROR", err.message, err.details);
    // The backend always answers errors as JSON, so anything else was produced in front of it
    // (hosting firewall such as ModSecurity/Imunify360, web server, or the Vercel proxy).
    const server = res.headers.get("server") ?? res.headers.get("x-vercel-error") ?? "unknown";
    const snippet = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    console.error(`[api] ${res.status} from upstream (server: ${server}) ${res.url}\n${snippet}`);
    throw new ApiError(
      res.status,
      "UPSTREAM",
      `เซิร์ฟเวอร์ปฏิเสธคำขอ (${res.status}) ก่อนถึงระบบ — server: ${server}${snippet ? ` · ${snippet.slice(0, 80)}` : ""}`,
      { server, snippet },
    );
  }
  return body as T;
}

// Endpoints where a 401 is the answer itself; every other call (including /auth/me after the
// 15-minute access token expired) refreshes the session once and retries.
const NO_REFRESH = new Set(["/auth/login", "/auth/refresh", "/auth/logout"]);

function networkError(): never {
  throw new ApiError(0, "NETWORK", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต");
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

  let res = await doFetch().catch(networkError);
  if (res.status === 401 && !skipRefresh && !NO_REFRESH.has(path)) {
    if (await refreshSession()) res = await doFetch().catch(networkError);
    else if (typeof window !== "undefined") {
      // Full reload clears all client state (Activity keeps hidden routes mounted otherwise)
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }
  return parse<T>(res);
}

/**
 * Fetch an API-served file (e.g. "/api/covers/1/assets/background") as a Blob with the auth cookie.
 * Works in rewrite and direct (NEXT_PUBLIC_API_URL) modes; the image stays same-origin for <canvas>.
 */
export async function apiBlob(apiPath: string): Promise<Blob> {
  const path = apiPath.replace(/^\/api(?=\/)/, "");
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, "HTTP_ERROR", `โหลดไฟล์ไม่สำเร็จ (${res.status})`);
  return res.blob();
}

/**
 * Download an API file (e.g. a CSV export) through the same base URL and auth cookie as every
 * other call, refreshing an expired session once. A plain <a href="/api/..."> would break in
 * direct mode (NEXT_PUBLIC_API_URL) and after the 15-minute access token expires.
 */
export async function apiDownload(path: string, query: Query | undefined, filename: string): Promise<void> {
  const doFetch = () => fetch(buildUrl(path, query), { credentials: "include", headers: { Accept: "text/csv, application/octet-stream, */*" } });
  let res = await doFetch().catch(networkError);
  if (res.status === 401 && (await refreshSession())) res = await doFetch().catch(networkError);
  if (!res.ok) await parse(res); // throws the backend's error message
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  get: <T>(path: string, query?: Query) => apiFetch<{ data: T }>(path, { query }).then((r) => r.data),
  post: <T>(path: string, json?: unknown) => apiFetch<{ data: T }>(path, { method: "POST", json }).then((r) => r.data),
  patch: <T>(path: string, json?: unknown) => apiFetch<{ data: T }>(path, { method: "PATCH", json }).then((r) => r.data),
  put: <T>(path: string, json?: unknown) => apiFetch<{ data: T }>(path, { method: "PUT", json }).then((r) => r.data),
  del: <T>(path: string) => apiFetch<{ data: T }>(path, { method: "DELETE" }).then((r) => r.data),
};
