import { createContext, useContext, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { ErrorBox, Loading } from "./components/ui";
import { useQuery } from "./lib/api";
import { useAuth } from "./lib/auth";
import type { Me, WorkspaceInfo } from "./lib/types";
import { AdminPage } from "./pages/Admin";
import { LoginPage } from "./pages/Login";
import { MembersPage } from "./pages/Members";
import { OnboardingPage } from "./pages/Onboarding";
import { WorkspaceHomePage } from "./pages/WorkspaceHome";

// ---- current user ----------------------------------------------------------------------
const MeContext = createContext<{ me: Me; reload(): void } | null>(null);
export const useMe = () => {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe outside MeProvider");
  return ctx;
};

function RequireSession({ children }: { children: ReactNode }) {
  const { session, ready, signOut } = useAuth();
  const location = useLocation();
  const q = useQuery<Me>(session ? "/me" : null);
  if (!ready) return <Loading />;
  // Remember where the user was going so SSO brings them back to the same page.
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
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
  return <MeContext.Provider value={{ me: q.data, reload: q.reload }}>{children}</MeContext.Provider>;
}

/** Members must belong to an approved workspace; otherwise they land on onboarding. */
function Home() {
  const { me } = useMe();
  const first = me.memberships.find((m) => m.status === "approved" && m.workspace.status === "active");
  if (first) return <Navigate to={`/w/${first.workspace.id}`} replace />;
  if (me.user.isAdmin) return <Navigate to="/admin" replace />;
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
        <NavLink to="/onboarding">Tham gia workspace</NavLink>
        {me.user.isAdmin && <NavLink to="/admin">Quản trị</NavLink>}
        <div className="sidebar-foot">
          <div className="who small">{me.user.name || me.user.email}</div>
          <div className="muted small">{me.user.email}</div>
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
  const canManage = me.user.isAdmin || m?.permissions.includes("members.manage");
  return (
    <>
      <div className="nav-group">Workspace</div>
      <NavLink to={`/w/${wid}`} end>Tổng quan</NavLink>
      {canManage && <NavLink to={`/w/${wid}/members`}>Thành viên & quyền</NavLink>}
    </>
  );
}

// ---- workspace context ------------------------------------------------------------------
const WsContext = createContext<{ info: WorkspaceInfo; reload(): void } | null>(null);
export const useWorkspace = () => {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWorkspace outside workspace route");
  return ctx;
};

function WorkspaceRoute() {
  const { wid } = useParams();
  const q = useQuery<WorkspaceInfo>(`/w/${wid}`);
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data || q.data.workspace.id !== wid) return <Loading />;
  return (
    <WsContext.Provider value={{ info: q.data, reload: q.reload }}>
      <Outlet />
    </WsContext.Provider>
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
