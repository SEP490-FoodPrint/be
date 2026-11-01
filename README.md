# FoodPrint Backend

Backend FoodPrint hiện dùng **TypeScript + CommonJS + Express + PostgreSQL/Prisma**, cùng **Redis Docker local** để lưu bộ đếm rate limit và hỗ trợ cache các query được chọn. Mỗi thành viên kết nối và test với database local của mình. Database Azure đã nhận baseline và áp dụng migration UserPermissionDenial; trạng thái triển khai và xác minh được ghi trong [baseline](database/SCHEMA_BASELINE.md).

Phạm vi hiện tại gồm nền tảng kết nối, HTTP health endpoint, helper/middleware, Prisma models, lịch sử SQL migration và 31 module có API GET danh sách mẫu. Mỗi module có routes/controller/service/validation; các API kiểm tra permission được gán và phạm vi tổ chức. Đã có đăng ký tài khoản UNVERIFIED, login bằng cookie HttpOnly, refresh/logout với phiên Redis, nộp/duyệt hồ sơ đơn vị, API quản trị quyền và ràng buộc một admin cho mỗi trường/supplier; xem [phiên đăng nhập](docs/AUTH_SESSIONS.md), [đổi/quên mật khẩu](docs/PASSWORD_RECOVERY.md), [hồ sơ theo Figma](docs/ONBOARDING.md) và [phân quyền](docs/AUTHORIZATION.md). Xem [danh mục module và API](src/modules/README.md) và [baseline/migration](database/SCHEMA_BASELINE.md). Chưa triển khai CRUD/lifecycle nghiệp vụ đầy đủ; bootstrap permission là thao tác riêng, không tự chạy trong CD.

Quy tắc coding cho team và AI được quản lý tại [AGENTS.md](AGENTS.md).

Quy tắc commit, Git hooks và quy trình đóng góp nằm trong [contribute.md](contribute.md).

Các tính năng gửi email dùng hàm `sendMail` chung; xem [cách gọi và hợp đồng mailer](docs/MAILER.md).

## 1. Cấu hình local

Dùng Node.js 24.22.1 theo `.nvmrc` và npm 11. Chạy `nvm use` tại root repo nếu dùng nvm. Chỉ tạo `.env` khi file chưa tồn tại:

```bash
if [ ! -e .env ]; then cp .env.example .env; fi
```

Điền cấu hình riêng trong `.env`:

| Biến                                     | Ý nghĩa                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                           | URL PostgreSQL của chính máy mình, chứa user/password, host, port và database thật             |
| `PORT`                                   | Cổng API, mặc định `5000`                                                                      |
| `NODE_ENV`                               | `development` khi code local                                                                   |
| `CLIENT_URL`                             | Origin frontend local, mặc định `http://localhost:3001`                                        |
| `JWT_SECRET`                             | Secret ngẫu nhiên riêng để ký JWT; thay placeholder trong mẫu                                  |
| `AUTH_ACCESS_TTL_SECONDS`                | Access token: mặc định 900 giây, cho phép 60–3600 giây                                         |
| `AUTH_REFRESH_TTL_SECONDS`               | Phiên refresh: mặc định 604800 giây, tối đa 30 ngày và phải dài hơn access token               |
| `RESEND_API_KEY`, `RESEND_FROM`          | API key Resend và sender thuộc domain đã verify để gửi mã xác minh email và khôi phục mật khẩu |
| `REDIS_URL`, `REDIS_PORT`                | URL Redis local và cổng Docker, mặc định `redis://127.0.0.1:6379/0`, `6379`                    |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | Cửa sổ đếm theo milliseconds và số request/IP, mặc định `60000`, `300`                         |

Ví dụ cấu trúc URL, cần thay user/password/database/port cho đúng máy:

```dotenv
DATABASE_URL="postgresql://your_local_db_user:your_local_db_password@127.0.0.1:5432/foodprint?schema=foodprint"
```

URL-encode ký tự đặc biệt trong user/password. Ưu tiên đặt rõ `DATABASE_URL`; source hiện còn hỗ trợ ghép URL từ các biến `DB_*` khi thiếu URL và có `DB_HOST`. Không đổi credentials hoặc xóa database hiện có chỉ để làm setup chạy được.

