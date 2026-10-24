"use client";

import type { PosOrder, PosSettings } from "@/lib/types";
import { useTaxSettings } from "@/lib/tax";
import { cn } from "@/lib/utils";
import { QrSvg } from "./qr";
import { METHOD_LABEL, receiptDoc, type ReceiptBlock } from "./receipt-doc";

export { METHOD_LABEL };

/**
 * 80mm thermal-printer receipt. Printed via window.print() (the global print stylesheet hides
 * everything except `.print-receipt`) or sent to a USB printer from the same blocks.
 */
export function Receipt({ order, settings }: { order: PosOrder; settings?: PosSettings }) {
  const { tax } = useTaxSettings();
  return <ReceiptBlocks blocks={receiptDoc(order, settings, tax)} />;
}

export function ReceiptBlocks({ blocks }: { blocks: ReceiptBlock[] }) {
  return (
    <div className="print-receipt mx-auto w-full max-w-[300px] bg-white p-4 font-mono text-[12px] leading-snug text-black">
      {blocks.map((b, i) => {
        if (b.kind === "rule") return <div key={i} className="my-2 border-t border-dashed border-black" />;
        if (b.kind === "qr") return <QrBlock key={i} data={b.data} caption={b.caption} />;
        const cls = cn(b.bold && "font-bold", b.big && "text-[14px]", b.small && "text-[11px]", b.strike && "line-through");
        if (b.kind === "row")
          return (
            <p key={i} className={cn("flex justify-between gap-2", cls)}>
              <span>{b.left}</span>
              <span className="shrink-0">{b.right}</span>
            </p>
          );
        return (
          <p key={i} className={cn(cls, b.align === "center" && "text-center", b.boxed && "mt-1 border border-black", "whitespace-pre-wrap")}>
            {b.text}
          </p>
        );
      })}
    </div>
  );
}

function QrBlock({ data, caption }: { data: string; caption?: string }) {
  return (
    <div className="my-2 flex flex-col items-center gap-1">
      <QrSvg data={data} className="size-32" />
      {caption && <p className="text-center text-[11px]">{caption}</p>}
    </div>
  );
}
