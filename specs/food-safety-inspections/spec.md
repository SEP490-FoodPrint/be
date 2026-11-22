# Feature Specification: Đợt kiểm tra ATTP và kết luận theo NCC (PR6a)

**Feature Branch**: `feat/food-safety-inspections`

**Created**: 2026-11-22

**Status**: Implemented

**Input**: Kế hoạch thiết kế DB khiếu nại & sự cố v5 (`docs/complaint_db_design_plan_v3.md` §1 Q5/Q11/Q23/Q26, §5.1, §5.2 mục 3, §6.3, §7 PR6) và `docs/complaint_state_diagrams.md` (luồng B, "Đợt kiểm tra"): "`food_safety_inspections` (kết quả ghi một lần, Q26) + findings theo NCC".

## Bối cảnh

PR5/PR5b đưa hồ sơ sự cố tới `AUTHORITY_ACKNOWLEDGED` (ATTP tiếp nhận) và lưu snapshot truy xuất. Chưa có đợt kiểm tra, kết luận hay đóng hồ sơ: `UNDER_INSPECTION` → `INSPECTION_COMPLETED` → `CLOSED` chưa có luồng ghi. PR6 trong kế hoạch được tách: PR6a (spec này) làm đợt kiểm tra, kết luận theo NCC và đóng hồ sơ; PR6b làm yêu cầu chế tài NCC (`PAUSE_INTAKE`/`LOCK_ACCOUNT`/`RESTORE`), hạn chế, khóa/mở tài khoản.

## Clarifications

### Session 2026-11-22

- Tách PR6? → A: Tách PR6a (đợt kiểm tra, kết luận, đóng hồ sơ) và PR6b (chế tài NCC).
- Nhiều đợt kiểm tra? → A: ATTP lập đợt khi hồ sơ `AUTHORITY_ACKNOWLEDGED` (→ `UNDER_INSPECTION`) hoặc đang `UNDER_INSPECTION`. Ghi kết quả một đợt mà không còn đợt `PLANNED` nào → hồ sơ `INSPECTION_COMPLETED`. Từ `INSPECTION_COMPLETED` **không** lập thêm đợt; chỉ còn đóng hồ sơ.
- NCC được kết luận? → A: Chỉ NCC xuất hiện trong snapshot truy xuất của hồ sơ (hợp mọi phiên bản). Hồ sơ không có NCC nào trong snapshot (dữ liệu cũ, thiếu allocation) → NCC có quan hệ cung cấp với trường (`school_supplier_relationships.status` khác `UNLINKED`).
- Mã quyền? → A: Quyền mới `food_safety_inspection.manage` cho `COMMUNE_FOOD_SAFETY_OFFICER` (lập đợt, ghi kết quả, đóng hồ sơ). Đọc dùng `food_safety_incident.view` sẵn có.
- Quyết định mặc định (không đổi nghiệp vụ đã chốt):
  - Người thao tác: cán bộ ATTP thuộc đơn vị đang nhận hồ sơ (`recipient_commune_food_safety_unit_id` = đơn vị của cán bộ); hồ sơ khác → 404. Hồ sơ cũ không có đơn vị nhận không thao tác được.
  - Lập đợt: `{teamDescription (1–2000), scheduledAt (ISO có múi giờ)}`; `SUBMITTED_TO_AUTHORITY` → 409 (phải tiếp nhận trước).
  - Ghi kết quả: `{resultSummary (10–4000), overallConclusion, findings[] (0–50, NCC không trùng; finding `AT_FAULT|CLEARED|INCONCLUSIVE`, evidenceNote ≤ 2000)}`; có ≥ 1 `AT_FAULT` ⇔ `overallConclusion ∈ {SUPPLIER_AT_FAULT, MIXED_FAULT}` (400). Ghi bằng `updateMany … WHERE status = 'PLANNED'`, 0 dòng → 409; findings tạo cùng transaction; không có thao tác sửa.
  - Đóng hồ sơ: chỉ từ `INSPECTION_COMPLETED`, mọi đợt `COMPLETED` và có ≥ 1 đợt `COMPLETED` (hồ sơ `LEGACY_IMPORT` miễn điều kiện "≥ 1 đợt", §6.3); ghi chú tùy chọn ≤ 2000 lưu vào lịch sử. Đóng không gỡ hạn chế NCC (PR6b).
  - Mọi chuyển trạng thái ghi `food_safety_incident_status_histories` với cán bộ ATTP là người thao tác.
  - Hiển thị (Q23): người báo (PH/GVCN) thấy mọi đợt (trạng thái, thời gian), `resultSummary`, `overallConclusion`, kết luận từng NCC (NCC, finding, evidenceNote) và người ghi kết quả (tên, vai trò); không thấy `teamDescription`. Chi tiết đầy đủ (BGH/ATTP/System) thêm `teamDescription`, người lập đợt.
  - `allowedActions` của cán bộ đơn vị nhận: `PLAN_INSPECTION` (`AUTHORITY_ACKNOWLEDGED`/`UNDER_INSPECTION`), `CLOSE` (`INSPECTION_COMPLETED`).

## Phạm vi

- Trong phạm vi: migration (`food_safety_inspections`, `food_safety_inspection_supplier_findings`, enum); quyền `food_safety_inspection.manage`; module `food-safety-inspection` (lập đợt, ghi kết quả, đóng hồ sơ, danh sách NCC được kết luận); chi tiết hồ sơ hiển thị đợt kiểm tra.
- Ngoài phạm vi: yêu cầu chế tài NCC, hạn chế, khóa/mở tài khoản, thu hồi session (PR6b); email; giao diện; neo blockchain.

