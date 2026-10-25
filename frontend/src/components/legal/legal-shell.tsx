"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { LegalProvider } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Shown on every legal page; change it whenever the wording of a page changes. */
export const LEGAL_EFFECTIVE_DATE = "25 ตุลาคม 2569";

const PAGES = [
  { href: "/terms", label: "ข้อกำหนดการใช้บริการ" },
  { href: "/privacy", label: "นโยบายความเป็นส่วนตัว" },
  { href: "/data-deletion", label: "คำขอลบข้อมูล" },
];

export function useLegalProvider() {
  return useQuery({ queryKey: ["public", "legal"], queryFn: () => api.get<LegalProvider>("/public/legal"), staleTime: 10 * 60_000 });
}

/** The provider's name for running text: legal name, else shop name. */
export function ProviderName() {
  const q = useLegalProvider();
  return <>{q.data ? q.data.legalName || q.data.name : "ผู้ให้บริการ"}</>;
}

/** Provider / data controller block with contact details from the shop's business settings. */
export function ProviderCard() {
  const q = useLegalProvider();
  const p = q.data;
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
  return (
    <dl className="space-y-1.5 rounded-xl border border-border bg-card p-4 text-sm">
      {row("ชื่อ", p ? p.legalName || p.name : q.isError ? "—" : "…")}
      {p?.legalName && p.legalName !== p.name && row("ชื่อบริการ / ร้าน", p.name)}
      {row("เลขประจำตัวผู้เสียภาษี", p?.taxId)}
      {row("ที่อยู่", p?.address)}
      {row("อีเมล", p?.email && <a href={`mailto:${p.email}`} className="text-primary hover:underline">{p.email}</a>)}
      {row("โทรศัพท์", p?.phone)}
    </dl>
  );
}

export function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const q = useLegalProvider();
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">P</span>
            {q.data?.name ?? "POS Enterprise"}
          </span>
          <nav className="flex flex-wrap gap-1 text-sm sm:ml-auto" aria-label="เอกสาร">
            {PAGES.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                aria-current={pathname === p.href ? "page" : undefined}
                className={cn("rounded-md px-2 py-1 hover:bg-accent", pathname === p.href ? "font-medium text-primary" : "text-muted-foreground")}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">มีผลตั้งแต่วันที่ {LEGAL_EFFECTIVE_DATE}</p>
        <div className="legal mt-6 space-y-6 text-[15px] leading-7">{children}</div>
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {q.data ? q.data.legalName || q.data.name : "POS Enterprise"}
      </footer>
    </div>
  );
}

/** A numbered section: heading + body. */
export function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={`s${n}`} className="scroll-mt-4 space-y-2">
      <h2 className="text-lg font-semibold">
        {n}. {title}
      </h2>
      <div className="space-y-2 text-foreground/90 [&_li]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ul]:list-disc [&_ul]:space-y-1">{children}</div>
    </section>
  );
}
