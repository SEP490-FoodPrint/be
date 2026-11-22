# Feature Specification: Luồng báo cáo sự cố ATTP (PR5)

**Feature Branch**: `feat/food-safety-incident-workflow`

**Created**: 2026-11-22

**Status**: Implemented

**Input**: Kế hoạch thiết kế DB khiếu nại & sự cố v5 (`docs/complaint_db_design_plan_v3.md` §1 Q4/Q19/Q20/Q23/Q24, §2 luồng B, §5.1, §5.2 mục 1, §6.3, §7 PR5): "Mở rộng `food_safety_incidents` (giữ `code` FP-IC), enum trạng thái mới + migrate theo mục 6.3, báo cáo sự cố của phụ huynh và GVCN, BGH tự lập hồ sơ gửi thẳng ATTP, người báo xem tiến độ, xác minh sơ bộ BGH, chuyển ATTP kể cả thiếu allocation, lịch sử trạng thái".

## Bối cảnh

Hiện `food_safety_incidents` chỉ có API đọc danh sách (module `inspection`, `/api/food-safety-incidents`) và hộp thư ATTP (`reporting`, `/api/food-safety-reports`, ATTP "tiếp nhận" bản chuyển). Không có luồng ghi. Trạng thái dùng enum cũ `incident_status` (`OPEN`/`INVESTIGATING`/`RESOLVED`/`CLOSED`). PR5 dựng luồng B (Q19): phụ huynh (`PARENTS_COMMITTEE`) hoặc GVCN (`HOMEROOM_TEACHER`) báo cáo sự cố lên BGH; BGH xác minh sơ bộ rồi bắt buộc chuyển lên ATTP (chỉ được hủy khi trùng/nhập sai, Q4); BGH cũng tự lập hồ sơ gửi thẳng ATTP (Q20); ATTP tiếp nhận.

## Clarifications

### Session 2026-11-22

- Q18: Tổ chức module? → A: Module mới `food-safety-incident` thay module `inspection` tại cùng mount `/api/food-safety-incidents` (tên `inspection` để dành cho đợt kiểm tra ở PR6); giữ `reporting` làm hộp thư ATTP, thao tác tiếp nhận chuyển hồ sơ sang `AUTHORITY_ACKNOWLEDGED`.
- Q16: Dữ liệu cũ? → A: Ánh xạ theo mục 6.3 trong migration (chạy được cả khi bảng rỗng hay có dữ liệu); mọi dòng cũ `source = LEGACY_IMPORT`.
- Phạm vi snapshot? → A: Tách PR5b: `food_safety_incident_trace_snapshots`, `trace_completeness`, payload chuẩn hóa và hash thuộc PR5b; PR5 chỉ làm luồng trạng thái, gắn allocation, lịch sử.
- Mã quyền người báo? → A: Quyền mới `food_safety_incident.report` cho `PARENTS_COMMITTEE` và `HOMEROOM_TEACHER` (cùng `food_safety_incident.view`, phạm vi chỉ hồ sơ mình báo). BGH dùng quyền có sẵn: `.create` (tự lập hồ sơ), `.manage` (hủy, gắn allocation), `.forward` (chuyển ATTP). ATTP giữ `food_safety_report.receive`.
- Quyết định mặc định (không đổi nghiệp vụ đã chốt):
  - Bản ghi cũ `OPEN` có bản chuyển ánh xạ đúng §6.3 sang `SUBMITTED_TO_AUTHORITY`; nếu bản chuyển đã được tiếp nhận từ trước, lần gọi tiếp nhận kế tiếp (trả lại biên nhận cũ) chuyển hồ sơ sang `AUTHORITY_ACKNOWLEDGED` để ATTP không bị kẹt.
  - `code` giữ nullable cho bản ghi cũ chờ `business-codes:backfill`; CHECK bắt buộc `code` với mọi `source <> LEGACY_IMPORT` (không làm hỏng CD nếu azure-dev còn dòng cũ chưa có mã).
  - Xác minh sơ bộ gộp vào thao tác chuyển ATTP: `POST /:id/forward {preliminaryAssessment, preliminaryNote?}` ghi nhận định và chuyển trong một transaction.
  - Tiêu đề do người báo nhập (1–255 ký tự); mô tả 10–2000; mô tả triệu chứng tùy chọn tối đa 2000; số người có triệu chứng 1–100000; thời điểm xảy ra tùy chọn, không ở tương lai.
  - Đơn vị ATTP nhận được suy ra như C05: `schools.location_id` → `commune_food_safety_units.location_id`, đơn vị `ACTIVE`, và phải có cán bộ `COMMUNE_FOOD_SAFETY_OFFICER` `ACTIVE` của đơn vị (người nhận bản chuyển); thiếu → 409.
  - Allocation gắn được phải thuộc trường, trạng thái `DISTRIBUTED`/`FINALIZED`; chỉ thêm (không gỡ), khi hồ sơ chưa `CLOSED`/`CANCELLED_BY_SCHOOL`.

