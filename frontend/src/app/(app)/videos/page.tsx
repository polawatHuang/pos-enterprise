import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { VideosView } from "@/components/videos/videos-view";

export const metadata: Metadata = { title: "AI Video" };

export default function VideosPage() {
  return (
    <RequirePermission permission="video:create">
      <VideosView />
    </RequirePermission>
  );
}
