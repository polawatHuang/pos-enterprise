import { NextResponse, type NextRequest } from "next/server";

/**
 * Route guard. Runs before rendering pages (not /api — that is rewritten to the backend).
 * "pe_session" is a non-secret hint cookie set by the backend alongside the httpOnly tokens;
 * real authorization always happens in the backend on every API call.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has("pe_session");
  // /login and the customer's own receipt page (opened from the QR on a receipt) need no session
  const isAuthPage = pathname === "/login" || pathname.startsWith("/r/");

  if (!hasSession && !isAuthPage) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  // Note: no redirect away from /login when the hint exists — the hint may be stale, and the
  // login page must stay reachable so a user with an expired session can sign in again.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|wasm)$).*)"],
};
