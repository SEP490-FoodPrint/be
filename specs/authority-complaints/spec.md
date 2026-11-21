# Feature Specification: Khiếu nại leo thang lên ATTP (C05, PR4)

**Feature Branch**: `feat/authority-complaints`

**Created**: 2026-11-22

**Status**: Implemented

**Input**: Kế hoạch thiết kế DB khiếu nại v5 (`docs/complaint_db_design_plan_v3.md` §1 Q10/Q14/Q19/Q22/Q24/Q25, §3.3 mục 3, §4, §7 PR4; `docs/complaint_state_diagrams.md` §5, §7): "Đăng ký chữ viết tắt C05 `AC`; thêm `commune_food_safety_units.location_id`; nút Chuyển ATTP trên C03 + `authority_complaints` (0..1); hộp thư ATTP xử lý theo luồng ticket; BGH xem chỉ đọc C05 kèm bình luận".

## Bối cảnh

PR1 đã có bảng cha `complaints` với kind `AUTHORITY`, CHECK `complaints_code_kind` nhận `FP-AC-%`, lý do đóng `ESCALATED` (CHECK `complaints_escalated_kind` chỉ cho `MEAL`) và loại bình luận `ESCALATION_NOTE`, nhưng chưa có luồng ghi. C03 là khiếu nại suất ăn do phụ huynh (`PARENTS_COMMITTEE`) gửi BGH (bảng con `meal_complaints`). PR4 cho phụ huynh "Chuyển ATTP" một C03 đã được báo đã xử lý: đóng C03 (`ESCALATED`) và sinh đúng một C05 gửi đơn vị ATTP phụ trách phường/xã của trường.

## Clarifications

### Session 2026-11-22

- Q: Gắn đơn vị ATTP với phường/xã thế nào (chưa có API quản lý đơn vị)? → A: Thêm `PUT /api/commune-food-safety-units/:id/location` cho System Admin (quyền mới `authority.manage`); chỉ nhận `Location` cấp phường/xã đang hoạt động; mỗi phường/xã tối đa một đơn vị (trùng → 409).
- Q: Location cấp phường/xã là gì? → A: `level = 2` và `isActive = true` (mô hình 2 cấp tỉnh → phường/xã).
- Q: ATTP xem gì từ C03 gốc? → A: Tóm tắt (mã, tiêu đề, loại, bữa ăn, mô tả) và toàn bộ bình luận PH ↔ BGH của C03, chỉ đọc.
- Q: Mô hình quyền? → A: Ba quyền mới: `authority_complaint.submit` (`PARENTS_COMMITTEE`), `authority_complaint.view` (`PARENTS_COMMITTEE`, `SCHOOL_MANAGEMENT_BOARD`, `COMMUNE_FOOD_SAFETY_OFFICER`), `authority_complaint.respond` (`COMMUNE_FOOD_SAFETY_OFFICER`).
- Quyết định mặc định (theo plan v5): thiếu `location_id` của trường hoặc phường/xã chưa có đơn vị ATTP `ACTIVE` → 409; tiêu đề C05 = `Khiếu nại chuyển ATTP từ đơn <mã C03>`; mô tả C05 = mô tả C03 + `Lý do chuyển ATTP: <lý do>` (nếu có); lý do tùy chọn, nếu có thì cũng lưu thành bình luận `ESCALATION_NOTE` trên C03.

## Phạm vi

- Trong phạm vi: migration (cột `commune_food_safety_units.location_id` + unique một phần; bảng con `authority_complaints`); chữ viết tắt `AC`; ba quyền C05 + `authority.manage`; API `/api/authority-complaints` (Chuyển ATTP, danh sách, chi tiết, ticket); `PUT /api/commune-food-safety-units/:id/location`; thao tác `ESCALATE` và liên kết C05 trên DTO C03.
- Ngoài phạm vi: email (PR-E), tạo/sửa đơn vị ATTP khác ngoài địa bàn, chuyển sự cố lên ATTP (PR5), gán `location_id` cho trường (đã có ở module tổ chức), giao diện.

### Thay thế spec cũ

`specs/complaint-supertype/` FR-004 (máy trạng thái): thêm thao tác người gửi `ESCALATE` chỉ cho C03, cùng điều kiện 48h như Hài lòng/Yêu cầu xử lý lại. Danh sách đơn vị ATTP (`GET /api/commune-food-safety-units`) trả thêm `locationId`.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Phụ huynh chuyển C03 lên ATTP (Priority: P1)

**Acceptance Scenarios**:

1. **Given** C03 do chính phụ huynh gửi ở `RESOLVED` trong 48h kể từ lần "Đã xử lý" gần nhất, trường có `location_id` và phường/xã có đơn vị ATTP `ACTIVE`, **When** `POST /api/authority-complaints {mealComplaintId, reason?}`, **Then** trong một transaction: C03 → `CLOSED` (`ESCALATED`, ghi lịch sử), bình luận `ESCALATION_NOTE` nếu có lý do; C05 mới ở `NEW` với mã `FP-AC-NNNNN`, lưu cứng trường, đơn vị ATTP nhận và C03 gốc; lịch sử `→ NEW`; trả 201 chi tiết C05.
2. **Given** C03 chưa `RESOLVED`, quá 48h, đã chuyển, hoặc là C01 (người gửi GVCN), **When** chuyển, **Then** 409 (C01/không phải của mình → 404).
3. **Given** trường chưa gắn phường/xã hoặc phường/xã chưa có đơn vị ATTP hoạt động, **Then** 409, không đổi gì.
4. **Given** hai yêu cầu chuyển đồng thời, **Then** đúng một thành công, còn lại 409.
5. **Given** chi tiết C03 của phụ huynh trong 48h sau "Đã xử lý" và có `authority_complaint.submit`, **Then** `allowedActions` gồm `ESCALATE`; sau khi chuyển, C03 trả `escalatedAuthorityComplaint {id, code}`.

