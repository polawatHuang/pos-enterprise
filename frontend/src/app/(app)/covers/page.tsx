import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { CoversView } from "@/components/covers/covers-view";

export const metadata: Metadata = { title: "AI ปกคลิป" };

export default function CoversPage() {
  return (
    <RequirePermission permission="video:create">
      <CoversView />
    </RequirePermission>
  );
}
