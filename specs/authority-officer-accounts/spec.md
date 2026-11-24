# Feature Specification: Tài khoản cán bộ ATTP theo phường/xã

**Feature Branch**: `feat/authority-officer-accounts`

**Created**: 2026-11-24

**Status**: Draft

**Input**: "Tài khoản cán bộ ATTP sẽ do System Admin cấp; khi tạo tài khoản có phần chọn phường/xã dựa vào bảng location trong DB; khi chọn phường/xã đó thì các trường học trong địa bàn xã đó tự động kết nối được với ATTP phường/xã đó. ATTP xã xem được danh sách các trường mà mình quản lý về ATTP. ATTP không cần dashboard."

## Bối cảnh

- Đã có: bảng `locations` (mô hình 2 cấp tỉnh → phường/xã, phường/xã `level = 2`), `commune_food_safety_units.location_id` (mỗi phường/xã tối đa một đơn vị, partial unique), `users.commune_food_safety_unit_id` (mỗi đơn vị tối đa một cán bộ, `uq_users_commune_officer`), `PUT /api/commune-food-safety-units/:id/location` (specs/authority-complaints FR-008). Các luồng chuyển sự cố (PR5) và leo thang C05 tự tìm đơn vị ATTP theo `schools.location_id`.
- Chưa có: API tạo đơn vị/cán bộ ATTP (hiện chỉ thêm tay vào DB); trường được tạo khi duyệt hồ sơ đăng ký **không** có `location_id` và không có API nào gắn phường/xã cho trường, nên luồng ATTP luôn trả `409` với trường mới; ATTP không xem được danh sách trường trên địa bàn; vai trò ATTP được cấp `dashboard.view` nhưng không có dashboard nào cho tổ chức `AUTHORITY`.

## Clarifications

### Session 2026-11-24

- Ai chọn phường/xã cho trường? → Trường chọn khi nộp hồ sơ đăng ký (bắt buộc); khi System Admin duyệt hồ sơ, trường được tạo với `location_id` đó. System Admin sửa được phường/xã của trường (kể cả gắn bổ sung cho trường đã tạo trước tính năng này).
- Hồ sơ đăng ký NCC? → Cũng bắt buộc chọn phường/xã như trường; duyệt hồ sơ tạo NCC với `suppliers.location_id` đó (cột đã có, không cần migration). System Admin sửa được phường/xã của NCC. Phường/xã của NCC chỉ là thông tin địa chỉ, không quyết định ATTP nào quản lý NCC.
- ATTP xem NCC thế nào? → Trong màn chi tiết một trường thuộc địa bàn, ATTP xem danh sách NCC có liên kết với trường đó; **ẩn NCC đã hủy liên kết** (quan hệ trường–NCC `UNLINKED`) **và NCC đã ngừng hoạt động** (`Supplier.status = INACTIVE`). Hiển thị NCC `ACTIVE` có quan hệ `ACTIVE` hoặc `SUSPENDED`, kể cả khi NCC đang bị tạm dừng tiếp nhận; response kèm trạng thái quan hệ và trạng thái tiếp nhận để ATTP phân biệt. ATTP chỉ đọc, không xem NCC ngoài các trường trên địa bàn.
- Đơn vị ATTP khi tạo cán bộ? → Mỗi phường/xã chỉ có **một** tài khoản ATTP; phường/xã đã có tài khoản ATTP (mọi trạng thái) thì không tạo được tài khoản mới (`409`). Đơn vị ATTP là chi tiết nội bộ: phường/xã chưa có đơn vị thì tạo tự động cùng tài khoản; đã có đơn vị chưa có cán bộ thì gắn cán bộ vào đơn vị đó.
- Đăng nhập lần đầu? → System Admin tạo tài khoản bằng **tên đăng nhập** (và mật khẩu ban đầu). Lần đăng nhập đầu bằng tên đăng nhập; hệ thống bắt buộc cán bộ cập nhật email trước khi dùng chức năng khác; sau khi cập nhật, cán bộ đăng nhập bằng **email** thay cho tên đăng nhập.
- "Kết nối tự động" giữa trường và ATTP? → Suy ra từ phường/xã: trường có `location_id = X` thuộc quản lý của đơn vị ATTP có `location_id = X`. Không tạo bảng liên kết; đổi phường/xã của trường thì quan hệ đổi theo ngay.
- Dashboard ATTP? → Không cần; bỏ quyền `dashboard.view` khỏi vai trò `COMMUNE_FOOD_SAFETY_OFFICER`.
- Quyết định đã xác nhận (2026-11-24):
  - Email cập nhật được xác minh bằng mã OTP 6 số gửi tới email đó (dùng lại hạ tầng `email-verification`: HMAC, hết hạn 10 phút, khóa sau 5 lần sai, giới hạn gửi lại). Chấp nhận mọi email hợp lệ, không giới hạn đuôi `@gmail.com`.
  - Mật khẩu ban đầu do System Admin nhập khi tạo (cùng chính sách `validateNewPassword`: ≥ 8 ký tự, có chữ thường, chữ hoa, chữ số, ký tự đặc biệt, tối đa 72 byte). Không bắt buộc đổi mật khẩu ở lần đăng nhập đầu (chưa có yêu cầu).
  - Sau khi đã có email, đăng nhập bằng tên đăng nhập trả cùng lỗi `401` chung như sai thông tin (không tiết lộ tài khoản tồn tại).
  - Quyền mới `authority_school.view` ("Xem trường thuộc địa bàn ATTP") gán mặc định cho `COMMUNE_FOOD_SAFETY_OFFICER`; API quản trị tài khoản ATTP và gắn phường/xã cho trường dùng quyền sẵn có `authority.manage` của `SYSTEM_ADMIN`.
  - Đơn vị tự tạo: `code = "ATTP-" + location.code`, `name = "Đơn vị ATTP " + location.name`, `status = ACTIVE`.
  - Hồ sơ đăng ký trường/NCC đã nộp trước tính năng (chưa có `locationId`) vẫn duyệt được; tổ chức tạo ra chưa có phường/xã, System Admin gắn sau.

