# FoodPrint Backend

Backend FoodPrint hiện dùng **TypeScript + CommonJS + Express + PostgreSQL/Prisma**, cùng **Redis Docker local** để lưu bộ đếm rate limit và hỗ trợ cache các query được chọn. Mỗi thành viên kết nối và test với database local của mình; chưa triển khai database lên server.

Phạm vi hiện tại chỉ gồm nền tảng kết nối, HTTP health endpoint và các helper/middleware có sẵn được chuyển sang TypeScript. Các module nghiệp vụ vẫn là thư mục giữ chỗ; chưa thêm model, migration, seed hoặc API nghiệp vụ.

Quy tắc coding cho team và AI được quản lý tại [AGENTS.md](AGENTS.md).

Quy tắc commit, Git hooks và quy trình đóng góp nằm trong [contribute.md](contribute.md).

## 1. Cấu hình local

Dùng Node.js 24.22.1 theo `.nvmrc` và npm 11. Chạy `nvm use` tại root repo nếu dùng nvm. Chỉ tạo `.env` khi file chưa tồn tại:

```bash
if [ ! -e .env ]; then cp .env.example .env; fi
```

Điền cấu hình riêng trong `.env`:

| Biến                                     | Ý nghĩa                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`                           | URL PostgreSQL của chính máy mình, chứa user/password, host, port và database thật |
| `PORT`                                   | Cổng API, mặc định `5000`                                                          |
| `NODE_ENV`                               | `development` khi code local                                                       |
| `CLIENT_URL`                             | Origin frontend local, mặc định `http://localhost:3001`                            |
| `JWT_SECRET`, `JWT_EXPIRES_IN`           | Secret riêng và thời hạn token; thay placeholder trong mẫu                         |
| `REDIS_URL`, `REDIS_PORT`                | URL Redis local và cổng Docker, mặc định `redis://127.0.0.1:6379/0`, `6379`        |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | Cửa sổ đếm theo milliseconds và số request/IP, mặc định `60000`, `300`             |

Ví dụ cấu trúc URL, cần thay user/password/database/port cho đúng máy:

```dotenv
DATABASE_URL="postgresql://your_local_db_user:your_local_db_password@127.0.0.1:5432/foodprint?schema=public"
```

URL-encode ký tự đặc biệt trong user/password. Source mới đọc `DATABASE_URL`, không dùng `DB_NAME`, `DB_USER`, `DB_PASS`, `DB_HOST`, `DB_PORT` của kết nối Sequelize cũ. Không đổi credentials hoặc xóa database hiện có chỉ để làm setup chạy được.

Database phải được chuẩn bị sẵn trên máy thành viên. Kết nối mới kiểm tra URL local, dùng Prisma PostgreSQL adapter, và không tự tạo database/bảng. Không dùng SSH tunnel hoặc database của người khác. Không commit `.env`, credentials hay dumps.

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
    ├── scripts/                # check-db.ts, check-redis.ts
    ├── generated/prisma/       # Generated, không commit
    └── modules/                # Các module giữ chỗ hiện hữu

tests/                         # Rate-limit, cache và Redis integration tests
```

Prisma Client dùng `moduleFormat = "cjs"`; `package.json` dùng `type: commonjs`. Source TypeScript có thể dùng cú pháp `import`/`export`; compiler chuyển sang CommonJS `require`/`exports`. Xem [Prisma generator](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators) và [TypeScript module modes](https://www.typescriptlang.org/tsconfig/module.html).

## 4. Giới hạn bước thiết lập này

- Schema Prisma chưa có business models. Client generation không introspect hoặc thay đổi database.
- Chưa chạy migrations, `db push`, reset, import SQL, deploy hoặc thêm nghiệp vụ.
- Không sửa giá trị các role/nhãn hiện có khi chuyển sang TypeScript.
- Có các test rate-limit và cache dùng Node test runner; chưa có test nghiệp vụ hoặc coverage threshold. Chỉ ghi PASS khi kiểm tra thực sự thành công.

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

`update code`, `fix bug`, `abc` không hợp lệ. Hooks chỉ áp dụng trên máy đã cài chúng; Phase 1 chưa cấu hình CI, GitHub rules hoặc deployment. Các vi phạm lint/format có sẵn phải được review và sửa trong thay đổi riêng, không coi việc cài tooling là code đã đạt chuẩn.

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
- Counter tồn tại trong Redis đến khi hết TTL, kể cả khi process API restart. Chưa tạo limiter đăng nhập hoặc API nghiệp vụ mới.

`src/app.ts` export `createApp(limiter)` để test HTTP mà không mở kết nối PostgreSQL. Server thật kết nối Redis trước khi tạo RedisStore/limiter.

### Kiểm thử

```bash
npm run test:rate-limit
# Cần Redis Docker local healthy cho lệnh tiếp theo:
npm run test:rate-limit:redis
```

Unit tests dùng MemoryStore được inject, không cần Redis hoặc PostgreSQL. Integration tests dùng Redis local thật với prefix test ngẫu nhiên, kiểm tra chia sẻ quota, TTL và lỗi client. Chúng chỉ dọn đúng key test đã tạo, không flush Redis hoặc dừng container đang dùng. Test nằm ngoài `src`, được typecheck nhưng không compile vào `dist`.

## 7. Helper cache kết quả query

`src/utils/cache.ts` cung cấp `cache.getOrSet`, `cache.invalidate` và `buildCacheKey`, dùng lại Redis client hiện có. Helper chưa được gắn vào endpoint hoặc Prisma query nào vì repo chưa có business models. Không cần thêm middleware HTTP để sử dụng trong service.

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
