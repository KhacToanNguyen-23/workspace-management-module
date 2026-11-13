import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useMe } from "../../app/contexts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Badge,
  Empty,
  ErrorBox,
  Loading,
  PageBody,
  PageHeader,
  Section,
  Tag,
  fmtShort,
  useAction,
} from "../../shared/components/ui";
import { useApi, useQuery } from "../../shared/lib/api";
import { ROLE_LABEL, type WorkspaceSummary } from "../../shared/lib/types";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { useTr } from "../entry/i18n";

/**
 * All workspaces in one place: join an existing one (a manager of that workspace approves it) or
 * create a new one. Admins and workspace managers create directly; members send a request that an
 * admin approves.
 */
export function OnboardingPage() {
  const tr = useTr();
  const api = useApi();
  const navigate = useNavigate();
  const { me, reload: reloadMe } = useMe();
  const list = useQuery<WorkspaceSummary[]>("/workspaces?limit=500");
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const canCreateDirectly = me.user.role !== "member";
  const request = me.workspaceRequest;
  const requestPending = request?.status === "pending";

  const refresh = () => {
    list.reload();
    reloadMe();
  };

  return (
    <>
      <PageHeader
        title="Workspace"
        actions={
          <Button
            size="sm"
            disabled={!canCreateDirectly && requestPending}
            title={
              !canCreateDirectly && requestPending
                ? tr("Bạn đang có một yêu cầu chờ duyệt")
                : undefined
            }
            className="min-w-(--size-action-lg)"
            onClick={() => setDialogOpen(true)}
          >
            <Plus />
            {canCreateDirectly ? tr("Tạo workspace") : tr("Xin tạo workspace")}
          </Button>
        }
      />
      <PageBody>
        <ErrorBox error={act.error ?? list.error} />

        {request && (
          <Section title={tr("Yêu cầu tạo workspace")}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-[13px]">
              <span className="font-medium">{request.name}</span>
              <Tag>{request.type}</Tag>
              <Badge value={request.status} />
              {request.decisionNote && (
                <span className="text-muted-foreground">
                  {request.decisionNote}
                </span>
              )}
              {requestPending && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={act.busy}
                  onClick={() =>
                    void act
                      .run(() =>
                        api("DELETE", `/workspace-requests/${request.id}`),
                      )
                      .then(refresh)
                  }
                >
                  {tr("Rút yêu cầu")}
                </Button>
              )}
            </div>
          </Section>
        )}

        {me.memberships.length > 0 && (
          <Section title={tr("Yêu cầu tham gia của tôi")} count={me.memberships.length}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Workspace</TableHead>
                  <TableHead className="w-28">{tr("Vai trò")}</TableHead>
                  <TableHead className="w-28">{tr("Trạng thái")}</TableHead>
                  <TableHead className="w-36">{tr("Gửi lúc")}</TableHead>
                  <TableHead>{tr("Ghi chú duyệt")}</TableHead>
                  <TableHead className="w-28">
                    <span className="sr-only">{tr("Thao tác")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {me.memberships.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.status === "approved" ? (
                        <Link to={`/w/${m.workspace.id}`}>
                          {m.workspace.name}
                        </Link>
                      ) : (
                        m.workspace.name
                      )}
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {tr(ROLE_LABEL[m.role])}
                    </TableCell>
                    <TableCell>
                      <Badge value={m.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {fmtShort(m.requestedAt)}
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">
                      {m.decisionNote || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {m.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={act.busy}
                          onClick={() =>
                            act
                              .run(() =>
                                api(
                                  "DELETE",
                                  `/workspaces/${m.workspace.id}/members/me`,
                                ),
                              )
                              .then(refresh)
                          }
                        >
                          {tr("Rút yêu cầu")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        )}

        <Section title={tr("Tất cả workspace")} count={list.data?.length}>
          {!list.data ? (
            <Loading />
          ) : list.data.length === 0 ? (
            <Empty>
              {canCreateDirectly
                ? tr("Chưa có workspace nào. Hãy tạo workspace đầu tiên.")
                : tr("Chưa có workspace nào để tham gia. Bạn có thể xin tạo workspace mới.")}
            </Empty>
          ) : (
            <ul className="divide-y">
              {list.data.map((w) => {
                const canRequest =
                  !w.myStatus ||
                  w.myStatus === "rejected" ||
                  w.myStatus === "revoked";
                return (
                  <li
                    key={w.id}
                    className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{w.name}</span>
                        <Tag>{w.type}</Tag>
                        {w.myStatus && <Badge value={w.myStatus} />}
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                        {w.description || tr("Không có mô tả.")}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {tr("{count} thành viên · Quản lý:", { count: w.memberCount })}{" "}
                        {w.managers.join(", ") || tr("chưa có")}
                      </p>
                    </div>
                    {canRequest && (
                      <div className="flex gap-2 lg:w-96">
                        <Input
                          aria-label={tr("Lời nhắn cho manager của {name}", { name: w.name })}
                          placeholder={tr("Lời nhắn cho manager (tuỳ chọn)")}
                          value={notes[w.id] ?? ""}
                          onChange={(e) =>
                            setNotes({ ...notes, [w.id]: e.target.value })
                          }
                          className="h-8 flex-1 text-[13px]"
                        />
                        <Button
                          className="min-w-(--size-action-md)"
                          size="sm"
                          disabled={act.busy}
                          onClick={() =>
                            act
                              .run(() =>
                                api("PUT", `/workspaces/${w.id}/members/me`, {
                                  note: notes[w.id] ?? "",
                                }),
                              )
                              .then(refresh)
                          }
                        >
                          {tr("Xin tham gia")}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </PageBody>

      <CreateWorkspaceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={canCreateDirectly ? "create" : "request"}
        onDone={(id) => {
          setDialogOpen(false);
          reloadMe();
          if (id) navigate(`/w/${id}`);
          else refresh();
        }}
      />
    </>
  );
}
