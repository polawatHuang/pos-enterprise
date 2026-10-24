"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { CustomerReceipt } from "@/components/pos/customer-receipt";

function Receipt() {
  const { token } = useParams<{ token: string }>();
  return <CustomerReceipt key={token} token={token} />;
}

export default function ReceiptPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center">
          <Loader2 className="size-7 animate-spin text-muted-foreground" />
        </main>
      }
    >
      <Receipt />
    </Suspense>
  );
}