## Phạm vi

- Trong phạm vi: migration (enum mới, cột mới, ánh xạ dữ liệu cũ, `food_safety_incident_status_histories`); quyền `food_safety_incident.report`; module `food-safety-incident` (danh sách, chi tiết, báo cáo PH/GVCN, BGH tự lập, chuyển ATTP, hủy, gắn allocation); `reporting.receive` chuyển hồ sơ sang `AUTHORITY_ACKNOWLEDGED`; cập nhật các nơi đọc trạng thái cũ.
- Ngoài phạm vi: snapshot truy xuất + `trace_completeness` + hash (PR5b); đợt kiểm tra, kết luận, `UNDER_INSPECTION` → `INSPECTION_COMPLETED` → `CLOSED`, chế tài NCC (PR6); email; cảnh báo trường khác; giao diện.

### Thay thế spec cũ

- Module `inspection` (`GET /api/food-safety-incidents`) được thay bởi module `food-safety-incident` cùng route; resource `inspection` đổi tên thành `food-safety-incident`; danh sách trả thêm `code`, `source`, `reportedSymptomaticCount`, `recipientCommuneFoodSafetyUnitId`, `status` theo enum mới.
- `PARENTS_COMMITTEE` có `food_safety_incident.view` trước đây thấy mọi sự cố của trường; nay chỉ thấy hồ sơ mình báo (Q23), kể cả trong `GET /api/schools/.../overview` (khối `incidents`).
- `POST /api/food-safety-reports/:id/receive`: ngoài ghi `received_at`, chuyển hồ sơ `SUBMITTED_TO_AUTHORITY → AUTHORITY_ACKNOWLEDGED` (ghi lịch sử) trong cùng transaction.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Phụ huynh / GVCN báo cáo sự cố (Priority: P1)

**Acceptance Scenarios**:

1. **Given** phụ huynh có `food_safety_incident.report` thuộc trường `ACTIVE`, **When** `POST /api/food-safety-incidents {title, description, reportedSymptomaticCount, symptomDescription?, occurredAt?, classId?}`, **Then** 201, hồ sơ `PENDING_SCHOOL_REVIEW`, `source = PARENT_REPORT`, mã `FP-IC-NNNNN`, lịch sử `→ PENDING_SCHOOL_REVIEW`.
2. **Given** GVCN, **When** báo cáo, **Then** `classId` bắt buộc và phải là lớp GVCN đang chủ nhiệm (400 thiếu, 403 không phải lớp mình); `source = TEACHER_REPORT`.
3. **Given** `classId` không thuộc trường hoặc không `ACTIVE`, **Then** 404.
4. **Given** BGH, bếp, ATTP, System Admin, **When** gọi API báo cáo, **Then** 403.

### User Story 2 - BGH xác minh và chuyển ATTP / hủy (Priority: P1)

