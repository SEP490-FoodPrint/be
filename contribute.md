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

Riêng nhánh có thay đổi `src/**` hoặc `prisma/**` dùng dạng `<feat|fix|refactor|perf>/<feature-slug>` gắn với spec `specs/<feature-slug>/`; số thứ tự không bắt buộc, tên cũ có số vẫn được hỗ trợ. Job **Spec gate** trong CI kiểm tra cấu trúc và quan hệ nhánh/spec. Xem [mục 8](#8-quy-trình-spec-driven-với-spec-kit).

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
- Kết nối PostgreSQL/Redis: chạy `npm run db:check` hoặc `npm run redis:check` tương ứng khi hạ tầng sẵn sàng.
- Thay đổi schema/model database: tạo migration local bằng `npm run db:migrate:create -- --name <description>`, review SQL và CHECK, áp dụng local bằng `npm run db:migrate`, rồi chạy `npm run test:migrations` trên PostgreSQL test mới. Không dùng `db push` hoặc `migrate dev` để cập nhật Azure. Xem [quy trình baseline/migration](database/SCHEMA_BASELINE.md).
- Thay đổi xác thực/phân quyền: chạy `npm run test:unit` và `npm run test:authorization` với `MIGRATION_TEST_DATABASE_URL` trỏ PostgreSQL test local riêng; xem [hợp đồng và ma trận quyền](docs/AUTHORIZATION.md).
- Chỉ sửa tài liệu: kiểm tra Prettier các file Markdown đã sửa. Không cần mở kết nối database để kiểm tra tài liệu.

Ghi rõ kiểm tra bị BLOCKED và nguyên nhân nếu thiếu hạ tầng. Các lệnh kiểm tra/generate không cho phép tự chạy DDL, migrations, reset, deploy hoặc xóa volume; tuân thủ phạm vi được phê duyệt trong AGENTS.md.

PR cần có:

- Tên nhánh đúng quy tắc và nhánh đích `dev` cho công việc thường ngày; PR phát hành từ `dev` vào `main`.
- Đường dẫn spec `specs/<feature-slug>/` nếu PR thay đổi `src/**` hoặc `prisma/**` (xem [mục 8](#8-quy-trình-spec-driven-với-spec-kit)).
- Vấn đề cần giải quyết và hành vi/cấu hình sau thay đổi.
- Issue liên quan nếu có, cùng phạm vi các thành phần bị ảnh hưởng.
- Lệnh kiểm tra thực tế và kết quả PASS/FAIL/BLOCKED; nêu lỗi còn tồn tại.
- Ví dụ request/response đã loại thông tin nhạy cảm nếu thay đổi API; hướng dẫn cấu hình hoặc chuyển đổi nếu cần.

Hooks kiểm tra local; GitHub Actions tại [.github/workflows/ci.yml](.github/workflows/ci.yml) chạy lại kiểm tra khi push lên `main`/`dev` hoặc mở/cập nhật PR vào hai nhánh này. Job **Code quality** cài dependencies bằng `npm ci`, kiểm tra Conventional Commits, validate/generate Prisma, chạy `validate` và `test:unit`. PR kiểm tra toàn bộ commit trong khoảng base/head; push kiểm tra commit cuối cùng. Merge/revert messages vẫn theo ngoại lệ của Commitlint hiện tại.

CI lấy Node từ `.nvmrc`, yêu cầu npm theo `package.json`. Job Code quality dùng URL placeholder local; job PostgreSQL migrations dùng service PostgreSQL 18 tạm để kiểm tra baseline, migration, CHECK và phân quyền/phạm vi dữ liệu bằng `test:authorization`. Job **Spec gate** chỉ chạy với PR và kiểm tra spec theo [mục 8.5](#85-spec-gate-trong-ci). Job Backend quality tổng hợp các kết quả và thất bại nếu Code quality hoặc PostgreSQL migrations lỗi hoặc bị bỏ qua, hay Spec gate lỗi (Spec gate được phép bỏ qua với sự kiện push), giữ nguyên tên check bắt buộc hiện tại. Các job quality không kết nối Azure, chạy Redis integration hoặc tải `.env`/secrets thật. Sau khi CI của push vào `dev` PASS, job CD được gọi để triển khai các migration còn thiếu lên Azure; PR và `main` không deploy database này. Chất lượng mô tả, phạm vi commit/PR và quy trình nhánh vẫn cần team review.

PR thay đổi database phải chứa cả SQL migration mới và schema đích phù hợp. Review SQL trước khi merge vào `dev`, vì bản merge sẽ được CD triển khai khi CI PASS. Giữ SQL đã applied bất biến; CD kiểm tra checksum và từ chối lịch sử lỗi/thiếu baseline. Cấu hình environment, secrets, kết nối runner và cách chạy lại được ghi ở [README mục CD](README.md#10-cd-migration-azure-từ-dev).

Người quản lý repo cần bật branch protection/ruleset trên GitHub cho `main` và `dev`, yêu cầu PR, ít nhất một approval, giải quyết thảo luận và status check **Backend quality**, đồng thời chặn force push/xóa nhánh. Workflow tự chạy không tự chặn merge khi chưa có rule yêu cầu check. Các thiết lập GitHub này cần quyền quản trị riêng và không được tạo chỉ bằng file YAML trong repo.

## 7. Khi commit bị chặn

Đọc tên hook, file/dòng lỗi hoặc rule Commitlint trong terminal. Sửa đúng file/message, kiểm tra lại, stage lại file đã sửa rồi commit. Có thể format riêng một file bằng `npm exec --no -- prettier --write <duong-dan-file>`; kiểm tra danh sách file trước khi dùng `npm run format` vì lệnh đó format toàn repo. Không bỏ qua hooks để coi một thay đổi chưa đạt kiểm tra là đã đạt.

Thử message mà không tạo commit:

```bash
printf '%s\n' 'docs(team): update contribution guide' | npm exec --no -- commitlint
```

## 8. Quy trình Spec-Driven với spec-kit

Mọi thay đổi trong `src/**` hoặc `prisma/**` (gồm `feat`, `fix`, `refactor`, `perf`) phải có spec viết bằng [spec-kit](https://github.com/github/spec-kit) và nằm **cùng một PR** với code. Nguyên tắc bất biến của dự án nằm trong [.specify/memory/constitution.md](.specify/memory/constitution.md); chi tiết vẫn theo [AGENTS.md](AGENTS.md). Giải thích chi tiết từng lệnh `$speckit-*`, khi nào dùng và ví dụ thực hành nằm tại [docs/SPEC_KIT_GUIDE.md](docs/SPEC_KIT_GUIDE.md).

### 8.1. Cài đặt một lần

Repo đã commit sẵn `.specify/` (templates, scripts, constitution) và các skill Codex trong `.agents/skills/speckit-*`. Mỗi thành viên chỉ cần CLI để nâng cấp hoặc kiểm tra, không chạy lại `specify init`:

```bash
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git
specify version   # repo đang dùng 0.16.2
```

Mở Codex tại root repo; các lệnh được gọi bằng `$speckit-<tên>`. Không cài extension `git` của spec-kit: nhánh được tạo thủ công theo quy tắc bên dưới.

### 8.2. Đặt tên nhánh và thư mục spec

- Nhánh mới: `<feat|fix|refactor|perf>/<feature-slug>`, ví dụ `feat/menu-weekly-export`.
- Spec mới: `specs/menu-weekly-export/`, có đủ `spec.md`, `plan.md`, `tasks.md`. Không cần lấy số tiếp theo hoặc đổi số khi người khác merge trước.
- Sửa tính năng đã có: dùng lại thư mục spec; nhánh có thể thêm hậu tố mô tả, ví dụ `fix/menu-weekly-export-timezone`.
- PR chỉ chứa spec có thể dùng `docs/menu-weekly-export`.
- Các spec/nhánh cũ như `specs/027-source-facility-management/` và `feat/027-source-facility-management` vẫn hợp lệ; không đổi hàng loạt lịch sử hoặc liên kết. Hai thư mục cũ trùng số nhưng khác tên không bị chặn chỉ vì trùng số.

Gate ưu tiên thư mục khớp nguyên phần tên sau dấu `/` của branch; sau đó đối chiếu tên tính năng khi bỏ tiền tố ba chữ số cũ; sau đó chọn tên tính năng khớp dài nhất trước hậu tố mô tả. Chỉ khi không khớp theo tên, nhánh cũ có số mới dùng lại tra cứu theo số để hỗ trợ các slug lịch sử khác nhau. Nếu vẫn khớp nhiều thư mục, dùng tên branch khớp nguyên thư mục spec để phân biệt; gate không chọn ngẫu nhiên.

### 8.3. Các bước cho tính năng mới

```bash
git switch dev
git pull --ff-only origin dev
git switch -c feat/menu-weekly-export
codex
```

Trong Codex:

1. `$speckit-specify <mô tả yêu cầu đã được xác nhận>` tạo `specs/menu-weekly-export/spec.md` và lưu `.specify/feature.json` local, không commit. Skill local chọn slug không số; không gọi script upstream để tự cấp số.
2. `$speckit-clarify` giải quyết các điểm chưa rõ trong spec.
3. `$speckit-plan` tạo kế hoạch và kiểm tra Constitution Check.
4. `$speckit-tasks` tạo công việc theo dependency; có thể chạy `$speckit-analyze` để đối chiếu tài liệu.
5. Format và commit bộ spec:

   ```bash
   npm exec --no -- prettier --write specs/menu-weekly-export
   git add specs/menu-weekly-export
   git commit -m "docs(spec): specify weekly menu export"
   ```

6. `$speckit-implement` triển khai theo tasks, đánh dấu task hoàn thành và commit code theo Conventional Commits.
7. Chạy kiểm tra ở mục 6 rồi mở PR vào `dev`, ghi đường dẫn spec trong PR template.

Một spec có thể được triển khai qua nhiều PR. Không bắt buộc hoàn tất mọi task trong một PR.

### 8.4. Sửa spec

- **PR đang mở:** cập nhật spec/plan/tasks của tính năng trong cùng PR.
- **Spec đã merge:** tạo nhánh tương ứng tên tính năng, trỏ vào thư mục cũ rồi cập nhật; thư mục cũ có số vẫn được dùng nguyên trạng.

  ```bash
  SPECIFY_FEATURE_DIRECTORY=specs/menu-weekly-export codex
  # trong Codex: $speckit-clarify → $speckit-plan → $speckit-tasks
  ```

- Không gọi `$speckit-specify` để ghi đè spec đã có. Tên mới trùng thư mục hiện có phải được xử lý bằng cách cập nhật spec cũ hoặc chọn slug mô tả khác, không tự thêm số thứ tự.
- Tính năng khác tạo spec mới và tham chiếu spec cũ khi cần; không đánh lại số lịch sử.

### 8.5. Spec gate trong CI

Job **Spec gate** ([.github/scripts/spec-gate.mjs](.github/scripts/spec-gate.mjs)) chạy với mọi PR và là một phần của **Backend quality**. Với PR thay đổi `src/**` hoặc `prisma/**`, job yêu cầu:

- Branch thuộc feat/fix/refactor/perf và tên tính năng là kebab-case; không bắt buộc số thứ tự.
- Xác định được đúng một spec theo quy tắc mục 8.2, tên thư mục hợp lệ và đủ `spec.md`, `plan.md`, `tasks.md`; spec có thể đã có trên `dev`.
- `spec.md` và `plan.md` không còn cụm `NEEDS CLARIFICATION`.
- PR không sửa thư mục spec ngoài tính năng đã chọn; không được dùng spec không liên quan để vượt gate.

PR chỉ sửa `specs/**` áp dụng cùng kiểm tra, cho phép thêm prefix docs. PR không đụng `src/**`, `prisma/**`, `specs/**` (tài liệu/CI/test/tooling), nhánh revert và PR dev → main được miễn như trước. Sự kiện push không chạy Spec gate. Không bổ sung label hoặc bypass mới.

Chạy thử gate trên máy trước khi push:

```bash
SPEC_GATE_BASE_SHA=$(git merge-base origin/dev HEAD) SPEC_GATE_HEAD_SHA=HEAD \
SPEC_GATE_BASE_REF=dev SPEC_GATE_HEAD_REF=$(git branch --show-current) \
npm run spec:check
```

Gate chỉ kiểm tra cấu trúc. Reviewer phải đọc spec trước khi duyệt code và xác nhận code chỉ triển khai yêu cầu đã ghi trong spec.

### 8.6. Nâng cấp spec-kit

Các file trong `.specify/` (trừ `memory/`) và `.agents/skills/speckit-*` do Specify CLI sinh ra, được Prettier bỏ qua; không sửa tay. Nâng cấp qua một PR riêng (ví dụ nhánh `chore/upgrade-spec-kit`): cập nhật CLI, chạy lại `specify init --here --force --integration codex --integration-options="--skills" --script sh`, kiểm tra `git diff` và giữ nguyên `constitution.md`.

Skill speckit-specify có điều chỉnh đặt tên riêng của repository: mặc định không số và ưu tiên slug của nhánh công việc để khớp gate. Sau khi nâng spec-kit, giữ/kiểm tra lại điều chỉnh này; không sửa trực tiếp scaffold upstream trong .specify/scripts/ hoặc cấu hình một giá trị feature_numbering không được upstream hỗ trợ.
