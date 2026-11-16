import { useState } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import { useWorkspace } from "../../app/contexts";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Badge,
  EmptyRow,
  ErrorBox,
  Loading,
  PageBody,
  PageHeader,
  Section,
  SelectField,
  Stacked,
  fmtShort,
  useAction,
  useAsk,
  ScrollList,
} from "../../shared/components/ui";
import { useApi, useQuery } from "../../shared/lib/api";
import type { DownloadRequest } from "../../shared/lib/types";
import { useTr } from "../entry/i18n";

const STATUS_FILTER = [
  { value: "", label: "Mọi trạng thái" },
  { value: "pending", label: "Chờ duyệt" },
  { value: "approved", label: "Đã duyệt" },
  { value: "rejected", label: "Từ chối" },
  { value: "withdrawn", label: "Đã rút" },
];

function matches(r: DownloadRequest, q: string, status: string) {
  if (status && r.status !== status) return false;
  if (!q) return true;
  const needle = q.toLowerCase();
  return [r.paperRef, r.note, r.requester, r.requesterName].some((v) =>
    v?.toLowerCase().includes(needle),
  );
}

/** Paper download requests: send one, follow my own, and (managers) work the queue. */
export function DownloadsPage() {
  const tr = useTr();
  const { info } = useWorkspace();
  const api = useApi();
  const act = useAction();
  const { ask, dialog } = useAsk();
  const wid = info.workspace.id;
  const mine = useQuery<DownloadRequest[]>(
    `/workspaces/${wid}/download-requests?requester=me&limit=500`,
  );
  const queue = useQuery<DownloadRequest[]>(
    info.canManage ? `/workspaces/${wid}/download-requests?limit=500` : null,
  );
  const [paperRef, setPaperRef] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const refresh = () => {
    mine.reload();
    queue.reload();
  };
  const decide = async (id: string, decision: "approve" | "reject") => {
    const decisionNote = await ask(
      decision === "approve"
        ? {
            title: tr("Duyệt yêu cầu download"),
            noteLabel: tr("Ghi chú cho thành viên"),
            confirmLabel: tr("Duyệt"),
          }
        : {
            title: tr("Từ chối yêu cầu download"),
            noteLabel: tr("Lý do từ chối"),
            confirmLabel: tr("Từ chối"),
            destructive: true,
          },
    );
    if (decisionNote === null) return;
    void act
      .run(() =>
        api("PATCH", `/workspaces/${wid}/download-requests/${id}`, {
          status: decision === "approve" ? "approved" : "rejected",
          note: decisionNote,
        }),
      )
      .then(refresh);
  };
  const withdraw = (id: string) =>
    void act
      .run(() => api("DELETE", `/workspaces/${wid}/download-requests/${id}`))
      .then(refresh);

  const myRows = (mine.data ?? []).filter((r) => matches(r, q, status));
  const queueRows = (queue.data ?? []).filter((r) => matches(r, q, status));

  return (
    <>
      <PageHeader
        title={tr("Yêu cầu download")}
        sub={info.workspace.name}
        actions={
          <>
            <div className="relative hidden sm:block">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                aria-label={tr("Tìm yêu cầu")}
                placeholder={tr("Tìm paper, người gửi…")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-8 w-56 pl-8 text-[13px]"
              />
            </div>
            <SelectField
              aria-label={tr("Lọc theo trạng thái")}
              value={status}
              onChange={setStatus}
              options={STATUS_FILTER.map((o) => ({ ...o, label: tr(o.label) }))}
            />
          </>
        }
      />
      <PageBody>
        <div className="relative mb-6 sm:hidden">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={tr("Tìm yêu cầu")}
            placeholder={tr("Tìm paper, người gửi…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 pl-8"
          />
        </div>
        <Section
          title={tr("Gửi yêu cầu paper")}
          description={tr("Gửi DOI, URL hoặc tiêu đề để manager xem xét. Chức năng này không tạo file hay link tải.")}
        >
          <form
            className="grid gap-2 pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void act
                .run(() =>
                  api("POST", `/workspaces/${wid}/download-requests`, { paperRef, note }),
                )
                .then((r) => {
                  if (r !== undefined) {
                    setPaperRef("");
                    setNote("");
                    setShowNote(false);
                    refresh();
                  }
                });
            }}
          >
            <label htmlFor="paper-ref" className="sr-only">
              {tr("DOI / URL / tiêu đề paper")}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="paper-ref"
                required
                maxLength={500}
                placeholder={tr("DOI / URL / tiêu đề paper")}
                value={paperRef}
                onChange={(e) => setPaperRef(e.target.value)}
                className="h-9 flex-1"
              />
              <Button type="submit" disabled={act.busy} className="h-9 min-w-(--size-action-md)">
                {tr("Gửi yêu cầu")}
              </Button>
            </div>
            {showNote ? (
              <Textarea
                aria-label={tr("Ghi chú (tuỳ chọn)")}
                maxLength={1000}
                rows={2}
                placeholder={tr("Ghi chú cho manager (tuỳ chọn)")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-16 text-[13px]"
              />
            ) : (
              <Button
                type="button"
                variant="link"
                size="xs"
                className="w-fit px-0 text-muted-foreground"
                onClick={() => setShowNote(true)}
              >
                {tr("+ Thêm ghi chú")}
              </Button>
            )}
            <ErrorBox error={act.error} />
          </form>
        </Section>

        <Section title={tr("Yêu cầu của tôi")} count={mine.data?.length}>
          {mine.error ? (
            <ErrorBox error={mine.error} />
          ) : !mine.data ? (
            <Loading />
          ) : (
            <ScrollList>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Paper</TableHead>
                    <TableHead className="w-36">{tr("Gửi lúc")}</TableHead>
                    <TableHead className="w-28">{tr("Trạng thái")}</TableHead>
                    <TableHead>{tr("Ghi chú manager")}</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">{tr("Thao tác")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myRows.length === 0 && (
                    <EmptyRow colSpan={5}>
                      {mine.data.length === 0
                        ? tr("Chưa có yêu cầu.")
                        : tr("Không có yêu cầu khớp bộ lọc.")}
                    </EmptyRow>
                  )}
                  {myRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-md">
                        <Stacked primary={r.paperRef} secondary={r.note} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                        {fmtShort(r.requestedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge value={r.status} />
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">
                        {r.decisionNote || "—"}
                      </TableCell>
                      <TableCell>
                        {r.status === "pending" && (
                          <DropdownMenu>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={tr("Thao tác")}
                                  >
                                    <MoreHorizontal />
                                  </Button>
                                </DropdownMenuTrigger>
                              </TooltipTrigger>
                              <TooltipContent>{tr("Thao tác")}</TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                disabled={act.busy}
                                onSelect={() => withdraw(r.id)}
                              >
                                {tr("Rút yêu cầu")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollList>
          )}
        </Section>

        {info.canManage && (
          <Section title={tr("Hàng đợi duyệt")} count={queue.data?.length}>
            {queue.error ? (
              <ErrorBox error={queue.error} />
            ) : !queue.data ? (
              <Loading />
            ) : (
              <ScrollList>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Paper</TableHead>
                      <TableHead>{tr("Người yêu cầu")}</TableHead>
                      <TableHead className="w-36">{tr("Gửi lúc")}</TableHead>
                      <TableHead className="w-28">{tr("Trạng thái")}</TableHead>
                      <TableHead className="w-44 text-right">
                        <span className="sr-only">{tr("Thao tác")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queueRows.length === 0 && (
                      <EmptyRow colSpan={5}>
                        {queue.data.length === 0
                          ? tr("Không có yêu cầu chờ duyệt.")
                          : tr("Không có yêu cầu khớp bộ lọc.")}
                      </EmptyRow>
                    )}
                    {queueRows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="max-w-md">
                          <Stacked primary={r.paperRef} secondary={r.note} />
                        </TableCell>
                        <TableCell>
                          <Stacked
                            primary={r.requesterName || r.requester}
                            secondary={r.requester}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                          {fmtShort(r.requestedAt)}
                        </TableCell>
                        <TableCell>
                          <Badge value={r.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          {r.status === "pending" && (
                            <div className="flex justify-end gap-1.5">
                              <Button
                                className="min-w-(--size-action-sm)"
                                size="sm"
                                disabled={act.busy}
                                onClick={() => void decide(r.id, "approve")}
                              >
                                {tr("Duyệt")}
                              </Button>
                              <Button
                                className="min-w-(--size-action-sm)"
                                size="sm"
                                variant="outline"
                                disabled={act.busy}
                                onClick={() => void decide(r.id, "reject")}
                              >
                                {tr("Từ chối")}
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollList>
            )}
          </Section>
        )}
      </PageBody>
      {dialog}
    </>
  );
}