## Phạm vi

- Trong phạm vi: migration cho phép `users.email` rỗng có điều kiện; API System Admin tạo/xem tài khoản ATTP theo phường/xã; luồng cập nhật email bắt buộc lần đầu; chọn phường/xã trong hồ sơ đăng ký trường và NCC, gắn vào tổ chức khi duyệt; API System Admin đổi phường/xã của trường và NCC; API ATTP xem danh sách và chi tiết trường thuộc địa bàn, kèm NCC liên kết với trường (trừ NCC đã hủy liên kết hoặc ngừng hoạt động); bỏ `dashboard.view` của ATTP.
- Ngoài phạm vi: nhiều cán bộ cho một phường/xã; đổi phường/xã của tài khoản ATTP đã tạo; System Admin đặt lại mật khẩu ATTP (dùng luồng quên mật khẩu sau khi có email); email thông báo cho ATTP; giao diện; nhập danh mục `locations` (dùng dữ liệu sẵn có).

### Thay đổi spec cũ

- `specs/authority-complaints` FR-008: vẫn giữ `PUT /api/commune-food-safety-units/:id/location`; đơn vị tự tạo theo FR-002 đã có `location_id` nên thường không cần gọi.
- Luồng onboarding (`docs/ONBOARDING.md`, áp dụng cho hồ sơ trường và NCC): hồ sơ trường và NCC thêm trường bắt buộc `locationId`.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - System Admin cấp tài khoản ATTP cho phường/xã (Priority: P1)

**Acceptance Scenarios**:

1. **Given** phường/xã X (`level = 2`, đang hoạt động) chưa có tài khoản ATTP, **When** System Admin gửi `{locationId: X, username, password, fullName, phone?}`, **Then** tạo đơn vị ATTP của X (nếu chưa có) và tài khoản `COMMUNE_FOOD_SAFETY_OFFICER` trạng thái `UNVERIFIED`, `email = null`; response có đơn vị, phường/xã và `emailSetupRequired: true`.
2. **Given** X đã có tài khoản ATTP (mọi trạng thái), **When** tạo tiếp, **Then** `409`; hai yêu cầu đồng thời cho X chỉ một thành công.
3. `locationId` không phải phường/xã đang hoạt động → `400`; tên đăng nhập trùng → `409`; đơn vị ATTP của X đang `INACTIVE` → `409`; người gọi không phải System Admin có `authority.manage` → `403`.

### User Story 2 - Cán bộ ATTP cập nhật email lần đầu rồi đăng nhập bằng email (Priority: P1)

**Acceptance Scenarios**:

1. **Given** tài khoản ATTP mới, **When** đăng nhập bằng tên đăng nhập + mật khẩu, **Then** có phiên, `GET /api/auth/me` trả `emailSetupRequired: true`; mọi API nghiệp vụ trả `403` cho tới khi cập nhật email.
2. **When** gửi email mới, **Then** mã OTP được gửi tới email đó; email đã thuộc tài khoản khác → `409`; **When** gửi đúng mã, **Then** tài khoản có `email`, `email_verified_at`, trạng thái `ACTIVE`; sai/hết hạn → `400`.
3. **Given** tài khoản đã cập nhật email, **When** đăng nhập bằng email, **Then** thành công; bằng tên đăng nhập → `401` như sai thông tin.

### User Story 3 - Trường/NCC chọn phường/xã khi đăng ký; System Admin sửa (Priority: P1)

**Acceptance Scenarios**:

1. **Given** hồ sơ đăng ký trường hoặc NCC, **When** nộp thiếu `locationId` hoặc không phải phường/xã đang hoạt động, **Then** `400`; hợp lệ thì lưu trong hồ sơ.
2. **When** System Admin duyệt hồ sơ, **Then** trường được tạo với `location_id` đã chọn; trường đó lập tức chuyển được sự cố/C05 tới ATTP của phường/xã (nếu phường/xã có đơn vị và cán bộ `ACTIVE`).
3. **When** System Admin `PUT /api/schools/:schoolId/location {locationId}`, **Then** trường đổi phường/xã; bản chuyển sự cố/C05 đã gửi giữ nguyên đơn vị nhận cũ.
4. **Given** hồ sơ NCC hợp lệ, **When** System Admin duyệt, **Then** NCC được tạo với `location_id` đã chọn; **When** System Admin `PUT /api/suppliers/:supplierId/location {locationId}`, **Then** NCC đổi phường/xã.

### User Story 4 - ATTP xem danh sách, chi tiết trường thuộc địa bàn và NCC liên kết (Priority: P1)

**Acceptance Scenarios**:

1. **Given** cán bộ ATTP của X, **When** `GET /api/commune-food-safety-units/me/schools`, **Then** chỉ trả các trường có `location_id = X` (phân trang, tìm theo tên/mã, lọc trạng thái).
2. Trường ở phường/xã khác không xuất hiện; tổ chức khác hoặc thiếu `authority_school.view` → `403`; đơn vị chưa gắn phường/xã → danh sách rỗng.
3. **When** `GET /api/commune-food-safety-units/me/schools/:schoolId`, **Then** trả thông tin trường và danh sách NCC liên kết với trường, trừ NCC đã hủy liên kết hoặc đã ngừng hoạt động (`{id, name, taxCode, phone, email, address, location, intakeState, relationshipStatus, linkedAt, suspendedAt}`); trường ngoài địa bàn hoặc không tồn tại → `404`.
4. **Given** trường có NCC A (quan hệ `ACTIVE`), B (quan hệ `SUSPENDED`), C (quan hệ `UNLINKED`), D (quan hệ `ACTIVE`, NCC `INACTIVE`), **Then** A, B xuất hiện kèm trạng thái; C, D không xuất hiện.

### User Story 5 - Bỏ dashboard ATTP (Priority: P2)

1. Vai trò `COMMUNE_FOOD_SAFETY_OFFICER` không còn grant `dashboard.view` trong catalog mặc định.

### Edge Cases

