import { NextResponse, type NextRequest } from "next/server";

function apiOrigin() {
  const raw = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!raw) throw new Error("Missing BACKEND_URL for customer logout");
  return new URL(raw).origin;
}

export async function POST(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  const token = request.cookies.get("pe_ec")?.value;
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) {
    return NextResponse.json({ error: "Invalid shop" }, { status: 400 });
  }
  try {
    if (token) {
      const result = await fetch(
        `${apiOrigin()}/api/ecommerce/public/stores/${encodeURIComponent(slug)}/customer/logout`,
        { method: "POST", headers: { Cookie: `pe_ec=${encodeURIComponent(token)}` }, cache: "no-store" },
      );
      if (!result.ok) return NextResponse.json({ error: "Logout failed" }, { status: 502 });
    }
    const response = NextResponse.json({ data: { ok: true } });
    response.cookies.set("pe_ec", "", {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Logout failed" }, { status: 502 });
  }
}
