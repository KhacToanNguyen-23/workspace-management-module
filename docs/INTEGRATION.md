# Tích hợp module Writing Bank

## Kiến trúc dữ liệu

Java backend dùng Firebase Admin SDK để đọc và ghi Cloud Firestore. Web chỉ gọi API `/api`; không kết nối Firestore trực tiếp. Firestore Security Rules mặc định chặn toàn bộ client access.

Các collection: `users`, `workspaceTypes`, `workspaces`, `memberships`, `workspaceRequests`, `downloadRequests`, `auditLog`. Tên field dùng camelCase. Xem mô hình đầy đủ trong [plan roles redesign](../plans/roles-redesign.md).

Trong local, chạy `npm run db:up` để bật Firestore emulator tại `localhost:8085`. Backend dùng `FIRESTORE_EMULATOR_HOST=localhost:8085`; production cấu hình `FIRESTORE_PROJECT_ID` và Application Default Credentials hoặc `GOOGLE_APPLICATION_CREDENTIALS`. Triển khai index từ `firestore.indexes.json`.

## API

Base path: `/api/v1`. Mọi route (trừ `GET /api/health` và `/api/dev/*` ở chế độ dev) yêu cầu `Authorization: Bearer <Firebase ID token>`. Thay đổi không tương thích sẽ đi kèm một phiên bản mới (`/api/v2`).

### Quy ước

- **Tài nguyên** là danh từ số nhiều, viết thường có gạch nối. Mỗi tài nguyên có một cây URL duy nhất; quyền quyết định ai thấy gì, không phải tiền tố đường dẫn.
- **Method:** `GET` đọc, `POST` tạo (trả `201` + header `Location`), `PUT` đặt trạng thái của chính người gọi (`members/me`), `PATCH` đổi một phần hoặc chuyển trạng thái (`{"status": ...}`), `DELETE` rút/xoá. Yêu cầu bị rút vẫn được giữ lại với trạng thái `withdrawn` để phục vụ audit.
- **Lọc** bằng query: `status=`, `requester=me`, `workspaceId=`, `q=`, `role=`, `disabled=`.
- **Phân trang** các collection: `limit` (mặc định 100, tối đa 500) và `offset`. Thân phản hồi vẫn là mảng JSON; tổng số nằm ở header `X-Total-Count`, trang kế/trước ở header `Link` (`rel="next"` / `rel="prev"`). `limit`/`offset` sai giá trị → `422`, sai kiểu → `400 bad_parameter`.
- **Lỗi:** `{"error":{"code":"...","message":"..."}}` với `401` (kèm `WWW-Authenticate`), `403`, `404`, `405` (kèm `Allow`), `409` (xung đột trạng thái), `415` (body không phải JSON), `422` (dữ liệu sai), `502` (directory lỗi).
- **Mô tả workspace** thống nhất ở mọi endpoint: `id, name, type, description, status, createdBy, createdAt, managers[], memberCount`, cùng `pendingCount` (admin và manager của workspace đó), `myStatus`/`myRole` (nếu caller có membership) và `canManage` (khi đọc một workspace).

### Đăng nhập (chỉ khi `AUTH_MODE=sso`)

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/v1/sessions` | Không cần token. Body `{code, codeVerifier, redirectUri}` lấy từ callback của HyperDataLab SSO. Trả `201 {token, expiresAt, user: {email, name}}`. Lỗi: `401 sso_rejected` (code sai hoặc hết hạn), `403 wrong_domain` / `unverified` / `disabled`, `422 invalid_redirect`, `502 sso_unavailable`. |
| DELETE | `/api/v1/sessions/current` | Đăng xuất: session token hết hiệu lực ngay. Trả `204`. |

### Hồ sơ và catalogue

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/v1/me` | User, global role, memberships, `canManage` và yêu cầu tạo workspace gần nhất. |
| GET | `/api/v1/workspace-types` | Loại workspace. |
| POST | `/api/v1/workspace-types` | Admin; thêm loại workspace. |
| GET | `/api/v1/workspaces?status=active\|archived\|all` | Danh sách workspace kèm trạng thái membership của caller. `archived` và `all` chỉ dành cho admin. |
| POST | `/api/v1/workspaces` | `workspace_manager` hoặc admin; tạo workspace `{name, type, description, managers?, members?}`. Chỉ admin được chọn `managers`; mặc định người tạo là manager. `members` (tối đa 100 email) được thêm ngay với trạng thái đã duyệt; mọi email được kiểm tra trước, một email sai (`422 wrong_domain`, `404 not_in_directory`, `409 inactive_user`) thì không tạo gì. |
| GET | `/api/v1/workspace-requests?status=&requester=me` | Admin thấy mọi yêu cầu tạo workspace (kèm thông tin người gửi); người khác chỉ thấy của mình. |
| POST | `/api/v1/workspace-requests` | Gửi yêu cầu tạo workspace `{name, type, description?, reason?}`. |
| GET | `/api/v1/workspace-requests/{id}` | Admin hoặc người gửi. |
| PATCH | `/api/v1/workspace-requests/{id}` | Admin; `{status: "approved" \| "rejected", note?, name?, type?, description?}`. Duyệt tạo workspace trong cùng transaction. |
| DELETE | `/api/v1/workspace-requests/{id}` | Người gửi; rút yêu cầu pending. |

### Một workspace