- Tài khoản ATTP chưa cập nhật email bị System Admin khóa/vô hiệu hóa: vẫn tính là phường/xã đã có tài khoản (FR-002).
- Đổi email sau khi đã kích hoạt: ngoài phạm vi (giữ luồng hồ sơ cá nhân hiện có).
- Tài khoản ATTP `UNVERIFIED` không được tính là cán bộ `ACTIVE` khi chuyển sự cố (giữ `409` hiện có).
- Quên mật khẩu khi chưa có email: không tự khôi phục được; System Admin xử lý ngoài phạm vi.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Migration MUST cho phép `users.email` NULL chỉ khi `role_code = 'COMMUNE_FOOD_SAFETY_OFFICER'`, `status <> 'ACTIVE'` (tài khoản chờ email vẫn khóa/vô hiệu hóa được) và `email_verified_at IS NULL` (CHECK); UNIQUE email giữ nguyên.
- **FR-002**: `POST /api/authority-officers` (System Admin, `authority.manage`, kiểm tra lại actor trong transaction) MUST nhận `{locationId, username, password, fullName, phone?}`; phường/xã `level = 2` đang hoạt động; tìm hoặc tạo đơn vị theo phường/xã; từ chối `409` nếu đơn vị đã có tài khoản ATTP; tạo tài khoản `UNVERIFIED`, `email = null`; xung đột unique (đồng thời) MUST map thành `409`.
- **FR-003**: `GET /api/authority-officers` và `GET /api/authority-officers/:userId` (System Admin) MUST trả tài khoản ATTP kèm đơn vị, phường/xã, trạng thái và `emailSetupRequired`; phân trang, lọc `locationId`, `status`, tìm theo tên/tên đăng nhập.
- **FR-004**: Phiên của tài khoản ATTP chưa có email MUST báo `emailSetupRequired: true` ở `/api/auth/me`; `authenticate` tiếp tục chặn API nghiệp vụ (tài khoản chưa `ACTIVE`); luồng onboarding trường/NCC MUST không áp dụng cho tài khoản này.
- **FR-005**: `POST /api/auth/email-setup/request {email}` và `POST /api/auth/email-setup/verify {email, code}` (phiên hợp lệ, CSRF) MUST chỉ dùng cho tài khoản ATTP chưa có email; OTP như `email-verification`; email đã dùng → `409`; xác minh đúng MUST, trong một transaction, ghi `email`, `email_verified_at`, `status = ACTIVE`, rồi xoay phiên.
- **FR-006**: Đăng nhập MUST từ chối tên đăng nhập với tài khoản ATTP đã có email (lỗi `401` chung); tài khoản chưa có email chỉ đăng nhập bằng tên đăng nhập.
- **FR-007**: Hồ sơ đăng ký trường và NCC MUST bắt buộc `locationId` (phường/xã đang hoạt động, kiểm tra khi nộp và khi duyệt); duyệt hồ sơ MUST tạo trường/NCC với `location_id` đó (hồ sơ cũ thiếu giá trị → `null`); chi tiết hồ sơ (người nộp và System Admin) MUST trả kèm phường/xã đã chọn.
- **FR-008**: `PUT /api/schools/:schoolId/location` và `PUT /api/suppliers/:supplierId/location` (`{locationId}`, System Admin, `authority.manage`) MUST gắn/đổi phường/xã đang hoạt động của trường/NCC; không đổi bản chuyển sự cố/C05 đã gửi.
- **FR-009**: `GET /api/commune-food-safety-units/me/schools` MUST yêu cầu tổ chức `AUTHORITY` + `authority_school.view`; phạm vi `schools.location_id = unit.location_id` lấy từ principal; trả `{id, code, name, address, phone, email, status, location}`; phân trang, `search`, `status`.
- **FR-011**: `GET /api/commune-food-safety-units/me/schools/:schoolId` MUST dùng cùng quyền và phạm vi FR-009 (ngoài phạm vi → `404`); trả `{id, code, name, address, phone, email, status, location, suppliers[]}`, `suppliers` gồm mọi NCC có quan hệ trường–NCC khác `UNLINKED` (`ACTIVE`, `SUSPENDED`) và `Supplier.status = ACTIVE`, sắp theo tên, mỗi phần tử `{id, name, taxCode, phone, email, address, location, intakeState, relationshipStatus, linkedAt, suspendedAt}` (allowlist, không trả hợp đồng, chứng nhận, lý do tạm dừng hay tài khoản NCC); đọc bằng một truy vấn Prisma (trường + quan hệ NCC lồng nhau).
- **FR-010**: Catalog quyền MUST thêm `authority_school.view` (grant `COMMUNE_FOOD_SAFETY_OFFICER`) và bỏ grant `dashboard.view` của `COMMUNE_FOOD_SAFETY_OFFICER`.

## Success Criteria _(mandatory)_

- **SC-001**: System Admin tạo được tài khoản ATTP cho một phường/xã mà không thao tác tay trên DB; phường/xã thứ hai không tạo được tài khoản trùng.
- **SC-002**: Trường và NCC đăng ký mới đều có phường/xã sau khi được duyệt; trường đăng ký mới với phường/xã X chuyển được sự cố/C05 tới ATTP X ngay sau khi được duyệt, và xuất hiện trong danh sách trường của ATTP X; chi tiết trường cho ATTP X thấy các NCC liên kết với trường, trừ NCC đã hủy liên kết hoặc đã ngừng hoạt động.
- **SC-003**: Cán bộ ATTP mới chỉ dùng được hệ thống sau khi xác minh email, và từ đó đăng nhập bằng email.
- **SC-004**: `npm run validate`, `test:unit`, `test:local:migrations`, `test:local:authorization` đều pass.
