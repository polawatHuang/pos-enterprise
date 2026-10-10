import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/components/auth/auth-provider";
import { AppShell } from "@/components/layout/app-shell";

function ShellFallback() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Loader2 className="size-6 animate-spin text-primary" aria-label="กำลังโหลด" />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {/* AppShell reads usePathname(); with Cache Components, routes with request-time params
          (e.g. /products/[id]) need a Suspense boundary above it to prerender. */}
      <Suspense fallback={<ShellFallback />}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </AuthProvider>
  );
}
