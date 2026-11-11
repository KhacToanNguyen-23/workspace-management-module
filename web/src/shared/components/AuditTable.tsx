import type { AuditRow } from "../lib/types";
import { fmtDate, Loading } from "./ui";

export function AuditTable({ rows }: { rows: AuditRow[] | null }) {
  if (!rows) return <Loading />;
  return (
    <table className="compact">
      <thead>
        <tr>
          <th>Lúc</th>
          <th>Ai</th>
          <th>Hành động</th>
          <th>Đối tượng</th>
          <th>Chi tiết</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="small">{fmtDate(r.at)}</td>
            <td className="small">{r.actor}</td>
            <td>
              <code>{r.action}</code>
            </td>
            <td className="small">{r.target}</td>
            <td className="small muted">{JSON.stringify(r.detail)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
