"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/layout/page";
import { CoverEditor } from "@/components/covers/cover-editor";

export default function CoverEditorPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission permission="video:create">
      <CoverEditor key={id} id={Number(id)} />
    </RequirePermission>
  );
}
