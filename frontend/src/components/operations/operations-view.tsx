"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Clock3,
  History,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Siren,
  Store,
  type LucideIcon,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import type { Branch, OperationsTask, OperationsTaskEvent } from "@/lib/types";
import { cn, formatDateTime, formatThaiDate, formatRelativeTime, formatNumber } from "@/lib/utils";

type TaskType = OperationsTask["type"];
type TaskStatus = OperationsTask["status"];
type Shift = OperationsTask["shift"];
type Priority = OperationsTask["priority"];
type Filter = "open" | "attention" | "done" | "all";

const TASKS_KEY = ["operations", "tasks"] as const;
const shiftLabel: Record<Shift, string> = { morning: "ช่วงเช้า", day: "ช่วงกลางวัน", evening: "ช่วงเย็น", any: "ทุกช่วง" };
const statusLabel: Record<TaskStatus, string> = {
  pending: "รอดำเนินการ",
  in_progress: "กำลังทำ",
  done: "เสร็จแล้ว",
  skipped: "ข้ามแล้ว",
  follow_up: "ส่งต่อ/ติดตาม",
};
const typeLabel: Record<TaskType, string> = { checklist: "Checklist", incident: "เหตุการณ์", handoff: "ส่งเวร", receiving: "รับสินค้า" };
const priorityLabel: Record<Priority, string> = { normal: "ปกติ", high: "สำคัญ", urgent: "เร่งด่วน" };

