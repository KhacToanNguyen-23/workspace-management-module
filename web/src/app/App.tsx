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
  ChevronLeft,
  ChevronsUpDown,
  FileDown,
  Layers,
  LayoutList,
  LogOut,
  Plus,
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
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={label}
        className="data-[active=true]:bg-(--sidebar-active)"
      >
        <NavLink
          to={to}
          end={end}
          onClick={() => isMobile && setOpenMobile(false)}
          className="text-[13px] text-sidebar-foreground"
        >
          <Icon className="text-sidebar-foreground/60 [[data-active=true]_&]:text-sky-300" />
          <span>{label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Round button that straddles the sidebar's right edge, halfway down where no sidebar content sits
 * in either width. Hidden on phones, where the sidebar is a drawer.
 */
function SidebarEdgeToggle() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const label = collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên";
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
  const { me } = useMe();
  const { wid } = useParams();
  const canManageCurrent =
    !!wid &&
    (me.user.isAdmin ||
      !!me.memberships.find((m) => m.workspace.id === wid)?.canManage);
  return (
    <Sidebar collapsible="icon" className="border-transparent">
      <SidebarHeader className="h-14 shrink-0 justify-center gap-0 border-b border-border bg-background px-2 py-0">
        <div className="flex items-center group-data-[collapsible=icon]:justify-center">
          <div className="flex min-w-0 items-center gap-2.5 px-1 group-data-[collapsible=icon]:px-0">
            <HyperSpaceMark className="size-7 shrink-0" />
            <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-semibold tracking-tight text-foreground">
                HyperSpace
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                HyperData Lab
              </div>
            </div>
          </div>
        </div>
      </SidebarHeader>
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
          <SidebarGroupLabel className="h-7 text-[11px] text-sidebar-foreground/50">
            Chung
          </SidebarGroupLabel>
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
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <UserMenu />
      </SidebarFooter>
      <SidebarEdgeToggle />
    </Sidebar>
  );
}

function WorkspaceSwitcher() {
  const { me } = useMe();
  const { wid } = useParams();
  const navigate = useNavigate();
  const approved = me.memberships.filter((m) => m.status === "approved");
  const current = approved.find((m) => m.workspace.id === wid);
  const name = current?.workspace.name ?? "Chọn workspace";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label={`Chọn workspace (đang chọn: ${name})`}
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
              {GLOBAL_ROLE_LABEL[user.role]}
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
