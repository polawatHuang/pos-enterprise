import type { NextConfig } from "next";

/**
 * BACKEND_URL — origin of the Node.js API on Plesk, e.g. https://api.example.com
 * The browser calls same-origin /api/* and Vercel forwards it to the backend, so auth
 * cookies are first-party on the frontend domain (no third-party cookie blocking).
 */
const backendUrl = normalizeBackendUrl(process.env.BACKEND_URL);

/** Tolerates values pasted with quotes/spaces or without a scheme; fails the build with a clear message otherwise. */
function normalizeBackendUrl(raw: string | undefined): string {
  let v = (raw ?? "").trim().replace(/^["']|["']$/g, "").trim();
  if (!v) return "http://localhost:4000";
  if (!/^https?:\/\//i.test(v)) v = `https://${v.replace(/^\/+/, "")}`;
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.host}`; // origin only: drop paths like /api and trailing slashes
  } catch {
    throw new Error(`BACKEND_URL is not a valid URL (got "${raw}"). Use e.g. https://api.example.com`);
  }
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Shown in the sidebar so "is the new version live yet?" is answerable at a glance
  env: { NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "local" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
