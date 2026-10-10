"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { VideoDetailView } from "@/components/videos/video-detail";

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission="video:create">
      <VideoDetailView key={id} id={Number(id)} />
    </RequirePermission>
  );
}
