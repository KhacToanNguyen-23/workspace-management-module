import { useState, type ReactNode } from "react";
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
  ChevronLeft,
  ChevronsUpDown,
  FileDown,
  FolderKanban,
  Layers,
  LayoutList,
  LogOut,
  Shield,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminPage } from "../features/admin/Admin";
import { LoginPage } from "../features/auth/Login";
import { SsoCallbackPage } from "../features/auth/SsoCallback";
import { isSsoReturn } from "../features/auth/sso";
import { AUTH_MODE, useAuth } from "../features/auth/auth";
import { DevAccountMenu } from "../features/auth/DevAccounts";
import { EntryPage } from "../features/entry/EntryPage";
import { ProjectDetailPage, ProjectsPage } from "../features/projects/Projects";
import { DownloadsPage } from "../features/workspaces/Downloads";
import { MembersPage } from "../features/workspaces/Members";
import { OnboardingPage } from "../features/workspaces/Onboarding";
import { WorkspaceHomePage } from "../features/workspaces/WorkspaceHome";
import { HyperSpaceMark } from "../shared/components/Brand";
import { ErrorBox, Loading } from "../shared/components/ui";
import { useQuery } from "../shared/lib/api";
import { useCount } from "../shared/lib/pending";
import type { Me, WorkspaceView } from "../shared/lib/types";
import { toWorkspaceInfo } from "../shared/lib/types";
import { GLOBAL_ROLE_LABEL } from "../shared/lib/types";
import { MeContext, WorkspaceContext, useMe } from "./contexts";
import { useTr } from "../features/entry/i18n";

function FullPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function RequireSession({ children }: { children: ReactNode }) {
  const tr = useTr();
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
        <h1 className="text-lg font-semibold">{tr("Không vào được")}</h1>
        <ErrorBox error={q.error} />
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          {tr("Đăng xuất")}
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
    return <Navigate to="/onboarding" replace />;
  return <Navigate to="/onboarding" replace />;
}

/** The shadcn sidebar keeps its state in a cookie; read it so a reload keeps the same width. */
function readSidebarOpen() {
  try {
    return !/(?:^|; )sidebar_state=false/.test(document.cookie);
  } catch {
    return true;
  }
}

