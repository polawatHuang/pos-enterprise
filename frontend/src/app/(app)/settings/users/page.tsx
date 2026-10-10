import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { UsersManager } from "@/components/settings/users-manager";

export const metadata: Metadata = { title: "ผู้ใช้และสิทธิ์" };

export default function UsersPage() {
  return (
    <RequirePermission permission="users:read">
      <UsersManager />
    </RequirePermission>
  );
}