Database phải được chuẩn bị sẵn trên máy thành viên. Kết nối dùng Prisma PostgreSQL adapter, hỗ trợ local hoặc Azure với SSL, và không tự tạo database/bảng. Development migrations chỉ chấp nhận URL local. Không dùng SSH tunnel hoặc database của người khác. Không commit `.env`, credentials hay dumps.

Các Prisma model/enum ánh xạ vào PostgreSQL schema `foodprint` bằng `@@schema`. `DATABASE_URL` phải trỏ tới database local đã chuẩn bị theo thiết kế SQL mới; kết nối thành công với database cũ chưa chứng minh models mới tương thích. Dùng URL `postgresql://` hoặc `postgres://`; chuỗi `jdbc:postgresql://` dành cho JDBC và bị cấu hình hiện tại từ chối. Tham số `schema=foodprint` cũng đặt schema mặc định cho raw queries. Việc tạo file Prisma không tự áp dụng file SQL, tạo database hoặc cập nhật database cũ.

## 2. Cài đặt và chạy

```bash
npm ci
docker compose up -d --no-recreate --wait redis
npm run redis:check
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run db:check
npm run dev
```

`db:check` chỉ kết nối và chạy `SELECT 1`, sau đó đóng Prisma Client. `redis:check` gửi `PING` và đóng Redis client. API chỉ mở cổng sau khi PostgreSQL và Redis đã sẵn sàng; lỗi kết nối thì startup thất bại. SIGINT/SIGTERM đóng HTTP rồi đóng cả hai kết nối.

Kiểm tra HTTP sau khi API chạy:

```bash
curl --fail-with-body http://localhost:5000/api/health
```

Endpoint này kiểm tra process HTTP, không truy vấn DB mỗi request. Dùng `npm run db:check` để kiểm tra kết nối tại thời điểm cần thiết.

Chạy mã đã compile:

```bash
npm run build
npm start
```

`build` generate Prisma Client rồi compile source sang `dist/`. JavaScript trong `dist/` là output cần thiết; toàn bộ source do lập trình viên sửa nằm trong `.ts`.

## 3. Cấu trúc

```text
be/
├── AGENTS.md
├── README.md
├── .env.example
├── compose.yaml                # Chỉ Redis local, không quản lý PostgreSQL
├── package.json / package-lock.json
├── tsconfig.json / tsconfig.build.json
├── prisma.config.ts
├── prisma/schema.prisma
├── prisma/migrations/          # Baseline và SQL migration có version
├── prisma/baseline.manifest.json
├── database/SCHEMA_BASELINE.md  # Đối chiếu baseline và trạng thái triển khai
└── src/
    ├── app.ts / server.ts
    ├── config/env.ts
    ├── config/prisma.ts
    ├── config/redis.ts
    ├── constants/roles.ts
    ├── middlewares/*.ts
    ├── routes/index.ts
    ├── utils/*.ts              # Bao gồm cache.ts dùng chung
    ├── types/express.d.ts
    ├── scripts/                # Kiểm tra kết nối/baseline và migration local
    ├── generated/prisma/       # Generated, không commit
    └── modules/                # 31 module, mỗi module có một GET danh sách mẫu

tests/                         # Business list, role, rate-limit, cache, Redis và migration
```

