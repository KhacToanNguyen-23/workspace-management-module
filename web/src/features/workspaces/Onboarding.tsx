import { useState } from "react";
import { Link } from "react-router-dom";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageBody,
  PageHeader,
  Section,
  SelectField,
  Tag,
  fmtShort,
  useAction,
} from "../../shared/components/ui";
import { useApi, useQuery } from "../../shared/lib/api";
import { ROLE_LABEL, type WorkspaceSummary } from "../../shared/lib/types";

/**
 * Pick a workspace and send a join request (a manager of that workspace approves it), or ask an
 * admin to create a new workspace. Workspace managers and admins create workspaces directly.
 */
export function OnboardingPage() {
  const api = useApi();
  const { me, reload: reloadMe } = useMe();
  const list = useQuery<WorkspaceSummary[]>("/workspaces");
  const act = useAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [workspaceForm, setWorkspaceForm] = useState({
    name: "",
    type: "research",
    description: "",
    reason: "",
  });
  const types = useQuery<{ code: string; name: string }[]>("/workspace-types");
  const approved = me.memberships.some((m) => m.status === "approved");
  const canCreateDirectly = me.user.role !== "member";

  const refresh = () => {
    list.reload();
    reloadMe();
  };

  return (
    <>
      <PageHeader
        title="Tham gia workspace"
        sub={
          approved
            ? "Bạn có thể xin vào thêm workspace khác."
            : "Chọn một workspace và gửi yêu cầu; manager của workspace đó sẽ duyệt."
        }
        actions={
          canCreateDirectly && (
            <Button asChild size="sm" variant="outline">
              <Link to="/create-workspace" className="no-underline!">
                <Plus />
                Tạo workspace
              </Link>
            </Button>
          )
        }
      />
      <PageBody>
        <ErrorBox error={act.error ?? list.error} />

        {me.memberships.length > 0 && (
          <Section title="Yêu cầu của tôi" count={me.memberships.length}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Workspace</TableHead>
                  <TableHead className="w-28">Vai trò</TableHead>
                  <TableHead className="w-28">Trạng thái</TableHead>
                  <TableHead className="w-36">Gửi lúc</TableHead>
                  <TableHead>Ghi chú duyệt</TableHead>
                  <TableHead className="w-28">
                    <span className="sr-only">Thao tác</span>
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
                      {ROLE_LABEL[m.role]}
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
                                  `/workspaces/${m.workspace.id}/join`,
                                ),
                              )
                              .then(refresh)
                          }
                        >
                          Rút yêu cầu
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        )}

        <Section title="Workspace" count={list.data?.length}>
          {!list.data ? (
            <Loading />
          ) : list.data.length === 0 ? (
            <Empty>
              {canCreateDirectly
                ? "Chưa có workspace nào. Hãy tạo workspace đầu tiên."
                : "Chưa có workspace nào để tham gia. Bạn có thể xin tạo workspace mới ở dưới."}
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
                        {w.description || "Không có mô tả."}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {w.memberCount} thành viên · Quản lý:{" "}
                        {w.managers.join(", ") || "chưa có"}
                      </p>
                    </div>
                    {canRequest && (
                      <div className="flex gap-2 lg:w-96">
                        <Input
                          aria-label={`Lời nhắn cho manager của ${w.name}`}
                          placeholder="Lời nhắn cho manager (tuỳ chọn)"
                          value={notes[w.id] ?? ""}
                          onChange={(e) =>
                            setNotes({ ...notes, [w.id]: e.target.value })
                          }
                          className="h-8 flex-1 text-[13px]"
                        />
                        <Button
                          size="sm"
                          disabled={act.busy}
                          onClick={() =>
                            act
                              .run(() =>
                                api("POST", `/workspaces/${w.id}/join`, {
                                  note: notes[w.id] ?? "",
                                }),
                              )
                              .then(refresh)
                          }
                        >
                          Xin tham gia
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {canCreateDirectly ? (
          <Section title="Tạo workspace mới">
            <p className="py-3 text-[13px] text-muted-foreground">
              Bạn có quyền quản lý workspace nên tạo được ngay, không cần admin
              duyệt. <Link to="/create-workspace">Tạo workspace</Link>
            </p>
          </Section>
        ) : (
          <Section
            title="Xin tạo workspace mới"
            description="Admin duyệt xong, bạn sẽ trở thành quản lý của workspace đó."
          >
            {me.workspaceRequest && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-3 text-[13px]">
                <span className="text-muted-foreground">Yêu cầu gần nhất</span>
                <span className="font-medium">{me.workspaceRequest.name}</span>
                <Badge value={me.workspaceRequest.status} />
                {me.workspaceRequest.decisionNote && (
                  <span className="text-muted-foreground">
                    {me.workspaceRequest.decisionNote}
                  </span>
                )}
                {me.workspaceRequest.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    disabled={act.busy}
                    onClick={() =>
                      void act
                        .run(() =>
                          api(
                            "DELETE",
                            `/workspace-requests/${me.workspaceRequest!.id}`,
                          ),
                        )
                        .then(refresh)
                    }
                  >
                    Rút yêu cầu
                  </Button>
                )}
              </div>
            )}
            {me.workspaceRequest?.status !== "pending" && (
              <form
                className="grid max-w-2xl gap-3 pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act
                    .run(() => api("POST", "/workspace-requests", workspaceForm))
                    .then(refresh);
                }}
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                  <Field label="Tên workspace" htmlFor="wr-name">
                    <Input
                      id="wr-name"
                      required
                      value={workspaceForm.name}
                      onChange={(e) =>
                        setWorkspaceForm({
                          ...workspaceForm,
                          name: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Loại" htmlFor="wr-type">
                    <SelectField
                      id="wr-type"
                      size="default"
                      className="w-full"
                      value={workspaceForm.type}
                      onChange={(type) =>
                        setWorkspaceForm({ ...workspaceForm, type })
                      }
                      options={(types.data ?? []).map((t) => ({
                        value: t.code,
                        label: t.name,
                      }))}
                    />
                  </Field>
                </div>
                <Field label="Mô tả" htmlFor="wr-desc">
                  <Input
                    id="wr-desc"
                    value={workspaceForm.description}
                    onChange={(e) =>
                      setWorkspaceForm({
                        ...workspaceForm,
                        description: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Lý do xin tạo" htmlFor="wr-reason">
                  <Textarea
                    id="wr-reason"
                    rows={3}
                    value={workspaceForm.reason}
                    onChange={(e) =>
                      setWorkspaceForm({
                        ...workspaceForm,
                        reason: e.target.value,
                      })
                    }
                  />
                </Field>
                <div>
                  <Button disabled={act.busy}>Gửi admin duyệt</Button>
                </div>
              </form>
            )}
          </Section>
        )}
      </PageBody>
    </>
  );
}