### User Story 2 - ATTP xử lý theo luồng ticket (Priority: P1)

Cán bộ ATTP (`COMMUNE_FOOD_SAFETY_OFFICER`) của đơn vị nhận có `view` + `respond` thấy C05 gửi đơn vị mình, xem tóm tắt + bình luận C03 gốc, Tiếp nhận, bình luận, Đã xử lý. Phụ huynh bình luận, Hài lòng, Yêu cầu xử lý lại (không giới hạn); job 48h tự đóng.

### User Story 3 - BGH chỉ xem (Priority: P2)

BGH có `authority_complaint.view` xem danh sách/chi tiết C05 của trường mình (kể cả bình luận PH ↔ ATTP và C03 gốc); mọi thao tác ghi trả 403.

### User Story 4 - System Admin gắn đơn vị ATTP với phường/xã (Priority: P1)

`PUT /api/commune-food-safety-units/:id/location {locationId}` (`authority.manage`, tổ chức SYSTEM): đơn vị không tồn tại → 404; Location không tồn tại/không hoạt động/không phải `level = 2` → 400; phường/xã đã gắn đơn vị khác → 409; gắn lại cùng giá trị trả 200. Đơn C05 đã tạo không đổi nơi nhận.

### Edge Cases

- Đơn vị ATTP bị `INACTIVE` sau khi nhận đơn: C05 cũ vẫn thuộc đơn vị đó (lưu cứng).
- Đơn vị ATTP khác hoặc cán bộ thiếu `respond`: không thấy đơn (404) hoặc chỉ xem (`allowedActions = []`).
- `SCHOOL_ADMINISTRATION` không có quyền C05 (Q24).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Migration MUST thêm `commune_food_safety_units.location_id uuid NULL FK locations` + unique index `uq_commune_food_safety_units_location_id` (`WHERE location_id IS NOT NULL`); tạo `authority_complaints(id, kind DEFAULT 'AUTHORITY', school_id, recipient_commune_food_safety_unit_id, escalated_from_meal_complaint_id)` với CHECK kind, `UNIQUE(id, kind)`, FK `(id, kind)` → `complaints`, FK trường/đơn vị/`meal_complaints(id)`, `UNIQUE(escalated_from_meal_complaint_id)`.
- **FR-002**: `AC` MUST được đăng ký trong `business-code.ts`; mã cấp bằng `allocateCode("AC")` trong transaction chuyển.
- **FR-003**: Chuyển ATTP MUST chạy trong `withSchoolTransaction` (Serializable, nạp lại actor, trường `ACTIVE`) với quyền `authority_complaint.submit`, vai trò `PARENTS_COMMITTEE`; khóa dòng C03 (`FOR UPDATE`); C03 phải `kind = MEAL`, `senderUserId = actor`, `senderRoleCode = PARENTS_COMMITTEE`, cùng trường; chuyển trạng thái có điều kiện `RESOLVED → CLOSED` (`ESCALATED`, hạn 48h); vi phạm UNIQUE → 409.
- **FR-004**: Đơn vị nhận MUST được suy ra từ `schools.location_id` → `commune_food_safety_units.location_id` với `status = ACTIVE`; người gửi không chọn tay.
- **FR-005**: Phạm vi đọc `authority-complaint`: `AUTHORITY` → `recipientCommuneFoodSafetyUnitId` của actor; BGH → `schoolId` của actor; vai trò trường khác có `view` → `senderUserId = actor` và cùng trường; còn lại 403.
- **FR-006**: Bên xử lý = `COMMUNE_FOOD_SAFETY_OFFICER` thuộc đơn vị nhận có `view` + `respond`; người gửi = phụ huynh gửi đơn có `submit`; mọi thao tác ghi nạp lại actor trong transaction Serializable.
- **FR-007**: Chi tiết C05 MUST gồm `escalatedFrom` (id, code, title, complaintType, description, meal, comments) chỉ đọc; danh sách chỉ gồm `escalatedFrom {id, code}`.
- **FR-008**: `PUT /api/commune-food-safety-units/:id/location` như US4; ghi trong `authorizationTransaction`, nạp lại actor.
- **FR-009**: Catalog MUST thêm 4 quyền và grant như Clarifications; `authority.manage` và `authority.view` (để tra cứu đơn vị) cho `SYSTEM_ADMIN`.

### Key Entities

- **AuthorityComplaint**: trường, đơn vị ATTP nhận, C03 gốc (0..1 mỗi C03).
- **CommuneFoodSafetyUnit.location**: phường/xã phụ trách (0..1, duy nhất).

## Success Criteria _(mandatory)_

- **SC-001**: Trên DB kiểm thử, luồng C03 → Chuyển ATTP → ATTP xử lý → phụ huynh Hài lòng chạy qua HTTP; BGH chỉ đọc.
- **SC-002**: Mọi điều kiện sai bị từ chối mà không đổi C03 và không tạo C05.
- **SC-003**: `npm run validate`, `test:unit`, `test:local:*` liên quan pass.

## Assumptions

- `auth:bootstrap` trên DB đã có role chỉ thêm grant cho System Admin (`authority.manage`); trên azure-dev operator cấp các quyền C05 cho phụ huynh, BGH, ATTP qua API quản trị quyền, và gắn đơn vị ATTP với phường/xã qua API mới.
- Email (tạo đơn, bình luận, Đã xử lý) thuộc PR-E.
