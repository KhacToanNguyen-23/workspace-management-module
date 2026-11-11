export type Permission =
  | "corpus.read"
  | "corpus.write"
  | "corpus.fetch"
  | "corpus.download"
  | "extraction.run"
  | "members.manage";

export type WorkspaceRole = "viewer" | "member" | "manager";
export type MembershipStatus = "pending" | "approved" | "rejected" | "revoked";

export interface Me {
  user: {
    email: string;
    name: string;
    photoUrl: string | null;
    orgUnit: string | null;
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

export interface Corpus {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
  total: number;
  fetched: number;
  downloaded: number;
  extracted: number;
  failed: number;
  sentences: number;
}

export type DocStatus = "fetched" | "downloaded" | "download_failed" | "extracted" | "extract_failed";

export interface DocumentRow {
  id: string;
  source: string;
  externalId: string;
  doi: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  license: string | null;
  isOa: boolean;
  oaUrl: string | null;
  status: DocStatus;
  error: string | null;
  contentType: string | null;
  contentBytes: number | null;
  sentenceCount: number;
  fetchedAt: string;
}

export interface FetchedRecord {
  source: string;
  externalId: string;
  doi: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  license: string | null;
  isOa: boolean;
  oaUrl: string | null;
  inCorpus: boolean;
}

export interface MemberRow {
  id: string;
  email: string;
  name: string;
  orgUnit: string | null;
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
  workspace_id: string | null;
  detail: Record<string, unknown>;
}

export const PERMISSION_LABEL: Record<Permission, string> = {
  "corpus.read": "Xem corpus",
  "corpus.write": "Tạo/xoá corpus",
  "corpus.fetch": "Fetch metadata",
  "corpus.download": "Tải file (downloader)",
  "extraction.run": "Chạy extraction",
  "members.manage": "Quản lý thành viên",
};

export const ROLE_LABEL: Record<WorkspaceRole, string> = { viewer: "Người xem", member: "Thành viên", manager: "Quản lý" };

export const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  revoked: "Đã thu hồi",
  fetched: "Đã fetch",
  downloaded: "Đã tải",
  download_failed: "Tải lỗi",
  extracted: "Đã trích",
  extract_failed: "Trích lỗi",
};
