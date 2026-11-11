# Writing Bank — Module Member, Workspace & Quyền

Module độc lập, viết để test riêng rồi ghép vào repo Writing Bank.

- **Backend:** Java 17 + Spring Boot 3 (`backend/`)
- **Database:** PostgreSQL 16, schema quản lý bằng Flyway
- **Frontend:** React + react-router + Vite (`web/`)

Phạm vi hiện tại: **lấy thông tin member, workspace và quản lý quyền**. Phần corpus, fetcher, downloader, extractor chưa làm.

## Module làm gì

| Phần | Nội dung |
|---|---|
| **Member** | Chỉ tài khoản Google `@hyperdatalab.org` đăng nhập được. Khi đăng nhập, backend gọi **API của bên khác** (user directory) để kiểm tra người đó có đăng ký dưới tên miền và còn active không, rồi lấy tên, phòng ban, ảnh và liên kết với user trong hệ thống. Có đồng bộ toàn bộ danh bạ hằng đêm (02:00) và nút đồng bộ cho admin. |
| **Workspace** | Workspace là **không gian làm việc riêng của web** (một nhóm trong Writing Bank), không phải Google Workspace. Admin tạo workspace, chọn **loại** (research / review / readonly, thêm được loại mới) và gán manager. |
| **Vào workspace** | User chưa thuộc workspace nào sẽ bị đưa vào màn chọn workspace để **gửi yêu cầu**. **Manager** của workspace đó duyệt hoặc từ chối. Manager cũng có thể thu hồi, đổi vai trò, hoặc thêm thẳng một member. |
| **Quyền** | Vai trò trong workspace: viewer < member < manager. Manager **bật/tắt quyền của workspace**. Quyền thực tế của một người = quyền của vai trò ∩ quyền workspace đang bật. Chỉ admin gán hoặc gỡ manager. |
| **Admin** | `admin@hyperdatalab.org` luôn là admin: xem toàn bộ member, khoá/mở khoá, nâng người khác làm admin, tạo/lưu trữ workspace, xem nhật ký. Mọi thay đổi đều ghi audit log. |

### Bảng quyền

| Mã quyền | Ý nghĩa | viewer | member | manager |
|---|---|---|---|---|
| `workspace.read` | Xem nội dung | ✓ | ✓ | ✓ |
| `workspace.write` | Tạo / sửa nội dung | | ✓ | ✓ |
| `workspace.review` | Duyệt nội dung | | ✓ | ✓ |
| `members.manage` | Duyệt yêu cầu, quản lý thành viên, bật/tắt quyền | | | ✓ |

Ba quyền `workspace.*` chỉ có hiệu lực khi manager bật cho workspace. `members.manage` không bị tắt được, để manager luôn bật lại được quyền.

## Chạy local

Cần Java 17, Maven, Node 20+, Docker.

```bash
npm install
npm run db:up          # PostgreSQL ở cổng 5433
npm run dev:backend    # http://localhost:8080 (Flyway tự tạo bảng)
npm run dev:web        # http://localhost:5174
```

Mặc định local chạy `AUTH_MODE=dev` và `DIRECTORY_MODE=mock`: màn đăng nhập là ô nhập email, và mọi địa chỉ `@hyperdatalab.org` đều được coi là active.

Kịch bản thử:
1. Đăng nhập `admin@hyperdatalab.org` → **Quản trị** → tạo workspace, gán manager (ví dụ `mai@hyperdatalab.org`).
2. Đăng nhập `alice@hyperdatalab.org` → bị đưa vào **Tham gia workspace** → gửi yêu cầu.
3. Đăng nhập `mai@...` → **Thành viên & quyền** → duyệt alice, thử bật/tắt quyền.
4. Đăng nhập lại alice → trang **Tổng quan** hiện quyền của alice và danh sách thành viên.

## Test

```bash
docker compose exec -T postgres psql -U wb -d wb_module -c "CREATE DATABASE wb_module_test"   # chạy một lần
npm test
```

33 test: 28 test API chạy trên PostgreSQL thật (database `wb_module_test`), 5 unit test (mô hình quyền, client gọi user directory qua HTTP).

## Cấu hình (biến môi trường)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DB_URL`, `DB_USER`, `DB_PASSWORD` | Postgres local cổng 5433 | Kết nối PostgreSQL |
| `AUTH_MODE` | `dev` | `firebase` ở production: verify Firebase ID token của project `hyperdatalab-writing-bank` |
| `DIRECTORY_MODE` | `mock` | Nguồn thông tin member: `http`, `google`, `mock`, `off` |
| `DIRECTORY_HTTP_BASE_URL`, `DIRECTORY_HTTP_TOKEN` | | Dùng với `http` |
| `GOOGLE_SA_FILE` | | Dùng với `google`: đường dẫn file JSON của service account |
| `CORS_ORIGIN` | `http://localhost:5174` | Origin của web |

Phía web (`web/.env.local`): `VITE_AUTH_MODE=firebase` và các biến `VITE_FIREBASE_*`.

### Nguồn thông tin member (`DIRECTORY_MODE`)

- **`http`** — một REST API bất kỳ biết danh sách user của tên miền:
  - `GET {baseUrl}/users/{email}` → `200 {email, name, photoUrl, department, suspended}` hoặc `404`
  - `GET {baseUrl}/users?domain=hyperdatalab.org` → mảng các object như trên (hoặc `{"users": [...]}`)
  - Gửi kèm `Authorization: Bearer {token}` nếu có cấu hình token.
- **`google`** — Google Admin SDK Directory API, qua service account có domain-wide delegation với scope `admin.directory.user.readonly`, chạy dưới danh nghĩa `admin@hyperdatalab.org`. Chỉ đọc danh sách tài khoản của tên miền.
- **`mock`** — danh sách trong `app.directory.mock-users` (xem `backend/src/test/resources/application-test.yml`).

Muốn nối API khác: implement interface `UserDirectory` (2 hàm `find`, `listAll`) và đăng ký trong `DirectoryConfig`.

Xem [docs/INTEGRATION.md](docs/INTEGRATION.md) để biết danh sách API và cách ghép vào repo Writing Bank.
