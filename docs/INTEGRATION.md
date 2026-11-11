# API và cách ghép vào repo Writing Bank

## API (prefix `/api`, header `Authorization: Bearer <Firebase ID token>`)

Lỗi luôn có dạng `{"error": {"code": "...", "message": "..."}}`.

### Member hiện tại

| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Không cần đăng nhập |
| GET | `/me` | Thông tin member (tên, phòng ban, trạng thái danh bạ, có phải admin) và mọi membership kèm quyền thực tế |
| GET | `/workspaces` | Các workspace đang hoạt động, kèm trạng thái của mình ở từng workspace |
| GET | `/workspace-types` | Các loại workspace |
| POST | `/workspaces/{id}/join` | Gửi yêu cầu tham gia (`{note}`) |
| DELETE | `/workspaces/{id}/join` | Rút yêu cầu hoặc rời workspace |

### Trong một workspace (`/w/{wid}`), cần membership đã duyệt hoặc là admin

| Method | Path | Quyền |
|---|---|---|
| GET | `/w/{wid}` | thành viên — thông tin workspace, vai trò, quyền thực tế |
| GET | `/w/{wid}/people` | `workspace.read` — danh sách thành viên đã duyệt |
| GET | `/w/{wid}/members?status=` | `members.manage` — cả hàng chờ duyệt |
| POST | `/w/{wid}/members` | `members.manage` — thêm thẳng một member (`{email, role}`) |
| POST | `/w/{wid}/members/{mid}/approve` | `members.manage` (`{role, note}`) |
| POST | `/w/{wid}/members/{mid}/reject` | `members.manage` (`{note}`) |
| POST | `/w/{wid}/members/{mid}/revoke` | `members.manage` |
| PATCH | `/w/{wid}/members/{mid}` | `members.manage` — đổi vai trò; liên quan manager thì chỉ admin |
| PUT | `/w/{wid}/permissions` | `members.manage` — `{permissions: [...]}` |
| GET | `/w/{wid}/audit` | `members.manage` |

### Admin (`/admin`)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/admin/users?q=&status=` | Toàn bộ member và workspace của từng người |
| POST | `/admin/users/sync` | Đồng bộ toàn bộ từ user directory |
| POST | `/admin/users/{email}/refresh` | Lấy lại thông tin một member từ user directory |
| PATCH | `/admin/users/{email}` | `{disabled, globalRole}` |
| GET / POST | `/admin/workspaces` | Danh sách / tạo (`{name, slug, type, description, managers}`) |
| PATCH | `/admin/workspaces/{id}` | Đổi tên, loại, lưu trữ |
| POST | `/admin/workspaces/{id}/managers` | Gán manager (`{email}`) |
| POST | `/admin/workspace-types` | Thêm loại workspace |
| GET | `/admin/audit` | Nhật ký toàn hệ thống |

## Cấu trúc mã nguồn

```
backend/src/main/java/org/hyperdatalab/wbmodule/
  auth/        verify token (Firebase hoặc dev), AuthFilter, CORS
  directory/   UserDirectory + 3 bản: HTTP, Google, mock
  identity/    IdentityService (liên kết tài khoản ↔ user, đồng bộ), AuditService
  workspace/   AccessService (cổng kiểm tra quyền), Me/Workspace/Admin controller
  common/      Permissions, lỗi, cấu hình
backend/src/main/resources/db/migration/V1__init.sql
web/src/
  app/         Router, layout và context ứng dụng
  features/    Màn hình theo nghiệp vụ (auth, admin, workspaces)
  shared/      Component, API client và kiểu dùng chung
plans/         Kế hoạch và thiết kế chưa triển khai
docs/          Hướng dẫn tích hợp
```

## Các bước ghép

1. **Database:** chạy `V1__init.sql` trên PostgreSQL của Writing Bank (6 bảng: `users`, `workspace_types`, `workspaces`, `workspace_permissions`, `memberships`, `audit_log`).
2. **Backend:** nếu Writing Bank cũng là Spring Boot thì copy các package ở trên. Nếu là stack khác thì chạy module như một service riêng và gọi qua API.
3. **Kiểm tra quyền ở tính năng khác:** mỗi API của Writing Bank gọi `accessService.load(user, workspaceId).require("workspace.write")` (hoặc `read` / `review`). Hàm này trả 403 nếu người gọi chưa được duyệt vào workspace hoặc thiếu quyền.
4. **Gắn dữ liệu vào workspace:** thêm cột `workspace_id` vào các bảng nội dung cần phân theo workspace.
5. **Vai trò cũ của Writing Bank** (`member / reviewer / admin`): `admin` → `global_role = 'admin'`; `reviewer` → vai trò `member` trong một workspace loại review.
6. **Frontend:** lấy màn hình trong `web/src/features/`, component và API client dùng chung trong `web/src/shared/`. Thay `web/src/features/auth/auth.tsx` bằng auth provider sẵn có của Writing Bank (chỉ cần hàm `getToken()` trả Firebase ID token). Thêm route `/onboarding`, `/w/:wid`, `/w/:wid/members`, `/admin`.

## Lưu ý

- Kết quả kiểm tra user directory được cache 12 giờ cho mỗi member (`app.directory.cache-hours`). Người đã rời tên miền bị chặn ở lần kiểm tra kế tiếp hoặc sau lần đồng bộ đêm.
- User bị từ chối đăng nhập (không có trong danh bạ, bị đình chỉ) vẫn được ghi vào bảng `users` để admin thấy.
- `AUTH_MODE=dev` chấp nhận token `dev:<email>` không cần mật khẩu; chỉ dùng trên máy local.
