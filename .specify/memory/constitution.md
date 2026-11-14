<!--
Sync Impact Report
- Version: 1.0.0 → 2.0.0
- Nguyên tắc sửa: VI — bỏ yêu cầu số tuần tự trên nhánh/thư mục spec; giữ kiểm tra spec bắt buộc và tương thích tên cũ.
- Đồng bộ: AGENTS.md, contribute.md, docs/SPEC_KIT_GUIDE.md, PR template, Spec gate/tests và skill speckit-specify.
- Template upstream .specify/templates/: không sửa; tên feature được quyết định bởi skill local, các placeholder có số chỉ là ví dụ tương thích.
- Việc còn lại: không.
-->

# Hiến chương FoodPrint Backend

Hiến chương này tóm tắt các nguyên tắc **không được vi phạm** khi viết spec, lập kế hoạch và triển khai bằng spec-kit. Chi tiết vận hành, lệnh và ngoại lệ nằm trong [AGENTS.md](../../AGENTS.md); mọi spec, plan và tasks phải tuân thủ cả hai tài liệu.

## Nguyên tắc cốt lõi

### I. Kiến trúc module phân lớp

- Mỗi tính năng nằm trong `src/modules/<feature>/` gồm routes, controller, validation, service, repository, `<feature>.request.dto.ts` và `<feature>.response.dto.ts` (hai file DTO tách riêng). Router được đăng ký tại `src/routes/index.ts`.
- Controller chỉ nhận input, gọi validation, chuyển giá trị đã chuẩn hóa cho service và trả kết quả qua `sendSuccess`/`sendError`; không import DTO.
- Validation dùng Zod `z.strictObject()` và `safeParse`, là nguồn sự thật của Request DTO (`z.infer`). Lỗi trả HTTP 400, thông báo tiếng Việt kèm đường dẫn trường, không lộ giá trị thô.
- Service chứa logic nghiệp vụ, phân quyền, chuyển trạng thái, transaction và ánh xạ tường minh sang Response DTO theo allowlist; không viết truy vấn hay dựng `where`/`select`/`include`.
- Repository chứa mọi truy vấn Prisma, dùng Prisma client dùng chung, không import DTO.
- Code TypeScript strict, CommonJS, import tương đối không đuôi; định dạng do Prettier quản lý.

### II. Phân quyền và cô lập tổ chức (KHÔNG THƯƠNG LƯỢNG)

- JWT chỉ mang danh tính trong `sub`; mỗi request nạp lại tài khoản ACTIVE, role, membership và quyền hiệu lực từ DB. Claim role/org trong token không có giá trị quyết định.
- Quyền hiệu lực = quyền role đang bật trừ các denial của người dùng trong tổ chức hiện tại. Không có bypass ngầm cho System Admin, không cache phân quyền. Mọi thao tác sửa quyền của `SYSTEM_ADMIN` trả 403.
- Service yêu cầu `AuthPrincipal` tin cậy, xác lập phạm vi sở hữu và truyền cho repository áp vào `WHERE`. Không bao giờ lấy phạm vi từ organization ID trong query/body.
- Mọi endpoint danh sách kiểm tra quyền được gán và bộ lọc tổ chức tường minh qua `src/utils/resource-access.ts`, theo ma trận trong `docs/AUTHORIZATION.md`.

### III. An toàn cơ sở dữ liệu (KHÔNG THƯƠNG LƯỢNG)

- Không chạy introspection, DDL, migration, `prisma db push`, reset, import, seed hay xóa volume khi chưa có cho phép tường minh cho chính tác vụ đó. Thiết lập kết nối hoặc sinh client không phải là cho phép thay đổi schema/dữ liệu.
- Migration đã áp dụng là bất biến; mỗi thay đổi cấu trúc là một migration mới, CHECK constraint nằm trong SQL migration. Giữ nguyên định danh DB đã được duyệt, `partialIndexes` và predicate của chúng.
- Không tạo model Sequelize, client DB trùng lặp, hay suy diễn trường nghiệp vụ từ ví dụ. Không commit credential, secret, dump hay mã sinh tự động.
- Phát triển và kiểm thử dùng PostgreSQL local của từng thành viên; thao tác trên Azure chỉ qua workflow CD đã duyệt hoặc cho phép tường minh.

### IV. Transaction, cache và rate limit

