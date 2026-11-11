# Plan: thiết kế lại hệ thống theo 3 role

> Plan này viết để giao cho Codex làm. Đọc hết trước khi code. Làm theo thứ tự các phase, chạy test sau mỗi phase.

## 0. Mục tiêu

Hệ thống chỉ còn **3 role toàn cục** (lưu ở `users.global_role`):

| Role | Ai | Làm được gì |
|---|---|---|
| `admin` | `admin@hyperdatalab.org` (cố định) và người được admin nâng lên | Quản lý user: xem danh sách, **cấp / gỡ role `workspace_manager`**, **disable / enable** user. Duyệt yêu cầu tạo workspace. Quản lý toàn bộ workspace, xem audit log. |
| `workspace_manager` | Member được admin cấp quyền (thường là khi member xin tạo workspace) | Quản lý workspace của mình: duyệt / từ chối yêu cầu tham gia, thêm / gỡ member, xem và duyệt / từ chối **yêu cầu download paper**. Tạo thêm workspace mới. |
| `member` | Mọi user `@hyperdatalab.org` đăng nhập lần đầu | Gửi yêu cầu tham gia workspace. Gửi **yêu cầu tạo workspace** cho admin. Trong workspace đã được duyệt: xem thành viên, **gửi yêu cầu download paper** cho manager. |

Ba luồng chính:

1. **Member xin tạo workspace** → admin duyệt → trong cùng 1 transaction: user thành `workspace_manager`, workspace được tạo, user là manager của workspace đó.
2. **Member xin vào workspace** → manager của workspace đó duyệt / từ chối (giữ logic hiện có).
3. **Member gửi yêu cầu download paper** trong workspace → manager thấy trong hàng đợi. **Không làm download thật**: chỉ cần lưu request, manager xem được và đổi status `approved` / `rejected`. Không có file, không có link tải.

Admin còn có thể: cấp `workspace_manager` trực tiếp cho member (không cần request), gỡ role, disable / enable user.

## 1. Quyết định thiết kế (đã chốt, cứ làm theo)

- **Bỏ** cơ chế bật / tắt quyền workspace (`workspace_permissions`, `PUT /api/w/{wid}/permissions`, `Permissions.TOGGLEABLE`) và role `viewer`. Spec mới không cần.
- **Giữ** `workspace_types` (research / review / readonly) để chọn loại khi tạo workspace, nhưng bỏ cột `default_permissions` khỏi logic (có thể để nguyên trong DB).
- Role **trong workspace** (`memberships.role`) chỉ còn `manager` | `member`. Một membership `manager` chỉ hợp lệ khi user đó có `global_role` là `workspace_manager` hoặc `admin`.
- Một workspace có thể có nhiều manager (admin gán thêm). Người tạo / người được duyệt request là manager đầu tiên.
- `workspace_manager` được tự tạo workspace mới qua `POST /api/workspaces` (không cần request nữa). Member thường thì phải gửi request.
- Mỗi member chỉ có **tối đa 1 yêu cầu tạo workspace đang `pending`**.
- **Disable**: user bị disable bị chặn ở `AuthFilter` (logic hiện có, trả `403 disabled`). Không xoá dữ liệu của họ. Không disable được `admin@hyperdatalab.org` và không tự disable chính mình.
- **Gỡ `workspace_manager`**: bị chặn (`409 still_managing`) nếu user đó còn là manager duy nhất của một workspace `active`. Nếu không thì gỡ role và hạ các membership `manager` của họ xuống `member`.
- Admin luôn có quyền như manager ở mọi workspace (giữ hành vi hiện tại của `AuthedUser.admin()`).
- Mọi thay đổi đều ghi `audit_log` như hiện tại.

## 2. Phase 1 — Database (Flyway `V2__roles_redesign.sql`)

**Không sửa `V1__init.sql`.** Tạo file mới `backend/src/main/resources/db/migration/V2__roles_redesign.sql`:

```sql
-- 1. Global roles: user -> member, thêm workspace_manager
ALTER TABLE users DROP CONSTRAINT users_global_role_check;
UPDATE users SET global_role = 'member' WHERE global_role = 'user';
UPDATE users SET global_role = 'workspace_manager'
 WHERE global_role = 'member'
   AND email IN (SELECT user_email FROM memberships WHERE role = 'manager' AND status = 'approved');
ALTER TABLE users ALTER COLUMN global_role SET DEFAULT 'member';
ALTER TABLE users ADD CONSTRAINT users_global_role_check
  CHECK (global_role IN ('member', 'workspace_manager', 'admin'));
ALTER TABLE users ADD COLUMN disabled_at TIMESTAMPTZ, ADD COLUMN disabled_by TEXT;

-- 2. Workspace roles: bỏ viewer
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
UPDATE memberships SET role = 'member' WHERE role = 'viewer';
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('member', 'manager'));

-- 3. Bỏ bật/tắt quyền
DROP TABLE workspace_permissions;

-- 4. Yêu cầu tạo workspace (member -> admin)
CREATE TABLE workspace_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester     TEXT NOT NULL REFERENCES users (email),
    name          TEXT NOT NULL,
    slug          TEXT NOT NULL,
    type          TEXT NOT NULL REFERENCES workspace_types (code),
    description   TEXT NOT NULL DEFAULT '',
    reason        TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by    TEXT,
    decided_at    TIMESTAMPTZ,
    decision_note TEXT NOT NULL DEFAULT '',
    workspace_id  UUID REFERENCES workspaces (id)        -- điền khi approved
);
CREATE UNIQUE INDEX uq_workspace_requests_pending ON workspace_requests (requester) WHERE status = 'pending';
CREATE INDEX idx_workspace_requests_status ON workspace_requests (status, requested_at DESC);

-- 5. Yêu cầu download paper (member -> manager của workspace)
CREATE TABLE download_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    requester     TEXT NOT NULL REFERENCES users (email),
    paper_ref     TEXT NOT NULL,      -- DOI / URL / tiêu đề, free text, chưa validate
    note          TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by    TEXT,
    decided_at    TIMESTAMPTZ,
    decision_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_download_requests_ws ON download_requests (workspace_id, status, requested_at DESC);
CREATE INDEX idx_download_requests_user ON download_requests (requester, requested_at DESC);
```

Kiểm tra tên constraint thật trước khi DROP (`\d users` trong psql); Postgres tự đặt là `users_global_role_check` / `memberships_role_check`.

## 3. Phase 2 — Backend core

### 3.1 `common/Roles.java` (mới) thay cho `common/Permissions.java`

```java
public final class Roles {
    public static final String ADMIN = "admin", WORKSPACE_MANAGER = "workspace_manager", MEMBER = "member";
    public static final String WS_MANAGER = "manager", WS_MEMBER = "member";   // memberships.role
    public static boolean canManageWorkspaces(String globalRole) { return ADMIN.equals(globalRole) || WORKSPACE_MANAGER.equals(globalRole); }
}
```

Xoá `Permissions.java` và mọi chỗ dùng nó (AccessService, MeController, WorkspaceController, AdminController, UnitTests).

### 3.2 `auth/AuthedUser.java`

Đổi thành `record AuthedUser(String email, String name, String role)` với helper:
- `boolean admin()` → `"admin".equals(role)` (giữ tên method để ít phải sửa).
- `boolean workspaceManager()` → `admin() || "workspace_manager".equals(role)`.

`IdentityService.resolve`: trả `new AuthedUser(email, saved.name(), saved.globalRole())`. Trong câu upsert, đổi giá trị mặc định `'user'` → `'member'`. Giữ nguyên logic forced admin và check disabled.

### 3.3 `workspace/AccessService.java`

- `Access` record: `(WorkspaceRow workspace, String role, boolean canManage)`; bỏ `enabled` / `permissions`.
- `canManage = user.admin() || "manager".equals(role)`.
- Thêm `void requireManager()` ném `403 forbidden "Only the workspace manager can do this."`.
- Giữ nguyên: 404 khi không có workspace, `pending_approval` / `not_member`, `archived`.

## 4. Phase 3 — API

Giữ style hiện có: `JdbcClient`, record body + `@Valid`, `ApiException`, `@Transactional`, `audit.log(...)`. Response JSON camelCase.

### 4.1 `MeController` (`/api`)