| Method | Path | Quyền và mô tả |
|---|---|---|
| GET | `/api/v1/workspaces/{id}` | Member đã duyệt hoặc admin; workspace cùng `myRole`, `canManage`. |
| PATCH | `/api/v1/workspaces/{id}` | Admin; đổi tên, mô tả, loại hoặc `status` (`active` / `archived`). |
| GET | `/api/v1/workspaces/{id}/members?status=` | Manager thấy mọi membership; member thường chỉ thấy các member đã duyệt với trường công khai. |
| POST | `/api/v1/workspaces/{id}/members` | Manager; thêm trực tiếp một member `{email}`. |
| GET | `/api/v1/workspaces/{id}/members/{mid}` | Manager hoặc chính member đó; `me` là bí danh của membership của caller. |
| PATCH | `/api/v1/workspaces/{id}/members/{mid}` | Manager; `{status: "approved" \| "rejected" \| "revoked", note?}`. |
| PUT | `/api/v1/workspaces/{id}/members/me` | Xin tham gia `{note?}` (`201`, membership `pending`). |
| DELETE | `/api/v1/workspaces/{id}/members/me` | Rút yêu cầu đang chờ hoặc rời workspace. |
| POST | `/api/v1/workspaces/{id}/managers` | Admin; gán manager `{email}`, member được tự nâng thành `workspace_manager`. |
| POST | `/api/v1/workspaces/{id}/download-requests` | Member đã duyệt; tạo request `{paperRef, note}`. |
| GET | `/api/v1/workspaces/{id}/download-requests?status=&requester=me` | Manager thấy hàng đợi; member (hoặc `requester=me`) chỉ thấy request của mình. |
| GET | `/api/v1/workspaces/{id}/download-requests/{rid}` | Manager hoặc người gửi. |
| PATCH | `/api/v1/workspaces/{id}/download-requests/{rid}` | Manager; `{status: "approved" \| "rejected", note?}`, không tạo file hoặc link. |
| DELETE | `/api/v1/workspaces/{id}/download-requests/{rid}` | Người gửi; rút request pending. |

### Người dùng, directory và audit (admin)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/v1/users?q=&role=&disabled=` | Tìm user và xem workspace của từng người. |
| PATCH | `/api/v1/users/{email}` | Cập nhật `{role, disabled}`; admin gốc không thể thay đổi. |
| POST | `/api/v1/directory-syncs` | Đồng bộ directory. |
| POST | `/api/v1/users/{email}/directory-refreshes` | Làm mới một user từ directory. |
| GET | `/api/v1/audit-events?workspaceId=` | Admin xem toàn hệ thống; manager xem audit của workspace mình quản lý (bắt buộc `workspaceId`). Mỗi sự kiện có `id`. |

### Đối chiếu với API cũ

| Cũ | Mới |
|---|---|
| `/api/me`, `/api/workspaces`, `/api/workspace-types` | thêm tiền tố `/api/v1` |
| `/api/w/{id}` | `/api/v1/workspaces/{id}` (trả phẳng, không còn `{workspace, role}`) |
| `/api/w/{id}/people` | `/api/v1/workspaces/{id}/members?status=approved` |
| `POST /api/workspaces/{id}/join`, `DELETE …/join` | `PUT` / `DELETE /api/v1/workspaces/{id}/members/me` |
| `POST …/members/{mid}/approve\|reject\|revoke` | `PATCH …/members/{mid}` với `status` |
| `GET …/download-requests/mine` | `GET …/download-requests?requester=me` |
| `POST …/download-requests/{rid}/approve\|reject` | `PATCH …/download-requests/{rid}` với `status` |
| `GET /api/workspace-requests/mine`, `GET /api/admin/workspace-requests` | `GET /api/v1/workspace-requests` (phạm vi theo quyền) |
| `POST /api/admin/workspace-requests/{id}/approve\|reject` | `PATCH /api/v1/workspace-requests/{id}` với `status` |
| `/api/admin/users…` | `/api/v1/users…` |
| `POST /api/admin/users/sync` | `POST /api/v1/directory-syncs` |
| `POST /api/admin/users/{email}/refresh` | `POST /api/v1/users/{email}/directory-refreshes` |
| `GET\|POST /api/admin/workspaces` | `GET\|POST /api/v1/workspaces` (`?status=all` cho admin) |
| `PATCH /api/admin/workspaces/{id}` | `PATCH /api/v1/workspaces/{id}` |
| `POST /api/admin/workspaces/{id}/managers` | `POST /api/v1/workspaces/{id}/managers` |
| `POST /api/admin/workspace-types` | `POST /api/v1/workspace-types` |
| `/api/admin/audit`, `/api/w/{id}/audit` | `/api/v1/audit-events[?workspaceId=]` |
| trường `managerEmails` (admin) / `managers` | `managers` ở mọi nơi |

Email là khoá của user nên vẫn nằm trong đường dẫn `/users/{email}`; email luôn được chuẩn hoá chữ thường.

## Ghép backend

1. Cấu hình service account và Firestore project của Writing Bank.
2. Chạy module này như một service riêng; nếu tích hợp mã nguồn, giữ các package `admin/`, `auth/`, `common/`, `config/`, `directory/`, `identity/`, `store/` và `workspace/` cùng các package con.
3. Gọi API từ frontend; không tạo Firestore client phía web. Chuyển Firebase ID token vào header `Authorization`.
4. Tính năng nội dung thuộc workspace cần kiểm tra membership đã duyệt và `canManage`/role phù hợp ở backend.

Role toàn cục chỉ gồm `admin`, `workspace_manager`, `member`; role membership chỉ `manager` hoặc `member`. Audit log được ghi cùng Firestore transaction cho các thay đổi role, workspace, membership và request.
