export type GlobalRole = "admin" | "workspace_manager" | "member";
export type WorkspaceRole = "manager" | "member";
export type MembershipStatus = "pending" | "approved" | "rejected" | "revoked";

export interface WorkspaceRequest {
  id: string;
  requester?: string;
  requesterName?: string;
  department?: string | null;
  role?: GlobalRole;
  name: string;
  type: string;
  description: string;
  reason: string;
  status: string;
  requestedAt: string;
  decisionNote: string;
  workspaceId?: string;
}
export interface DownloadRequest {
  id: string;
  workspaceId: string;
  requester: string;
  requesterName: string;
  paperRef: string;
  note: string;
  status: string;
  requestedAt: string;
  decisionNote: string;
}
export interface AdminUser {
  email: string;
  name: string;
  department: string | null;
  directoryStatus: string;
  role: GlobalRole;
  disabled: boolean;
  disabledAt: string | null;
  disabledBy: string | null;
  lastSeen: string | null;
  syncedAt: string | null;
  workspaces: { name: string; role: string; status: string }[];
}

export interface Me {
  user: {
    email: string;
    name: string;
    photoUrl: string | null;
    department: string | null;
    isAdmin: boolean;
    role: GlobalRole;
    disabled: boolean;
    directoryStatus: string;
  };
  memberships: {
    id: string;
    workspace: {
      id: string;
      name: string;
      type: string;
      status: string;
    };
    role: WorkspaceRole;
    status: MembershipStatus;
    requestedAt: string;
    decidedAt: string | null;
    decisionNote: string;
    canManage: boolean;
  }[];
  workspaceRequest: WorkspaceRequest | null;
}
export interface WorkspaceSummary {
  id: string;
  name: string;
  type: string;
  description: string;
  memberCount: number;
  managers: string[];
  myStatus: MembershipStatus | null;
  myRole: WorkspaceRole | null;
}
export interface WorkspaceInfo {
  workspace: {
    id: string;
    name: string;
    type: string;
    description: string;
    status: string;
  };
  role: WorkspaceRole | null;
  canManage: boolean;
}
/** GET /workspaces/{id}: the workspace plus what the caller may do in it. */
export interface WorkspaceView {
  id: string;
  name: string;
  type: string;
  description: string;
  status: string;
  managers: string[];
  myRole?: WorkspaceRole;
  canManage: boolean;
}

export function toWorkspaceInfo(v: WorkspaceView): WorkspaceInfo {
  return {
    workspace: {
      id: v.id,
      name: v.name,
      type: v.type,
      description: v.description,
      status: v.status,
    },
    role: v.myRole ?? null,
    canManage: v.canManage,
  };
}

export interface MemberRow {
  id: string;
  email: string;
  name: string;
  department: string | null;
  directoryStatus: string;
  role: WorkspaceRole;
  status: MembershipStatus;
  note: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string;
}
export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  workspaceId: string | null;
  detail: Record<string, unknown>;
  /** Display names resolved by the API; null when the person or object no longer exists. */
  actorName?: string | null;
  targetName?: string | null;
}
export interface Person {
  email: string;
  name: string;
  department: string | null;
  photoUrl: string | null;
  role: WorkspaceRole;
}
export const GLOBAL_ROLE_LABEL: Record<GlobalRole, string> = {
  admin: "Quản trị viên",
  workspace_manager: "Quản lý workspace",
  member: "Thành viên",
};
export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  member: "Thành viên",
  manager: "Quản lý",
};
export const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  revoked: "Đã thu hồi",
  withdrawn: "Đã rút",
  active: "Đang hoạt động",
  suspended: "Bị đình chỉ",
  missing: "Không có trong danh bạ",
  unknown: "Chưa kiểm tra",
};
