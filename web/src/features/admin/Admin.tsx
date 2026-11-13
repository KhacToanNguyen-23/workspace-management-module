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
  TruncationNote,
  fmtShort,
  useAction,
  useAsk,
  ScrollList,
} from "../../shared/components/ui";
import { useApi, useQuery } from "../../shared/lib/api";
import { useCount } from "../../shared/lib/pending";
import {
  GLOBAL_ROLE_LABEL,
  type AdminUser,
  type AuditRow,
  type GlobalRole,
  type WorkspaceRequest,
} from "../../shared/lib/types";
import { useTr } from "../entry/i18n";

const TABS = [
  { value: "users", label: "Người dùng" },
  { value: "requests", label: "Yêu cầu tạo workspace" },
  { value: "workspaces", label: "Workspace" },
  { value: "audit", label: "Nhật ký" },
] as const;

export function AdminPage() {
  const tr = useTr();
  const { me } = useMe();
  const [tab, setTab] = useState<string>("users");
  const pendingRequests = useCount(
    me.user.isAdmin ? "/workspace-requests?status=pending" : null,
  );
  if (!me.user.isAdmin)
    return (
      <PageBody>
        <ErrorBox error={tr("Chỉ admin mới vào được trang này.")} />
      </PageBody>
    );
  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-0">
      <PageHeader title={tr("Quản trị")} />
      <div className="overflow-x-auto border-b px-4 md:px-8">
        <TabsList variant="line" className="h-10 gap-4 p-0">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="flex-none px-0 text-[13px] after:bg-primary group-data-[orientation=horizontal]/tabs:after:bottom-0"
            >
              {tr(t.label)}
              {t.value === "requests" && pendingRequests > 0 && (
                <span
                  aria-label={tr("{count} chờ duyệt", { count: pendingRequests })}
                  className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-xs font-semibold text-[#0f2339] tabular-nums"
                >
                  {pendingRequests > 99 ? "99+" : pendingRequests}
                </span>
              )}
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
  const tr = useTr();
  const roleOptions = ROLE_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }));
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
  params.set("limit", "500");
  const users = useQuery<AdminUser[]>(`/users?${params}`);
  const patch = (email: string, body: object) =>
    void act
      .run(() =>
        api("PATCH", `/users/${encodeURIComponent(email)}`, body),
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
            aria-label={tr("Tìm người dùng")}
            placeholder={tr("Tìm email / tên")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-64 pl-8 text-[13px]"
          />
        </div>
        <SelectField
          aria-label={tr("Lọc theo role")}
          value={role}
          onChange={setRole}
          options={[{ value: "", label: tr("Mọi role") }, ...roleOptions]}
        />
        <SelectField
          aria-label={tr("Lọc theo trạng thái")}
          value={disabled}
          onChange={setDisabled}
          options={[
            { value: "", label: tr("Mọi trạng thái") },
            { value: "false", label: tr("Đang hoạt động") },
            { value: "true", label: tr("Đã vô hiệu hoá") },
          ]}
        />
      </div>
      <ErrorBox error={act.error ?? users.error} />
      <div className="border-t">
        {!users.data ? (
          <Loading />
        ) : (
          <ScrollList>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{tr("Người dùng")}</TableHead>
                  <TableHead className="w-40">{tr("Danh bạ")}</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead className="w-48">Role</TableHead>
                  <TableHead className="w-32">{tr("Trạng thái")}</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">{tr("Thao tác")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.length === 0 && (
                  <EmptyRow colSpan={6}>{tr("Không có người dùng khớp bộ lọc.")}</EmptyRow>
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
                          aria-label={tr("Role của {email}", { email: u.email })}
                          value={u.role}
                          disabled={locked}
                          className="w-44"
                          onChange={(value) => patch(u.email, { role: value })}
                          options={roleOptions}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge
                          value={u.disabled ? "disabled" : "active"}
                          label={u.disabled ? tr("Đã vô hiệu hoá") : tr("Hoạt động")}
                        />
                      </TableCell>
                      <TableCell>
                        {!locked && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={tr("Thao tác với {email}", { email: u.email })}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                variant={u.disabled ? "default" : "destructive"}
                                onSelect={async () => {
                                  const ok = await ask({
                                    title: tr(u.disabled ? "Mở khoá {email}?" : "Vô hiệu hoá {email}?", { email: u.email }),
                                    confirmLabel: u.disabled
                                      ? tr("Mở khoá")
                                      : tr("Vô hiệu hoá"),
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
          </ScrollList>
        )}
      </div>
      <TruncationNote shown={users.data?.length} total={users.total} />
      {dialog}
    </>
  );
}

function RequestsTab() {
  const tr = useTr();
  const api = useApi(),
    act = useAction(),
    { ask, dialog } = useAsk();
  const q = useQuery<WorkspaceRequest[]>(
    "/workspace-requests?status=pending&limit=500",
  );
  const [edits, setEdits] = useState<Record<string, { name: string }>>({});
  const refresh = () => q.reload();
  const approve = async (r: WorkspaceRequest, e: { name: string }) => {
    const note = await ask({
      title: tr("Duyệt workspace \"{name}\"?", { name: e.name }),
      description: tr("Người yêu cầu sẽ thành quản lý của workspace mới."),
      noteLabel: tr("Ghi chú"),
      confirmLabel: tr("Duyệt"),
    });
    if (note === null) return;
    void act
      .run(() =>
        api("PATCH", `/workspace-requests/${r.id}`, {
          ...e,
          status: "approved",
          note,
        }),
      )
      .then(refresh);
  };
  const reject = async (r: WorkspaceRequest) => {
    const note = await ask({
      title: tr("Từ chối yêu cầu \"{name}\"?", { name: r.name }),
      noteLabel: tr("Lý do từ chối"),
      confirmLabel: tr("Từ chối"),
      destructive: true,
    });
    if (note === null) return;
    void act
      .run(() =>
        api("PATCH", `/workspace-requests/${r.id}`, { status: "rejected", note }),
      )
      .then(refresh);
  };
  return (
    <>
      <ErrorBox error={act.error ?? q.error} />
      <Section title={tr("Đang chờ duyệt")} count={q.data?.length}>
        {!q.data ? (
          <Loading />
        ) : (
          <ScrollList>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{tr("Người yêu cầu")}</TableHead>
                  <TableHead>{tr("Tên workspace")}</TableHead>
                  <TableHead>{tr("Chi tiết")}</TableHead>
                  <TableHead>{tr("Lý do")}</TableHead>
                  <TableHead className="w-36">{tr("Gửi lúc")}</TableHead>
                  <TableHead className="w-44">
                    <span className="sr-only">{tr("Thao tác")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.length === 0 && (
                  <EmptyRow colSpan={6}>{tr("Không có yêu cầu đang chờ.")}</EmptyRow>
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
                          aria-label={tr("Tên workspace (admin có thể sửa trước khi duyệt)")}
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
                            className="min-w-(--size-action-sm)"
                            size="sm"
                            disabled={act.busy}
                            onClick={() => void approve(r, e)}
                          >
                            {tr("Duyệt")}
                          </Button>
                          <Button
                            className="min-w-(--size-action-sm)"
                            size="sm"
                            variant="outline"
                            disabled={act.busy}
                            onClick={() => void reject(r)}
                          >
                            {tr("Từ chối")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollList>
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
  managers?: string[];
  memberCount: number;
  pendingCount: number;
}

function WorkspacesTab() {
  const tr = useTr();
  const api = useApi(),
    act = useAction(),
    { ask, dialog } = useAsk();
  const list = useQuery<AdminWorkspace[]>("/workspaces?status=all&limit=500");
  const users = useQuery<AdminUser[]>("/users?disabled=false&limit=500");
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
        title: tr("Nâng quyền người dùng?"),
        description: tr("Người này sẽ được nâng lên Quản lý workspace"),
        confirmLabel: tr("Tiếp tục"),
      });
      if (ok === null) return;
    }
    void act
      .run(() =>
        api<{ promoted: boolean }>(
          "POST",
          `/workspaces/${w.id}/managers`,
          { email },
        ),
      )
      .then((result) => {
        if (result) {
          setPromotionMessage(
            result.promoted
              ? tr("{email} đã được nâng lên Quản lý workspace.", { email })
              : tr("{email} đã được thêm làm manager.", { email }),
          );
          setManagerSelections({ ...managerSelections, [w.id]: "" });
          refresh();
        }
      });
  };

  return (
    <>
      <Section title={tr("Tạo workspace")}>
        <form
          className="grid gap-3 pt-3 md:grid-cols-[1fr_10rem_1fr_1fr_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void act
              .run(() =>
                api("POST", "/workspaces", {
                  ...form,
                  managers: form.managers.split(/[\s,;]+/).filter(Boolean),
                }),
              )
              .then(refresh);
          }}
        >
          <Field label={tr("Tên")} htmlFor="aw-name">
            <Input
              id="aw-name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="h-8 text-[13px]"
            />
          </Field>
          <Field label={tr("Loại")} htmlFor="aw-type">
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
          <Field label={tr("Mô tả")} htmlFor="aw-desc">
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
          <Button size="sm">{tr("Tạo")}</Button>
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
          <ScrollList>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{tr("Tên")}</TableHead>
                  <TableHead>Managers</TableHead>
                  <TableHead className="w-80">{tr("Thêm manager")}</TableHead>
                  <TableHead className="w-32">{tr("Thành viên")}</TableHead>
                  <TableHead className="w-32">{tr("Trạng thái")}</TableHead>
                  <TableHead className="w-24">
                    <span className="sr-only">{tr("Thao tác")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.length === 0 && (
                  <EmptyRow colSpan={6}>{tr("Chưa có workspace.")}</EmptyRow>
                )}
                {list.data.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>
                      <Stacked primary={w.name} secondary={w.type} />
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-[13px] text-muted-foreground">
                      {(w.managers ?? []).join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <SelectField
                          aria-label={tr("Chọn manager cho {name}", { name: w.name })}
                          placeholder={tr("Chọn người dùng")}
                          className="w-56"
                          value={managerSelections[w.id] ?? ""}
                          onChange={(value) =>
                            setManagerSelections({
                              ...managerSelections,
                              [w.id]: value,
                            })
                          }
                          options={(users.data ?? [])
                            .filter((user) => !w.managers?.includes(user.email))
                            .map((user) => ({
                              value: user.email,
                              label: `${user.name || user.email} (${user.role})`,
                            }))}
                        />
                        <Button
                          className="min-w-(--size-action-sm)"
                          size="sm"
                          variant="outline"
                          disabled={!managerSelections[w.id] || act.busy}
                          onClick={() => void addManager(w)}
                        >
                          {tr("Thêm")}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-[13px] tabular-nums">
                      {w.memberCount}
                      <span className="text-muted-foreground">
                        {" "}
                        · {tr("{count} chờ", { count: w.pendingCount })}
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
                              api("PATCH", `/workspaces/${w.id}`, {
                                status:
                                  w.status === "active" ? "archived" : "active",
                              }),
                            )
                            .then(refresh)
                        }
                      >
                        {w.status === "active" ? tr("Lưu trữ") : tr("Mở lại")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollList>
        )}
      </Section>
      {dialog}
    </>
  );
}

function AuditTab() {
  const q = useQuery<AuditRow[]>("/audit-events?limit=300");
  return (
    <>
      <ErrorBox error={q.error} />
      <div className="border-t">
        <AuditTable rows={q.data} />
      </div>
      <TruncationNote shown={q.data?.length} total={q.total} />
    </>
  );
}
