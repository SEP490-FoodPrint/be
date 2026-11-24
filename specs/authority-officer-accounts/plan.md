# Implementation Plan: Tài khoản cán bộ ATTP theo phường/xã

**Branch**: `feat/authority-officer-accounts` | **Spec**: [spec.md](./spec.md)

## Summary

System Admin cấp tài khoản ATTP bằng cách chọn phường/xã (`locations.level = 2`); hệ thống tìm hoặc tạo đơn vị ATTP của phường/xã và chặn tài khoản thứ hai. Cán bộ đăng nhập lần đầu bằng tên đăng nhập, bắt buộc xác minh email bằng OTP, sau đó đăng nhập bằng email. Trường và NCC chọn phường/xã khi đăng ký và được gắn khi duyệt; quan hệ trường ↔ ATTP suy ra từ `location_id`, nên ATTP xem được danh sách trường trên địa bàn. Bỏ `dashboard.view` của ATTP.

## Technical Context

Express + TypeScript strict (CommonJS), Prisma 7, PostgreSQL 18. Tái sử dụng: `authorizationTransaction` + `loadPrincipal` (kiểm tra lại actor), `WARD_LOCATION_LEVEL` và repository `authority` (khóa đơn vị, tìm theo phường/xã), hạ tầng OTP `email-verification` (store Redis, HMAC, rate limit) và mailer/outbox, `auth-sessions` (xoay phiên), `list-query` (phân trang). Danh sách phường/xã cho form lấy từ API sẵn có `GET /api/schools/public/locations` (có `level`, `parentId`).

## Constitution Check

- Spec-driven: `specs/authority-officer-accounts/{spec,plan,tasks}.md` cùng PR.
- Module theo lớp routes → controller → validation → service → repository; DTO tách request/response; service không dựng truy vấn Prisma.
- Ghi: `requirePermission` + kiểm tra lại trong transaction; đọc danh sách qua `listScopes` trong `resource-access.ts`.
- Migration mới, không sửa migration cũ; CHECK trong SQL; không function/trigger; không seed, không thao tác Azure.

## Data Model

Migration `prisma/migrations/20261208000100_authority_officer_accounts/migration.sql`:

- `ALTER TABLE foodprint.users ALTER COLUMN email DROP NOT NULL;`
- `CHECK chk_users_email_required`: `email IS NOT NULL OR (role_code = 'COMMUNE_FOOD_SAFETY_OFFICER' AND status <> 'ACTIVE' AND email_verified_at IS NULL)`.
- Không thêm bảng: đã có `uq_commune_food_safety_units_location_id`, `uq_users_commune_officer`, `uq_users_non_staff_username`, `idx_schools_location_id`.

Prisma: `User.email String? @db.Citext`. Rà các chỗ đọc `user.email` (session/me, mailer, quên mật khẩu, danh sách người dùng, DTO) để xử lý `null` theo kiểu; typecheck chỉ ra đủ vị trí.

## Thiết kế mã

1. **Module mới `src/modules/authority-officer/`** (mount `/api/authority-officers`):
   - `create`: trong `authorizationTransaction`: `loadPrincipal` → System Admin + `authority.manage`; khóa dòng `locations` của phường/xã (`FOR UPDATE`) để tuần tự hóa theo phường/xã; kiểm tra `level = 2`, `is_active`; tìm đơn vị theo `location_id` (`INACTIVE` → 409) hoặc tạo; có cán bộ → 409; tạo user (bcrypt 12, `UNVERIFIED`, `email = null`). P2002 → 409 (username / cán bộ / phường/xã).
   - `list`, `getOne`: System Admin, `where` trong repository.
2. **Email lần đầu** (`src/modules/auth/`):
   - `session.service`: `me`/login trả `emailSetupRequired = role === COMMUNE_FOOD_SAFETY_OFFICER && email === null`; tài khoản này không bị coi là `onboardingRequired`.
   - Đăng nhập: tra theo email trước; nếu khớp username của tài khoản ATTP đã có email → lỗi đăng nhập chung.
   - `email-setup.service` + controller/validation: `request` (tạo OTP gắn `userId` + email đích, gửi qua mailer, kiểm tra email chưa dùng), `verify` (kiểm OTP, transaction: kiểm tra lại tài khoản vẫn `UNVERIFIED` + `email null`, update có điều kiện, unique email → 409; sau commit xoay phiên).
