import { useState } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import { useMe } from "../../app/contexts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditTable } from "../../shared/components/AuditTable";
import {
  Badge,
  EmptyRow,
  ErrorBox,
  Field,
  Loading,
  PageBody,
  PageHeader,
  Section,
  SelectField,
  Stacked,
  Tag,
  fmtShort,
  useAction,
  useAsk,
} from "../../shared/components/ui";
import { useApi, useQuery } from "../../shared/lib/api";
import {
  GLOBAL_ROLE_LABEL,
  type AdminUser,
  type AuditRow,
  type GlobalRole,
  type WorkspaceRequest,
} from "../../shared/lib/types";

const TABS = [
  { value: "users", label: "Người dùng" },
  { value: "requests", label: "Yêu cầu tạo workspace" },
  { value: "workspaces", label: "Workspace" },
  { value: "audit", label: "Nhật ký" },
] as const;

export function AdminPage() {
  const { me } = useMe();
  const [tab, setTab] = useState<string>("users");
  if (!me.user.isAdmin)
    return (
      <PageBody>
        <ErrorBox error="Chỉ admin mới vào được trang này." />
      </PageBody>
    );
  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-0">
      <PageHeader
        title="Quản trị"
        sub="Người dùng, yêu cầu tạo workspace, workspace và nhật ký."
      />
      <div className="overflow-x-auto border-b px-4 md:px-8">
        <TabsList variant="line" className="h-10 gap-4 p-0">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="flex-none px-0 text-[13px] after:bg-primary group-data-[orientation=horizontal]/tabs:after:bottom-0"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <PageBody>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="requests">
          <RequestsTab />
        </TabsContent>
        <TabsContent value="workspaces">
          <WorkspacesTab />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
      </PageBody>
    </Tabs>
  );
}

const ROLE_OPTIONS = (["member", "workspace_manager", "admin"] as GlobalRole[]).map(
  (r) => ({ value: r, label: GLOBAL_ROLE_LABEL[r] }),
);

