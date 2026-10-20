import { cn } from "@/lib/utils";

/** Tiny inline bar chart (sales per day). Bars keep zero days visible as a baseline tick. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  const max = Math.max(...values, 1);
  const w = values.length * 5;
  return (
    <svg viewBox={`0 0 ${w} 20`} className={cn("h-5 w-[70px]", className)} role="img" aria-label={label ?? `ยอดขาย ${values.length} วัน`} preserveAspectRatio="none">
      {values.map((v, i) => {
        const h = v > 0 ? Math.max((v / max) * 18, 2) : 1;
        return <rect key={i} x={i * 5 + 0.5} y={20 - h} width={4} height={h} rx={1} className={v > 0 ? "fill-primary" : "fill-border"} />;
      })}
    </svg>
  );
}
