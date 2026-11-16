# Writing Bank — Module thành viên và workspace

Module độc lập để phát triển và kiểm thử trước khi ghép vào Writing Bank.

- **Backend:** Java 17 + Spring Boot 3, Firebase Admin SDK.
- **Database:** Cloud Firestore; local và integration test dùng Firestore emulator.
- **Frontend:** React + React Router + Vite.

Web chỉ gọi Java API. Backend là thành phần duy nhất đọc và ghi Firestore; [firestore.rules](firestore.rules) chặn truy cập trực tiếp từ client.

## Module làm gì

| Phần | Nội dung |
|---|---|
| **Member** | Tài khoản `@hyperdatalab.org` đăng nhập qua HyperDataLab SSO. Mỗi lần đăng nhập, backend nhận tên, ảnh, ngành, mã sinh viên và vai trò từ SSO rồi lưu vào hồ sơ user. |
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
npm run dev            # emulator + backend (8080) + web (3000) trong một lệnh
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

Nút **Reset dữ liệu mẫu** ở màn đăng nhập (`POST /api/dev/reset`) xoá toàn bộ dữ liệu trong emulator rồi tạo lại như bảng trên. Đặt `DEV_SEED=false` nếu không muốn tự tạo dữ liệu mẫu. Các route `/api/dev/*` và dữ liệu mẫu chỉ tồn tại khi `AUTH_MODE=dev`.

## Kịch bản thử

1. `alice@hyperdatalab.org` đăng nhập với role `member` và gửi **Xin tạo workspace**.
2. `admin@hyperdatalab.org` mở **Quản trị → Yêu cầu tạo workspace** và duyệt. Alice thành `workspace_manager` và workspace được tạo.
3. `bob@hyperdatalab.org` gửi yêu cầu tham gia workspace của Alice; Alice duyệt trong **Quản lý workspace**.
4. Bob gửi yêu cầu download paper ở trang workspace; Alice xem và duyệt trong **Yêu cầu download**.
5. Admin vô hiệu hoá Bob; request đăng nhập tiếp theo của Bob bị từ chối với `403 disabled`.

## Test và kiểm tra frontend

Integration test dùng Firestore emulator trong Docker Compose. Dữ liệu các collection nghiệp vụ được xoá trước mỗi test; workspace types được seed lại idempotent lúc ứng dụng khởi động.
Backend test suite gồm kiểm thử API trên emulator và unit test.

```bash
npm run db:up
npm test
npm run typecheck
npm run build
```

## Cấu trúc mã nguồn

```text
backend/src/main/java/org/hyperdatalab/wbmodule/
  auth/             Xác thực và filter
  admin/            API quản trị
  common/           Lỗi, role và cấu hình ứng dụng
  config/           Cấu hình Firestore
  directory/        Adapter user directory
  identity/         Danh tính, audit và API hồ sơ
  store/            Truy cập Firestore
  workspace/        Workspace, quyền và membership
    request/        Yêu cầu tạo workspace
    download/       Yêu cầu download
web/src/
  app/              Router, layout và context
  features/         Màn hình auth, admin và workspace
  shared/           Component, API client và kiểu dùng chung
```

