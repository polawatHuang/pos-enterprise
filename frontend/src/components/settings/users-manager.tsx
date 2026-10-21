"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, MoreHorizontal, Pencil, Plus, Search, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { api, apiFetch, ApiError } from "@/lib/api";
import type { Branch, Role, UserRow } from "@/lib/types";
import { cn, formatRelativeTime, initials } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, FieldError, Input, Label, NativeSelect, Skeleton } from "@/components/ui/primitives";
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { PageHeader } from "@/components/layout/page";
import { ROLE_LABELS } from "@/components/layout/user-menu";
import { passwordRule } from "./change-password-form";

const USERS_KEY = ["users"] as const;

export function UsersManager() {
  const { can, user: me } = useAuth();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const qc = useQueryClient();

  const users = useQuery({
    queryKey: [...USERS_KEY, q],
    queryFn: () => apiFetch<{ data: UserRow[]; meta: { total: number } }>("/users", { query: { q, pageSize: 100 } }),
  });
  const roles = useQuery({ queryKey: ["org", "roles"], queryFn: () => api.get<Role[]>("/org/roles"), staleTime: 10 * 60_000 });
  const branches = useQuery({ queryKey: ["org", "branches"], queryFn: () => api.get<Branch[]>("/org/branches"), staleTime: 10 * 60_000 });

  const toggleStatus = useMutation({
    mutationFn: (u: UserRow) => api.patch<UserRow>(`/users/${u.id}`, { status: u.status === "active" ? "disabled" : "active" }),
    onSuccess: (u) => {
      toast.success(u.status === "active" ? `เปิดใช้งาน ${u.fullName} แล้ว` : `ระงับ ${u.fullName} แล้ว`);
      void qc.invalidateQueries({ queryKey: USERS_KEY });
    },
    onError: (e) => toast.error(e.message),
  });

  const writable = can("users:write");

  return (
    <>
      <PageHeader
        title="ผู้ใช้และสิทธิ์"
        description="กำหนดบทบาทให้พนักงาน สิทธิ์จะมีผลภายใน 15 นาที (หรือทันทีเมื่อเข้าสู่ระบบใหม่)"
        actions={
          writable && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> เพิ่มผู้ใช้
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อหรืออีเมล" className="h-9 pl-9" aria-label="ค้นหาผู้ใช้" />
          </div>
          <p className="text-sm text-muted-foreground sm:ml-auto">{users.data ? `${users.data.meta.total} บัญชี` : " "}</p>
        </div>

        {users.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-cards w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">ผู้ใช้</th>
                  <th className="px-4 py-3 font-medium">บทบาท</th>
                  <th className="px-4 py-3 font-medium">สาขา</th>
                  <th className="px-4 py-3 font-medium">สถานะ</th>
                  <th className="px-4 py-3 font-medium">เข้าใช้ล่าสุด</th>
                  <th className="w-12 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.data?.data.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                          {initials(u.fullName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {u.fullName} {u.id === me?.id && <span className="text-xs text-muted-foreground">(คุณ)</span>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td data-label="บทบาท" className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge key={r} tone={r === "owner" || r === "admin" ? "primary" : "neutral"}>
                            {ROLE_LABELS[r] ?? r}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td data-label="สาขา" className="px-4 py-3 text-muted-foreground">{u.branchName ?? "ทุกสาขา"}</td>
                    <td data-label="สถานะ" className="px-4 py-3">
                      <Badge tone={u.status === "active" ? "success" : "danger"}>{u.status === "active" ? "ใช้งาน" : "ระงับ"}</Badge>
                    </td>
                    <td data-label="เข้าใช้ล่าสุด" className="px-4 py-3 text-muted-foreground">{u.lastLoginAt ? formatRelativeTime(u.lastLoginAt) : "ยังไม่เคย"}</td>
                    <td className="px-4 py-3">
                      {writable && u.id !== me?.id && (
                        <DropdownMenu>
                          <DropdownMenuTrigger className="grid size-8 place-items-center rounded-md hover:bg-accent" aria-label={`จัดการ ${u.fullName}`}>
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(u)}>
                              <Pencil /> แก้ไขบทบาท / รีเซ็ตรหัสผ่าน
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => toggleStatus.mutate(u)}>
                              {u.status === "active" ? <UserX /> : <UserCheck />}
                              {u.status === "active" ? "ระงับการใช้งาน" : "เปิดใช้งาน"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="text-[15px] font-semibold">บทบาทในระบบ</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {roles.data?.map((r) => (
            <div key={r.code} className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{r.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">{r.permissions.length} สิทธิ์</p>
            </div>
          ))}
        </div>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && (
          <UserDialog
            key={editing === "new" ? "new" : editing.id}
            user={editing === "new" ? null : editing}
            roles={roles.data ?? []}
            branches={branches.data ?? []}
            canGrantOwner={!!me?.roles.includes("owner")}
            onDone={() => {
              setEditing(null);
              void qc.invalidateQueries({ queryKey: USERS_KEY });
            }}
          />
        )}
      </Dialog>
    </>
  );
}

const formSchema = z.object({
  fullName: z.string().trim().min(1, "กรุณากรอกชื่อ"),
  email: z.email("อีเมลไม่ถูกต้อง"),
  role: z.string().min(1, "เลือกบทบาท"),
  branchId: z.string(),
  password: z.union([z.literal(""), passwordRule]),
});
type FormValues = z.infer<typeof formSchema>;

function UserDialog({
  user,
  roles,
  branches,
  canGrantOwner,
  onDone,
}: {
  user: UserRow | null;
  roles: Role[];
  branches: Branch[];
  canGrantOwner: boolean;
  onDone: () => void;
}) {
  const isNew = !user;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(
      isNew ? formSchema.refine((v) => v.password !== "", { path: ["password"], message: "กำหนดรหัสผ่านเริ่มต้น" }) : formSchema,
    ),
    defaultValues: {
      fullName: user?.fullName ?? "",
      email: user?.email ?? "",
      role: user?.roles[0] ?? "",
      branchId: user?.branchId ? String(user.branchId) : "",
      password: "",
    },
  });

  const onSubmit = async (v: FormValues) => {
    const branchId = v.branchId ? Number(v.branchId) : null;
    try {
      if (isNew) {
        await api.post("/users", { email: v.email, fullName: v.fullName, password: v.password, roles: [v.role], branchId });
        toast.success("เพิ่มผู้ใช้แล้ว ผู้ใช้จะต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก");
      } else {
        await api.patch(`/users/${user.id}`, {
          fullName: v.fullName,
          roles: [v.role],
          branchId,
          ...(v.password ? { password: v.password } : {}),
        });
        toast.success("บันทึกการเปลี่ยนแปลงแล้ว");
      }
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError("email", { message: err.message });
      else toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    }
  };

  return (
    <DialogContent title={isNew ? "เพิ่มผู้ใช้" : `แก้ไข ${user.fullName}`} description={isNew ? "ผู้ใช้ใหม่จะถูกบังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก" : undefined}>
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="fullName">ชื่อ-นามสกุล</Label>
          <Input id="fullName" aria-invalid={!!errors.fullName} {...register("fullName")} />
          <FieldError message={errors.fullName?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">อีเมล (ใช้เข้าสู่ระบบ)</Label>
          <Input id="email" type="email" disabled={!isNew} aria-invalid={!!errors.email} {...register("email")} />
          <FieldError message={errors.email?.message} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="role">บทบาท</Label>
            <NativeSelect id="role" className="h-10 w-full" {...register("role")}>
              <option value="">เลือกบทบาท</option>
              {roles
                .filter((r) => r.code !== "owner" || canGrantOwner)
                .map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
            </NativeSelect>
            <FieldError message={errors.role?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branchId">สาขา</Label>
            <NativeSelect id="branchId" className="h-10 w-full" {...register("branchId")}>
              <option value="">ทุกสาขา</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{isNew ? "รหัสผ่านเริ่มต้น" : "รีเซ็ตรหัสผ่าน (เว้นว่างถ้าไม่เปลี่ยน)"}</Label>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
          <FieldError message={errors.password?.message} />
        </div>
        <div className={cn("flex justify-end gap-2 pt-2")}>
          <Button type="button" variant="outline" onClick={onDone}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            {isNew ? "เพิ่มผู้ใช้" : "บันทึก"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