- Service xác định ranh giới transaction; các ghi liên quan dùng `prisma.$transaction` và mọi lời gọi repository tham gia (kể cả đọc kiểm tra lại quyền) dùng cùng transaction client.
- Cache chỉ cho các lần đọc được chọn, qua `cache.getOrSet`/`cache.invalidate` với key từ `buildCacheKey` chứa phạm vi truy cập và mọi tham số đã chuẩn hóa, TTL dương, guard `isValid`. Invalidate key chính xác sau commit.
- Rate limiter dùng Redis với prefix riêng theo namespace; lỗi Redis phải fail closed (503), không fallback bộ nhớ.
- Không bao giờ flush Redis, xóa wildcard, hay xóa key của namespace khác.

### V. Hợp đồng HTTP và dữ liệu đầu ra

- Giữ nguyên envelope thành công/lỗi và safe projection; không bao giờ trả bản ghi DB trực tiếp hay lộ credential/secret.
- Date, Decimal, BigInt được serialize tường minh sang dạng JSON đã duyệt.
- Mã role/org dùng `ROLES`/`ORG_TYPES` trong `src/constants/roles.ts`, giữ nguyên code và nhãn.

### VI. Phát triển theo spec (Spec-Driven)

- Mọi PR thay đổi `src/**` hoặc `prisma/**` (gồm `feat`, `fix`, `refactor`, `perf`) phải đi kèm `specs/<feature-slug>/` có đủ `spec.md`, `plan.md`, `tasks.md` và chạy trên branch `<type>/<feature-slug>`; có thể thêm hậu tố mô tả cho nhánh khi dùng lại spec. Số thứ tự không bắt buộc; spec/nhánh cũ có số vẫn được hỗ trợ và không cần đổi tên. Spec và code nằm chung một PR, một nhánh chỉ sửa spec thuộc tính năng tương ứng.
- Chỉ triển khai yêu cầu đã được xác nhận trong spec. Mọi điểm chưa rõ được đánh dấu `[NEEDS CLARIFICATION: ...]` và phải được giải quyết (ví dụ bằng `$speckit-clarify`) trước khi merge.
- Khi yêu cầu thay đổi, cập nhật spec/plan/tasks trong cùng PR với code; không để code và spec lệch nhau.

## Ràng buộc kỹ thuật

- Stack: Node.js theo `.nvmrc`, TypeScript strict, Express, PostgreSQL, Prisma (client `cjs` sinh vào `src/generated/prisma/`), Redis.
- Schema đích nằm trong `prisma/schema.prisma` với tên model/enum PascalCase, trường camelCase có `@map`/`@@map`, `@@schema("foodprint")`; lịch sử triển khai là `prisma/migrations/`.
- Không thêm framework test ngoài Node test runner (`tsx --test`) khi chưa được duyệt. Test mới không cần hạ tầng phải được thêm vào `npm run test:unit`.

## Quy trình phát triển và quality gate

- Branch tạo từ `dev`, PR vào `dev`; `dev` được promote sang `main` qua PR. Commit theo Conventional Commits; khuyến nghị commit `docs(spec): ...` trước các commit code.
- Thay đổi backend phải qua `npm run validate` (lint, format, typecheck, build) và `npm run test:unit`; thay đổi kết nối PostgreSQL/Redis chạy thêm `db:check`/`redis:check` khi có hạ tầng local.
- Check bắt buộc **Backend quality** gồm code quality, migration/authorization trên PostgreSQL tạm và spec gate.
- Plan phải có mục "Constitution Check" đối chiếu với các nguyên tắc I–VI; mọi vi phạm phải được ghi rõ lý do trong bảng Complexity Tracking và được reviewer chấp thuận.

## Governance

- Hiến chương này và [AGENTS.md](../../AGENTS.md) có hiệu lực cao hơn thói quen cá nhân hay đề xuất của AI agent. Nếu hai tài liệu mâu thuẫn, AGENTS.md được áp dụng cho tới khi cả hai được sửa đồng bộ trong cùng một PR.
- Sửa hiến chương qua PR riêng (`docs(constitution): ...`), cập nhật Sync Impact Report và version theo semver: MAJOR khi bỏ/định nghĩa lại nguyên tắc, MINOR khi thêm nguyên tắc/mục, PATCH khi làm rõ câu chữ.
- Reviewer kiểm tra PR tuân thủ hiến chương; spec gate trong CI chỉ kiểm tra cấu trúc, không thay thế review nội dung.

**Version**: 2.0.0 | **Ratified**: 2026-11-06 | **Last Amended**: 2026-11-14