1. **Given** hồ sơ `PENDING_SCHOOL_REVIEW` của trường, BGH có `.forward`, **When** `POST /:id/forward {preliminaryAssessment, preliminaryNote?}`, **Then** trong một transaction: ghi nhận định sơ bộ (`OUTSIDE_MEAL` vẫn phải chuyển), suy ra đơn vị ATTP, tạo bản chuyển `food_safety_report_forwardings` (`SENT`, người nhận là cán bộ của đơn vị), hồ sơ `SUBMITTED_TO_AUTHORITY`, lịch sử; không cần có allocation.
2. **Given** trường chưa gắn phường/xã, phường/xã chưa có đơn vị `ACTIVE` hoặc đơn vị chưa có cán bộ `ACTIVE`, **Then** 409, không đổi gì.
3. **Given** `POST /:id/cancel {reason: DUPLICATE_REPORT|DATA_ENTRY_ERROR, note}` (`.manage`), **Then** `CANCELLED_BY_SCHOOL` kèm lý do; chỉ từ `PENDING_SCHOOL_REVIEW` (khác → 409).
4. **Given** hai thao tác chuyển/hủy đồng thời, **Then** đúng một thành công, còn lại 409.

### User Story 3 - BGH tự lập hồ sơ gửi thẳng ATTP (Priority: P1)

`POST /api/food-safety-incidents/direct {title, description, reportedSymptomaticCount, symptomDescription?, occurredAt?, classId?, preliminaryAssessment, preliminaryNote?}` (BGH, `.create` + `.forward`): hồ sơ `SCHOOL_DIRECT` vào thẳng `SUBMITTED_TO_AUTHORITY`, ghi nhận định ngay, tạo bản chuyển; điều kiện đơn vị nhận như US2 (409 khi thiếu, không tạo hồ sơ).

### User Story 4 - BGH gắn suất ăn bị ảnh hưởng (Priority: P2)

`POST /:id/allocations {mealAllocationIds}` (`.manage`, 1–50 id không trùng): thêm liên kết (bỏ qua liên kết đã có); allocation ngoài trường → 404; trạng thái không `DISTRIBUTED`/`FINALIZED` → 409; hồ sơ `CLOSED`/`CANCELLED_BY_SCHOOL` → 409.

### User Story 5 - Người báo theo dõi tiến độ (Priority: P1)

Phụ huynh/GVCN chỉ thấy hồ sơ mình báo (`source ∈ {PARENT_REPORT, TEACHER_REPORT}`), chỉ đọc: nội dung đã gửi, trạng thái, lịch sử trạng thái (mốc thời gian), lý do/ghi chú hủy. Không thấy nhận định sơ bộ, bản chuyển, allocation. Hồ sơ `SCHOOL_DIRECT` và hồ sơ người khác → không có trong danh sách, chi tiết 404.

### User Story 6 - ATTP tiếp nhận (Priority: P1)

Cán bộ ATTP nhận bản chuyển (`POST /api/food-safety-reports/:id/receive`) → hồ sơ `SUBMITTED_TO_AUTHORITY → AUTHORITY_ACKNOWLEDGED`; ATTP xem chi tiết hồ sơ được chuyển tới đơn vị mình (đầy đủ như BGH).

### Edge Cases