Prisma Client dùng `moduleFormat = "cjs"`; `package.json` dùng `type: commonjs`. Source TypeScript có thể dùng cú pháp `import`/`export`; compiler chuyển sang CommonJS `require`/`exports`. Xem [Prisma generator](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators) và [TypeScript module modes](https://www.typescriptlang.org/tsconfig/module.html).

## 4. Giới hạn bước thiết lập này

- Schema Prisma phản ánh SQL thiết kế database mới, dùng `@map`/`@@map` để giữ nguyên tên bảng/cột và `@@schema("foodprint")`. Client generation không introspect, tạo hoặc thay đổi database.
- SQL hiện tại chỉ định nghĩa schema và role seeds, không có function/trigger. Backend services chịu trách nhiệm lifecycle, validation liên bảng và inventory posting; các xử lý này chưa được triển khai chỉ bằng việc tạo Prisma models. Các cột `updated_at` dùng `@updatedAt` cho thao tác qua Prisma, còn ghi bằng raw SQL phải cập nhật timestamp rõ ràng.
- CHECK constraints nằm trong SQL migration. Baseline không chứa role/permission seed hoặc mock data; việc seed cần phạm vi được phê duyệt riêng. Không kéo schema từ database cũ để ghi đè models mới.
- Đã có migration trong Git và kiểm thử trên PostgreSQL tạm; trạng thái áp dụng Azure được ghi trong baseline, không suy ra từ code đã merge. API mẫu chỉ đọc danh sách; chưa thực hiện nghiệp vụ ghi dữ liệu/chuyển trạng thái.
- Không sửa giá trị các role/nhãn hiện có khi chuyển sang TypeScript.
- Có test rate-limit, cache, role middleware và API danh sách dùng Node test runner; chưa có coverage threshold; đã có kiểm thử phân quyền/phạm vi API trên PostgreSQL tạm. Chỉ ghi PASS khi kiểm tra thực sự thành công.

## 5. Backend Code Quality — Phase 1

Phase 1 thêm Prettier, ESLint flat config với typescript-eslint, Husky, lint-staged và Commitlint. Runtime CommonJS/Node16 và source hiện tại được giữ nguyên; bước này không chuyển sang ESM/NodeNext hoặc viết lại imports. Cấu hình công cụ hỗ trợ cả JavaScript ESM và CommonJS, đồng thời giữ nguyên đuôi `.js` của các ESM imports nếu có.

TypeScript được pin ở **6.0.3** vì typescript-eslint **8.72.0** stable hỗ trợ TypeScript `>=4.8.4 <6.1.0`; TypeScript 7.0.2 trước đó chưa nằm trong dải hỗ trợ. Strict mode và tsconfig hiện hữu được giữ nguyên. Xem [dải dependency được hỗ trợ](https://typescript-eslint.io/users/dependency-versions/).

```bash
nvm use
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run build
```

`npm run validate` chạy bốn kiểm tra lint → format:check → typecheck → build, dừng ở lỗi đầu tiên. Lệnh này không chạy test giả, kết nối DB hoặc migration; build vẫn dùng Prisma generate như trước.

Prettier quản lý hai spaces, double quotes, semicolons và LF. ESLint dùng recommended type-checked rules, còn `eslint-config-prettier` tắt các rule formatting có thể xung đột. Không có rule tự thay đổi đuôi import.

Chỉ khi chủ động muốn sửa file, dùng `npm run lint:fix` hoặc `npm run format`; `format` có thể sửa nhiều file. Lần thiết lập Phase 1 không format toàn repo hoặc sửa các vi phạm nghiệp vụ đang tồn tại.

Các công cụ bỏ qua `node_modules`, `dist`, `build`, `coverage`, generated Prisma Client và thư mục generated khác, `.env*` kể cả `.env.example`, Husky internals, lockfile, SQL/schema Prisma, migrations, dumps, logs và compiler caches.

### Git hooks

`npm ci` chạy `prepare` để cài Husky. Nếu hooks chưa được cài sau khi clone, chạy `npm run prepare`. Các hooks chỉ gọi công cụ local, không tự tải thêm package.

- **pre-commit:** lint-staged kiểm tra ESLint và Prettier trên source đã stage; JSON/Markdown/YAML đã stage được kiểm tra Prettier. Hook không chạy `--fix` hoặc `--write`. Nếu lỗi, commit bị chặn; sửa file rồi stage lại.
- **commit-msg:** Commitlint kiểm tra nội dung commit theo Conventional Commits. Scope tùy chọn; dùng tên module khi phù hợp.

Ví dụ hợp lệ:

```text
feat(auth): implement login validation
fix(ingredient): correct quantity validation
refactor(database): extract prisma repository
docs(backend): update architecture guidelines
```

`update code`, `fix bug`, `abc` không hợp lệ. Hooks chỉ áp dụng trên máy đã cài chúng; CI GitHub Actions được mô tả ở mục 8. Branch protection là thiết lập riêng trên GitHub; CD migration Azure được mô tả ở mục 10. Các vi phạm lint/format phải được review và sửa trong thay đổi riêng, không coi việc cài tooling là code đã đạt chuẩn.

## 6. Redis Docker local và rate limit dùng chung

Compose hiện chỉ khai báo Redis, bind cổng trên `127.0.0.1`, có healthcheck và named volume `redis_data`. Redis bật AOF và `noeviction`. Cấu hình này dùng được với container `be-redis-1` hiện hữu khi chạy trong project `be`; không cần recreate hoặc xóa volume.

```bash
docker compose config --quiet
docker compose up -d --no-recreate --wait redis
docker compose exec -T redis redis-cli PING
npm run redis:check
```

Kết quả mong đợi là `PONG` và `PASS: Redis local PONG`. Nếu cổng `6379` đã có dịch vụ khác, kiểm tra dịch vụ đó trước; nếu cần đổi cổng local, sửa cả `REDIS_PORT` và cổng trong `REDIS_URL` của riêng mình. Không dừng/xóa dịch vụ khác để lấy cổng.

Nếu máy đã có PostgreSQL thuộc cùng Compose project, Compose có thể cảnh báo orphan vì file mới chỉ khai báo Redis. Không chạy `--remove-orphans`, `down -v` hoặc xóa volume; PostgreSQL hiện có phải được giữ nguyên. `--no-recreate` giữ container hiện hữu, không tự áp dụng thay đổi cấu hình container.

### Cách limiter hoạt động

- `createRateLimiter` là factory dùng chung, nhận `windowMs`, `limit`, `store` và `skip` tùy chọn. `createApiRateLimiter` thêm chính sách chung cho API.
- Runtime dùng Redis store với prefix `foodprint:rate-limit:api:`. Các process dùng cùng Redis/prefix sẽ chia sẻ quota; policy khác phải dùng namespace riêng và RedisStore instance riêng.
- Giới hạn mặc định là **300 request/phút/IP**, bật cả local/development. Hai biến `RATE_LIMIT_WINDOW_MS` và `RATE_LIMIT_MAX` cho phép đổi ngưỡng; giá trị phải là số nguyên dương, window không quá `2147483647` ms. Cấu hình sai làm startup thất bại.
- Limiter gắn tại `/api`, sau CORS và trước body parsers/routes. Bỏ qua OPTIONS và health GET/HEAD, kể cả trailing slash; request tới path API không tồn tại vẫn tiêu quota.
- Vượt quota trả **429** qua `sendError`, kèm `Retry-After`, `RateLimit`, `RateLimit-Policy`; không dùng legacy `X-RateLimit-*` headers.
- Redis lỗi trả **503** với thông báo chung, không lộ credentials và không fallback sang MemoryStore. Client không giữ queue request vô hạn khi Redis mất kết nối.
- IP/IPv6 dùng cách xác định mặc định của thư viện, giữ `trust proxy: false`. Không lấy IP trực tiếp từ `X-Forwarded-For`; chưa cấu hình reverse proxy/deployment.
- Counter tồn tại trong Redis đến khi hết TTL, kể cả khi process API restart. Các API danh sách nghiệp vụ dùng chung limiter `/api`; chưa có API hoặc limiter đăng nhập.

`src/app.ts` export `createApp(limiter)` để test HTTP mà không mở kết nối PostgreSQL. Server thật kết nối Redis trước khi tạo RedisStore/limiter.

### Kiểm thử

```bash
npm run test:rate-limit
# Cần Redis Docker local healthy cho lệnh tiếp theo:
npm run test:rate-limit:redis
```

Unit tests dùng MemoryStore được inject, không cần Redis hoặc PostgreSQL. Integration tests dùng Redis local thật với prefix test ngẫu nhiên, kiểm tra chia sẻ quota, TTL và lỗi client. Chúng chỉ dọn đúng key test đã tạo, không flush Redis hoặc dừng container đang dùng. Test nằm ngoài `src`, được typecheck nhưng không compile vào `dist`.

## 7. Helper cache kết quả query

`src/utils/cache.ts` cung cấp `cache.getOrSet`, `cache.invalidate` và `buildCacheKey`, dùng lại Redis client hiện có. Helper chưa được gắn vào endpoint hoặc Prisma query nghiệp vụ nào. Không cần thêm middleware HTTP để sử dụng trong service.

`getOrSet` kiểm tra cache trước; khi miss, gọi `load`, lưu kết quả với TTL bắt buộc rồi trả dữ liệu. Cache hit không gia hạn TTL. Các lượt gọi đồng thời cùng key chia sẻ một lần nạp trong một helper instance; dùng singleton `cache` trong các service.

Ví dụ độc lập với model nghiệp vụ, `load` do service cung cấp sau khi xác thực và kiểm tra quyền:

```typescript
import { buildCacheKey, cache } from "./utils/cache";

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item: unknown) => typeof item === "string");

async function readCachedLabels(
  organizationId: string,
  load: () => Promise<string[]>,
): Promise<string[]> {
  const key = buildCacheKey("labels:list", { organizationId });
  return cache.getOrSet({ key, ttlSeconds: 60, load, isValid: isStringList });
}
```

Key có dạng `foodprint:cache:v1:<resource>:<sha256>`. Thứ tự thuộc tính object không làm đổi key; thứ tự array có ý nghĩa. Đưa phạm vi tổ chức/người dùng/quyền, filter, page, limit, sort và các tham số ảnh hưởng kết quả vào key. Lấy phạm vi truy cập từ ngữ cảnh đã xác thực, không tin trực tiếp ID do client gửi. Chuẩn hóa input và bỏ thuộc tính `undefined` trước khi tạo key.

Dữ liệu phải là JSON DTO (`JsonValue`), được kiểm tra bằng type guard `isValid`. Date, Prisma Decimal và BigInt cần chuyển rõ ràng sang dạng JSON theo hợp đồng API; helper không tự đoán kiểu hoặc khôi phục chúng. JSON hỏng/sai kiểu được coi là cache miss; giá trị `null`, `false`, `0`, chuỗi rỗng và danh sách rỗng vẫn có thể được cache.

Sau khi transaction PostgreSQL commit thành công, gọi `await cache.invalidate(keyA, keyB)` với các key chi tiết/danh sách bị ảnh hưởng. Helper chỉ xóa key chính xác; không tự tìm mọi trang/filter liên quan. Nếu xóa cache lỗi, `CacheInvalidationError` được trả về để service xử lý: database có thể đã ghi thành công, không được mặc định retry thao tác ghi. TTL là giới hạn dự phòng cho dữ liệu cũ khi invalidation thất bại.

Lỗi đọc/ghi Redis không che lỗi từ `load`: helper gọi nguồn dữ liệu khi cache lỗi và không lưu lỗi truy vấn. Lỗi ghi hoặc JSON không được hỗ trợ vẫn trả kết quả nguồn nhưng không cache. Việc gom lượt gọi và ngăn loader cũ nạp lại sau invalidation chỉ áp dụng trong cùng helper instance; chưa có distributed lock hoặc bảo đảm nhất quán tức thời giữa nhiều process. Không dùng cache để bỏ qua kiểm tra quyền hoặc quyết định ghi dữ liệu cần trạng thái mới nhất.

Rate limiter vẫn trả 503 nếu Redis không hoạt động, nên fallback của helper không làm API tiếp tục phục vụ khi rate limiter đã chặn request.

```bash
npm run test:cache
# Cần Redis local healthy, không cần PostgreSQL:
npm run test:cache:redis
```

Unit tests dùng client giả để kiểm tra TTL, đồng thời, invalidation và lỗi; integration tests dùng key ngẫu nhiên riêng rồi chỉ xóa các key test đã tạo. Không thêm package hoặc thay đổi Prisma schema/Docker configuration cho helper này. Tham khảo [Redis cache-aside](https://redis.io/docs/latest/develop/use-cases/cache-aside/).

## 8. Nhánh dev và GitHub Actions CI

Team tạo nhánh `<type>/<kebab-case-description>` từ `dev`, mở PR vào `dev`; khi code đã ổn định, mở PR từ `dev` vào `main`. Chi tiết tại [contribute.md](contribute.md).

[Workflow Backend CI](.github/workflows/ci.yml) chạy khi push lên `main`/`dev` và khi mở/cập nhật PR vào hai nhánh này. Job **Code quality** thực hiện:

1. Cài Node theo `.nvmrc`, cache npm theo lockfile, cài đúng dependencies bằng `npm ci` với engine checks.
2. Kiểm tra Conventional Commits: toàn bộ commit của PR hoặc commit cuối của lần push.
3. Validate schema và generate Prisma Client trước các kiểm tra có type information.
4. Chạy `npm run validate`: lint, format:check, typecheck và build.
5. Chạy `npm run test:unit`: các test không cần hạ tầng cho cache, API module, rate limit, role middleware và guard migration local.

`test:unit` liệt kê rõ các file test không cần hạ tầng; thêm file vào script khi bổ sung unit test. Các script Redis integration hiện hữu tiếp tục chạy local khi có Redis.

Workflow chỉ có quyền đọc repository; các action được pin bằng commit SHA. Job Code quality dùng URL PostgreSQL placeholder trên `127.0.0.1:1` và JWT secret dành riêng cho test. Job PostgreSQL migrations dựng PostgreSQL 18 và Redis 7 tạm, kiểm tra baseline/migration/CHECK bằng `npm run test:migrations`, signup/login/phân quyền bằng `npm run test:authorization`, rotation/TTL bằng `npm run test:auth:redis`. Check Backend quality tổng hợp cả hai kết quả, nên migration lỗi vẫn chặn check bắt buộc hiện có. Các job quality không cần `.env`/GitHub Secrets thật và không kết nối Azure. Sau khi check Backend quality của push vào `dev` PASS, workflow gọi job CD Azure ở mục 10; PR và `main` không deploy database này. `HUSKY=0` chỉ áp dụng trong CI vì các bước kiểm tra được chạy trực tiếp.

Để tái hiện kiểm tra trên một checkout sạch, chưa có `.env`:

```bash
npm ci
export DATABASE_URL='postgresql://ci_validation@127.0.0.1:1/foodprint_ci?schema=foodprint'
export NODE_ENV=test
export JWT_SECRET=foodprint-ci-test-only-secret-not-for-runtime
npm run prisma:validate
npm run prisma:generate
npm run validate
npm run test:unit
```

URL trên chỉ dành cho validate/generate; dùng terminal riêng và không dùng nó để chạy `dev`, `start` hoặc `db:check`. Build/test không xác nhận database mới đã triển khai hoặc API đã truy vấn được database thật.

Người quản lý repo bật branch protection/ruleset cho `main` và `dev`, yêu cầu PR/review và check **Backend quality** thành công trước khi merge. CI workflow không tự bật các rule quản trị này. Nhánh `main` nhận workflow sau khi PR `dev` → `main` được merge.

## 9. Baseline và migration database

Lịch sử SQL chuẩn nằm trong `prisma/migrations/`: `0_init` tái tạo schema v5.4 hiện hữu và migration tiếp theo thêm `user_permission_denials` cùng CHECK đúng một tổ chức. Baseline không seed dữ liệu. Nguồn, fingerprints đã đối chiếu với Azure và cách nhận baseline được ghi tại [database/SCHEMA_BASELINE.md](database/SCHEMA_BASELINE.md).

| Lệnh                                                | Phạm vi                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run db:baseline:check`                         | Chỉ đọc, xác nhận database hiện hữu khớp baseline trước khi nhận lịch sử                        |
| `npm run db:deploy:check`                           | Chỉ đọc, kiểm tra đúng Azure host/schema/SSL, baseline và checksum lịch sử trước/sau deploy     |
| `npm run db:migrate:create -- --name <description>` | Tạo draft migration để review SQL, chỉ PostgreSQL local                                         |
| `npm run db:migrate`                                | Tạo/áp dụng migration development, chặn Azure/remote                                            |
| `npm run db:migrate:deploy`                         | Áp dụng các migration còn thiếu trên DATABASE_URL đã chọn; cần phạm vi triển khai được cho phép |
| `npm run db:migrate:status`                         | Kiểm tra lịch sử/pending migrations                                                             |
| `npm run test:migrations`                           | Kiểm thử trên PostgreSQL test local mới, nhận URL qua MIGRATION_TEST_DATABASE_URL               |

Database đã có dữ liệu phải qua bước kiểm tra và `migrate resolve --applied 0_init` một lần trước `migrate deploy`; không replay baseline vào database đó. Azure hiện tại đã hoàn tất cả bước nhận baseline và migration UserPermissionDenial, đã kiểm tra schema diff và dữ liệu cũ. Các lần triển khai tiếp theo dùng `db:migrate:deploy` cho migration mới; không nhận lại baseline. Xem [kết quả triển khai](database/SCHEMA_BASELINE.md#triển-khai-azure-ngày-29102026).

Migration cần commit cả SQL và `migration_lock.toml`; giữ migration đã applied bất biến. CHECK không biểu diễn trong Prisma phải nằm trong SQL migration. `db push` không thay thế lịch sử này. CI kiểm thử migration bằng database tạm; CD chỉ triển khai SQL đã review trong lịch sử migration theo quy trình bên dưới.

## 10. CD migration Azure từ dev

[Workflow CD](.github/workflows/cd.yml) được gọi từ CI của **push vào `dev`**, sau khi `Backend quality` PASS. Workflow checkout đúng commit đã kiểm tra, bỏ qua commit nếu `dev` đã có bản mới hơn, rồi áp dụng các migration đang chờ bằng `prisma migrate deploy`. PR và `main` không triển khai lên database này; workflow chỉ triển khai database.

CD kiểm tra pending migration ở mỗi push hợp lệ, không lọc theo file thay đổi của riêng commit cuối. Nhờ đó, migration chưa triển khai vẫn được áp dụng khi các run đang chờ bị thay thế bởi push mới. Nếu không có pending migration, deploy không thay đổi schema. Chỉ sửa `schema.prisma` mà thiếu SQL tương ứng sẽ bị kiểm tra schema diff trên PostgreSQL tạm trong CI chặn.

### Cấu hình GitHub một lần

Trong **Settings → Environments**, tạo `azure-dev` và giới hạn **Deployment branches and tags** chỉ cho branch `dev`. Để chạy tự động sau review PR, không bật Required reviewers cho environment; nếu bật, deployment sẽ chờ approval. Xem [GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

| Loại                 | Tên                   | Giá trị                                                                                                                                                   |
| -------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment secret   | `AZURE_DATABASE_URL`  | Sao chép URL Azure đã kiểm chứng trong `.env`, bao gồm database `foodprint_db`, `schema=foodprint` và `sslmode=require` hoặc chế độ SSL xác minh chặt hơn |
| Environment variable | `AZURE_DATABASE_HOST` | `foodprint-pg-dev-2026-hm01.postgres.database.azure.com`                                                                                                  |

Caller truyền riêng secret đã khai báo; environment `azure-dev` cung cấp giá trị cho job CD theo [quy tắc reusable workflow](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows). Chỉ bước deploy nhận URL Azure; bước cài dependencies và generate Client dùng URL placeholder local. Không đưa `.env` vào Git hoặc artifact.

Tài khoản trong URL cần đọc `_prisma_migrations` và có quyền thực thi SQL đã review trong schema `foodprint`. Database phải nhận baseline từ trước; workflow sẽ dừng nếu thiếu baseline thay vì tự tạo lại database.

### Kết nối mạng

Runner phải truy cập được Azure PostgreSQL qua TCP 5432 và được firewall cho phép. Workflow hiện dùng `ubuntu-latest`; IP của runner mặc định thay đổi, nên việc máy cá nhân kết nối thành công không xác nhận runner cũng kết nối được. Cấu hình đường mạng/runner có IP được cho phép trước khi bật CD; workflow không tự chỉnh firewall. Tham khảo [địa chỉ IP GitHub runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#ip-addresses) và [Azure PostgreSQL firewall](https://learn.microsoft.com/en-us/azure/postgresql/security/security-firewall-rules).

### Trình tự và xử lý lỗi

CD chạy lần lượt:

```bash
npm run db:deploy:check
npm run db:migrate:deploy
npm run db:deploy:check
npm run db:migrate:status
npm exec --no -- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Preflight chỉ đọc: kiểm tra đúng host, database, schema, SSL và checksum/thứ tự lịch sử. CD dừng khi SQL đã applied bị sửa/xóa hoặc có migration chưa hoàn tất. Chỉ có một deployment chạy tại một thời điểm; push mới không tự hủy run `dev` đang chạy migration. Prisma advisory lock vẫn được giữ.

Nếu thiếu secret, sai host hoặc không kết nối được, sửa cấu hình rồi vào **Actions → Backend CI → run của commit `dev` hiện tại → Re-run failed jobs**. Khi migration lỗi, cần kiểm tra và xử lý thủ công; workflow không tự resolve, reset, seed, rollback hay dùng `db push`. Mọi thay đổi cấu trúc tiếp theo cần SQL migration mới được review.

Schema diff cuối cùng kiểm tra phần Prisma biểu diễn được; CHECK/SQL riêng vẫn cần review migration và kiểm thử PostgreSQL trong CI. File workflow không tự tạo environment secrets hoặc quyền mạng Azure. Theo dõi job **Azure database migration** để xác nhận deployment; check bắt buộc cho PR vẫn là **Backend quality**.

## 11. Login và phân quyền động

Cấu hình `JWT_SECRET` riêng trong `.env`; không còn secret mặc định. Với database local đã áp dụng đủ migration, chạy bootstrap catalog trước khi dùng API quản trị:

```bash
npm run db:migrate:deploy
npm run auth:bootstrap
```

Bootstrap không tạo tài khoản hoặc mock data. Khi chạy lại, nó giữ thay đổi quyền của các role ngoài SYSTEM_ADMIN và giữ các permission đang inactive. Quyền SYSTEM_ADMIN được khởi tạo qua bước operator này, không chỉnh qua API. Hướng dẫn bootstrap Azure có kiểm tra đích và quy trình triển khai nằm trong [tài liệu phân quyền](docs/AUTHORIZATION.md).

`POST /api/auth/signup` tạo tài khoản UNVERIFIED cho SCHOOL/SUPPLIER, chưa tạo hồ sơ PENDING. Resend gửi mã xác minh email sau commit; người dùng xác minh email rồi đăng nhập để hoàn thiện hồ sơ. Xem [gửi/gửi lại mã và xác minh email](docs/EMAIL_VERIFICATION.md). `/api/auth/me` trả status, emailVerifiedAt, onboardingRequired và trạng thái hồ sơ, nhưng tài khoản UNVERIFIED chưa truy cập API nghiệp vụ. `POST /api/auth/onboarding` nộp hồ sơ theo hai form Figma, giữ UNVERIFIED; System Admin có registration.approve mới duyệt và tạo tổ chức/kích hoạt trong một transaction. Có API từ chối kèm lý do và nộp lại. Xem [hợp đồng hồ sơ, chứng nhận và tài liệu](docs/ONBOARDING.md); upload tệp cần cấu hình CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET trong `.env` riêng. Các permission mới cần operator bootstrap riêng, không tự áp dụng lên database thật.

`POST /api/auth/login` đặt access token và refresh token vào cookie HttpOnly, không trả token trong JSON. Redis chỉ lưu hash refresh token, userId và hạn phiên. Xem `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me` và [hướng dẫn frontend/Postman](docs/AUTH_SESSIONS.md).

`PATCH /api/auth/me` cập nhật fullName và phone của người đang đăng nhập; GET /me trả thêm email/phone. Hỗ trợ cập nhật từng trường, phone=null để xóa số điện thoại; không cho client đổi ID, email, role, status hoặc tổ chức. Xem phần hồ sơ cá nhân trong [hợp đồng API phiên](docs/AUTH_SESSIONS.md#hồ-sơ-cá-nhân).

Frontend gửi `credentials: "include"`; các request POST/PUT/PATCH/DELETE cần `X-CSRF-Protection: 1` và Origin khớp CLIENT_URL khi trình duyệt cung cấp Origin. Token cũ thiếu sid hoặc không có phiên Redis phải đăng nhập lại. Thời hạn mới dùng AUTH_ACCESS_TTL_SECONDS/AUTH_REFRESH_TTL_SECONDS; JWT_EXPIRES_IN cũ không còn được dùng.

Quyền được đọc lại từ DB mỗi request: role thay đổi áp dụng cho mọi tài khoản thuộc role đó; denial riêng vẫn được giữ. System Admin không có bypass và không được chỉnh quyền role SYSTEM_ADMIN. Admin trường/supplier chỉ quản lý ngoại lệ trong tổ chức mình; ATTP xã không có chức năng quản trị quyền.

```bash
npm run test:unit
npm run test:auth:redis
# Cần PostgreSQL tạm riêng và Redis local, không dùng database thành viên hoặc Azure:
MIGRATION_TEST_DATABASE_URL='<disposable-local-test-url>' npm run test:authorization
```