// ---- shell -----------------------------------------------------------------------------
function Shell() {
  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider defaultOpen={readSidebarOpen()}>
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
  count = 0,
  countLabel,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  /** Items waiting for this user's decision; shown as a badge when above zero. */
  count?: number;
  /** Accessible wording for the count, e.g. "3 chờ duyệt". */
  countLabel?: string;
}) {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = !!matchPath({ path: to, end: end ?? false }, pathname);
  const shown = count > 99 ? "99+" : String(count);
  const fullLabel = count > 0 && countLabel ? `${label} (${countLabel})` : label;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={fullLabel}
        className={cn(
          "data-[active=true]:bg-(--sidebar-active)",
          count > 0 && "pr-10",
        )}
      >
        <NavLink
          to={to}
          end={end}
          aria-label={fullLabel}
          onClick={() => isMobile && setOpenMobile(false)}
          className="relative text-[13px] text-sidebar-foreground"
        >
          <Icon className="text-sidebar-foreground/60 [[data-active=true]_&]:text-sky-300" />
          <span>{label}</span>
          {count > 0 && (
            // Collapsed sidebar: the number badge is hidden, so mark the icon with a dot.
            <span
              aria-hidden
              className="absolute top-1.5 left-5 hidden size-2 rounded-full bg-amber-400 ring-2 ring-sidebar group-data-[collapsible=icon]:block"
            />
          )}
        </NavLink>
      </SidebarMenuButton>
      {count > 0 && (
        <SidebarMenuBadge
          aria-hidden
          className="rounded-full bg-amber-400 font-semibold text-[#0f2339] peer-hover/menu-button:text-[#0f2339] peer-data-[active=true]/menu-button:text-[#0f2339]"
        >
          {shown}
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}

/**
 * Round button that straddles the sidebar's right edge, halfway down where no sidebar content sits
 * in either width. Hidden on phones, where the sidebar is a drawer.
 */
function SidebarEdgeToggle() {
  const tr = useTr();
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const label = collapsed ? tr("Mở rộng thanh bên") : tr("Thu gọn thanh bên");
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={label}
      title={`${label} (Ctrl+B)`}
      className="absolute top-1/2 -right-3 z-30 -translate-y-1/2 hidden size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:flex"
    >
      <ChevronLeft
        aria-hidden
        className={cn(
          "size-3.5 transition-transform duration-200",
          collapsed && "rotate-180",
        )}
      />
    </button>
  );
}

function AppSidebar() {
  const tr = useTr();
  const { me } = useMe();
  const { wid } = useParams();
  const canManageCurrent =
    !!wid &&
    (me.user.isAdmin ||
      !!me.memberships.find((m) => m.workspace.id === wid)?.canManage);
  // Requests waiting for a decision by this user. A member's own pending requests are not counted:
  // there is nothing for them to act on.
  const joinRequests = useCount(
    canManageCurrent ? `/workspaces/${wid}/members?status=pending` : null,
  );
  const downloadRequests = useCount(
    canManageCurrent ? `/workspaces/${wid}/download-requests?status=pending` : null,
  );
  const workspaceRequests = useCount(
    me.user.isAdmin ? "/workspace-requests?status=pending" : null,
  );
  const waiting = (n: number) => tr("{count} chờ duyệt", { count: n });
  return (
    <Sidebar
      collapsible="icon"
      className="border-transparent [&_[data-slot=sidebar-inner]]:bg-background"
    >
      <SidebarHeader className="h-14 shrink-0 justify-center gap-0 border-b border-border bg-background px-2 py-0">
        <div className="flex items-center group-data-[collapsible=icon]:justify-center">
          <div className="flex min-w-0 items-center gap-2.5 px-1 group-data-[collapsible=icon]:px-0">
            <HyperSpaceMark className="size-9 shrink-0 group-data-[collapsible=icon]:size-8" />
            <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
              <div className="truncate text-[17px] font-semibold tracking-tight text-foreground">
                HyperSpace
              </div>
              <div className="truncate text-xs text-muted-foreground">
                HyperData Lab
              </div>
            </div>
          </div>
        </div>
      </SidebarHeader>
      <div className="flex min-h-0 flex-1 flex-col rounded-tr-[32px] bg-sidebar">
      <SidebarContent className="gap-0 overflow-x-hidden pt-8 pb-2">
        <SidebarGroup className="pt-0 pb-3">
          <WorkspaceSwitcher />
        </SidebarGroup>
        {wid && (
          <SidebarGroup className="py-1">
            <SidebarGroupLabel className="h-7 text-[11px] text-sidebar-foreground/50">
              Workspace
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavItem
                  to={`/w/${wid}`}
                  end
                  icon={LayoutList}
                  label={tr("Tổng quan")}
                />
                <NavItem
                  to={`/w/${wid}/downloads`}
                  icon={FileDown}
                  label={tr("Yêu cầu download")}
                  count={downloadRequests}
                  countLabel={waiting(downloadRequests)}
                />
                {canManageCurrent && (
                  <NavItem
                    to={`/w/${wid}/members`}
                    icon={Users}
                    label={tr("Quản lý workspace")}
                    count={joinRequests}
                    countLabel={waiting(joinRequests)}
                  />
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="h-7 text-[11px] text-sidebar-foreground/50">
            {tr("Chung")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem to="/projects" icon={FolderKanban} label={tr("Dự án")} />
              <NavItem to="/onboarding" icon={UserPlus} label={tr("Tất cả workspace")} />
              {me.user.isAdmin && (
                <NavItem
                  to="/admin"
                  icon={Shield}
                  label={tr("Quản trị")}
                  count={workspaceRequests}
                  countLabel={waiting(workspaceRequests)}
                />
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <UserMenu />
      </SidebarFooter>
      </div>
      <SidebarEdgeToggle />
    </Sidebar>
  );
}

function WorkspaceSwitcher() {
  const tr = useTr();
  const { me } = useMe();
  const { wid } = useParams();
  const navigate = useNavigate();
  const approved = me.memberships.filter((m) => m.status === "approved");
  const current = approved.find((m) => m.workspace.id === wid);
  const name = current?.workspace.name ?? tr("Chọn workspace");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label={tr("Chọn workspace (đang chọn: {name})", { name })}
          className="h-9 w-full justify-between border border-sidebar-border bg-sidebar-accent/50 px-2.5 font-normal text-sidebar-foreground hover:bg-sidebar-accent hover:text-white group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
        >
          <span className="min-w-0 truncate text-[13px] font-medium group-data-[collapsible=icon]:hidden">
            {name}
          </span>
          <span
            aria-hidden
            className="hidden text-xs font-semibold group-data-[collapsible=icon]:block"
          >
            {current ? name.slice(0, 1).toUpperCase() : <Layers className="size-4" />}
          </span>
          <span className="flex items-center gap-1.5 group-data-[collapsible=icon]:hidden">
            {current && (
              <span className="text-[11px] text-sidebar-foreground/60">
                {current.workspace.type}
              </span>
            )}
            <ChevronsUpDown className="size-3.5 text-sidebar-foreground/60" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {tr("Workspace của tôi")}
        </DropdownMenuLabel>
        {approved.length === 0 && (
          <DropdownMenuItem disabled>{tr("Chưa có workspace")}</DropdownMenuItem>
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
  const tr = useTr();
  const { me } = useMe();
  const { signOut } = useAuth();
  const { user } = me;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          tooltip={user.name || user.email}
          className="gap-2.5 px-2 data-[state=open]:bg-sidebar-accent"
        >
          <Avatar className="size-7 shrink-0 rounded-md">
            {user.photoUrl && <AvatarImage src={user.photoUrl} alt="" />}
            <AvatarFallback className="rounded-md bg-sidebar-active text-[11px] font-semibold text-white">
              {initials(user.name, user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-[13px] font-medium text-white">
              {user.name || user.email}
            </span>
            <span className="truncate text-[11px] text-sidebar-foreground/60">
              {tr(GLOBAL_ROLE_LABEL[user.role])}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 text-sidebar-foreground/60" />
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
          {tr("Đăng xuất")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceRoute() {
  const { wid } = useParams();
  const q = useQuery<WorkspaceView>(`/workspaces/${wid}`);
  if (q.error)
    return (
      <div className="p-8">
        <ErrorBox error={q.error} />
      </div>
    );
  if (!q.data || q.data.id !== wid)
    return (
      <div className="p-8">
        <Loading />
      </div>
    );
  return (
    <WorkspaceContext.Provider
      value={{ value: toWorkspaceInfo(q.data), reload: q.reload }}
    >
      <Outlet />
    </WorkspaceContext.Provider>
  );
}

export function App() {
  // The SSO may return to any registered URL of the app (even "/"), so the sign-in is finished
  // wherever its ?code&state arrive. The query is captured once: completing the sign-in removes
  // the pending attempt, and this must keep rendering until the navigation that follows.
  const [ssoReturn] = useState(() =>
    AUTH_MODE === "sso" && isSsoReturn(window.location.search)
      ? window.location.search
      : null,
  );
  const { search } = useLocation();
  if (ssoReturn !== null && search === ssoReturn)
    return <SsoCallbackPage search={ssoReturn} />;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/welcome" element={<EntryPage />} />
      <Route element={<AppGate />}>
        <Route index element={<Home />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="create-workspace" element={<Navigate to="/onboarding" replace />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:pid" element={<ProjectDetailPage />} />
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
