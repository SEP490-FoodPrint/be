# Hướng dẫn đóng góp FoodPrint Backend

Tài liệu này hướng dẫn thành viên tạo commit và Pull Request (PR). Quy tắc coding, kiến trúc và an toàn database được quản lý tại [AGENTS.md](AGENTS.md); cách thiết lập local nằm trong [README.md](README.md).

## 1. Chuẩn bị Git hooks

Dùng Node.js theo `.nvmrc` (hiện là 24.22.1) và npm 11. Tại root repo:

```bash
nvm use
npm ci
```

`npm ci` chạy script `prepare` để cài Husky. Nếu đã cài dependencies nhưng hooks chưa hoạt động, chạy `npm run prepare`. Kiểm tra bằng `git config --get core.hooksPath`; giá trị mong đợi là `.husky/_`. Terminal hoặc Git client dùng để commit cần truy cập được Node.js và npm.

## 2. Định dạng commit message

Dự án dùng **Conventional Commits**, được kiểm tra bằng [commitlint.config.cjs](commitlint.config.cjs):

```text
<type>(<scope>): <mô tả ngắn>
```

- `type` bắt buộc, viết thường và thuộc danh sách bên dưới.
- `scope` tùy chọn: ví dụ `auth`, `ingredient`, `database`, `cache`, `backend`, `team`. Hiện chưa có whitelist scope.
- Có dấu `:` và một khoảng trắng trước mô tả. Mô tả phải có nội dung, diễn đạt thay đổi cụ thể, bắt đầu bằng chữ thường và không kết thúc bằng dấu chấm.
- Dòng tiêu đề tối đa **100 ký tự**, tính cả type, scope và khoảng trắng. Đây là giới hạn của cấu hình hiện tại.
- Có thể viết tiếng Anh hoặc tiếng Việt rõ nghĩa; Commitlint không bắt buộc ngôn ngữ. Preset chặn các kiểu mô tả Sentence case, Start Case, PascalCase và UPPERCASE.

### Các type được chấp nhận

| Type       | Dùng khi                               |
| ---------- | -------------------------------------- |
| `feat`     | Thêm tính năng                         |
| `fix`      | Sửa lỗi                                |
| `refactor` | Cấu trúc lại code, giữ nguyên hành vi  |
| `perf`     | Cải thiện hiệu năng                    |
| `docs`     | Sửa tài liệu                           |
| `test`     | Thêm hoặc sửa test                     |
| `style`    | Đổi định dạng code, giữ nguyên hành vi |
| `build`    | Đổi hệ thống build hoặc dependencies   |
| `ci`       | Đổi cấu hình CI                        |
| `chore`    | Bảo trì công cụ hoặc công việc phụ trợ |
| `revert`   | Hoàn tác thay đổi trước đó             |

Ví dụ hợp lệ:

```text
feat(auth): implement login validation
fix(ingredient): correct quantity validation
refactor(database): extract prisma repository
docs(backend): update architecture guidelines
docs(team): hướng dẫn quy tắc commit
chore: update development tooling
```

Ví dụ không hợp lệ:

```text
update code
fix bug
abc
Feat(auth): implement login validation
fix(auth): Implement login validation
fix(auth): correct token parsing.
```

### Body, footer và breaking change

Thêm body để giải thích lý do hoặc tác động khi cần. Đặt dòng trống giữa header, body và footer; preset hiện cảnh báo nếu thiếu dòng trống. Body/footer được kiểm tra giới hạn 100 ký tự mỗi dòng theo quy tắc của Commitlint.

Với thay đổi phá vỡ tương thích, dùng `!` và mô tả yêu cầu chuyển đổi trong footer:

```text
feat(cache)!: require ttl for cached reads

BREAKING CHANGE: callers must provide ttlSeconds explicitly
```

Đây là cách trình bày được khuyến nghị; cấu hình hiện tại chưa bắt buộc mọi header có `!` phải kèm footer `BREAKING CHANGE`.

## 3. Hooks kiểm tra những gì?

| Hook         | Kiểm tra                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `pre-commit` | Chạy lint-staged: ESLint và Prettier trên source đã stage; Prettier trên JSON, Markdown và YAML đã stage |
| `commit-msg` | Chạy Commitlint trên message của commit đang tạo                                                         |

Các lệnh nằm trong [.husky/pre-commit](.husky/pre-commit), [.husky/commit-msg](.husky/commit-msg) và [lint-staged.config.mjs](lint-staged.config.mjs). Hook không chạy `--fix` hoặc `--write`; lỗi kiểm tra sẽ chặn commit. File có lỗi từ trước vẫn bị chặn nếu được stage.

