import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GLOBAL_ROLE_LABEL, type AuditRow, type GlobalRole } from "../lib/types";
import { EmptyRow, fmtShort, Loading, ScrollList } from "./ui";
import { useTr } from "../../features/entry/i18n";

type Tr = ReturnType<typeof useTr>;

/** A plain label per stored action code. Vietnamese is the key (see shared/lib/en.ts). */
const ACTION_LABEL: Record<string, string> = {
  "membership.add": "Thêm thành viên",
  "membership.approve": "Duyệt yêu cầu tham gia",
  "membership.reject": "Từ chối yêu cầu tham gia",
  "membership.revoke": "Gỡ thành viên",
  "membership.request": "Xin tham gia workspace",
  "membership.withdraw": "Rút yêu cầu tham gia",
  "membership.leave": "Rời workspace",
  "workspace.create": "Tạo workspace",
  "workspace.update": "Cập nhật workspace",
  "workspace.archive": "Lưu trữ workspace",
  "workspace.reopen": "Mở lại workspace",
  "workspace.manager": "Chỉ định quản lý workspace",
  "workspace_request.create": "Gửi yêu cầu tạo workspace",
  "workspace_request.withdraw": "Rút yêu cầu tạo workspace",
  "workspace_request.approve": "Duyệt yêu cầu tạo workspace",
  "workspace_request.reject": "Từ chối yêu cầu tạo workspace",
  "download_request.create": "Gửi yêu cầu download",
  "download_request.withdraw": "Rút yêu cầu download",
  "download_request.approved": "Duyệt yêu cầu download",
  "download_request.rejected": "Từ chối yêu cầu download",
  "user.role": "Đổi vai trò",
  "user.disable": "Vô hiệu hoá tài khoản",
  "user.enable": "Kích hoạt lại tài khoản",
  "user.first_sign_in": "Đăng nhập lần đầu",
  "user.refresh": "Làm mới thông tin danh bạ",
  "directory.sync": "Đồng bộ danh bạ",
  "workspace_type.create": "Thêm loại workspace",
};
const OTHER_ACTION = "Thay đổi khác";

function str(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

/** workspace.update covers archive, reopen and a plain edit; tell them apart by the new status. */
function actionKey(r: AuditRow): string {
  if (r.action === "workspace.update") {
    if (r.detail.status === "archived") return "workspace.archive";
    if (r.detail.status === "active") return "workspace.reopen";
  }
  return r.action;
}

function roleLabel(v: unknown, tr: Tr): string {
  const label = GLOBAL_ROLE_LABEL[str(v) as GlobalRole];
  return label ? tr(label) : str(v);
}

/** A name with the email underneath when the stored value is a person. */
function Person({ name, email }: { name?: string | null; email: string }) {
  if (!name) return <span>{email}</span>;
  return (
    <>
      <span className="block">{name}</span>
      <span className="block text-xs text-muted-foreground">{email}</span>
    </>
  );
}

/** What the event acted on, by name; never a raw document id. */
function Target({ r, tr }: { r: AuditRow; tr: Tr }) {
  // The person acted on their own membership: the actor column already says who.
  if (!r.target || r.target === r.actor) return <Dash />;
  if (r.target.includes("@")) return <Person name={r.targetName} email={r.target} />;
  const name = r.targetName || str(r.detail.name) || str(r.detail.paperRef);
  return <span>{name || tr("(không còn tồn tại)")}</span>;
}

function detailText(r: AuditRow, tr: Tr): ReactNode {
  const d = r.detail;
  switch (r.action) {
    case "user.role":
      return `${roleLabel(d.from, tr)} → ${roleLabel(d.to, tr)}`;
    case "workspace.create":
      return str(d.type) && tr("Loại: {type}", { type: str(d.type) });
    case "workspace.update":
      return str(d.name) && tr("Tên mới: {name}", { name: str(d.name) });
    case "directory.sync":
      return tr("{count} tài khoản", { count: str(d.listed) });
  }
  const note = str(d.note);
  return note && `“${note}”`;
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

export function AuditTable({ rows }: { rows: AuditRow[] | null }) {
  const tr = useTr();
  if (!rows) return <Loading />;
  return (
    <ScrollList>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-36">{tr("Lúc")}</TableHead>
            <TableHead>{tr("Người thực hiện")}</TableHead>
            <TableHead>{tr("Hành động")}</TableHead>
            <TableHead>{tr("Đối tượng")}</TableHead>
            <TableHead>{tr("Chi tiết")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && <EmptyRow colSpan={5}>{tr("Chưa có nhật ký.")}</EmptyRow>}
          {rows.map((r, i) => {
            const detail = detailText(r, tr);
            return (
              <TableRow key={r.id ?? `${r.at}-${i}`}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                  {fmtShort(r.at)}
                </TableCell>
                <TableCell className="text-[13px]">
                  <Person name={r.actorName} email={r.actor} />
                </TableCell>
                <TableCell className="text-[13px]">
                  {tr(ACTION_LABEL[actionKey(r)] ?? OTHER_ACTION)}
                </TableCell>
                <TableCell className="text-[13px]">
                  <Target r={r} tr={tr} />
                </TableCell>
                <TableCell className="max-w-72 whitespace-normal text-[13px] text-muted-foreground">
                  {detail || <Dash />}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollList>
  );
}
