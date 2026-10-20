"use client";

import type { ReactNode } from "react";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { toast, Toaster } from "sonner";
import { isTransient, retryDelay, retryTransient } from "@/lib/api";

let browserQueryClient: QueryClient | undefined;

function makeQueryClient() {
  const client: QueryClient = new QueryClient({
    // Runs only after every retry failed: one toast for the whole page, not one per query.
    queryCache: new QueryCache({
      onError: (err) => {
        if (typeof window === "undefined" || !isTransient(err)) return;
        toast.error("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ", {
          id: "server-unreachable",
          description: "โหลดข้อมูลบางส่วนไม่ได้ เซิร์ฟเวอร์อาจกำลังเริ่มทำงาน",
          duration: 10_000,
          action: { label: "ลองใหม่", onClick: () => client.refetchQueries({ type: "active" }) },
        });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: retryTransient,
        retryDelay,
      },
    },
  });
  return client;
}

function getQueryClient() {
  // Keep server renders isolated and preserve the browser cache across renders.
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={getQueryClient()}>
        {children}
        <Toaster richColors position="top-right" closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
