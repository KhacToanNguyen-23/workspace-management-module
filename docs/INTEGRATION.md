# Ghép module vào repo Writing Bank

Writing Bank hiện có frontend React (Firebase Hosting), Firebase Auth Google với `hd=hyperdatalab.org`,
một backend Worker (`writingbank-worker`) và route `/members` với các vai trò `member / reviewer / admin`.
Module này viết cùng stack nên có thể ghép từng phần.

## API (prefix `/api`)

| Method | Path | Quyền |
|---|---|---|
| GET | `/me` | đã đăng nhập |
| GET | `/workspaces`, `/workspace-types` | đã đăng nhập |
| POST / DELETE | `/workspaces/:id/join` | đã đăng nhập (gửi / rút yêu cầu, rời workspace) |
| GET | `/w/:wid` | member đã được duyệt |
| GET | `/w/:wid/members?status=` | `members.manage` |
| POST | `/w/:wid/members` (thêm trực tiếp) | `members.manage` |
| POST | `/w/:wid/members/:mid/approve` \| `reject` \| `revoke` | `members.manage` |
| PATCH | `/w/:wid/members/:mid` (đổi vai trò) | `members.manage`; gán/gỡ manager chỉ admin làm được |
| PUT | `/w/:wid/permissions` | `members.manage` |
| GET | `/w/:wid/audit` | `members.manage` |
| GET / POST | `/w/:wid/corpora` | `corpus.read` / `corpus.write` |
| DELETE | `/w/:wid/corpora/:cid` | `corpus.write` |
| GET | `/w/:wid/corpora/:cid/documents?status=&q=&page=` | `corpus.read` |
| POST | `/w/:wid/corpora/:cid/fetch/preview`, `/fetch` | `corpus.fetch` |
| POST | `/w/:wid/corpora/:cid/download` (≤10 id) | `corpus.download` |
| POST | `/w/:wid/corpora/:cid/extract` (≤10 id) | `extraction.run` |
| GET | `/w/:wid/documents/:did`, `/file` | `corpus.read` |
| `*` | `/admin/users`, `/admin/users/sync`, `/admin/workspaces`, `/admin/workspaces/:id/managers`, `/admin/workspace-types`, `/admin/audit` | admin |

## Các bước ghép

1. **Database**: thêm `worker/migrations/0001_init.sql` vào migration D1 của Writing Bank. Nếu Writing Bank đang lưu
   member ở KV hoặc store khác, bảng `users` dùng `email` làm khoá chính nên có thể map từ `uid/email` sẵn có.
2. **Backend**: copy `worker/src/{lib,services,fetchers,routes}`, rồi mount bằng
   `app.route("/api", meRoutes)`, `app.route("/api/admin", adminRoutes)`, `app.route("/api/w/:wid", workspaceRoutes)`,
   `app.route("/api/w/:wid", corpusRoutes())`. Middleware xác thực trong `app.ts` (`verifyToken` + `resolveUser`)
   thay cho bước verify token hiện có, hoặc dùng song song với nó.
3. **Vai trò cũ → mới**: `admin` của Writing Bank tương ứng `global_role = 'admin'`. `reviewer` có thể map thành
   vai trò `manager` trong workspace tương ứng, hoặc giữ nguyên làm vai trò duyệt nội dung (không liên quan tới module này).
4. **Downloader có sẵn**: implement interface `Downloader` (`services/downloader.ts`) bằng downloader của Writing Bank,
   rồi truyền vào `corpusRoutes((maxBytes) => new ExistingDownloader(...))`.
5. **Nguồn fetch mới**: implement `Fetcher` (`fetchers/types.ts`) và đăng ký trong `fetchers/index.ts`.
6. **Frontend**: copy `web/src/pages/*`, `web/src/lib/{api,types}.ts`, `web/src/components/ui.tsx`. Bỏ `lib/auth.tsx` và
   dùng auth provider của Writing Bank (chỉ cần một hàm `getToken()` trả về Firebase ID token). Thêm các route
   `/onboarding`, `/w/:wid/...`, `/admin` vào router và các mục tương ứng vào sidebar.

## Lưu ý vận hành

- Mỗi request download/extract xử lý tối đa 10 tài liệu, và frontend tự chia lô. Nếu corpus lớn hơn nhiều,
  nên chuyển sang Cloudflare Queues; logic trong `routes/corpus.ts` tách sẵn để chuyển được.
- Nhiều nhà xuất bản chặn tải tự động (HTTP 403). Những bài đó được đánh dấu `download_failed` kèm lý do,
  và extraction vẫn chạy được trên abstract.
- Kết quả tra danh bạ được cache 12 giờ cho mỗi user. Cron đồng bộ hằng đêm sẽ đánh dấu `missing` những ai đã rời domain.