- `GET /api/me` → `user` thêm `role` (`admin|workspace_manager|member`) và `disabled`; giữ `isAdmin` cho tương thích. Mỗi membership bỏ `permissions`, thêm `canManage` (bool). Thêm `workspaceRequest`: request tạo workspace gần nhất của user (hoặc `null`).
- `GET /api/workspaces`, `POST|DELETE /api/workspaces/{id}/join`: giữ nguyên; join tạo membership role `member`.
- **Mới** `POST /api/workspaces` — chỉ `workspaceManager()`; body `{name, slug, type, description}`; tạo workspace + membership manager cho chính mình. Tách logic tạo workspace ra `WorkspaceService.create(actor, name, slug, type, description, managerEmail)` để dùng chung với admin và với lúc duyệt request.

### 4.2 `WorkspaceRequestController` (mới, `/api/workspace-requests`) — phía member

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/api/workspace-requests` | Body `{name, slug, type, description?, reason?}`. Validate như `WorkspaceCreate`. `409 already_pending` nếu đã có pending. `409 duplicate` nếu slug đã có workspace hoặc đã có request pending khác dùng slug đó. `422 unknown_type`. Trả `201 {id, status:"pending"}`. Audit `workspace_request.create`. |
| GET | `/api/workspace-requests/mine` | Danh sách request của chính mình, mới nhất trước. |
| DELETE | `/api/workspace-requests/{id}` | Rút lại request `pending` của chính mình → `withdrawn`. `404` nếu không phải của mình / không pending. |

`workspace_manager` / `admin` gọi POST cũng được nhưng không cần (họ tạo thẳng); cho phép luôn, không chặn.

### 4.3 `AdminController` (`/api/admin`) — sửa

- `GET /api/admin/users?q=&role=&disabled=` → mỗi user trả `role`, `disabled`, `disabledAt`, `disabledBy`, danh sách workspace.
- `PATCH /api/admin/users/{email}` body `{role?: "member"|"workspace_manager"|"admin", disabled?: boolean}`:
  - Không được sửa `admin@hyperdatalab.org` (`409 protected`), không tự disable / tự hạ role (`409 self_change`).
  - Hạ từ `workspace_manager`/`admin` xuống `member`: nếu user là manager duy nhất của workspace `active` nào → `409 still_managing` (kèm danh sách tên workspace trong message). Ngược lại `UPDATE memberships SET role='member' WHERE user_email=? AND role='manager'`.
  - `disabled=true` → set `disabled_at=now(), disabled_by=actor`; `false` → xoá 2 cột đó.
  - Audit `user.role` và / hoặc `user.disable` / `user.enable`.
- **Mới** `GET /api/admin/workspace-requests?status=pending` → kèm thông tin requester (name, email, department, role).
- **Mới** `POST /api/admin/workspace-requests/{id}/approve` body `{note?, name?, slug?, type?, description?}` (admin được chỉnh trước khi duyệt). Một transaction:
  1. request phải `pending` (`409 not_pending`), requester không bị disable (`409 inactive_user`);
  2. nếu requester là `member` → nâng lên `workspace_manager`;
  3. `WorkspaceService.create(...)` với requester là manager (slug trùng → `409 duplicate`);
  4. cập nhật request `approved`, `workspace_id`, `decided_*`;
  5. audit `workspace_request.approve`.
  Trả `{requestId, workspaceId, status:"approved"}`.
- **Mới** `POST /api/admin/workspace-requests/{id}/reject` body `{note?}` → `rejected`. Audit.
- `POST /api/admin/workspaces/{id}/managers`: user đích phải là email của org domain và không bị disable (`409 inactive_user`). Nếu user đang là `member` → **tự nâng lên `workspace_manager`** trong cùng transaction (audit `user.role` với `detail.reason = "assigned_manager"`), rồi gán membership `manager`. User là `workspace_manager` / `admin` thì chỉ gán. Response thêm `promoted: true|false`.
- `POST /api/admin/workspaces`: giữ, dùng `WorkspaceService.create`; mỗi email trong `managers` cũng được tự nâng role như trên.
- Bỏ phần `default_permissions` trong `POST /api/admin/workspace-types` (body chỉ còn `code, name, description`).
- `PATCH /api/admin/workspaces/{id}`, `/audit`, `/users/sync`, `/users/{email}/refresh`: giữ nguyên.

### 4.4 `WorkspaceController` (`/api/w/{wid}`) — sửa

- `GET /api/w/{wid}` → `{workspace, role, canManage}`.
- `GET /members`, approve / reject / revoke, `POST /members` (thêm trực tiếp): yêu cầu `requireManager()`. Role chỉ `member` (bỏ tham số role ở approve / add; nếu gửi `manager` → `403 admin_only`, việc gán manager đi qua admin).
- **Xoá** `PATCH /members/{mid}` (đổi role) và `PUT /permissions`.
- `GET /people`: mọi member đã duyệt xem được.
- `GET /audit`: manager.

### 4.5 `DownloadRequestController` (mới, `/api/w/{wid}/download-requests`)

| Method | Path | Ai | Ghi chú |
|---|---|---|---|
| POST | `` | member đã duyệt của workspace (cả manager) | Body `{paperRef: @NotBlank @Size(max=500), note?: @Size(max=1000)}`. Lưu `pending`. `201 {id, status:"pending"}`. Audit `download_request.create`. |
| GET | `/mine` | member | Request của chính mình trong workspace này. |
| DELETE | `/{id}` | requester | Rút request `pending` → `withdrawn`. |
| GET | `?status=` | manager | Toàn bộ request trong workspace, `pending` trước; kèm tên / email requester. |
| POST | `/{id}/approve`, `/{id}/reject` | manager | Body `{note?}`. Chỉ đổi status, **không** sinh link / file. `409 not_pending`. Audit. |

Dùng `access.load(user, wid)` để check membership (user chưa được duyệt → `403 not_member` / `pending_approval`, đúng như yêu cầu "member có gửi được request không").

## 5. Phase 4 — Tests backend

Sửa test cũ cho khớp (bỏ test về permissions toggle / viewer / đổi role), thêm test mới. Cần có tối thiểu:

**IdentityApiTest / AdminApiTest**
- User mới đăng nhập có role `member`; `admin@hyperdatalab.org` là `admin`.
- Admin cấp `workspace_manager` cho member → `/api/me` trả role mới.
- Admin disable user → user đó gọi `/api/me` bị `403 disabled`; enable lại → vào được.
- Không disable / hạ role được admin gốc và chính mình.
- Non-admin gọi `/api/admin/**` → `403 admin_only`.
- Hạ role manager duy nhất của workspace active → `409 still_managing`.

**WorkspaceRequestApiTest (mới)**
- Member gửi request → pending; gửi lần 2 → `409 already_pending`; rút lại → `withdrawn` và gửi lại được.
- Admin duyệt → requester thành `workspace_manager`, workspace tồn tại, requester là manager, `/api/me` có membership đó.
- Admin từ chối → status `rejected`, không tạo workspace.
- Slug trùng → `409 duplicate`.
- `workspace_manager` tạo workspace trực tiếp được; `member` gọi `POST /api/workspaces` → `403`.

**WorkspaceApiTest**
- Member xin vào → manager duyệt → member truy cập được; từ chối / thu hồi vẫn chạy.
- Manager không duyệt được ở workspace không phải của mình.
- Admin gán manager cho user đang là `member` → user tự thành `workspace_manager`, response `promoted: true`, có audit `user.role`; gán cho user bị disable → `409 inactive_user`.

**DownloadRequestApiTest (mới)**
- Member đã duyệt gửi request → `201`, thấy trong `/mine`.
- User chưa được duyệt / pending → `403`.
- Manager thấy request trong danh sách, approve / reject được; member thường gọi list toàn bộ hoặc approve → `403`.
- `paperRef` rỗng → `400/422` (theo `ErrorHandler` hiện có).

**UnitTests**: xoá test của `Permissions`, thêm test nhỏ cho `Roles.canManageWorkspaces`.

`npm test` phải xanh.

## 6. Phase 5 — Frontend (`web/`)

- `lib/types.ts`: thêm `GlobalRole = "admin" | "workspace_manager" | "member"`; `WorkspaceRole = "manager" | "member"`; cập nhật `Me` (`user.role`, `user.disabled`, `workspaceRequest`, membership `canManage`), `WorkspaceInfo` (`role`, `canManage`); thêm `WorkspaceRequest`, `DownloadRequest`, `AdminUser`. Xoá `Permission`, `PERMISSION_LABEL`. Thêm `GLOBAL_ROLE_LABEL = { admin: "Quản trị viên", workspace_manager: "Quản lý workspace", member: "Thành viên" }`, bổ sung `STATUS_LABEL.withdrawn = "Đã rút"`.
- `App.tsx`:
  - Sidebar hiện role hiện tại của user (badge) dưới tên.
  - Nav "Thành viên & quyền" → "Quản lý workspace", hiện khi `canManage`.
  - Thêm nav "Yêu cầu download" trong workspace (member: request của mình; manager: hàng đợi).
  - `workspace_manager` có nav "Tạo workspace"; `member` có "Xin tạo workspace".
  - `Home()`: giữ logic, nhưng `workspace_manager` chưa có workspace thì đi tới trang tạo workspace.
- `pages/Onboarding.tsx`: giữ phần xin vào workspace; thêm card "Xin tạo workspace mới" (form name / slug / type / description / reason) và trạng thái request hiện tại (pending → nút rút lại; rejected → hiện lý do + cho gửi lại).
- **Mới** `pages/CreateWorkspace.tsx` cho `workspace_manager` (gọi `POST /api/workspaces`). Có thể tái dùng form trong Onboarding.
- `pages/WorkspaceHome.tsx`: thêm form "Gửi yêu cầu download paper" (paperRef + note) và bảng request của tôi (status, ngày, ghi chú của manager, nút rút lại khi pending).
- `pages/Members.tsx`: bỏ phần bật / tắt quyền và dropdown đổi role. Giữ hàng đợi xin vào + danh sách thành viên + thêm trực tiếp + thu hồi. Thêm tab "Yêu cầu download" (list + approve / reject có note).
- `pages/Admin.tsx`: tab
  1. **Người dùng**: bảng user, lọc theo role / disabled, `<select>` đổi role, nút Disable / Enable (confirm trước), hiện lỗi `still_managing` rõ ràng.
  2. **Yêu cầu tạo workspace**: hàng đợi pending, xem chi tiết, sửa name / slug trước khi duyệt, Duyệt / Từ chối có note.
  3. **Workspace**: như hiện tại; ô gán manager cho chọn mọi user active, nếu chọn một `member` thì hiện confirm "Người này sẽ được nâng lên Quản lý workspace"; bỏ phần permissions.
  4. **Nhật ký**: giữ.
- Giữ style hiện có (`styles.css`, `components/ui.tsx`), text tiếng Việt.

`npm run typecheck` và `npm run build` phải pass.

## 7. Phase 6 — Docs

- Cập nhật `README.md`: bảng "Module làm gì", thay bảng quyền bằng bảng 3 role ở mục 0, kịch bản thử mới:
  1. `alice@` đăng nhập → member → gửi "Xin tạo workspace".
  2. `admin@` → Quản trị → Yêu cầu tạo workspace → duyệt → alice thành workspace_manager.
  3. `bob@` → xin vào workspace của alice → alice duyệt.
  4. bob → Tổng quan → gửi yêu cầu download paper → alice thấy trong "Yêu cầu download".
  5. admin disable bob → bob không đăng nhập được.
- Cập nhật `docs/INTEGRATION.md` nếu có nhắc tới `Permissions` / `workspace.*`.
- Cập nhật số lượng test trong README.

## 8. Ngoài phạm vi (không làm)

- Tải file / sinh link download, lưu trữ paper, tích hợp nguồn paper.
- Thông báo email / realtime.
- Phân trang.

## 9. Checklist nghiệm thu

- [ ] `npm run db:up && npm test` xanh (DB test `wb_module_test` có sẵn, xem README).
- [ ] `npm run typecheck && npm run build` pass.
- [ ] Không còn tham chiếu tới `Permissions`, `workspace_permissions`, `viewer`, `global_role = 'user'` (`grep -rn` để chắc).
- [ ] Chạy tay kịch bản ở Phase 6 với `AUTH_MODE=dev`, `DIRECTORY_MODE=mock`.
- [ ] Commit theo từng phase, message dạng `feat(roles): ...`.