## Cấu hình chính

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `FIRESTORE_PROJECT_ID` | `hyperdatalab-writing-bank` | Project ID cho Firestore. |
| `FIRESTORE_EMULATOR_HOST` | rỗng | Đặt `localhost:8085` để dùng emulator; để trống khi chạy production. |
| `GOOGLE_APPLICATION_CREDENTIALS` | rỗng | Service account JSON cho production; nếu rỗng backend dùng ADC. |
| `AUTH_MODE` | `dev` | Dùng `sso` khi chạy production (HyperDataLab SSO). `firebase` là đăng nhập Google qua Firebase Auth. |
| `SSO_BASE_URL` | rỗng | Địa chỉ Worker của ResearchPulse phục vụ `/oauth/*`. Bắt buộc khi `AUTH_MODE=sso`. |
| `SSO_CLIENT_ID` | rỗng | Client id của module, lấy ở ResearchPulse → Connected applications. Bắt buộc khi `AUTH_MODE=sso`. |
| `SSO_CLIENT_SECRET` | rỗng | Secret của client loại Confidential; để trống nếu đăng ký loại Public. Chỉ đặt ở backend. |
| `SSO_SESSION_HOURS` | `12` | Thời gian một lần đăng nhập có hiệu lực trước khi phải qua SSO lại. |
| `PROJECTS_MODE` | `auto` | Nguồn dự án: `auto` (ResearchPulse khi dùng SSO, dữ liệu mẫu khi dev), `http`, `demo` hoặc `off`. |
| `PROJECTS_BASE_URL` | rỗng | Địa chỉ API dự án; rỗng thì dùng `SSO_BASE_URL`. |
| `SSO_TOKEN_KEY` | rỗng | Khoá mã hoá token SSO lưu ở backend (base64 của 32 byte). Production nên đặt, mọi instance dùng chung. |
| `FIREBASE_PROJECT_ID` | `hyperdatalab-writing-bank` | Firebase project dùng để kiểm tra ID token. |
| `ADMIN_EMAIL` | `admin@hyperdatalab.org` | Admin đầu tiên, luôn là `admin` và không sửa được trên giao diện. Phải là tài khoản có thật trong user directory. |
| `DIRECTORY_MODE` | `mock` | Nguồn user directory: `http`, `google`, `mock` hoặc `off`. Bị bỏ qua (luôn là `off`) khi `AUTH_MODE=sso`. |
| `DIRECTORY_HTTP_BASE_URL`, `DIRECTORY_HTTP_TOKEN` | rỗng | Cấu hình adapter HTTP. |
| `GOOGLE_SA_FILE` | rỗng | Service account cho adapter Google Directory. |
| `CORS_ORIGIN` | `http://localhost:3000` | Origin của web. |

Firebase Admin SDK dùng phiên bản 9.11.0. Production cần cấu hình credentials và triển khai các composite index trong [firestore.indexes.json](firestore.indexes.json).

## Đăng nhập bằng HyperDataLab SSO

Production dùng `AUTH_MODE=sso` (backend) và `VITE_AUTH_MODE=sso` (web). SSO là OAuth 2.0 Authorization Code + PKCE do Worker của ResearchPulse phục vụ.

1. Web tạo `state` và PKCE verifier, chuyển người dùng tới `{SSO_BASE_URL}/oauth/authorize`.
2. Người dùng đăng nhập Google Workspace ở ResearchPulse. SSO trả về callback URL đã đăng ký kèm `?code=...&state=...`.
3. Web kiểm tra `state` rồi gửi `code` và verifier cho backend (`POST /api/v1/sessions`).
4. Backend đổi `code` lấy access token, gọi `/oauth/userinfo`, lưu hồ sơ user, rồi trả về một session token của module. Web gửi token này trong `Authorization: Bearer` cho mọi request.

Backend tự đổi `code` bằng client id của module, nên token cấp cho ứng dụng khác trong hệ sinh thái không dùng được ở đây. Access token của SSO không rời backend và không được lưu. Session chỉ lưu dạng hash trong collection `sessions`, hết hạn sau `SSO_SESSION_HOURS` giờ; đăng xuất xoá session ngay.

Việc cần làm để bật SSO:

