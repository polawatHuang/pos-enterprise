"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { AccDocument, DocType, Paged } from "@/lib/types";
import { formatMoney, formatThaiDate, todayStr } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge, Card, Input, NativeSelect, Pagination, Skeleton } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlays";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page";
import { CREATABLE_DOC_TYPES, DOC_STATUS, DOC_TYPE_LABEL } from "./labels";

export function DocumentsView() {
  const { can } = useAuth();
  const router = useRouter();
  const [docType, setDocType] = useState<DocType | "">("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const query = { docType, status, q, page, pageSize: 25 };
  const list = useQuery({
    queryKey: ["accounting", "documents", query],
    queryFn: () => apiFetch<Paged<AccDocument>>("/accounting/documents", { query }),
    placeholderData: keepPreviousData,
  });
  const today = todayStr();

  return (
    <>
      <PageHeader
        title="เอกสาร"
        description="ใบเสนอราคา ใบแจ้งหนี้ ใบกำกับภาษี ใบเสร็จ ใบลดหนี้ และหนังสือรับรองหัก ณ ที่จ่าย — เลขที่เรียงต่อเนื่องอัตโนมัติ"
        actions={
          can("accounting:write") && (
            <DropdownMenu>
              <DropdownMenuTrigger className={buttonVariants()}>
                <Plus /> สร้างเอกสาร
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {CREATABLE_DOC_TYPES.map((t) => (
                  <DropdownMenuItem key={t} onSelect={() => router.push(`/accounting/documents/new?type=${t}`)}>
                    {DOC_TYPE_LABEL[t]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="ค้นหาเลขที่ / ชื่อคู่ค้า"
              className="h-9 pl-9"
              aria-label="ค้นหาเอกสาร"
            />
          </div>
          <NativeSelect aria-label="ประเภทเอกสาร" value={docType} onChange={(e) => setDocType(e.target.value as DocType | "")}>
            <option value="">ทุกประเภท</option>
            {[...CREATABLE_DOC_TYPES, "wht_certificate" as const].map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="สถานะ" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">ทุกสถานะ</option>
            <option value="unpaid">ค้างรับชำระ</option>
            <option value="draft">ฉบับร่าง</option>
            <option value="issued">ออกแล้ว</option>
            <option value="paid">ชำระแล้ว</option>
            <option value="void">ยกเลิก</option>
          </NativeSelect>
        </div>
        {list.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">เลขที่</th>
                  <th className="px-4 py-3 font-medium">ประเภท</th>
                  <th className="px-4 py-3 font-medium">คู่ค้า</th>
                  <th className="px-4 py-3 font-medium">วันที่</th>
                  <th className="px-4 py-3 text-right font-medium">ยอดรวม</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-14 text-center text-muted-foreground">
                      ยังไม่มีเอกสาร
                    </td>
                  </tr>
                )}
                {list.data?.data.map((d) => {
                  const overdue = d.status === "issued" && d.dueDate && d.dueDate < today;
                  return (
                    <tr key={d.id} onClick={() => router.push(`/accounting/documents/${d.id}`)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">
                        <Link href={`/accounting/documents/${d.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-primary">
                          {d.isDraft ? "ฉบับร่าง" : d.docNo}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{DOC_TYPE_LABEL[d.docType]}</td>
                      <td className="max-w-56 truncate px-4 py-3">{d.partyName ?? "–"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {formatThaiDate(d.docDate)}
                        {d.dueDate && d.status === "issued" && (
                          <span className={`block text-xs ${overdue ? "text-danger" : ""}`}>ครบกำหนด {formatThaiDate(d.dueDate)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {formatMoney(d.docType === "wht_certificate" ? d.whtAmount : d.total)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={overdue ? "danger" : DOC_STATUS[d.status].tone}>{overdue ? "เกินกำหนด" : DOC_STATUS[d.status].label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination {...list.data.meta} onChange={setPage} />}
      </Card>
    </>
  );
}