Lint/format bỏ qua generated Prisma Client, `dist`, `node_modules`, `.env*`, SQL/schema/migrations, dumps, logs và lockfile. **Lockfile vẫn phải được commit cùng thay đổi dependencies tương ứng**, dù không được lint/format.

Pre-commit không chạy typecheck, build hay tests. Commitlint dùng các ngoại lệ mặc định cho một số message do Git/công cụ tạo, như merge, revert hoặc release; thành viên vẫn dùng định dạng Conventional Commits cho commit thông thường.

## 4. Quy tắc đặt tên nhánh

Các nhánh công việc mới dùng một trong hai dạng:

```text
<type>/<description>
<type>/<issue-number>-<description>
```

- `type` dùng các giá trị trong bảng commit phía trên: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `style`, `build`, `ci`, `chore`, `revert`.
- `description` mô tả ngắn gọn công việc bằng tiếng Anh, viết thường theo `kebab-case`. Chỉ dùng chữ ASCII `a-z`, số `0-9` và dấu `-` để ngăn cách từ.
- Chỉ có một dấu `/` giữa type và phần mô tả. Không dùng khoảng trắng, dấu tiếng Việt, chữ hoa, `_`, dấu `-` liên tiếp hoặc dấu `-` ở đầu/cuối phần mô tả.
- `issue-number` tùy chọn, dùng số issue nếu có, ví dụ `123`. Không bắt buộc tạo issue chỉ để đặt tên nhánh.
- Mỗi nhánh tập trung vào một công việc. Tránh tên chung chung như `feat/update` hoặc `fix/bug`, dù chúng đúng cú pháp.

Ví dụ hợp lệ:

```text
feat/auth-login-validation
fix/123-role-claim-validation
refactor/database-client
docs/contribution-guide
test/cache-expiration
```

Ví dụ không hợp lệ:

```text
feature/auth-login
feat/AuthLogin
fix/role_validation
feat/auth/login
feat/auth--login
feat/
```

Biểu thức mô tả cú pháp tên nhánh công việc:

```text
^(feat|fix|refactor|perf|docs|test|style|build|ci|chore|revert)/[a-z0-9]+(-[a-z0-9]+)*$
```

Quy tắc tên phía trên áp dụng cho nhánh công việc. Hai nhánh lâu dài được dùng như sau:

- `main`: code ổn định; nhận PR từ `dev` sau khi kiểm thử và review.
- `dev`: nhánh tích hợp; tạo các nhánh công việc từ đây và mở PR trở lại `dev`.

Luồng hiện tại là `dev` → `<type>/<description>` → PR vào `dev` → PR từ `dev` vào `main`. Chưa quy định nhánh `release/*` hoặc `hotfix/*`; nếu bổ sung Gitflow đầy đủ, team cần cập nhật quy tắc tên và luồng đồng bộ tương ứng.

Đây là quy ước team cần review thủ công: hooks hiện tại chưa kiểm tra tên nhánh. Commitlint chỉ kiểm tra commit message. `git check-ref-format --branch <ten-nhanh>` chỉ kiểm tra cú pháp Git, không xác minh đầy đủ quy ước phía trên.

## 5. Quy trình làm việc

Mỗi commit tập trung vào một thay đổi có thể giải thích và review độc lập. Tạo nhánh công việc theo quy tắc phía trên trước khi bắt đầu thay đổi mới.

Ví dụ cho thay đổi tài liệu, bắt đầu từ `dev` đã cập nhật:

```bash
git switch dev
git pull --ff-only origin dev
git switch -c docs/contribution-guide
# Chỉnh sửa các file liên quan.
npm exec --no -- prettier --check contribute.md README.md
git status --short
git add contribute.md README.md
git diff --cached --stat
git diff --cached
git commit -m "docs(team): document contribution workflow"
git push -u origin HEAD
```

Mở PR trên GitHub với **base: `dev`**, **compare: nhánh công việc**. Thành viên chưa có `dev` local chạy `git fetch origin` rồi `git switch --track origin/dev` một lần. Không push công việc trực tiếp lên `main` hoặc `dev`; lần thiết lập ban đầu tạo nhánh `dev` và CI là bước bootstrap của người quản lý repo.

Kiểm tra **toàn bộ nội dung đã stage** trước khi commit, kể cả file đã stage từ công việc khác. Chỉ stage các file thuộc phạm vi thay đổi; không commit credentials, JWT secrets, `.env`, dumps, `node_modules`, `dist` hoặc generated client. Mỗi thành viên dùng database local riêng theo AGENTS.md.

