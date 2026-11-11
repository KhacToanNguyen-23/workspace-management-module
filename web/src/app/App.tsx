import type { ReactNode } from "react";
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { AdminPage } from "../features/admin/Admin";
import { LoginPage } from "../features/auth/Login";
import { useAuth } from "../features/auth/auth";
import { MembersPage } from "../features/workspaces/Members";
import { OnboardingPage } from "../features/workspaces/Onboarding";
import { WorkspaceHomePage } from "../features/workspaces/WorkspaceHome";
import { CreateWorkspacePage } from "../features/workspaces/CreateWorkspace";
import { ErrorBox, Loading } from "../shared/components/ui";
import { useQuery } from "../shared/lib/api";
import type { Me, WorkspaceInfo } from "../shared/lib/types";
import { GLOBAL_ROLE_LABEL } from "../shared/lib/types";
import { MeContext, WorkspaceContext, useMe } from "./contexts";

function RequireSession({ children }: { children: ReactNode }) {
  const { session, ready, signOut } = useAuth();
  const location = useLocation();
  const q = useQuery<Me>(session ? "/me" : null);
  if (!ready) return <Loading />;
  // Remember where the user was going so SSO brings them back to the same page.
  if (!session)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  if (q.error) {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h2>Không vào được</h2>
          <ErrorBox error={q.error} />
          <button onClick={() => void signOut()}>Đăng xuất</button>
        </div>
      </div>
    );
  }
  if (!q.data) return <Loading />;
  return (
    <MeContext.Provider value={{ value: q.data, reload: q.reload }}>
      {children}
    </MeContext.Provider>
  );
}

/** Members must belong to an approved workspace; otherwise they land on onboarding. */
function Home() {
  const { me } = useMe();
  const first = me.memberships.find(
    (m) => m.status === "approved" && m.workspace.status === "active",
  );
  if (first) return <Navigate to={`/w/${first.workspace.id}`} replace />;
  if (me.user.isAdmin) return <Navigate to="/admin" replace />;
  if (me.user.role === "workspace_manager")
    return <Navigate to="/create-workspace" replace />;
  return <Navigate to="/onboarding" replace />;
}

// ---- shell -----------------------------------------------------------------------------
function Shell() {
  const { me } = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { wid } = useParams();
  const approved = me.memberships.filter((m) => m.status === "approved");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">W</span>
          <span>
            Writing Bank
            <small>HyperData Lab</small>
          </span>
        </div>
        <label className="field">
          <span>Workspace</span>
          <select
            value={wid ?? ""}
            onChange={(e) => e.target.value && navigate(`/w/${e.target.value}`)}
          >
            <option value="">— chọn —</option>
            {approved.map((m) => (
              <option key={m.workspace.id} value={m.workspace.id}>
                {m.workspace.name}
              </option>
            ))}
          </select>
        </label>
        {wid && <WorkspaceNav wid={wid} />}
        <div className="nav-group">Chung</div>
        <NavLink to="/onboarding">
          {me.user.role === "member"
            ? "Tham gia / xin tạo workspace"
            : "Tham gia workspace"}
        </NavLink>
        {me.user.role === "workspace_manager" && (
          <NavLink to="/create-workspace">Tạo workspace</NavLink>
        )}
        {me.user.isAdmin && <NavLink to="/admin">Quản trị</NavLink>}
        <div className="sidebar-foot">
          <div className="who small">{me.user.name || me.user.email}</div>
          <div className="muted small">{me.user.email}</div>
          <div className="tag">{GLOBAL_ROLE_LABEL[me.user.role]}</div>
          <button className="link" onClick={() => void signOut()}>
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

function WorkspaceNav({ wid }: { wid: string }) {
  const { me } = useMe();
  const m = me.memberships.find((x) => x.workspace.id === wid);
  const canManage = me.user.isAdmin || m?.canManage;
  return (
    <>
      <div className="nav-group">Workspace</div>
      <NavLink to={`/w/${wid}`} end>
        Tổng quan
      </NavLink>
      <NavLink to={`/w/${wid}#downloads`}>Yêu cầu download</NavLink>
      {canManage && (
        <NavLink to={`/w/${wid}/members`}>Quản lý workspace</NavLink>
      )}
    </>
  );
}

function WorkspaceRoute() {
  const { wid } = useParams();
  const q = useQuery<WorkspaceInfo>(`/w/${wid}`);
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data || q.data.workspace.id !== wid) return <Loading />;
  return (
    <WorkspaceContext.Provider value={{ value: q.data, reload: q.reload }}>
      <Outlet />
    </WorkspaceContext.Provider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireSession>
            <Shell />
          </RequireSession>
        }
      >
        <Route index element={<Home />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="create-workspace" element={<CreateWorkspacePage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="w/:wid" element={<WorkspaceRoute />}>
          <Route index element={<WorkspaceHomePage />} />
          <Route path="members" element={<MembersPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
