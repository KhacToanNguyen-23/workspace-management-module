import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, UserPlus } from "lucide-react";
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
  EmptyRow,
  ErrorBox,
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
import { ApiError, useApi, useQuery } from "../../shared/lib/api";
import { AUTH_MODE, ORG_DOMAIN, useAuth } from "../auth/auth";

export interface Project {
  id: string;
  title: string | null;
  description: string | null;
  researchArea: string | null;
  ownerUid: string | null;
  /** Only when the list holds the user's own projects. */
  myRole?: string | null;
  joinedAt?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ProjectList {
  mode: "http" | "demo" | "off";
  /** true: every project of the lab; false: only the user's own (ResearchPulse API). */
  listsAll: boolean;
  canManageMembers: boolean;
  items: Project[];
}

interface ProjectMember {
  /** Absent from ResearchPulse's answer today. */
  uid?: string;
  /** Only sent to admins. */
  email?: string | null;
  name: string | null;
  role: string | null;
  status: string | null;
}

interface ProjectDetail extends Project {
  members: ProjectMember[];
  canManageMembers: boolean;
}

/**
 * Turns "your SSO token expired" and "ResearchPulse has not enabled projects yet" into a sentence
 * and a sign-in button; other errors show as usual.
 */
function ProjectsError({ error }: { error: unknown }) {
  const { signInSso } = useAuth();
  const { pathname } = useLocation();
  if (!(error instanceof ApiError)) return <ErrorBox error={error} />;
  if (error.code === "sso_token_expired" || error.code === "scope_not_granted")
    return (
      <div className="mb-4 grid max-w-xl gap-3 text-[13px]">
        <p className="text-muted-foreground">{error.message}</p>
        {AUTH_MODE === "sso" && (
          <div>
            <Button size="sm" onClick={() => void signInSso(pathname)}>
              Đăng nhập lại
            </Button>
          </div>
        )}
      </div>
    );
  return <ErrorBox error={error} />;
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Chủ dự án",
  MEMBER: "Thành viên",
};
const ROLE_OPTIONS = [
  { value: "MEMBER", label: ROLE_LABEL.MEMBER },
  { value: "OWNER", label: ROLE_LABEL.OWNER },
];
const roleLabel = (r: string | null) => (r ? (ROLE_LABEL[r] ?? r) : "—");

function SampleNote({ mode }: { mode: string | undefined }) {
  if (mode !== "demo") return null;
  return (
    <p className="mb-4 text-[13px] text-muted-foreground">
      Đang hiển thị dữ liệu mẫu. Danh sách thật sẽ lấy từ ResearchPulse khi kết nối xong; thay
      đổi thành viên ở chế độ này mất khi backend khởi động lại.
    </p>
  );
}

/** The research projects (owned by ResearchPulse). */
export function ProjectsPage() {
  const q = useQuery<ProjectList>("/projects");
  const mine = q.data ? !q.data.listsAll : false;
  const [search, setSearch] = useState("");
  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = q.data?.items ?? [];
    if (!needle) return all;
    return all.filter((p) =>
      [p.title, p.description, p.researchArea].some((x) =>
        (x ?? "").toLowerCase().includes(needle),
      ),
    );
  }, [q.data, search]);

  return (
    <>
      <PageHeader title="Dự án" />
      <PageBody>
        {q.error && <ProjectsError error={q.error} />}
        {!q.data ? (
          !q.error && <Loading />
        ) : q.data.mode === "off" ? (
          <p className="text-[13px] text-muted-foreground">Phần dự án đang tắt.</p>
        ) : (
          <>
            <SampleNote mode={q.data.mode} />
            <Section
              title={mine ? "Dự án bạn tham gia" : "Dự án của lab"}
              count={items.length}
              actions={
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm theo tên, mô tả, lĩnh vực"
                  aria-label="Tìm dự án"
                  className="h-8 w-56"
                />
              }
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dự án</TableHead>
                    <TableHead className="hidden md:table-cell">Lĩnh vực</TableHead>
                    {mine && <TableHead>Vai trò</TableHead>}
                    <TableHead className="hidden sm:table-cell">Cập nhật</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 && (
                    <EmptyRow colSpan={mine ? 4 : 3}>
                      {search
                        ? "Không có dự án khớp."
                        : mine
                          ? "Bạn chưa tham gia dự án nào trên ResearchPulse."
                          : "Lab chưa có dự án nào."}
                    </EmptyRow>
                  )}
                  {items.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-[32rem] whitespace-normal">
                        <Link
                          to={`/projects/${encodeURIComponent(p.id)}`}
                          className="font-medium"
                        >
                          <Stacked
                            primary={p.title || p.id}
                            secondary={p.description || undefined}
                          />
                        </Link>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {p.researchArea ? <Tag>{p.researchArea}</Tag> : "—"}
                      </TableCell>
                      {mine && <TableCell>{roleLabel(p.myRole ?? null)}</TableCell>}
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {fmtShort(p.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          </>
        )}
      </PageBody>
    </>
  );
}

/** Admins: the form above the member list. */
function AddMemberForm({ pid, onDone }: { pid: string; onDone: () => void }) {
  const api = useApi();
  const act = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const submit = async () => {
    const r = await act.run(() =>
      api("POST", `/projects/${encodeURIComponent(pid)}/members`, {
        email: email.trim(),
        role,
      }),
    );
    if (r !== undefined) {
      setEmail("");
      setRole("MEMBER");
      onDone();
    }
  };
  return (
    <form
      className="mb-3 grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={`ten@${ORG_DOMAIN}`}
          aria-label="Email người cần thêm"
          className="h-8 w-64"
        />
        <SelectField
          value={role}
          onChange={setRole}
          options={ROLE_OPTIONS}
          aria-label="Vai trò"
          className="w-36"
        />
        <Button type="submit" size="sm" disabled={act.busy}>
          <UserPlus />
          Thêm vào dự án
        </Button>
      </div>
      <ErrorBox error={act.error} />
    </form>
  );
}

export function ProjectDetailPage() {
  const { pid = "" } = useParams();
  const api = useApi();
  const act = useAction();
  const { ask, dialog } = useAsk();
  const q = useQuery<ProjectDetail>(`/projects/${encodeURIComponent(pid)}`);
  const p = q.data;
  // Admins of this module, and only where ResearchPulse lets members be changed.
  const isAdmin = !!p?.canManageMembers;
  const base = `/projects/${encodeURIComponent(pid)}/members`;

  const changeRole = async (m: ProjectMember, role: string) => {
    if (await act.run(() => api("PATCH", `${base}/${encodeURIComponent(m.uid ?? "")}`, { role })))
      q.reload();
  };
  const remove = async (m: ProjectMember) => {
    const ok = await ask({
      title: `Xoá ${m.name || m.email || "người này"} khỏi ${p?.title ?? "dự án"}?`,
      description: "Người này sẽ không còn là thành viên dự án trên ResearchPulse.",
      confirmLabel: "Xoá khỏi dự án",
      destructive: true,
    });
    if (ok === null) return;
    // DELETE answers 204 with no body, so success is marked explicitly.
    const done = await act.run(async () => {
      await api("DELETE", `${base}/${encodeURIComponent(m.uid ?? "")}`);
      return true;
    });
    if (done) q.reload();
  };

  return (
    <>
      <PageHeader
        title={p?.title || "Dự án"}
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link to="/projects" className="no-underline!">
              <ArrowLeft />
              Tất cả dự án
            </Link>
          </Button>
        }
      />
      <PageBody className="max-w-4xl">
        {q.error && <ProjectsError error={q.error} />}
        {!p ? (
          !q.error && <Loading />
        ) : (
          <>
            {p.description && (
              <p className="mb-6 text-[14px] leading-relaxed">{p.description}</p>
            )}
            <dl className="mb-8 grid grid-cols-[8rem_1fr] gap-y-2 text-[13px]">
              <dt className="text-muted-foreground">Lĩnh vực</dt>
              <dd>{p.researchArea || "—"}</dd>
              {p.myRole && (
                <>
                  <dt className="text-muted-foreground">Vai trò của tôi</dt>
                  <dd>{roleLabel(p.myRole)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Tạo</dt>
              <dd>{fmtShort(p.createdAt)}</dd>
              <dt className="text-muted-foreground">Cập nhật</dt>
              <dd>{fmtShort(p.updatedAt)}</dd>
            </dl>
            <Section title="Thành viên" count={p.members.length}>
              <div className="pt-3">
                {isAdmin && <AddMemberForm pid={pid} onDone={q.reload} />}
                <ErrorBox error={act.error} />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Thành viên</TableHead>
                    <TableHead>Vai trò</TableHead>
                    {isAdmin && <TableHead className="w-0" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.members.length === 0 && (
                    <EmptyRow colSpan={isAdmin ? 3 : 2}>Chưa có thành viên.</EmptyRow>
                  )}
                  {p.members.map((m, i) => (
                    <TableRow key={m.uid ?? `${m.name}-${i}`}>
                      <TableCell>
                        <Stacked
                          primary={m.name || "—"}
                          secondary={isAdmin ? (m.email ?? undefined) : undefined}
                        />
                      </TableCell>
                      <TableCell>
                        {isAdmin ? (
                          <SelectField
                            value={m.role ?? "MEMBER"}
                            onChange={(role) => void changeRole(m, role)}
                            options={ROLE_OPTIONS}
                            disabled={act.busy}
                            aria-label={`Vai trò của ${m.name ?? m.uid}`}
                            className="w-36"
                          />
                        ) : (
                          roleLabel(m.role)
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={act.busy}
                            onClick={() => void remove(m)}
                          >
                            Xoá
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          </>
        )}
      </PageBody>
      {dialog}
    </>
  );
}
