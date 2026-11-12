# Writing Bank — Module thành viên và workspace

Module độc lập để phát triển và kiểm thử trước khi ghép vào Writing Bank.

- **Backend:** Java 17 + Spring Boot 3, Firebase Admin SDK.
- **Database:** Cloud Firestore; local và integration test dùng Firestore emulator.
- **Frontend:** React + React Router + Vite.

Web chỉ gọi Java API. Backend là thành phần duy nhất đọc và ghi Firestore; [firestore.rules](firestore.rules) chặn truy cập trực tiếp từ client.

## Module làm gì

| Phần | Nội dung |
|---|---|
| **Member** | Tài khoản `@hyperdatalab.org` đăng nhập qua Google. Backend kiểm tra user directory, lấy tên, phòng ban và ảnh; đồng bộ danh bạ hằng đêm và theo yêu cầu admin. |
| **Workspace** | Workspace là không gian làm việc trong Writing Bank, có loại `research`, `review` hoặc `readonly`. Manager duyệt yêu cầu tham gia, thêm hoặc thu hồi member và xử lý yêu cầu download paper. |
| **Yêu cầu workspace** | Member gửi yêu cầu tạo workspace. Admin duyệt để nâng requester thành `workspace_manager` và tạo workspace trong cùng transaction. |
| **Yêu cầu download** | Member đã được duyệt gửi DOI, URL hoặc tiêu đề paper. Manager duyệt hoặc từ chối; hệ thống không tải paper và không tạo link. |
| **Admin** | Quản lý role và trạng thái user, duyệt yêu cầu tạo workspace, quản lý workspace và xem audit log. |

### Ba role toàn cục

| Role | Quyền |
|---|---|
| `admin` | Quản lý user và mọi workspace, duyệt yêu cầu tạo workspace, xem audit log. `admin@hyperdatalab.org` luôn được bảo vệ. |
| `workspace_manager` | Tạo workspace, quản lý workspace mình tham gia với role `manager`, duyệt yêu cầu tham gia và download. |
| `member` | Xin vào workspace, xin tạo workspace và gửi yêu cầu download khi đã là member được duyệt. |

Role trong workspace chỉ là `manager` hoặc `member`. Admin có quyền quản lý mọi workspace. Workspace manager duy nhất của workspace đang hoạt động không thể bị hạ role; cần gán thêm manager trước.

## Chạy local

Cần Java 17, Maven, Node 20+ và Docker.

```bash
npm install
npm run dev            # emulator + backend (8080) + web (5174) trong một lệnh
```

Hoặc chạy riêng từng phần: `npm run db:up` (Firestore emulator tại localhost:8085), `npm run dev:backend`, `npm run dev:web`.

Local mặc định dùng `AUTH_MODE=dev` và `DIRECTORY_MODE=mock`: mọi địa chỉ `@hyperdatalab.org` đều đăng nhập được.

### Tài khoản mẫu (chỉ có ở dev)

Khi backend chạy với `AUTH_MODE=dev`, lúc khởi động nó tạo sẵn dữ liệu mẫu (chỉ tạo bản ghi còn thiếu, không ghi đè). Màn đăng nhập liệt kê các tài khoản này, bấm là vào; trong app có ô **Đổi tài khoản (dev)** ở cuối sidebar để chuyển nhanh.

| Tài khoản | Role | Trạng thái dùng để test |
|---|---|---|
| `admin@` | admin | Quản lý user, duyệt yêu cầu tạo workspace của Carol |
| `manager@` | workspace_manager | Quản lý **Demo Lab**: 1 yêu cầu tham gia (Bob) và 1 yêu cầu download (Alice) đang chờ |
| `alice@` | member | Thành viên đã duyệt của Demo Lab, gửi được yêu cầu download |
| `bob@` | member | Đang chờ duyệt vào Demo Lab |
| `carol@` | member | Đang chờ admin duyệt yêu cầu tạo workspace |
| `dave@` | member | Member mới, chưa thuộc workspace nào |
| `disabled@` | member | Bị disable, đăng nhập bị chặn `403 disabled` |