3. **Phường/xã của trường và NCC**:
   - `onboarding.validation`: thêm `locationId` UUID bắt buộc vào `common` (dùng chung `schoolProfileSchema` và `supplierProfileSchema`); lưu trong `profile_data` (JSONB, không cần migration).
   - `onboarding.service`: kiểm tra phường/xã `level = 2` đang hoạt động khi nộp và khi duyệt; `onboardingRepository.createSchool`/`createSupplier` ghi `locationId` (hồ sơ cũ thiếu → `null`); response hồ sơ kèm `{id, code, name}` phường/xã.
   - `PUT /api/schools/:schoolId/location` (organization) và `PUT /api/suppliers/:supplierId/location` (supplier) cho System Admin: khóa dòng tổ chức, kiểm tra phường/xã; dùng chung một helper kiểm tra phường/xã với `authority`.
4. **Danh sách và chi tiết trường của ATTP**: `authority` module thêm `GET /me/schools` và `GET /me/schools/:schoolId` (chi tiết kèm `suppliers`: repository lọc `schoolSupplierRelationships.status IN (ACTIVE, SUSPENDED)` (loại `UNLINKED`) và `Supplier.status = ACTIVE`, select allowlist, `orderBy` tên NCC; trường đọc với `where: { id, ...scope }` → không thấy thì `404`); resource mới `authority-school` trong `resource-access.ts` trả `{ location: { communeFoodSafetyUnits: { some: { id: unitId } } } }` (tức `schools.location_id = unit.location_id`); đơn vị chưa có `location_id` → rỗng.
5. **Catalog quyền**: thêm `authority_school.view` + grant officer; bỏ `["COMMUNE_FOOD_SAFETY_OFFICER", "dashboard.view"]`.
6. **Tài liệu**: `src/modules/README.md`, `docs/AUTHORIZATION.md` (bảng endpoint mới, quyền), `docs/ONBOARDING.md` (`locationId`), `docs/AUTH_SESSIONS.md`/`EMAIL_VERIFICATION.md` (email lần đầu).

## Kiểm thử

- Unit: validation tạo tài khoản/email setup/onboarding `locationId` (trường và NCC); service tạo cán bộ (409 phường/xã đã có, 400 không phải phường/xã, 403); `emailSetupRequired`; từ chối username sau khi có email; resource `authority-school`; chi tiết trường loại NCC `UNLINKED` và NCC `INACTIVE`, trường ngoài địa bàn `404`.
- Integration (`test:local:authorization`): tạo đồng thời hai tài khoản cùng phường/xã → một 409; luồng đăng nhập → OTP → `ACTIVE` → đăng nhập email; trường duyệt có phường/xã chuyển được sự cố tới ATTP; ATTP chỉ thấy trường địa bàn mình; chi tiết trường hiện NCC `ACTIVE` có quan hệ `ACTIVE`/`SUSPENDED`, ẩn quan hệ `UNLINKED` và NCC `INACTIVE`.
- Migration test: CHECK chặn email NULL với vai trò khác/`ACTIVE`.

## Triển khai (azure-dev, sau khi merge)

CD tự chạy migration. Thao tác vận hành (cần bạn thực hiện/cho phép): chạy `auth:bootstrap -- --azure` để tạo `authority_school.view`, cấp quyền này cho `COMMUNE_FOOD_SAFETY_OFFICER` và gỡ `dashboard.view` qua API quản trị quyền; gắn phường/xã cho các trường và NCC đã có bằng `PUT /api/schools/:schoolId/location` và `PUT /api/suppliers/:supplierId/location`.

## Rủi ro

- `users.email` thành nullable ảnh hưởng nhiều nơi dùng `email`; xử lý theo typecheck, không đổi response cho tài khoản khác.
- Tách 2 PR: (A) phường/xã của trường/NCC + danh sách/chi tiết trường ATTP + bỏ dashboard (không migration); (B) tài khoản ATTP + email lần đầu (migration). Cả hai dùng chung spec này.
- Thực hiện PR A: helper dùng chung `src/utils/ward-location.ts`; API gắn phường/xã trường/NCC đặt trong module `authority` (`createOrganizationLocationRouter`, mount `/api/schools` và `/api/suppliers` trước router cũ); `locationId` lưu trong `profile_data` (JSONB) nên hồ sơ cũ đọc lại được (`null`).