function UsersTab() {
  const api = useApi(),
    act = useAction(),
    { ask, dialog } = useAsk(),
    { me } = useMe();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [disabled, setDisabled] = useState("");
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (role) params.set("role", role);
  if (disabled) params.set("disabled", disabled);
  const users = useQuery<AdminUser[]>(`/admin/users?${params}`);
  const patch = (email: string, body: object) =>
    void act
      .run(() =>
        api("PATCH", `/admin/users/${encodeURIComponent(email)}`, body),
      )
      .then(users.reload);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Tìm người dùng"
            placeholder="Tìm email / tên"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-64 pl-8 text-[13px]"
          />
        </div>
        <SelectField
          aria-label="Lọc theo role"
          value={role}
          onChange={setRole}
          options={[{ value: "", label: "Mọi role" }, ...ROLE_OPTIONS]}
        />
        <SelectField
          aria-label="Lọc theo trạng thái"
          value={disabled}
          onChange={setDisabled}
          options={[
            { value: "", label: "Mọi trạng thái" },
            { value: "false", label: "Đang hoạt động" },
            { value: "true", label: "Đã vô hiệu hoá" },
          ]}
        />
      </div>
      <ErrorBox error={act.error ?? users.error} />
      <div className="border-t">
        {!users.data ? (
          <Loading />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Người dùng</TableHead>
                <TableHead className="w-40">Danh bạ</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead className="w-48">Role</TableHead>
                <TableHead className="w-32">Trạng thái</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.length === 0 && (
                <EmptyRow colSpan={6}>Không có người dùng khớp bộ lọc.</EmptyRow>
              )}
              {users.data.map((u) => {
                const locked =
                  u.email === "admin@hyperdatalab.org" ||
                  u.email === me.user.email;
                return (
                  <TableRow key={u.email}>
                    <TableCell>
                      <Stacked primary={u.name || "—"} secondary={u.email} />
                    </TableCell>
                    <TableCell>
                      <Badge value={u.directoryStatus} />
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-[13px] text-muted-foreground">
                      {u.workspaces
                        ?.map((w) => `${w.name} (${w.role})`)
                        .join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      <SelectField
                        aria-label={`Role của ${u.email}`}
                        value={u.role}
                        disabled={locked}
                        className="w-44"
                        onChange={(value) => patch(u.email, { role: value })}
                        options={ROLE_OPTIONS}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge
                        value={u.disabled ? "disabled" : "active"}
                        label={u.disabled ? "Đã vô hiệu hoá" : "Hoạt động"}
                      />
                    </TableCell>
                    <TableCell>
                      {!locked && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Thao tác với ${u.email}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              variant={u.disabled ? "default" : "destructive"}
                              onSelect={async () => {
                                const ok = await ask({
                                  title: `${u.disabled ? "Mở khoá" : "Vô hiệu hoá"} ${u.email}?`,
                                  confirmLabel: u.disabled
                                    ? "Mở khoá"
                                    : "Vô hiệu hoá",
                                  destructive: !u.disabled,
                                });
                                if (ok !== null)
                                  patch(u.email, { disabled: !u.disabled });
                              }}
                            >
                              {u.disabled ? "Enable" : "Disable"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      {dialog}
    </>
  );
}

function RequestsTab() {
  const api = useApi(),
    act = useAction(),
    { ask, dialog } = useAsk();
  const q = useQuery<WorkspaceRequest[]>(
    "/admin/workspace-requests?status=pending",
  );
  const [edits, setEdits] = useState<Record<string, { name: string }>>({});
  const refresh = () => q.reload();
  const approve = async (r: WorkspaceRequest, e: { name: string }) => {
    const note = await ask({
      title: `Duyệt workspace "${e.name}"?`,
      description: "Người yêu cầu sẽ thành quản lý của workspace mới.",
      noteLabel: "Ghi chú",
      confirmLabel: "Duyệt",
    });
    if (note === null) return;
    void act
      .run(() =>
        api("POST", `/admin/workspace-requests/${r.id}/approve`, {
          ...e,
          note,
        }),
      )
      .then(refresh);
  };
  const reject = async (r: WorkspaceRequest) => {
    const note = await ask({
      title: `Từ chối yêu cầu "${r.name}"?`,
      noteLabel: "Lý do từ chối",
      confirmLabel: "Từ chối",
      destructive: true,
    });
    if (note === null) return;
    void act
      .run(() =>
        api("POST", `/admin/workspace-requests/${r.id}/reject`, { note }),
      )
      .then(refresh);
  };
  return (
    <>
      <ErrorBox error={act.error ?? q.error} />
      <Section title="Đang chờ duyệt" count={q.data?.length}>
        {!q.data ? (
          <Loading />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Người yêu cầu</TableHead>
                <TableHead>Tên workspace</TableHead>
                <TableHead>Chi tiết</TableHead>
                <TableHead>Lý do</TableHead>
                <TableHead className="w-36">Gửi lúc</TableHead>
                <TableHead className="w-44">
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.length === 0 && (
                <EmptyRow colSpan={6}>Không có yêu cầu đang chờ.</EmptyRow>
              )}
              {q.data.map((r) => {
                const e = edits[r.id] ?? { name: r.name };
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Stacked
                        primary={r.requesterName || r.requester}
                        secondary={`${r.requester}${r.department ? ` · ${r.department}` : ""}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label="Tên workspace (admin có thể sửa trước khi duyệt)"
                        value={e.name}
                        onChange={(x) =>
                          setEdits({
                            ...edits,
                            [r.id]: { ...e, name: x.target.value },
                          })
                        }
                        className="h-8 min-w-40 text-[13px]"
                      />
                    </TableCell>
                    <TableCell className="text-[13px]">
                      <div className="flex items-center gap-2">
                        <Tag>{r.type}</Tag>
                        <span className="truncate text-muted-foreground">
                          {r.description || "—"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">
                      {r.reason || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {fmtShort(r.requestedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          disabled={act.busy}
                          onClick={() => void approve(r, e)}
                        >
                          Duyệt
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={act.busy}
                          onClick={() => void reject(r)}
                        >
                          Từ chối
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>
      {dialog}
    </>
  );
}

interface AdminWorkspace {
  id: string;
  name: string;
  type: string;
  status: string;
  /** The admin API returns the manager list under this name. */
  managerEmails?: string[];
  memberCount: number;
  pendingCount: number;
}

function WorkspacesTab() {
  const api = useApi(),
    act = useAction(),
    { ask, dialog } = useAsk();
  const list = useQuery<AdminWorkspace[]>("/admin/workspaces");
  const users = useQuery<AdminUser[]>("/admin/users?disabled=false");
  const types = useQuery<{ code: string; name: string }[]>("/workspace-types");
  const [managerSelections, setManagerSelections] = useState<
    Record<string, string>
  >({});
  const [promotionMessage, setPromotionMessage] = useState("");
  const [form, setForm] = useState({
    name: "",
    type: "research",
    description: "",
    managers: "",
  });
  const refresh = () => list.reload();

  const addManager = async (w: AdminWorkspace) => {
    const email = managerSelections[w.id];
    const selected = users.data?.find((user) => user.email === email);
    if (!email) return;
    if (selected?.role === "member") {
      const ok = await ask({
        title: "Nâng quyền người dùng?",
        description: "Người này sẽ được nâng lên Quản lý workspace",
        confirmLabel: "Tiếp tục",
      });
      if (ok === null) return;
    }
    void act
      .run(() =>
        api<{ promoted: boolean }>(
          "POST",
          `/admin/workspaces/${w.id}/managers`,
          { email },
        ),
      )
      .then((result) => {
        if (result) {
          setPromotionMessage(
            result.promoted
              ? `${email} đã được nâng lên Quản lý workspace.`
              : `${email} đã được thêm làm manager.`,
          );
          setManagerSelections({ ...managerSelections, [w.id]: "" });
          refresh();
        }
      });
  };

  return (
    <>
      <Section title="Tạo workspace">
        <form
          className="grid gap-3 pt-3 md:grid-cols-[1fr_10rem_1fr_1fr_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void act
              .run(() =>
                api("POST", "/admin/workspaces", {
                  ...form,
                  managers: form.managers.split(/[\s,;]+/).filter(Boolean),
                }),
              )
              .then(refresh);
          }}
        >
          <Field label="Tên" htmlFor="aw-name">
            <Input
              id="aw-name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="h-8 text-[13px]"
            />
          </Field>
          <Field label="Loại" htmlFor="aw-type">
            <SelectField
              id="aw-type"
              className="w-full"
              value={form.type}
              onChange={(type) => setForm({ ...form, type })}
              options={(types.data ?? []).map((t) => ({
                value: t.code,
                label: t.name,
              }))}
            />
          </Field>
          <Field label="Mô tả" htmlFor="aw-desc">
            <Input
              id="aw-desc"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              className="h-8 text-[13px]"
            />
          </Field>
          <Field label="Managers (email)" htmlFor="aw-managers">
            <Input
              id="aw-managers"
              placeholder="a@…, b@…"
              value={form.managers}
              onChange={(e) => setForm({ ...form, managers: e.target.value })}
              className="h-8 text-[13px]"
            />
          </Field>
          <Button size="sm">Tạo</Button>
        </form>
      </Section>

      <ErrorBox error={act.error ?? users.error} />
      {promotionMessage && (
        <p role="status" className="pb-3 text-[13px] text-ok">
          {promotionMessage}
        </p>
      )}

      <Section title="Workspace" count={list.data?.length}>
        {!list.data ? (
          <Loading />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Tên</TableHead>
                <TableHead>Managers</TableHead>
                <TableHead className="w-80">Thêm manager</TableHead>
                <TableHead className="w-32">Thành viên</TableHead>
                <TableHead className="w-32">Trạng thái</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.length === 0 && (
                <EmptyRow colSpan={6}>Chưa có workspace.</EmptyRow>
              )}
              {list.data.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    <Stacked primary={w.name} secondary={w.type} />
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-[13px] text-muted-foreground">
                    {(w.managerEmails ?? []).join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <SelectField
                        aria-label={`Chọn manager cho ${w.name}`}
                        placeholder="Chọn người dùng"
                        className="w-56"
                        value={managerSelections[w.id] ?? ""}
                        onChange={(value) =>
                          setManagerSelections({
                            ...managerSelections,
                            [w.id]: value,
                          })
                        }
                        options={(users.data ?? [])
                          .filter((user) => !w.managerEmails?.includes(user.email))
                          .map((user) => ({
                            value: user.email,
                            label: `${user.name || user.email} (${user.role})`,
                          }))}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!managerSelections[w.id] || act.busy}
                        onClick={() => void addManager(w)}
                      >
                        Thêm
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums">
                    {w.memberCount}
                    <span className="text-muted-foreground">
                      {" "}
                      · {w.pendingCount} chờ
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge value={w.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={act.busy}
                      onClick={() =>
                        void act
                          .run(() =>
                            api("PATCH", `/admin/workspaces/${w.id}`, {
                              status:
                                w.status === "active" ? "archived" : "active",
                            }),
                          )
                          .then(refresh)
                      }
                    >
                      {w.status === "active" ? "Lưu trữ" : "Mở lại"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      {dialog}
    </>
  );
}

function AuditTab() {
  const q = useQuery<AuditRow[]>("/admin/audit?limit=300");
  return (
    <>
      <ErrorBox error={q.error} />
      <div className="border-t">
        <AuditTable rows={q.data} />
      </div>
    </>
  );
}