export function OperationsView() {
  const { user, can } = useAuth();
  const queryClient = useQueryClient();
  const isManager = can("operations:manage");
  const [branchId, setBranchId] = useState<number | undefined>(user?.branchId ?? undefined);
  const [filter, setFilter] = useState<Filter>("open");
  const [showCreate, setShowCreate] = useState(false);

  const branches = useQuery({
    queryKey: ["org", "branches"],
    queryFn: () => api.get<Branch[]>("/org/branches"),
    enabled: isManager || !user?.branchId,
    staleTime: 10 * 60_000,
  });
  const selectedBranchId = branchId ?? branches.data?.find((branch) => branch.isActive)?.id;
  const tasks = useQuery({
    queryKey: [...TASKS_KEY, selectedBranchId],
    queryFn: () => api.get<OperationsTask[]>("/operations/tasks", { branchId: selectedBranchId }),
    enabled: selectedBranchId != null,
    refetchInterval: 60_000,
  });
  const team = useQuery({
    queryKey: ["operations", "team", selectedBranchId],
    queryFn: () => api.get<{ id: number; fullName: string }[]>("/operations/team", { branchId: selectedBranchId }),
    enabled: isManager && selectedBranchId != null,
  });
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    await queryClient.invalidateQueries({ queryKey: ["operations", "events"] });
  };
  const createTask = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<OperationsTask>("/operations/tasks", body),
    onSuccess: async () => {
      setShowCreate(false);
      await invalidate();
    },
  });
  const updateTask = useMutation({
    mutationFn: ({ id, changes }: { id: number; changes: Record<string, unknown> }) =>
      api.patch<OperationsTask>(`/operations/tasks/${id}?branchId=${selectedBranchId}`, changes),
    onSuccess: invalidate,
  });

  const items = tasks.data ?? [];
  const openCount = items.filter((task) => ["pending", "in_progress"].includes(task.status)).length;
  const attentionCount = items.filter((task) => task.status === "follow_up" || task.overdue || task.priority === "urgent").length;
  const doneCount = items.filter((task) => task.status === "done").length;
  const filtered = items.filter((task) => {
    if (filter === "open") return ["pending", "in_progress"].includes(task.status);
    if (filter === "attention") return task.status === "follow_up" || task.overdue || task.priority === "urgent";
    if (filter === "done") return task.status === "done" || task.status === "skipped";
    return true;
  });
  const grouped = filtered.reduce<Record<string, OperationsTask[]>>((result, task) => {
    (result[task.date] ??= []).push(task);
    return result;
  }, {});
  const days = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <PageHeader
        title="งานร้านวันนี้"
        description="รวม checklist งานเร่งด่วน เหตุการณ์ และงานค้างที่ต้องส่งต่อ"
        actions={
          <>
            {isManager && (
              <Button onClick={() => setShowCreate((value) => !value)}>
                <Plus /> เพิ่มงาน
              </Button>
            )}
            {isManager && branches.data && (
              <NativeSelect
                aria-label="เลือกสาขา"
                value={selectedBranchId ?? ""}
                onChange={(event) => setBranchId(Number(event.target.value) || undefined)}
              >
                <option value="">เลือกสาขา</option>
                {branches.data.filter((branch) => branch.isActive).map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </NativeSelect>
            )}
          </>
        }
      />

      <section aria-label="สรุปงานวันนี้" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard icon={ClipboardCheck} label="งานที่เปิดอยู่" value={openCount} tone="primary" />
        <SummaryCard icon={AlertTriangle} label="ต้องติดตาม" value={attentionCount} tone="warning" />
        <SummaryCard icon={CheckCircle2} label="เสร็จแล้ว" value={doneCount} tone="success" />
        <SummaryCard icon={History} label="ค้างจากวันก่อน" value={items.filter((task) => task.overdue).length} tone="muted" />
      </section>

      {showCreate && isManager && (
        <CreateTaskForm
          branchId={selectedBranchId}
          team={team.data ?? []}
          busy={createTask.isPending}
          error={createTask.error}
          onCancel={() => setShowCreate(false)}
          onSubmit={(body) => createTask.mutate(body)}
        />
      )}

      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="กรองรายการงาน">
          {([
            ["open", `งานที่ต้องทำ (${openCount})`],
            ["attention", `ต้องติดตาม (${attentionCount})`],
            ["done", `ปิดงาน (${items.filter((task) => task.status === "done" || task.status === "skipped").length})`],
            ["all", "ทั้งหมด"],
          ] as [Filter, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", filter === key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
        {selectedBranchId && branches.data && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Store className="size-3.5" />{branches.data.find((branch) => branch.id === selectedBranchId)?.name}</p>}
      </div>

      {branches.isError ? (
        <ErrorPanel message="โหลดรายชื่อสาขาไม่สำเร็จ" onRetry={() => void branches.refetch()} />
      ) : !selectedBranchId ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{branches.isPending ? "กำลังโหลดสาขา..." : "เลือกสาขาเพื่อดูงานวันนี้"}</CardContent></Card>
      ) : tasks.isPending ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin text-primary" />กำลังโหลดงานของสาขา...</CardContent></Card>
      ) : tasks.isError ? (
        <ErrorPanel message={tasks.error.message || "โหลดรายการงานไม่สำเร็จ"} onRetry={() => void tasks.refetch()} />
      ) : filtered.length === 0 ? (
        <Card className="border-success/20 bg-gradient-to-br from-success-soft/50 to-card">
          <CardContent className="py-12 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-success-soft text-success"><CheckCircle2 className="size-6" /></span>
            <h2 className="mt-4 font-semibold">{filter === "open" ? "ไม่มีงานค้างในรายการนี้" : "ยังไม่มีรายการในหมวดนี้"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">งานที่สร้างหรือ checklist ประจำวันจะแสดงที่นี่</p>
            {filter === "open" && <div className="mt-4 flex flex-wrap justify-center gap-3 text-xs"><Link className="text-primary underline" href="/inventory/expiry">ดูวันหมดอายุ</Link><Link className="text-primary underline" href="/purchasing">ดูรับสินค้า</Link><Link className="text-primary underline" href="/pos">เปิด POS</Link></div>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {days.map(([date, dailyTasks]) => (
            <section key={date} aria-label={`งานวันที่ ${formatThaiDate(date)}`}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{date === todayStr() ? "วันนี้" : `ค้างจาก ${formatThaiDate(date)}`}</h2>
                <span className="text-xs text-muted-foreground">{dailyTasks.length} งาน</span>
              </div>
              <div className="space-y-3">
                {dailyTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    branchId={selectedBranchId}
                    team={team.data ?? []}
                    canManage={isManager}
                    busy={updateTask.isPending && updateTask.variables?.id === task.id}
                    error={updateTask.isError && updateTask.variables?.id === task.id ? updateTask.error : null}
                    onUpdate={(changes) => updateTask.mutate({ id: task.id, changes })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-6 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
        <BellRing className="mr-1 inline size-3.5" />
        Checklist นี้ช่วยติดตามงาน ไม่ได้บันทึกเวลาเข้างานหรือตารางกะ และไม่เชื่อมออเดอร์ Delivery อัตโนมัติ
      </p>
    </>
  );
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function SummaryCard({ icon: Icon, label, value, tone }: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: "primary" | "warning" | "success" | "muted";
}) {
  const style = {
    primary: "bg-primary/10 text-primary",
    warning: "bg-warning-soft text-warning",
    success: "bg-success-soft text-success",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-center gap-3 p-3 sm:p-4">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", style)}><Icon className="size-4.5" /></span>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{formatNumber(value)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateTaskForm({ branchId, team, busy, error, onCancel, onSubmit }: {
  branchId?: number;
  team: { id: number; fullName: string }[];
  busy: boolean;
  error: Error | null;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("checklist");
  const [shift, setShift] = useState<Shift>("any");
  const [priority, setPriority] = useState<Priority>("normal");
  const [assignedTo, setAssignedTo] = useState("");
  const [description, setDescription] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId || !title.trim()) return;
    onSubmit({
      branchId,
      title: title.trim(),
      type,
      shift,
      priority,
      ...(assignedTo ? { assignedTo: Number(assignedTo) } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    });
  }

  return (
    <Card className="mb-5 border-primary/20">
      <CardHeader>
        <div><CardTitle>เพิ่มงานให้สาขา</CardTitle><CardDescription>สร้าง checklist, บันทึกเหตุการณ์ หรือฝากงานให้กะถัดไป</CardDescription></div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium sm:col-span-2">ชื่องาน
            <Input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="เช่น ตู้แช่มีปัญหา แจ้งช่างตรวจสอบ" />
          </label>
          <label className="space-y-1.5 text-xs font-medium">ประเภท
            <NativeSelect className="h-10 w-full" value={type} onChange={(event) => setType(event.target.value as TaskType)}>
              <option value="checklist">Checklist</option><option value="incident">บันทึกเหตุการณ์</option><option value="handoff">ส่งต่องาน</option><option value="receiving">ติดตามการรับสินค้า</option>
            </NativeSelect>
          </label>
          <label className="space-y-1.5 text-xs font-medium">ช่วงเวลา
            <NativeSelect className="h-10 w-full" value={shift} onChange={(event) => setShift(event.target.value as Shift)}>
              <option value="any">ไม่ระบุช่วง</option><option value="morning">ช่วงเช้า</option><option value="day">ช่วงกลางวัน</option><option value="evening">ช่วงเย็น/กะถัดไป</option>
            </NativeSelect>
          </label>
          <label className="space-y-1.5 text-xs font-medium">ความสำคัญ
            <NativeSelect className="h-10 w-full" value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
              <option value="normal">ปกติ</option><option value="high">สำคัญ</option><option value="urgent">เร่งด่วน</option>
            </NativeSelect>
          </label>
          <label className="space-y-1.5 text-xs font-medium">ผู้รับผิดชอบ
            <NativeSelect className="h-10 w-full" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
              <option value="">ยังไม่ระบุ</option>{team.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
            </NativeSelect>
          </label>
          <label className="space-y-1.5 text-xs font-medium sm:col-span-2">รายละเอียด/บรีฟส่งต่อ
            <Textarea maxLength={2000} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="ข้อมูลที่ผู้รับงานควรรู้" />
          </label>
          {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error.message}</p>}
          <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onCancel}>ยกเลิก</Button>
            <Button type="submit" disabled={!title.trim() || !branchId || busy}>{busy && <Loader2 className="animate-spin" />}สร้างงาน</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function TaskCard({ task, branchId, team, canManage, busy, error, onUpdate }: {
  task: OperationsTask;
  branchId: number;
  team: { id: number; fullName: string }[];
  canManage: boolean;
  busy: boolean;
  error: Error | null;
  onUpdate: (changes: Record<string, unknown>) => void;
}) {
  const [showHandoff, setShowHandoff] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery({
    queryKey: ["operations", "events", branchId, task.id],
    queryFn: () => api.get<OperationsTaskEvent[]>(`/operations/tasks/${task.id}/events`, { branchId }),
    enabled: showHistory,
  });
  const finished = task.status === "done" || task.status === "skipped";

  function sendHandoff(status: "follow_up" | "skipped") {
    if (!reason.trim()) return;
    onUpdate({ status, reason: reason.trim(), ...(note.trim() ? { note: note.trim() } : {}) });
    setShowHandoff(false);
    setReason("");
    setNote("");
  }

  return (
    <Card className={cn("min-w-0 transition-colors", task.priority === "urgent" && "border-danger/40", task.overdue && "border-warning/50", task.status === "done" && "border-success/20 bg-success-soft/20")}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl", task.status === "done" ? "bg-success-soft text-success" : task.status === "follow_up" ? "bg-warning-soft text-warning" : "bg-primary/10 text-primary")}>
            {task.status === "done" ? <Check className="size-5" /> : task.type === "incident" ? <Siren className="size-5" /> : task.type === "handoff" ? <Send className="size-5" /> : task.status === "in_progress" ? <Loader2 className="size-5 animate-spin" /> : <Circle className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className={cn("min-w-0 break-words text-sm font-semibold", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</h3>
              {task.overdue && <Badge tone="warning">ค้างจากวันก่อน</Badge>}
              {task.priority !== "normal" && <Badge tone={task.priority === "urgent" ? "danger" : "warning"}>{priorityLabel[task.priority]}</Badge>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{typeLabel[task.type]}</span><span>{shiftLabel[task.shift]}</span><span>{statusLabel[task.status]}</span>
              {task.assigneeName ? <span className="inline-flex items-center gap-1"><UserRound className="size-3" />{task.assigneeName}</span> : <span>ยังไม่มอบหมาย</span>}
              {task.dueAt && <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{formatDateTime(task.dueAt)}</span>}
            </div>
            {task.description && <p className="mt-2 break-words text-sm text-muted-foreground">{task.description}</p>}
            {task.statusReason && <p className="mt-2 rounded-lg bg-warning-soft/70 px-3 py-2 text-xs text-foreground">หมายเหตุ: {task.statusReason}</p>}
            {task.handoffNote && <p className="mt-2 rounded-lg bg-primary-soft/60 px-3 py-2 text-xs text-foreground">ส่งต่อ: {task.handoffNote}</p>}
          </div>
        </div>

        {canManage && !finished && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground sm:flex-none">
              <UserRound className="size-4 shrink-0" />
              <NativeSelect
                aria-label={`มอบหมายงาน ${task.title}`}
                className="h-9 min-w-0 flex-1 sm:w-48"
                value={task.assignedTo ?? ""}
                disabled={busy}
                onChange={(event) => onUpdate({ assignedTo: event.target.value ? Number(event.target.value) : null })}
              >
                <option value="">ไม่ระบุผู้รับผิดชอบ</option>{team.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
              </NativeSelect>
            </label>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {!finished && task.status === "pending" && <Button size="sm" variant="outline" disabled={busy} onClick={() => onUpdate({ status: "in_progress" })}>เริ่มทำ</Button>}
          {!finished && <Button size="sm" disabled={busy} onClick={() => onUpdate({ status: "done" })}><Check className="size-4" />เสร็จแล้ว</Button>}
          {!finished && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowHandoff((value) => !value)}><Send className="size-4" />ส่งต่อ/ข้าม</Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowHistory((value) => !value)}><History className="size-4" />ประวัติ</Button>
          {task.type === "receiving" && <Button size="sm" variant="outline" asChild><Link href="/purchasing?tab=orders">เปิดงานรับสินค้า <ArrowRight className="size-4" /></Link></Button>}
          {task.link && <Button size="sm" variant="outline" asChild><Link href={task.link}>เปิดหน้าระบบ <ArrowRight className="size-4" /></Link></Button>}
        </div>

        {showHandoff && !finished && (
          <div className="mt-3 grid min-w-0 gap-2 rounded-xl bg-muted/60 p-3">
            <label className="space-y-1 text-xs font-medium">เหตุผลที่ต้องส่งต่อหรือข้าม <span className="text-danger">*</span>
              <Input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="เช่น รอช่าง/รอสินค้าจากคลัง" />
            </label>
            <label className="space-y-1 text-xs font-medium">รายละเอียดสำหรับกะถัดไป
              <Textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ระบุขั้นตอนต่อไปหรือข้อมูลที่ควรรู้" />
            </label>
            {error && <p role="alert" className="text-sm text-danger">{error.message}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button size="sm" disabled={!reason.trim() || busy} onClick={() => sendHandoff("follow_up")}><Send className="size-4" />ส่งต่อให้กะถัดไป</Button>
              <Button size="sm" variant="outline" disabled={!reason.trim() || busy} onClick={() => sendHandoff("skipped")}>ข้ามงานพร้อมเหตุผล</Button>
            </div>
          </div>
        )}

        {showHistory && (
          <div className="mt-3 rounded-xl bg-muted/50 p-3">
            {history.isPending ? <p className="text-xs text-muted-foreground">กำลังโหลดประวัติ...</p> : history.isError ? <p className="text-xs text-danger">{history.error.message}</p> : !history.data?.length ? <p className="text-xs text-muted-foreground">ยังไม่มีประวัติ</p> : (
              <ul className="space-y-2">
                {history.data.map((event) => (
                  <li key={event.id} className="flex min-w-0 gap-2 text-xs">
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0 break-words"><b>{event.userName}</b> · {event.action === "created" ? "สร้างงาน" : event.action === "assigned" ? "เปลี่ยนผู้รับผิดชอบ" : event.action === "status_changed" ? `${event.fromStatus ?? ""} → ${event.toStatus ?? ""}` : "อัปเดตงาน"}{event.note ? ` · ${event.note}` : ""}<span className="ml-1 text-muted-foreground">{formatRelativeTime(event.createdAt)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-danger/25">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p role="alert" className="text-sm text-danger">{message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}><RotateCcw className="size-4" />ลองใหม่</Button>
      </CardContent>
    </Card>
  );
}