- Admin ResearchPulse đăng ký ứng dụng ở `/admin/users` → **Connected applications**, callback URL mặc định là `<origin của web>/auth/callback`. Nếu đăng ký URL khác (ví dụ chỉ `http://localhost:3000`) thì đặt đúng URL đó vào `VITE_SSO_CALLBACK_URL`; web hoàn tất đăng nhập ở bất kỳ URL nào SSO trả về, scope `email`, `profile`, `hyperdatalab_profile`. Nên chọn loại **Confidential** vì module có backend.
- Chạy local: chép `.env.example` thành `.env` ở thư mục gốc, đổi `AUTH_MODE` và `VITE_AUTH_MODE` thành `sso`, dán client id (hai chỗ) và secret, rồi `npm run dev`. File `.env` không được commit.
- Production, backend: đặt biến môi trường `AUTH_MODE=sso`, `SSO_BASE_URL`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET` (nếu Confidential), `CORS_ORIGIN` trùng origin của web.
- Production, web (lúc build image): `VITE_AUTH_MODE=sso`, `VITE_SSO_BASE_URL`, `VITE_SSO_CLIENT_ID`.
- Firestore: bật TTL policy cho field `expiresAt` của collection `sessions` để dọn session hết hạn.
- `ADMIN_EMAIL` phải là tài khoản đăng nhập được qua SSO (hồ sơ ResearchPulse đã duyệt).

Giới hạn cần biết:

- SSO không có API tra cứu user theo email. Manager thêm được mọi địa chỉ `@hyperdatalab.org`; hồ sơ (tên, ngành) chỉ có sau lần đăng nhập đầu của người đó.
- Hồ sơ bị khoá ở ResearchPulse sẽ không đăng nhập mới được, nhưng session đang mở còn hiệu lực tới khi hết hạn. Muốn chặn ngay thì admin vô hiệu hoá user trong module.

## Dự án nghiên cứu (ResearchPulse)

Trang **Dự án** (`/projects`) đọc dự án từ ResearchPulse theo tài liệu `EXTERNAL_RESEARCH_PROJECTS_API_VI.md` của bên ResearchPulse. Module không lưu dự án.

- Mỗi người thấy **các dự án mình đang tham gia** (`GET /api/v1/me/research-projects`) và chi tiết từng dự án kèm thành viên (tên, vai trò). API của ResearchPulse chưa có danh sách toàn lab và chưa cho đọc email thành viên.
- Backend gọi ResearchPulse bằng **access token SSO của chính người dùng**, nhận lúc đăng nhập, lưu mã hoá (AES-GCM, khoá `SSO_TOKEN_KEY`) cùng session và không gửi xuống trình duyệt. Token sống 1 giờ, không gia hạn được: sau đó trang có nút **Đăng nhập lại**.
- Scope `research_projects:read` **tự bật**: trước mỗi lần đăng nhập, web hỏi backend (`GET /api/v1/sessions/options`), backend thử `/oauth/authorize` với scope đó. ResearchPulse đã cấp thì xin luôn, chưa cấp thì đăng nhập như thường (xin scope chưa được cấp sẽ làm SSO từ chối cả lần đăng nhập). Kết quả được nhớ 5 phút nếu chưa cấp, 6 giờ nếu đã cấp.
- **Admin thêm/xoá thành viên dự án**: giao diện và API đã có nhưng chỉ hoạt động với dữ liệu mẫu, vì API của ResearchPulse chỉ cho đọc. Với dữ liệu thật, phần này tự ẩn (`canManageMembers: false`) và các API ghi trả `501 not_supported`.
- `PROJECTS_MODE=auto` (mặc định): đăng nhập SSO thì đọc ResearchPulse, chế độ `dev` thì dùng 3 dự án mẫu trong bộ nhớ.

API của module:

| Method | Path | Ai | Mô tả |
|---|---|---|---|
| GET | `/api/v1/projects` | Mọi người | `{mode, listsAll, canManageMembers, items}`. |
| GET | `/api/v1/projects/{id}` | Mọi người | Chi tiết kèm `members`; admin thấy `email` khi nguồn có. |
| POST | `/api/v1/projects/{id}/members` | Admin | `{email, role}`; `501` khi ResearchPulse chưa hỗ trợ. |
| PATCH | `/api/v1/projects/{id}/members/{uid}` | Admin | `{role}`. |
| DELETE | `/api/v1/projects/{id}/members/{uid}` | Admin | Xoá thành viên. |

Lỗi thường gặp: `409 sso_token_expired` (quá 1 giờ sau đăng nhập), `409 scope_not_granted` (ResearchPulse chưa cấp quyền đọc dự án), `429 rate_limited`, `502 projects_unavailable`.

## User directory

Phần này chỉ áp dụng khi không dùng SSO (`AUTH_MODE=firebase` hoặc `dev`).

- **`http`** — `GET {baseUrl}/users/{email}` và `GET {baseUrl}/users?domain=hyperdatalab.org`; có thể gửi `Authorization: Bearer {token}`. Danh sách có thể chia trang bằng `nextPageToken` (gọi tiếp với `&pageToken=`). Hợp đồng này là tạm, sẽ chỉnh theo tài liệu API thật của hệ sinh thái trong `HttpUserDirectory`.

Đồng bộ toàn bộ (hằng đêm 02:00 và nút của admin) đánh dấu `missing` những user không còn trong danh sách. Nếu directory trả về danh sách rỗng, hoặc ít hơn một nửa số user đang `active` (khi có từ 10 user trở lên), lần đồng bộ bị huỷ với `502 directory_error` và không ghi gì.
- **`google`** — Google Admin SDK Directory API qua service account có domain-wide delegation với scope `admin.directory.user.readonly`.
- **`mock`** — danh sách `app.directory.mock-users` trong `application-test.yml`.
- **`off`** — tắt kiểm tra directory.

Xem [docs/INTEGRATION.md](docs/INTEGRATION.md) để biết API và hướng dẫn tích hợp.
