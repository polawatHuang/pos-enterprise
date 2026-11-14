import { NextResponse, type NextRequest } from "next/server";

const slugPattern = /^[a-z0-9][a-z0-9-]{0,119}$/;

function apiOrigin() {
  const raw = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!raw) throw new Error("Missing BACKEND_URL for LINE Login");
  return new URL(raw).origin;
}

function clearOAuthCookies(response: NextResponse, callbackPath: string) {
  response.cookies.set("pe_line_state", "", { path: callbackPath, maxAge: 0 });
  response.cookies.set("pe_line_slug", "", { path: callbackPath, maxAge: 0 });
}

function failure(request: NextRequest, slug: string, reason: string, callbackPath: string) {
  const destination = new URL(slugPattern.test(slug) ? `/shop/${slug}/account` : "/shop", request.url);
  if (slugPattern.test(slug)) destination.searchParams.set("login", "failed");
  destination.searchParams.set("reason", reason);
  const response = NextResponse.redirect(destination);
  clearOAuthCookies(response, callbackPath);
  return response;
}

export async function handleLineCallback(request: NextRequest, callbackPath: string) {
  const slug = request.cookies.get("pe_line_slug")?.value ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const providerError = request.nextUrl.searchParams.get("error");
  const expectedState = request.cookies.get("pe_line_state")?.value ?? "";

  if (providerError) return failure(request, slug, "cancelled", callbackPath);
  if (!slugPattern.test(slug) || !state || state !== expectedState || !code) {
    return failure(request, slug, "state", callbackPath);
  }

  const proxySecret = process.env.ECOMMERCE_AUTH_PROXY_SECRET;
  if (!proxySecret) {
    return failure(request, slug, "proxy", callbackPath);
  }

  try {
    const result = await fetch(`${apiOrigin()}/api/ecommerce/public/auth/line/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ecommerce-Auth-Proxy": proxySecret },
      body: JSON.stringify({ code, state }),
      cache: "no-store",
    });
    if (!result.ok) {
      const body = await result.json().catch(() => null) as { error?: { code?: string } } | null;
      const codeFromBackend = body?.error?.code;
      const reason = codeFromBackend === "FORBIDDEN"
        ? "proxy"
        : codeFromBackend === "LINE_LOGIN_FAILED"
          ? "line"
          : codeFromBackend === "LINE_LOGIN_UNAVAILABLE"
            ? "backend"
            : codeFromBackend === "LINE_LOGIN_NOT_CONFIGURED"
              ? "config"
              : codeFromBackend === "BAD_REQUEST"
                ? "state"
                : result.status === 404
                  ? "deploy"
                  : "backend";
      return failure(request, slug, reason, callbackPath);
    }

    const body = await result.json() as { data: { sessionToken: string; expiresIn: number; storeSlug: string } };
    if (!body.data.sessionToken || body.data.storeSlug !== slug) {
      return failure(request, slug, "session", callbackPath);
    }

    const response = NextResponse.redirect(new URL(`/shop/${slug}/account?login=success`, request.url));
    clearOAuthCookies(response, callbackPath);
    response.cookies.set("pe_ec", body.data.sessionToken, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: body.data.expiresIn,
      ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    });
    return response;
  } catch {
    return failure(request, slug, "backend", callbackPath);
  }
}