Nút **Reset dữ liệu mẫu** ở màn đăng nhập (`POST /api/dev/reset`) xoá toàn bộ dữ liệu trong emulator rồi tạo lại như bảng trên. Đặt `DEV_SEED=false` nếu không muốn tự tạo dữ liệu mẫu. Các route `/api/dev/*` và dữ liệu mẫu không tồn tại khi `AUTH_MODE=firebase`.

## Kịch bản thử

1. `alice@hyperdatalab.org` đăng nhập với role `member` và gửi **Xin tạo workspace**.
2. `admin@hyperdatalab.org` mở **Quản trị → Yêu cầu tạo workspace** và duyệt. Alice thành `workspace_manager` và workspace được tạo.
3. `bob@hyperdatalab.org` gửi yêu cầu tham gia workspace của Alice; Alice duyệt trong **Quản lý workspace**.
4. Bob gửi yêu cầu download paper ở trang workspace; Alice xem và duyệt trong **Yêu cầu download**.
5. Admin vô hiệu hoá Bob; request đăng nhập tiếp theo của Bob bị từ chối với `403 disabled`.

## Test và kiểm tra frontend

Integration test dùng Firestore emulator trong Docker Compose. Dữ liệu các collection nghiệp vụ được xoá trước mỗi test; workspace types được seed lại idempotent lúc ứng dụng khởi động.
Backend test suite hiện có 94 test, gồm kiểm thử API trên emulator và unit test.

```bash
npm run db:up
npm test
npm run typecheck
npm run build
```

## Cấu trúc mã nguồn

```text
backend/src/main/java/org/hyperdatalab/wbmodule/
  auth/        Xác thực Firebase/dev token và filter
  config/      Cấu hình Firestore
  directory/   Adapter user directory (HTTP, Google, mock)
  identity/    IdentityService và audit log
  store/       Truy cập collection Firestore và seeder
  workspace/   API role, workspace, membership và request
web/src/
  app/         Router, layout và context
  features/    Màn hình auth, admin và workspace
  shared/      Component, API client và kiểu dùng chung
```

## Cấu hình chính

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `FIRESTORE_PROJECT_ID` | `hyperdatalab-writing-bank` | Project ID cho Firestore. |
| `FIRESTORE_EMULATOR_HOST` | rỗng | Đặt `localhost:8085` để dùng emulator; để trống khi chạy production. |
| `GOOGLE_APPLICATION_CREDENTIALS` | rỗng | Service account JSON cho production; nếu rỗng backend dùng ADC. |
| `AUTH_MODE` | `dev` | Dùng `firebase` khi chạy production. |
| `DIRECTORY_MODE` | `mock` | Nguồn user directory: `http`, `google`, `mock` hoặc `off`. |
| `DIRECTORY_HTTP_BASE_URL`, `DIRECTORY_HTTP_TOKEN` | rỗng | Cấu hình adapter HTTP. |
| `GOOGLE_SA_FILE` | rỗng | Service account cho adapter Google Directory. |
| `CORS_ORIGIN` | `http://localhost:5174` | Origin của web. |

Firebase Admin SDK dùng phiên bản 9.11.0. Production cần cấu hình credentials và triển khai các composite index trong [firestore.indexes.json](firestore.indexes.json).

## User directory

- **`http`** — `GET {baseUrl}/users/{email}` và `GET {baseUrl}/users?domain=hyperdatalab.org`; có thể gửi `Authorization: Bearer {token}`.
- **`google`** — Google Admin SDK Directory API qua service account có domain-wide delegation với scope `admin.directory.user.readonly`.
- **`mock`** — danh sách `app.directory.mock-users` trong `application-test.yml`.
- **`off`** — tắt kiểm tra directory.

Xem [docs/INTEGRATION.md](docs/INTEGRATION.md) để biết API và hướng dẫn tích hợp.
