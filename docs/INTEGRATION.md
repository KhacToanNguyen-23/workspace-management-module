# Tích hợp module Writing Bank

## Kiến trúc dữ liệu

Java backend dùng Firebase Admin SDK để đọc và ghi Cloud Firestore. Web chỉ gọi API `/api`; không kết nối Firestore trực tiếp. Firestore Security Rules mặc định chặn toàn bộ client access.

Các collection: `users`, `workspaceTypes`, `workspaces`, `workspaceSlugs`, `memberships`, `workspaceRequests`, `downloadRequests`, `auditLog`. Tên field dùng camelCase. Xem mô hình đầy đủ trong [plan roles redesign](../plans/roles-redesign.md).

Trong local, chạy `npm run db:up` để bật Firestore emulator tại `localhost:8085`. Backend dùng `FIRESTORE_EMULATOR_HOST=localhost:8085`; production cấu hình `FIRESTORE_PROJECT_ID` và Application Default Credentials hoặc `GOOGLE_APPLICATION_CREDENTIALS`. Triển khai index từ `firestore.indexes.json`.

## API

Các route (ngoài `/health`) yêu cầu `Authorization: Bearer <Firebase ID token>`. Lỗi có dạng `{"error":{"code":"...","message":"..."}}`.

### Profile và workspace

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/me` | User, global role, memberships, `canManage` và yêu cầu tạo workspace gần nhất. |
| GET | `/api/workspaces` | Workspace đang hoạt động và trạng thái membership của caller. |
| GET | `/api/workspace-types` | Loại workspace. |
| POST | `/api/workspaces` | Tạo workspace trực tiếp; chỉ `workspace_manager` hoặc admin. |
| POST / DELETE | `/api/workspaces/{id}/join` | Gửi yêu cầu tham gia / rút hoặc rời workspace. |
| POST / GET | `/api/workspace-requests` | Tạo yêu cầu workspace / danh sách của caller tại `/mine`. |
| DELETE | `/api/workspace-requests/{id}` | Rút yêu cầu tạo workspace pending của caller. |

### Trong workspace

| Method | Path | Quyền và mô tả |
|---|---|---|
| GET | `/api/w/{id}` | Member đã duyệt; trả workspace, role và `canManage`. |
| GET | `/api/w/{id}/people` | Member đã duyệt; danh sách member đã duyệt. |
| GET | `/api/w/{id}/members` | Manager; hàng đợi và danh sách member. |
| POST | `/api/w/{id}/members` | Manager; thêm trực tiếp một member (`{email}`). |
| POST | `/api/w/{id}/members/{mid}/approve` | Manager; duyệt yêu cầu tham gia (`{note}`). |
| POST | `/api/w/{id}/members/{mid}/reject` | Manager; từ chối yêu cầu tham gia (`{note}`). |
| POST | `/api/w/{id}/members/{mid}/revoke` | Manager; thu hồi member. |
| GET | `/api/w/{id}/audit` | Manager; audit log workspace. |
| POST | `/api/w/{id}/download-requests` | Member đã duyệt; tạo request `{paperRef, note}`. |
| GET | `/api/w/{id}/download-requests/mine` | Member; request của caller. |
| DELETE | `/api/w/{id}/download-requests/{rid}` | Requester; rút request pending. |
| GET | `/api/w/{id}/download-requests` | Manager; hàng đợi request. |
| POST | `/api/w/{id}/download-requests/{rid}/approve` | Manager; duyệt request, không tạo file hoặc link. |
| POST | `/api/w/{id}/download-requests/{rid}/reject` | Manager; từ chối request. |

### Admin

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/admin/users?q=&role=&disabled=` | Tìm user và xem workspace của từng người. |
| PATCH | `/api/admin/users/{email}` | Cập nhật `{role, disabled}`; admin gốc không thể thay đổi. |
| POST | `/api/admin/users/sync` | Đồng bộ directory. |
| POST | `/api/admin/users/{email}/refresh` | Làm mới một user từ directory. |
| GET | `/api/admin/workspace-requests?status=pending` | Hàng đợi yêu cầu tạo workspace. |
| POST | `/api/admin/workspace-requests/{id}/approve` | Duyệt, có thể chỉnh tên, slug, type và description. |
| POST | `/api/admin/workspace-requests/{id}/reject` | Từ chối với ghi chú. |
| GET / POST | `/api/admin/workspaces` | Danh sách / tạo workspace. |
| PATCH | `/api/admin/workspaces/{id}` | Đổi tên, mô tả hoặc trạng thái. |
| POST | `/api/admin/workspaces/{id}/managers` | Gán manager; member được tự nâng thành `workspace_manager`. |
| POST | `/api/admin/workspace-types` | Thêm loại workspace. |
| GET | `/api/admin/audit` | Audit log toàn hệ thống. |

## Ghép backend

1. Cấu hình service account và Firestore project của Writing Bank.
2. Chép `auth/`, `config/`, `directory/`, `identity/`, `store/`, `workspace/` và `common/` hoặc chạy module này như một service riêng.
3. Gọi API từ frontend; không tạo Firestore client phía web. Chuyển Firebase ID token vào header `Authorization`.
4. Tính năng nội dung thuộc workspace cần kiểm tra membership đã duyệt và `canManage`/role phù hợp ở backend.

Role toàn cục chỉ gồm `admin`, `workspace_manager`, `member`; role membership chỉ `manager` hoặc `member`. Audit log được ghi cùng Firestore transaction cho các thay đổi role, workspace, membership và request.
