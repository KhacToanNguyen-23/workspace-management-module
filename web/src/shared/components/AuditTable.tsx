import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AuditRow } from "../lib/types";
import { EmptyRow, fmtShort, Loading } from "./ui";

export function AuditTable({ rows }: { rows: AuditRow[] | null }) {
  if (!rows) return <Loading />;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-40">Lúc</TableHead>
          <TableHead>Ai</TableHead>
          <TableHead>Hành động</TableHead>
          <TableHead>Đối tượng</TableHead>
          <TableHead>Chi tiết</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && <EmptyRow colSpan={5}>Chưa có nhật ký.</EmptyRow>}
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
              {fmtShort(r.at)}
            </TableCell>
            <TableCell className="text-[13px]">{r.actor}</TableCell>
            <TableCell>
              <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">
                {r.action}
              </code>
            </TableCell>
            <TableCell className="text-[13px]">{r.target}</TableCell>
            <TableCell className="max-w-80 truncate font-mono text-xs text-muted-foreground">
              {JSON.stringify(r.detail)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