- `SCHOOL_ADMINISTRATION` không có quyền sự cố (Q24).
- Hồ sơ `LEGACY_IMPORT` đọc được, không có thao tác mới ngoài tiếp nhận ATTP.
- Tài khoản bị khóa hoặc chuyển trường sau khi báo: thao tác ghi nạp lại actor trong transaction; người báo cũ không còn đọc được nếu không còn quyền.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Migration MUST tạo enum `food_safety_incident_status` (`PENDING_SCHOOL_REVIEW`, `SUBMITTED_TO_AUTHORITY`, `AUTHORITY_ACKNOWLEDGED`, `UNDER_INSPECTION`, `INSPECTION_COMPLETED`, `CLOSED`, `CANCELLED_BY_SCHOOL`), `food_safety_incident_source`, `school_preliminary_assessment`, `food_safety_incident_cancellation_reason`; chuyển `status` theo §6.3, xóa enum cũ `incident_status`.
- **FR-002**: Migration MUST thêm cột `source`, `reported_role_code` (FK `roles(code)`), `reported_class_id`, `reported_symptomatic_count`, `symptom_description`, `school_preliminary_assessment`, `school_preliminary_note`, `school_reviewed_by_user_id`, `school_reviewed_at`, `cancellation_reason`, `cancellation_note`, `recipient_commune_food_safety_unit_id` với CHECK: vai trò theo nguồn, lớp bắt buộc với `TEACHER_REPORT`, số người ≥ 1, mã bắt buộc ngoài `LEGACY_IMPORT`, hủy ⇔ có lý do + ghi chú, nhận định sơ bộ đủ bộ, đơn vị nhận `NULL` ở `PENDING_SCHOOL_REVIEW`/`CANCELLED_BY_SCHOOL` và bắt buộc từ `SUBMITTED_TO_AUTHORITY` (trừ `LEGACY_IMPORT`), nhận định bắt buộc từ `SUBMITTED_TO_AUTHORITY` (trừ `LEGACY_IMPORT`).
- **FR-003**: Migration MUST tạo `food_safety_incident_status_histories(id, incident_id, from_status, to_status, actor_user_id, actor_role_code, note, created_at)`, CHECK người thao tác đủ bộ.
- **FR-004**: Tạo hồ sơ MUST chạy trong `withSchoolTransaction`, cấp mã `allocateBusinessCode("IC")` trong transaction, ghi lịch sử.
- **FR-005**: Phạm vi đọc `food-safety-incident`: SYSTEM → tất cả; BGH → `schoolId`; vai trò trường khác có `view` → `schoolId` + `reportedByUserId = actor` + `source ∈ {PARENT_REPORT, TEACHER_REPORT}`; AUTHORITY → hồ sơ có bản chuyển tới đơn vị/cán bộ (giữ phạm vi cũ); `SCHOOL_ADMINISTRATION` không có quyền.
- **FR-006**: Mọi thao tác ghi MUST nạp lại actor, khóa dòng hồ sơ (`FOR UPDATE`) và chuyển trạng thái có điều kiện; thua đồng thời → 409.
- **FR-007**: Chi tiết MUST chọn projection theo người xem (người báo: rút gọn theo US5; BGH/ATTP/SYSTEM: đầy đủ gồm nhận định, đơn vị nhận, bản chuyển, allocation, lịch sử).
- **FR-008**: `reporting.receive` MUST chuyển hồ sơ `SUBMITTED_TO_AUTHORITY → AUTHORITY_ACKNOWLEDGED` (có điều kiện, ghi lịch sử) khi bản chuyển được tiếp nhận, kể cả khi gọi lại trên bản chuyển đã tiếp nhận; trạng thái khác giữ nguyên.
- **FR-009**: Catalog MUST thêm `food_safety_incident.report` (grant `PARENTS_COMMITTEE`, `HOMEROOM_TEACHER`) và grant `food_safety_incident.view` cho `HOMEROOM_TEACHER`.
- **FR-010**: Các truy vấn đọc trạng thái cũ MUST đổi sang enum mới: mẫu lưu (`retained-sample`) coi hồ sơ "đang xử lý" là mọi trạng thái khác `CLOSED`/`CANCELLED_BY_SCHOOL`; tổng quan trường dùng phạm vi FR-005.

### Key Entities

- **FoodSafetyIncident**: thêm nguồn, người/vai trò/lớp báo, triệu chứng, nhận định sơ bộ, hủy, đơn vị nhận.
- **FoodSafetyIncidentStatusHistory**: lịch sử trạng thái append-only.

## Success Criteria _(mandatory)_

- **SC-001**: Trên DB kiểm thử, luồng PH báo → BGH gắn allocation → chuyển ATTP → ATTP tiếp nhận, và BGH tự lập → ATTP tiếp nhận chạy qua HTTP.
- **SC-002**: Migration ánh xạ đúng dữ liệu cũ theo §6.3 và CHECK chặn trạng thái sai.
- **SC-003**: `npm run validate`, `test:unit`, `test:local:*` liên quan pass.

## Assumptions

- Trên azure-dev, sau khi merge: operator chạy `auth:bootstrap -- --azure` để tạo quyền `food_safety_incident.report`, rồi cấp `report` + `view` cho phụ huynh và GVCN qua API quản trị quyền (bootstrap không cấp cho vai trò đã tồn tại). Luồng chuyển ATTP cần trường và đơn vị ATTP đã gắn phường/xã (PR4).
- Bản ghi cũ chưa có mã vẫn chờ `business-codes:backfill`.
