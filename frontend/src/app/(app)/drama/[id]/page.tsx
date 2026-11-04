"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { DramaStudio } from "@/components/drama/drama-studio";

export default function DramaStudioPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission="video:create">
      <DramaStudio key={id} id={Number(id)} />
    </RequirePermission>
  );
}