## 6. Kiểm tra trước khi mở PR

Với thay đổi source backend, chạy:

```bash
npm run validate
npm run test:unit
```

`validate` chạy `lint` → `format:check` → `typecheck` → `build`, dừng tại lỗi đầu tiên; không tự chạy tests. `test:unit` chạy các test cache, module nghiệp vụ, rate limit và role middleware không cần PostgreSQL/Redis. Khi thêm unit test mới, bổ sung file vào script `test:unit` để CI chạy được. Backend phải được kiểm tra typecheck/build. Nếu validate dừng sớm, ghi rõ lỗi và kết quả các kiểm tra chạy riêng, không báo toàn bộ PASS.

Chạy thêm theo phần thay đổi:

- Cache: `npm run test:cache`; có Redis local thì chạy `npm run test:cache:redis`.
- Rate limit: `npm run test:rate-limit`; có Redis local thì chạy `npm run test:rate-limit:redis`.
- Kết nối PostgreSQL/Redis: chạy `npm run db:check` hoặc `npm run redis:check` tương ứng khi hạ tầng local sẵn sàng.
- Chỉ sửa tài liệu: kiểm tra Prettier các file Markdown đã sửa. Không cần mở kết nối database để kiểm tra tài liệu.

Ghi rõ kiểm tra bị BLOCKED và nguyên nhân nếu thiếu hạ tầng. Các lệnh kiểm tra/generate không cho phép tự chạy DDL, migrations, reset, deploy hoặc xóa volume; tuân thủ phạm vi được phê duyệt trong AGENTS.md.

PR cần có:

- Tên nhánh đúng quy tắc và nhánh đích `dev` cho công việc thường ngày; PR phát hành từ `dev` vào `main`.
- Vấn đề cần giải quyết và hành vi/cấu hình sau thay đổi.
- Issue liên quan nếu có, cùng phạm vi các thành phần bị ảnh hưởng.
- Lệnh kiểm tra thực tế và kết quả PASS/FAIL/BLOCKED; nêu lỗi còn tồn tại.
- Ví dụ request/response đã loại thông tin nhạy cảm nếu thay đổi API; hướng dẫn cấu hình hoặc chuyển đổi nếu cần.

Hooks kiểm tra local; GitHub Actions tại [.github/workflows/ci.yml](.github/workflows/ci.yml) chạy lại kiểm tra khi push lên `main`/`dev` hoặc mở/cập nhật PR vào hai nhánh này. Job **Backend quality** cài dependencies bằng `npm ci`, kiểm tra Conventional Commits, validate/generate Prisma, chạy `validate` và `test:unit`. PR kiểm tra toàn bộ commit trong khoảng base/head; push kiểm tra commit cuối cùng. Merge/revert messages vẫn theo ngoại lệ của Commitlint hiện tại.

CI lấy Node từ `.nvmrc`, yêu cầu npm theo `package.json`, dùng URL PostgreSQL placeholder local chỉ để tải Prisma config. CI không kết nối database, chạy Redis integration tests, migration, deploy hoặc tải `.env`/secrets thật. Không có dịch vụ PostgreSQL/Redis được dựng trong workflow này. Chất lượng mô tả, phạm vi commit/PR và quy trình nhánh vẫn cần team review.

Người quản lý repo cần bật branch protection/ruleset trên GitHub cho `main` và `dev`, yêu cầu PR, ít nhất một approval, giải quyết thảo luận và status check **Backend quality**, đồng thời chặn force push/xóa nhánh. Workflow tự chạy không tự chặn merge khi chưa có rule yêu cầu check. Các thiết lập GitHub này cần quyền quản trị riêng và không được tạo chỉ bằng file YAML trong repo.

## 7. Khi commit bị chặn

Đọc tên hook, file/dòng lỗi hoặc rule Commitlint trong terminal. Sửa đúng file/message, kiểm tra lại, stage lại file đã sửa rồi commit. Có thể format riêng một file bằng `npm exec --no -- prettier --write <duong-dan-file>`; kiểm tra danh sách file trước khi dùng `npm run format` vì lệnh đó format toàn repo. Không bỏ qua hooks để coi một thay đổi chưa đạt kiểm tra là đã đạt.

Thử message mà không tạo commit:

```bash
printf '%s\n' 'docs(team): update contribution guide' | npm exec --no -- commitlint
```
