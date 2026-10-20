"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, retryDelay, retryTransient } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  /** /auth/me failed for a reason other than being signed out (server down, network). */
  isError: boolean;
  retry: () => void;
  can: (permission: string) => boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const ME_QUERY_KEY = ["auth", "me"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.get<{ user: User }>("/auth/me").then((d) => d.user),
    staleTime: 5 * 60 * 1000,
    retry: retryTransient,
    retryDelay,
  });
  const retry = useCallback(() => void refetch(), [refetch]);

  const user = data ?? null;
  const can = useCallback((p: string) => Boolean(user?.permissions.includes(p)), [user]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      // Full reload: clears query cache and any state Activity keeps for hidden routes
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional full reload on logout
      window.location.assign("/login");
    }
  }, []);

  const value = useMemo(() => ({ user, isLoading, isError, retry, can, logout }), [user, isLoading, isError, retry, can, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
