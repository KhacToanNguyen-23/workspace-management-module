# Writing Bank — Module Workspace & Corpus

Module độc lập, viết để test riêng rồi ghép vào repo Writing Bank. Dùng cùng stack với Writing Bank:
**React + react-router + Firebase Auth (Google, `hd=hyperdatalab.org`)** ở frontend và **Cloudflare Worker** ở backend
(thêm D1 làm database và R2 để lưu file).

Module gồm:

| Phần | Nội dung |
|---|---|
| **Quản lý user/member** | Chỉ tài khoản `@hyperdatalab.org`. Khi đăng nhập, backend gọi **Google Admin SDK Directory API** để kiểm tra user còn tồn tại và còn active, đồng thời lấy tên và org unit. Có cron đồng bộ toàn bộ danh bạ hằng đêm. `admin@hyperdatalab.org` luôn là admin. |
| **Workspace** | Admin tạo workspace, chọn **loại** (research / annotation / review, có thể thêm loại mới) và gán manager. User chưa thuộc workspace nào sẽ bị đưa vào màn chọn workspace để **gửi yêu cầu**, và chỉ vào được sau khi **manager duyệt**. |
| **Phân quyền** | Vai trò trong workspace: viewer < member < manager. Manager **bật/tắt quyền của workspace**. Quyền thực tế = quyền của vai trò ∩ quyền đang bật. Mọi thay đổi đều ghi audit log. |
| **Corpus** | Danh sách corpus của workspace, kèm số bài theo từng bước của pipeline. |
| **Fetcher** | Lấy *metadata* từ OpenAlex/Crossref theo từ khoá hoặc danh sách DOI. Có bước xem trước, người dùng tick chọn rồi mới lưu. Tự bỏ qua bài trùng (cùng id hoặc DOI). |
| **Downloader** | Chỉ tải bài open access có link file (giới hạn 25 MB), lưu file vào R2. |
| **Extraction** | Bóc text từ PDF (`unpdf`) hoặc HTML, nhận diện section, tách câu (xử lý được e.g., et al., số thập phân), dừng ở phần References. |

## Chạy local

```bash
npm install
npm run db:migrate -w worker      # tạo D1 local
npm run dev:worker                # http://127.0.0.1:8787
npm run dev:web                   # http://localhost:5174
```

Ở local, mặc định `AUTH_MODE=dev` và `DIRECTORY_MODE=mock`. Màn đăng nhập hiện ô nhập email; mọi địa chỉ
`@hyperdatalab.org` đều được coi là active. Muốn giả lập danh bạ cụ thể, đặt `DIRECTORY_MOCK` trong
`worker/.dev.vars` (xem `.dev.vars.example`).

Kịch bản thử:
1. Đăng nhập `admin@hyperdatalab.org`, vào **Quản trị**, tạo workspace và gán manager (ví dụ `mai@hyperdatalab.org`).
2. Đăng nhập `alice@hyperdatalab.org`: alice bị đưa vào **Tham gia workspace** và gửi yêu cầu.
3. Đăng nhập `mai@...`, vào **Thành viên & quyền** và duyệt alice.
4. alice tạo corpus, chạy **Fetcher** (xem trước rồi lưu), **Tải file**, rồi **Chạy extraction**, và mở tài liệu để xem các câu.

## Kiểm tra

```bash
npm test          # 33 test: identity, directory, workspace, duyệt, quyền, fetch→download→extract
npm run typecheck
npm run build
```

Test chạy trên SQLite có sẵn trong Node (`node:sqlite`, cần Node ≥ 22.5), dùng đúng file migration của D1.
Các API bên ngoài (OpenAlex, Google Directory, downloader) đều được thay bằng bản giả trong test.

## Cấu hình production

Các biến trong `worker/wrangler.toml`:

| Biến | Production |
|---|---|
| `AUTH_MODE` | `firebase`: verify Firebase ID token của project `hyperdatalab-writing-bank` |
| `DIRECTORY_MODE` | `google` |
| `GOOGLE_SA_KEY` (secret) | JSON của service account đã bật **domain-wide delegation** với scope `https://www.googleapis.com/auth/admin.directory.user.readonly`. Request được gửi dưới danh nghĩa `ADMIN_EMAIL`. |
| `ADMIN_EMAIL` | `admin@hyperdatalab.org` |
| `CORS_ORIGIN` | origin của web, ví dụ `https://hyperdatalab-writing-bank.web.app` |
| `API_CONTACT_EMAIL` | (tuỳ chọn) email liên hệ gửi kèm request tới OpenAlex/Crossref để vào polite pool |

Phía web (`web/.env.local`): `VITE_AUTH_MODE=firebase` và các biến `VITE_FIREBASE_*`.

Bật Directory API (việc admin Google Workspace phải làm):
1. Trong Google Cloud: tạo service account, bật *Admin SDK API*, tạo key JSON.
2. Trong Admin console: Security → API controls → Domain-wide delegation, thêm client ID của service account với scope ở trên.
3. `npx wrangler secret put GOOGLE_SA_KEY` (dán JSON vào).

Xem [docs/INTEGRATION.md](docs/INTEGRATION.md) để biết cách ghép module vào repo Writing Bank.
