export type Permission = "workspace.read" | "workspace.write" | "workspace.review" | "members.manage";

export type WorkspaceRole = "viewer" | "member" | "manager";
export type MembershipStatus = "pending" | "approved" | "rejected" | "revoked";

export interface Me {
  user: {
    email: string;
    name: string;
    photoUrl: string | null;
    department: string | null;
    isAdmin: boolean;
    directoryStatus: string;
  };
  memberships: {
    id: string;
    workspace: { id: string; name: string; slug: string; type: string; status: string };
    role: WorkspaceRole;
    status: MembershipStatus;
    requestedAt: string;
    decidedAt: string | null;
    decisionNote: string;
    permissions: Permission[];
  }[];
}

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  type: string;
  description: string;
  memberCount: number;
  managers: string[];
  myStatus: MembershipStatus | null;
  myRole: WorkspaceRole | null;
}

export interface WorkspaceInfo {
  workspace: { id: string; name: string; slug: string; type: string; description: string; status: string };
  role: WorkspaceRole | null;
  enabledPermissions: Permission[];
  permissions: Permission[];
  toggleablePermissions: Permission[];
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
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string;
  workspaceId: string | null;
  detail: Record<string, unknown>;
}

export interface Person {
  email: string;
  name: string;
  department: string | null;
  photoUrl: string | null;
  role: WorkspaceRole;
}

export const PERMISSION_LABEL: Record<Permission, string> = {
  "workspace.read": "Xem nội dung",
  "workspace.write": "Tạo / sửa nội dung",
  "workspace.review": "Duyệt nội dung",
  "members.manage": "Quản lý thành viên",
};

export const ROLE_LABEL: Record<WorkspaceRole, string> = { viewer: "Người xem", member: "Thành viên", manager: "Quản lý" };

export const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  revoked: "Đã thu hồi",
  active: "Đang hoạt động",
  suspended: "Bị đình chỉ",
  missing: "Không có trong danh bạ",
  unknown: "Chưa kiểm tra",
};
