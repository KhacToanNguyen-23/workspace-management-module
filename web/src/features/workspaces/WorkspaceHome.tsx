import { Navigate, useLocation } from "react-router-dom";
import { useMe, useWorkspace } from "../../app/contexts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyRow,
  ErrorBox,
  Loading,
  PageBody,
  PageHeader,
  Section,
  Stacked,
  Tag,
} from "../../shared/components/ui";
import { useQuery } from "../../shared/lib/api";
import { ROLE_LABEL, type Person } from "../../shared/lib/types";

/** Workspace overview: identity, description and the member directory. */
export function WorkspaceHomePage() {
  const { info } = useWorkspace();
  const { me } = useMe();
  const { hash } = useLocation();
  const wid = info.workspace.id;
  const people = useQuery<Person[]>(
    `/workspaces/${wid}/members?status=approved&limit=500`,
  );

  // Old links pointed at the download section of this page; it is its own page now.
  if (hash === "#downloads") return <Navigate to="downloads" replace />;

  const myRole = info.role
    ? ROLE_LABEL[info.role]
    : me.user.isAdmin
      ? "Quản trị viên"
      : "—";

  return (
    <>
      <PageHeader
        title={info.workspace.name}
        sub={
          <span className="flex items-center gap-2">
            <Tag>{info.workspace.type}</Tag>
            <span>Vai trò: {myRole}</span>
          </span>
        }
      />
      <PageBody>
        <p className="mb-8 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          {info.workspace.description || "Không có mô tả."}
        </p>
        <Section title="Thành viên" count={people.data?.length}>
          {people.error ? (
            <ErrorBox error={people.error} />
          ) : !people.data ? (
            <Loading />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Thành viên</TableHead>
                  <TableHead>Phòng ban</TableHead>
                  <TableHead className="w-32">Vai trò</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.data.length === 0 && (
                  <EmptyRow colSpan={3}>Chưa có thành viên.</EmptyRow>
                )}
                {people.data.map((p) => (
                  <TableRow key={p.email}>
                    <TableCell>
                      <Stacked primary={p.name || p.email} secondary={p.email} />
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">
                      {p.department || "—"}
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {ROLE_LABEL[p.role]}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </PageBody>
    </>
  );
}
