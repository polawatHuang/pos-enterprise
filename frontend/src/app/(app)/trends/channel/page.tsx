import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { ChannelView } from "@/components/trends/channel-view";

export const metadata: Metadata = { title: "โปรไฟล์ช่อง" };

export default function ChannelPage() {
  return (
    <RequirePermission permission="scraping:read">
      <ChannelView />
    </RequirePermission>
  );
}
