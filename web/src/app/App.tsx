import type { ReactNode } from "react";
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  matchPath,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Check,
  ChevronsUpDown,
  FileDown,
  LayoutList,
  LogOut,
  Plus,
  Shield,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminPage } from "../features/admin/Admin";
import { LoginPage } from "../features/auth/Login";
import { AUTH_MODE, useAuth } from "../features/auth/auth";
import { DevAccountMenu } from "../features/auth/DevAccounts";
import { EntryPage } from "../features/entry/EntryPage";
import { CreateWorkspacePage } from "../features/workspaces/CreateWorkspace";
import { DownloadsPage } from "../features/workspaces/Downloads";
import { MembersPage } from "../features/workspaces/Members";
import { OnboardingPage } from "../features/workspaces/Onboarding";
import { WorkspaceHomePage } from "../features/workspaces/WorkspaceHome";
import { HyperSpaceMark } from "../shared/components/Brand";
import { ErrorBox, Loading } from "../shared/components/ui";
import { useQuery } from "../shared/lib/api";
import type { Me, WorkspaceInfo } from "../shared/lib/types";
import { GLOBAL_ROLE_LABEL } from "../shared/lib/types";
import { MeContext, WorkspaceContext, useMe } from "./contexts";

function FullPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function RequireSession({ children }: { children: ReactNode }) {
  const { session, ready, signOut } = useAuth();
  const location = useLocation();
  const q = useQuery<Me>(session ? "/me" : null);
  if (!ready)
    return (
      <FullPage>
        <Loading />
      </FullPage>
    );
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
      <FullPage>
        <HyperSpaceMark className="mb-4 size-8" />
        <h1 className="text-lg font-semibold">Không vào được</h1>
        <ErrorBox error={q.error} />
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          Đăng xuất
        </Button>
      </FullPage>
    );
  }
  if (!q.data)
    return (
      <FullPage>
        <Loading />
      </FullPage>
    );
  return (
    <MeContext.Provider value={{ value: q.data, reload: q.reload }}>
      {children}
    </MeContext.Provider>
  );
}

/** Logged-out visitors on "/" see the product entry page; everything else needs a session. */
function AppGate() {
  const { session, ready } = useAuth();
  const { pathname } = useLocation();
  if (ready && !session && pathname === "/") return <EntryPage />;
  return (
    <RequireSession>
      <Shell />
    </RequireSession>
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
  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  end,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
}) {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = !!matchPath({ path: to, end: end ?? false }, pathname);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
        <NavLink
          to={to}
          end={end}
          onClick={() => isMobile && setOpenMobile(false)}
          className="text-[13px] text-sidebar-foreground! no-underline! hover:text-sidebar-accent-foreground!"
        >
          <Icon className="text-muted-foreground" />
          <span>{label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AppSidebar() {
  const { me } = useMe();
  const { wid } = useParams();
  const canManageCurrent =
    !!wid &&
    (me.user.isAdmin ||
      !!me.memberships.find((m) => m.workspace.id === wid)?.canManage);
  return (
    <Sidebar>
      <SidebarHeader className="gap-3 border-b px-3 py-3">
        <div className="flex items-center gap-2 px-1">
          <HyperSpaceMark />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight text-foreground">
              HyperSpace
            </div>
            <div className="text-[11px] text-muted-foreground">
              HyperData Lab
            </div>
          </div>
        </div>
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent className="gap-0 py-2">
        {wid && (
          <SidebarGroup className="py-1">
            <SidebarGroupLabel className="h-7 text-[11px]">
              Workspace
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavItem
                  to={`/w/${wid}`}
                  end
                  icon={LayoutList}
                  label="Tổng quan"
                />
                <NavItem
                  to={`/w/${wid}/downloads`}
                  icon={FileDown}
                  label="Yêu cầu download"
                />
                {canManageCurrent && (
                  <NavItem
                    to={`/w/${wid}/members`}
                    icon={Users}
                    label="Quản lý workspace"
                  />
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="h-7 text-[11px]">Chung</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem
                to="/onboarding"
                icon={UserPlus}
                label={
                  me.user.role === "member"
                    ? "Tham gia / xin tạo workspace"
                    : "Tham gia workspace"
                }
              />
              {me.user.role !== "member" && (
                <NavItem
                  to="/create-workspace"
                  icon={Plus}
                  label="Tạo workspace"
                />
              )}
              {me.user.isAdmin && (
                <NavItem to="/admin" icon={Shield} label="Quản trị" />
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-2">
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}

function WorkspaceSwitcher() {
  const { me } = useMe();
  const { wid } = useParams();
  const navigate = useNavigate();
  const approved = me.memberships.filter((m) => m.status === "approved");
  const current = approved.find((m) => m.workspace.id === wid);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-full justify-between px-2.5 font-normal"
          aria-label="Chọn workspace"
        >
          <span className="min-w-0 text-left leading-tight">
            <span className="block truncate text-[13px] font-medium">
              {current?.workspace.name ?? "Chọn workspace"}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {current && (
              <span className="text-[11px] text-muted-foreground">
                {current.workspace.type}
              </span>
            )}
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Workspace của tôi
        </DropdownMenuLabel>
        {approved.length === 0 && (
          <DropdownMenuItem disabled>Chưa có workspace</DropdownMenuItem>
        )}
        {approved.map((m) => (
          <DropdownMenuItem
            key={m.workspace.id}
            onSelect={() => navigate(`/w/${m.workspace.id}`)}
            className="justify-between"
          >
            <span className="truncate">{m.workspace.name}</span>
            {m.workspace.id === wid ? (
              <Check className="size-4" />
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {m.workspace.type}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initials(name: string, email: string) {
  const source = name.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  return (
    parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2)
  ).toUpperCase();
}

function UserMenu() {
  const { me } = useMe();
  const { signOut } = useAuth();
  const { user } = me;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="h-11 gap-2.5 px-2">
          <Avatar className="size-7 rounded-md">
            {user.photoUrl && <AvatarImage src={user.photoUrl} alt="" />}
            <AvatarFallback className="rounded-md bg-accent text-[11px] font-semibold text-accent-foreground">
              {initials(user.name, user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-[13px] font-medium text-foreground">
              {user.name || user.email}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {GLOBAL_ROLE_LABEL[user.role]}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="grid font-normal">
          <span className="truncate text-[13px] font-medium">
            {user.name || user.email}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {AUTH_MODE === "dev" && (
          <>
            <DevAccountMenu current={user.email} />
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut />
          Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceRoute() {
  const { wid } = useParams();
  const q = useQuery<WorkspaceInfo>(`/w/${wid}`);
  if (q.error)
    return (
      <div className="p-8">
        <ErrorBox error={q.error} />
      </div>
    );
  if (!q.data || q.data.workspace.id !== wid)
    return (
      <div className="p-8">
        <Loading />
      </div>
    );
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
      <Route path="/welcome" element={<EntryPage />} />
      <Route element={<AppGate />}>
        <Route index element={<Home />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="create-workspace" element={<CreateWorkspacePage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="w/:wid" element={<WorkspaceRoute />}>
          <Route index element={<WorkspaceHomePage />} />
          <Route path="downloads" element={<DownloadsPage />} />
          <Route path="members" element={<MembersPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
