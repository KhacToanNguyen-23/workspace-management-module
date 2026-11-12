import { useState } from "react";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { useMe, useWorkspace } from "../../app/contexts";
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
import { AuditTable } from "../../shared/components/AuditTable";
import {
  Badge,
  EmptyRow,
  ErrorBox,
  Loading,
  PageBody,
  PageHeader,
  Section,
  Stacked,
  fmtShort,
  useAction,
  useAsk,
} from "../../shared/components/ui";
import { useApi, useQuery } from "../../shared/lib/api";
import {
  type AuditRow,
  type MemberRow,
  ROLE_LABEL,
} from "../../shared/lib/types";

export function MembersPage() {
  const { info } = useWorkspace();
  const { me, reload: reloadMe } = useMe();
  const wid = info.workspace.id;
  const api = useApi();
  const act = useAction();
  const { ask, dialog } = useAsk();
  const members = useQuery<MemberRow[]>(`/workspaces/${wid}/members?limit=500`);
  const audit = useQuery<AuditRow[]>(
    `/audit-events?workspaceId=${wid}&limit=50`,
  );
  const [email, setEmail] = useState("");
  if (!info.canManage)
    return (
      <PageBody>
        <ErrorBox error="Bạn không có quyền quản lý workspace này." />
      </PageBody>
    );
  const refresh = () => {
    members.reload();
    audit.reload();
    reloadMe();
  };
  const decide = (
    id: string,
    status: "approved" | "rejected" | "revoked",
    body: object = {},
  ) =>
    void act
      .run(() =>
        api("PATCH", `/workspaces/${wid}/members/${id}`, { status, ...body }),
      )
      .then(refresh);
  const reject = async (m: MemberRow) => {
    const note = await ask({
      title: `Từ chối ${m.email}?`,
      noteLabel: "Lý do từ chối",
      confirmLabel: "Từ chối",
      destructive: true,
    });
    if (note !== null) decide(m.id, "rejected", { note });
  };
  const revoke = async (m: MemberRow) => {
    const ok = await ask({
      title: `Thu hồi quyền của ${m.email}?`,
      description: "Người này sẽ không còn truy cập workspace.",
      confirmLabel: "Thu hồi",
      destructive: true,
    });
    if (ok !== null) decide(m.id, "revoked");
  };
  const rows = members.data ?? [];
  const pending = rows.filter((m) => m.status === "pending"),
    approved = rows.filter((m) => m.status === "approved"),
    past = rows.filter((m) => ["rejected", "revoked"].includes(m.status));

  return (
    <>
      <PageHeader
        title="Quản lý workspace"
        sub={info.workspace.name}
        actions={
          <form
            className="hidden items-center gap-2 sm:flex"
            onSubmit={(e) => {
              e.preventDefault();
              void act
                .run(() => api("POST", `/workspaces/${wid}/members`, { email }))
                .then((r) => {
                  if (r !== undefined) setEmail("");
                  refresh();
                });
            }}
          >
            <Input
              type="email"
              aria-label="Email thành viên cần thêm"
              placeholder="ten@hyperdatalab.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-8 w-60 text-[13px]"
            />
            <Button size="sm" disabled={act.busy || !email}>
              <UserPlus />
              Thêm
            </Button>
          </form>
        }
      />
      <PageBody>
        <ErrorBox error={act.error ?? members.error} />
        <Section title="Chờ duyệt" count={members.data ? pending.length : undefined}>
          {!members.data ? (
            <Loading />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Người xin</TableHead>
                  <TableHead>Lời nhắn</TableHead>
                  <TableHead className="w-36">Gửi lúc</TableHead>
                  <TableHead className="w-44">
                    <span className="sr-only">Thao tác</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.length === 0 && (
                  <EmptyRow colSpan={4}>Không có yêu cầu nào.</EmptyRow>
                )}
                {pending.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Stacked
                        primary={m.name || m.email}
                        secondary={`${m.email}${m.department ? ` · ${m.department}` : ""}`}
                      />
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">
                      {m.note || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {fmtShort(m.requestedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          disabled={act.busy}
                          onClick={() => decide(m.id, "approved")}
                        >
                          Duyệt
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={act.busy}
                          onClick={() => void reject(m)}
                        >
                          Từ chối
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section title="Thành viên" count={members.data ? approved.length : undefined}>
          {/* The add form lives in the toolbar on wider screens. */}
          <form
            className="flex gap-2 py-3 sm:hidden"
            onSubmit={(e) => {
              e.preventDefault();
              void act
                .run(() => api("POST", `/workspaces/${wid}/members`, { email }))
                .then((r) => {
                  if (r !== undefined) setEmail("");
                  refresh();
                });
            }}
          >
            <Input
              type="email"
              aria-label="Email thành viên cần thêm"
              placeholder="ten@hyperdatalab.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 flex-1"
            />
            <Button disabled={act.busy || !email}>Thêm</Button>
          </form>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Thành viên</TableHead>
                <TableHead className="w-40">Danh bạ</TableHead>
                <TableHead className="w-28">Vai trò</TableHead>
                <TableHead>Duyệt bởi</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data && approved.length === 0 && (
                <EmptyRow colSpan={5}>Chưa có thành viên.</EmptyRow>
              )}
              {approved.map((m) => {
                const locked =
                  (m.email === me.user.email && !me.user.isAdmin) ||
                  (m.role === "manager" && !me.user.isAdmin);
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Stacked primary={m.name || m.email} secondary={m.email} />
                    </TableCell>
                    <TableCell>
                      <Badge value={m.directoryStatus} />
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {ROLE_LABEL[m.role]}
                    </TableCell>
                    <TableCell>
                      <Stacked
                        primary={
                          <span className="font-normal">
                            {m.decidedBy || "—"}
                          </span>
                        }
                        secondary={fmtShort(m.decidedAt)}
                      />
                    </TableCell>
                    <TableCell>
                      {!locked && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Thao tác với ${m.email}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={act.busy}
                              onSelect={() => void revoke(m)}
                            >
                              Thu hồi quyền
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
          {past.length > 0 && (
            <details className="group border-t py-2 text-[13px]">
              <summary className="cursor-pointer py-1 text-muted-foreground hover:text-foreground">
                Đã từ chối / thu hồi ({past.length})
              </summary>
              <ul className="divide-y">
                {past.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                  >
                    <span>{m.email}</span>
                    <Badge value={m.status} />
                    <span className="text-muted-foreground">
                      {m.decisionNote || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>

        <Section title="Nhật ký">
          <AuditTable rows={audit.data} />
        </Section>
      </PageBody>
      {dialog}
    </>
  );
}
