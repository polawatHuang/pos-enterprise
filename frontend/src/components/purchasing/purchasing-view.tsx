"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PurchaseOrder, StockTransfer, Warehouse } from "@/lib/types";
import { Card, Skeleton, TabBar } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page";
import { OrderBoard } from "./order-board";
import { OrdersList } from "./orders-list";
import { SuppliersList } from "./suppliers";
import { ErrorNote } from "@/components/dashboard/widgets";
import { TransfersList } from "./transfers";

type Tab = "order" | "orders" | "transfers" | "suppliers";

export function PurchasingView() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab | null) ?? "order");
  const warehouses = useQuery({ queryKey: ["inventory", "warehouses"], queryFn: () => api.get<Warehouse[]>("/inventory/warehouses") });
  const open = useQuery({ queryKey: ["purchasing", "orders", "open"], queryFn: () => api.get<PurchaseOrder[]>("/purchasing/orders", { status: "open" }) });
  const transit = useQuery({ queryKey: ["purchasing", "transfers"], queryFn: () => api.get<StockTransfer[]>("/purchasing/transfers") });
  const inTransit = transit.data?.filter((t) => t.status === "in_transit").length ?? 0;

  return (
    <>
      <PageHeader title="สั่งซื้อ & รับของ" description="ระบบแนะนำยอดสั่งจากยอดขายจริงรายสินค้า (แบบ 7-Eleven) · ใบสั่งซื้อ · รับของด้วยการสแกน · โอนย้ายระหว่างสาขา" />
      <Card>
        <div className="px-4 pt-2">
          <TabBar
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "order", label: "สั่งของ" },
              { value: "orders", label: `ใบสั่งซื้อ${open.data?.length ? ` (${open.data.length} รอของ)` : ""}` },
              { value: "transfers", label: `โอนย้าย${inTransit ? ` (${inTransit} ระหว่างทาง)` : ""}` },
              { value: "suppliers", label: "ผู้ขาย" },
            ]}
          />
        </div>
        {tab === "order" &&
          (warehouses.data ? (
            <OrderBoard warehouses={warehouses.data} initialWarehouse={params.get("warehouseId") ?? ""} />
          ) : warehouses.isError ? (
            <ErrorNote onRetry={() => warehouses.refetch()} error={warehouses.error} />
          ) : (
            <Skeleton className="m-4 h-64" />
          ))}
        {tab === "orders" && <OrdersList />}
        {tab === "transfers" && <TransfersList />}
        {tab === "suppliers" && <SuppliersList />}
      </Card>
    </>
  );
}
