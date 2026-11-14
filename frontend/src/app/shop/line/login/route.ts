import { NextResponse, type NextRequest } from "next/server";

const slugPattern = /^[a-z0-9][a-z0-9-]{0,119}$/;

function apiOrigin() {
  const raw = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!raw) throw new Error("Missing BACKEND_URL for LINE Login");
  return new URL(raw).origin;
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  if (!slugPattern.test(slug)) return NextResponse.redirect(new URL("/shop", request.url));
  const fallback = new URL(`/shop/${slug}/account?login=unavailable`, request.url);

  try {
    const response = await fetch(
      `${apiOrigin()}/api/ecommerce/public/auth/line/start?slug=${encodeURIComponent(slug)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return NextResponse.redirect(fallback);
    const body = await response.json() as { data: { authorizationUrl: string; state: string } };
    const destination = new URL(body.data.authorizationUrl);
    if (destination.origin !== "https://access.line.me" || !body.data.state) return NextResponse.redirect(fallback);
    const next = NextResponse.redirect(destination);
    const cookieOptions = {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax" as const,
      path: "/api/social/oauth/line/callback",
      maxAge: 600,
    };
    next.cookies.set("pe_line_state", body.data.state, cookieOptions);
    next.cookies.set("pe_line_slug", slug, cookieOptions);
    return next;
  } catch {
    return NextResponse.redirect(fallback);
  }
}
