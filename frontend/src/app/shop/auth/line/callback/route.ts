import type { NextRequest } from "next/server";
import { handleLineCallback } from "@/lib/ecommerce-line-callback";

export async function GET(request: NextRequest) {
  return handleLineCallback(request, "/shop/auth/line/callback");
}