### Thay thế spec cũ

- `specs/food-safety-incident-workflow`: `allowedActions` có thêm `PLAN_INSPECTION`/`CLOSE` cho cán bộ ATTP đơn vị nhận; chi tiết hồ sơ (cả `REPORTER` và `FULL`) thêm `inspections`.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - ATTP lập đợt kiểm tra (Priority: P1)

**Acceptance Scenarios**:

1. **Given** hồ sơ `AUTHORITY_ACKNOWLEDGED`, **When** cán bộ đơn vị nhận lập đợt, **Then** đợt `PLANNED`, hồ sơ `UNDER_INSPECTION`, có lịch sử.
2. **Given** hồ sơ `SUBMITTED_TO_AUTHORITY` hoặc `INSPECTION_COMPLETED`, **Then** 409. Cán bộ đơn vị khác → 404; vai trò khác → 403.

### User Story 2 - ATTP ghi kết quả (Priority: P1)

**Acceptance Scenarios**:

1. **Given** hai đợt `PLANNED`, **When** ghi kết quả đợt 1, **Then** đợt 1 `COMPLETED`, hồ sơ vẫn `UNDER_INSPECTION`; ghi đợt 2 → `INSPECTION_COMPLETED`.
2. **Given** đợt đã `COMPLETED`, **When** ghi lại, **Then** 409 (hai lượt đồng thời: một 200, một 409).
3. **Given** NCC không thuộc snapshot, **Then** 400; kết luận `SUPPLIER_AT_FAULT` không có NCC `AT_FAULT` → 400.

### User Story 3 - ATTP đóng hồ sơ (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `INSPECTION_COMPLETED`, **When** đóng, **Then** `CLOSED`, có lịch sử; trạng thái khác → 409.

### User Story 4 - Người báo xem kết luận (Priority: P1)

**Acceptance Scenarios**:

1. **Given** phụ huynh đã báo hồ sơ, **When** xem chi tiết, **Then** thấy kết luận từng NCC, không thấy `teamDescription`.

### Edge Cases

- Hồ sơ cũ `UNDER_INSPECTION` (ánh xạ từ `INVESTIGATING`) chưa có đợt: cho lập bổ sung (§6.3).
- Hồ sơ cũ `INSPECTION_COMPLETED` không có đợt: đóng được.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Migration MUST tạo enum `food_safety_inspection_status` (`PLANNED`, `COMPLETED`), `food_safety_inspection_conclusion` (`SUPPLIER_AT_FAULT`, `SCHOOL_AT_FAULT`, `MIXED_FAULT`, `NOT_FOOD_RELATED`, `INCONCLUSIVE`), `food_safety_supplier_finding` (`AT_FAULT`, `CLEARED`, `INCONCLUSIVE`).
- **FR-002**: Migration MUST tạo `food_safety_inspections(id, incident_id, team_description, scheduled_at, status, result_summary, overall_conclusion, recorded_by_user_id, completed_at, created_by_user_id, created_at, updated_at)`, `UNIQUE(incident_id, id)`, CHECK: `PLANNED` ⇒ 4 cột kết quả `NULL`, `COMPLETED` ⇒ 4 cột kết quả `NOT NULL`; `team_description`/`result_summary` không rỗng.
- **FR-003**: Migration MUST tạo `food_safety_inspection_supplier_findings(inspection_id, supplier_id, finding, evidence_note)`, PK `(inspection_id, supplier_id)`.
- **FR-004**: Mọi thao tác ghi MUST chạy trong transaction phân quyền, nạp lại actor (cán bộ ATTP `AUTHORITY`, có `food_safety_inspection.manage`), khóa dòng hồ sơ, giới hạn hồ sơ theo đơn vị nhận, chuyển trạng thái có điều kiện; thua đồng thời → 409.
- **FR-005**: Lập đợt, ghi kết quả, đóng hồ sơ MUST theo mục Clarifications và ghi lịch sử trạng thái.
- **FR-006**: `GET /:id/inspection-suppliers` MUST trả danh sách NCC được kết luận (cán bộ đơn vị nhận).
- **FR-007**: Chi tiết hồ sơ MUST thêm `inspections` theo projection người xem (Q23).
- **FR-008**: Catalog MUST thêm `food_safety_inspection.manage` (grant `COMMUNE_FOOD_SAFETY_OFFICER`).

### Key Entities

- **FoodSafetyInspection**: đợt kiểm tra của ATTP, kết quả ghi một lần.
- **FoodSafetyInspectionSupplierFinding**: kết luận theo từng NCC, căn cứ cho `LOCK_ACCOUNT` (PR6b).

## Success Criteria _(mandatory)_

- **SC-001**: Trên DB kiểm thử, luồng ATTP tiếp nhận → lập 2 đợt → ghi kết quả → đóng hồ sơ chạy qua HTTP; phụ huynh xem kết luận.
- **SC-002**: CHECK chặn đợt kiểm tra thiếu/thừa kết quả.
- **SC-003**: `npm run validate`, `test:unit`, `test:local:*` liên quan pass.

## Assumptions

- Trên azure-dev sau khi merge: operator chạy `auth:bootstrap -- --azure` để tạo `food_safety_inspection.manage`, rồi cấp cho `COMMUNE_FOOD_SAFETY_OFFICER` qua API quản trị quyền (bootstrap không cấp cho vai trò đã tồn tại).
