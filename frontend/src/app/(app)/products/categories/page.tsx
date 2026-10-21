import type { Metadata } from "next";
import { RequirePermission } from "@/components/layout/page";
import { CategoriesManager } from "@/components/products/categories-manager";

export const metadata: Metadata = { title: "หมวดหมู่สินค้า" };

export default function CategoriesPage() {
  return (
    <RequirePermission permission="products:read">
      <CategoriesManager />
    </RequirePermission>
  );
}
