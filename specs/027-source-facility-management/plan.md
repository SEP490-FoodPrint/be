# Implementation Plan: Quản lý cơ sở cung cấp nguyên liệu

**Branch**: feat/027-source-facility-management | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: specs/027-source-facility-management/spec.md

## Summary

Hoàn thiện năm thao tác tại /api/source-facilities: danh sách, chi tiết, thêm, sửa và dừng hoạt động. Chỉ INGREDIENT_SUPPLIER_ADMIN có source_facility.manage hiệu lực, membership hợp lệ và nhà cung cấp ACTIVE được sử dụng. Cơ sở thuộc riêng nhà cung cấp; staff/SYSTEM không có ngoại lệ.

Tách repository và hai DTO khỏi module hiện có, dùng strict Zod, service mapping và transaction chung. Hệ thống cấp mã FP-SF-00001 theo dãy riêng từng supplier bằng numeric max mã canonical đã lưu cộng một; khóa supplier, unique scoped và retry toàn transaction chống race. Giữ schema và dữ liệu cũ; không cần migration hoặc backfill.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict, Node.js 24.22.1 theo .nvmrc; CommonJS, Node16 module resolution.

**Primary Dependencies**: Express 4.21.x, Prisma/client/adapter-pg 7.10.1, PostgreSQL, Zod 4.6.7; không thêm dependency.

**Storage**: Bảng foodprint.source_facilities và suppliers hiện có; giữ nullable facility_code varchar(80), unique tên và partial unique mã theo supplier. Redis hiện có cho phiên và rate limit, không thêm cache/counter Redis.

**Testing**: Node test runner qua tsx; unit/HTTP với dependency injection; mở rộng authorization integration trên PostgreSQL tạm và Redis local, đã có bước chạy trong CI.

**Target Platform**: Dịch vụ backend Linux hiện có; không có giao diện mới.

**Project Type**: Express REST web service theo module.

**Performance Goals**: Giữ page mặc định 1, limit 20/tối đa 100, đọc limit+1, thứ tự id tăng; không N+1. Numeric max chỉ xét supplier hiện tại, trả một scalar thay vì tải toàn bộ mã vào Node. Không đặt SLA độ trễ mới ngoài spec; số liệu contention và thời gian fixture lớn được ghi trong kiểm chứng.

**Constraints**: Trusted supplier scope, actor recheck cùng tx; không xóa/kích hoạt lại/sửa mã; Date ISO và safe allowlist. Reuse authorizationTransaction: Serializable, tối đa ba attempts, maxWait 10 giây, timeout 20 giây/attempt. Tôn trọng varchar(80), không làm tròn số, không log query/credential. Không thao tác database trong bước plan.

**Scale/Scope**: Một module, năm endpoint, một helper scope, một formatter thuần; thêm một unit test file và các ca vào integration hiện có. Không thêm bảng/model/migration/seed hoặc thay đổi nghiệp vụ chọn cơ sở ở module lô/đơn hàng.

## Constitution Check

| Nguyên tắc                    | Trước Phase 0 | Sau Phase 1 | Cách đáp ứng                                                                                                                                    |
| ----------------------------- | ------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Kiến trúc phân lớp         | PASS          | PASS        | Controller không dùng DTO; strict validation là nguồn Request DTO; service quyết định nghiệp vụ/map output; repository giữ mọi Prisma/SQL/lock. |
| II. Quyền và tenant           | PASS          | PASS        | Helper resource-access chỉ supplier admin + permission; xóa nhánh SYSTEM khỏi list scope; actor/supplier recheck, target WHERE có supplierId.   |
| III. An toàn DB               | PASS          | PASS        | Giữ nguyên schema, partial index và dữ liệu cũ; không introspect/DDL/migration/seed; integration chỉ dùng database local mới tạo khi được phép. |
| IV. Transaction/cache/limiter | PASS          | PASS        | Service mở authorizationTransaction; mọi repo call/đọc actor/cấp mã/ghi cùng tx; không cache mới, giữ fail-closed limiter.                      |
| V. HTTP và output             | PASS          | PASS        | Giữ response helpers, error.fields, safe projection và ISO timestamps; không trả raw records hoặc bigint.                                       |
| VI. Spec-driven               | PASS          | PASS        | Spec 027 đã xác nhận cách cấp mã; branch đúng quy ước; tạo tasks bằng speckit-tasks trước khi viết code.                                        |

