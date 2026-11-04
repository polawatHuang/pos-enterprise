import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { DramaListView } from "@/components/drama/drama-list";

export const metadata: Metadata = { title: "ละคร AI" };

export default function DramaPage() {
  return (
    <RequirePermission permission="video:create">
      <DramaListView />
    </RequirePermission>
  );
}