Không có vi phạm cần miễn trừ. tasks.md đã được sinh và thực thi; kết quả kiểm chứng được ghi trong quickstart.md. Không có extensions.yml khi kiểm tra nên bỏ qua before_plan/after_plan.

## Project Structure

### Documentation (this feature)

```text
specs/027-source-facility-management/
  spec.md
  plan.md
  research.md
  data-model.md
  quickstart.md
  contracts/source-facility-api.md
  checklists/requirements.md
  tasks.md                         # theo dõi 41 task triển khai
```

### Source Code (repository root)

```text
src/modules/source-facility/
  source-facility.routes.ts
  source-facility.controller.ts
  source-facility.validation.ts
  source-facility.service.ts
  source-facility.repository.ts     # mới
  source-facility.request.dto.ts    # mới
  source-facility.response.dto.ts   # mới
src/utils/resource-access.ts
src/utils/source-facility-code.ts   # mới: formatter/nhận diện canonical thuần
tests/source-facility-management.test.ts  # mới, thêm test:unit
tests/authorization.integration.test.ts   # mở rộng suite hiện có
tests/modules.test.ts                    # giữ/regression generic HTTP
tests/authorization.test.ts              # generic list scope phân biệt admin-only
docs/AUTHORIZATION.md
src/modules/README.md
package.json                            # đăng ký unit test
```

**Structure Decision**: Giữ module và base route hiện có trong src/routes/index.ts; không tạo router /management riêng. Không sửa prisma/schema.prisma, migrations, database baseline, generated output hoặc permission catalog. Không thay đổi CI vì integration được gắn vào suite đã chạy.

## Phase 0 — Research

Đã hoàn thành [research.md](research.md): scope, layering, numeric max, legacy, retry, validation và kiểm thử. Mấu chốt là khóa supplier không làm mới Serializable snapshot; chỉ kết hợp unique scoped và retry toàn transaction mới xử lý đúng trường hợp chờ khóa rồi đọc max cũ.

## Phase 1 — Design

Thiết kế dữ liệu tại [data-model.md](data-model.md), năm API tại [contracts/source-facility-api.md](contracts/source-facility-api.md), hướng dẫn xác minh tại [quickstart.md](quickstart.md).

### Luồng đọc

Router xác thực và kiểm tra helper scope trước controller. Controller validate query/params rồi gọi service. Service nhận AuthPrincipal, kiểm tra supplier ACTIVE qua repo, chuyển trusted scope và query chuẩn hóa cho repo. Repo giữ WHERE supplierId, select/order/pagination. Service map tường minh từng trường, cắt limit+1 và tạo hasNext. Chi tiết dùng id UUID và supplierId; không tồn tại hoặc khác supplier cùng 404.

### Luồng ghi và cấp mã

1. Validation chỉ chấp nhận năm trường nhập; service xác định trusted scope ban đầu.
2. Service gọi authorizationTransaction; mỗi attempt nạp actor hiện tại qua repository bằng tx, kiểm tra lại role/membership/quyền và supplier không đổi.
3. Repository khóa supplier; service kiểm tra supplier ACTIVE trong cùng tx. Khi sửa/dừng, khóa target bằng id và supplierId rồi đọc lại target.
4. Tạo mới: repository kiểm tra tên trùng trong supplier và đọc numeric max mã canonical của supplier, gồm INACTIVE/isVisible=false; service tính next bằng bigint và formatter. Repository ghi mã, supplier, audit và dữ liệu hợp lệ theo allowlist.
5. Sửa: chỉ năm trường người dùng được phép gửi; không thay facilityCode. Dừng: chỉ ACTIVE sang INACTIVE và audit; INACTIVE trả lại bản ghi hiện tại, không đổi audit.
6. Tất cả kết quả chỉ được trả sau commit; toàn attempt được retry khi serialization/deadlock/unique mã. Trùng tên nhận diện bằng constraint/fields và chuyển 409; không chuyển mọi P2002 thành trùng tên. Shared helper trả 503 an toàn sau khi hết attempts.

Repository có các operation-specific methods: actor, supplierStatus, lockSupplier, list, find, lockTarget, nameExists, highestCodeNumber, create, update, deactivate. Không nhận Request/Response DTO. highestCodeNumber trả bigint từ kết quả numeric MAX dạng text; create nhận input nội bộ gồm mã đã format và actor ID. Mọi operation ghi yêu cầu tx, không tự mở transaction.

### Trình tự cho bước tasks

1. Hoàn thiện validation, hai DTO, formatter và helper scope; ghi contract tests cho normalize/readonly/role.
2. Tạo repository, dịch lỗi theo constraint, numeric max scoped và locks; service orchestration/map output.
3. Nối năm routes/controller, siết listScopes hiện có và giữ injection seam để test không cần DB.
4. Thêm unit/HTTP, cập nhật regression fixture nếu cần và đăng ký test:unit.
5. Mở rộng authorization integration: cấp mã tenant riêng, hai kết nối thực/race, rollback/retry, quyền bị thu hồi, mã legacy, lịch sử lô.
6. Đồng bộ ma trận phân quyền và module README; chạy quality checks và integration được phép; tạo PR vào dev khi có yêu cầu.

### Validation và điều kiện hoàn tất

- Unit/HTTP kiểm tra năm API, giới hạn trường, normalize null/empty/omit, phân trang 20/20/5, ISO và projection, staff/SYSTEM có permission vẫn bị chặn, supplier inactive, cross-tenant 404, PATCH/dừng giữ mã.
- Integration ép hai create khác tên cùng supplier tranh chấp thật, chứng minh retry đọc lại max; hai request cùng tên chỉ một thành công và bên còn lại 409; A/B cùng bắt đầu 00001; 99999 sang 100000; mã vượt Number.MAX_SAFE_INTEGER; restart service không reset; legacy null/không chuẩn được giữ.
- Kiểm tra mã canonical cao ở INACTIVE/isVisible=false vẫn được tính, dừng không giải phóng mã, lỗi ghi rollback toàn vẹn, và IngredientLot.sourceFacilityId không đổi.
- Dùng barrier/điểm đồng bộ chỉ ở attempt đầu, sau đọc actor tạo snapshot và trước khóa supplier; không đặt sau khóa vì hai writer cùng supplier sẽ chờ nhau. Không giữ barrier bắt buộc trong retry hoặc dùng sleep làm bằng chứng. Hết retry nhận 503, không tạo thêm dòng.
- Kiểm tra formatter ở độ dài hợp lệ tối đa và trường hợp đã có mã canonical với hậu tố 74 chữ số 9: mã tiếp theo vượt varchar(80), trả 503 mà không insert hoặc sửa dữ liệu cũ.
- Chạy npm run prisma:validate, npm run validate (đã gồm typecheck/build), npm run test:unit và npm run test:authorization khi có hạ tầng disposable được phép. Không cần chạy lại riêng các bước đã đạt khi không có thay đổi mới; quickstart có hướng dẫn kiểm tra hạ tầng trước integration.

### Rủi ro và tương thích

List hiện có từng mở SYSTEM theo permission sẽ được siết như người dùng yêu cầu; tài liệu quyền cần ghi rõ thay đổi. Read DTO giữ facilityCode string|null cho legacy, create mới luôn string. Không backfill hoặc đổi mã cũ. Cấp mã đọc tập mã supplier có chi phí theo số cơ sở; nếu tải tương lai vượt khả năng thì thiết kế counter trong thay đổi riêng. Tính không tái sử dụng mã dựa trên cam kết không có xóa và mã bất biến; writer tương lai phải cùng giao thức lock/cấp mã. Không đảm bảo mọi request đều thành công dưới contention không giới hạn.

## Complexity Tracking

Không có ngoại lệ constitution. SQL chỉ dùng trong repository cho khóa và numeric aggregate cần thiết; không thêm trigger/function, cache, model hoặc migration. Bước plan chỉ tạo tài liệu, không chạy backend tests hoặc tác động dữ liệu.
