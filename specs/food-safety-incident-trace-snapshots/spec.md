# Feature Specification: Snapshot truy xuất sự cố ATTP (PR5b)

**Feature Branch**: `feat/food-safety-incident-trace-snapshots`

**Created**: 2026-11-22

**Status**: Implemented

**Input**: Kế hoạch thiết kế DB khiếu nại & sự cố v5 (`docs/complaint_db_design_plan_v3.md` §1 Q6, §5.1 quy tắc 2.2, §5.2 mục 1–2, §7 PR5) và quyết định tách PR5b của `specs/food-safety-incident-workflow/spec.md`: "`food_safety_incident_trace_snapshots`, `trace_completeness`, payload chuẩn hóa và hash".

## Bối cảnh

PR5 (`specs/food-safety-incident-workflow`) đã dựng luồng PH/GVCN báo cáo → BGH chuyển ATTP, BGH tự lập hồ sơ, gắn suất ăn (`food_safety_incident_allocations`) và lịch sử trạng thái, nhưng ATTP chỉ thấy danh sách suất ăn gắn với hồ sơ, không có bản ghi bất biến về chuỗi truy xuất (lớp → mẻ nấu → lô nguyên liệu → NCC/cơ sở nguồn → mẫu lưu) tại thời điểm gửi. Quy tắc 2.2: chuyển ATTP không bắt buộc có allocation; hệ thống ghi mức đầy đủ truy xuất và tạo snapshot v1 ghi nhận trạng thái thiếu; khi bổ sung allocation sau đó tạo snapshot v2+ và gửi bản bổ sung lên ATTP, giữ nguyên snapshot cũ.

## Clarifications

### Session 2026-11-22

- Phạm vi: đã chốt ở PR5 (tách PR5b). Các quyết định mặc định dưới đây không đổi nghiệp vụ đã chốt trong kế hoạch:
  - Thời điểm tạo snapshot: (1) BGH chuyển ATTP (`POST /:id/forward`) và (2) BGH tự lập hồ sơ (`POST /direct`) tạo snapshot v1 trong cùng transaction, bản chuyển mang `trace_snapshot_id`; (3) gắn suất ăn (`POST /:id/allocations`) khi hồ sơ đã ở `SUBMITTED_TO_AUTHORITY` trở đi (chưa `CLOSED`/`CANCELLED_BY_SCHOOL`) và có ít nhất một suất ăn mới thực sự được thêm → snapshot phiên bản kế tiếp. Ở `PENDING_SCHOOL_REVIEW` không tạo snapshot (snapshot v1 lấy lúc chuyển).
  - Bản bổ sung: snapshot từ bước (3) đi kèm một bản chuyển mới (`food_safety_report_forwardings`, kênh `IN_APP`, `SENT`) tới đơn vị ATTP đang nhận hồ sơ (`recipient_commune_food_safety_unit_id`) và cán bộ `ACTIVE` của đơn vị; đơn vị không còn hoạt động hoặc không có cán bộ → 409, không ghi gì. Hồ sơ cũ (`LEGACY_IMPORT`) không có đơn vị nhận chỉ tạo snapshot, không tạo bản chuyển. Bản bổ sung không đổi trạng thái hồ sơ; ATTP tiếp nhận bản bổ sung như bản chuyển thường (FR-008 của PR5).
  - Mức đầy đủ (`trace_completeness`): không có allocation → `MISSING`; có allocation nhưng còn lý do thiếu → `PARTIAL`; không thiếu gì → `COMPLETE`. Lý do thiếu (`missing_reasons`, mảng JSON sắp xếp cố định): `NO_ALLOCATIONS`; `ALLOCATION_WITHOUT_COOKING_BATCH` (`mealAllocationId`); `COOKING_BATCH_DISH_WITHOUT_LOTS` (`cookingBatchId`, `dishId`); `COOKING_BATCH_DISH_WITHOUT_RETAINED_SAMPLE` (`cookingBatchId`, `dishId`). Cơ sở nguồn của lô là tùy chọn trong dữ liệu hiện có nên không tính là thiếu.
  - Chuỗi lô nguyên liệu lấy theo món đã phân bổ: `meal_allocation_batches (cooking_batch_id, dish_id)` → `cooking_batch_lots` cùng `(cooking_batch_id, dish_id)` → `ingredient_lots` → `delivery_items` → `deliveries` (NCC) và `source_facilities`; mẫu lưu theo `retained_food_samples (cooking_batch_id, dish_id)`.
  - Payload (`payload_version = 1`) chỉ chứa kiểu nguyên thủy: thời điểm UTC ISO, ngày `YYYY-MM-DD`, Decimal `toFixed(3)`; mảng sắp xếp theo ID (khóa tổ hợp theo thứ tự cột). Không chứa tên/ID người dùng. `potentialExposedPortionCount` = tổng `daily_meal_portions.total_portions` trên tập allocation khử trùng.
  - Hash: `KECCAK-256` trên `canonicalizeJson(payload)` (`src/utils/canonical-hash.ts`), lưu chữ thường dạng `0x` + 64 hex.
  - Đọc: chi tiết đầy đủ (BGH/ATTP/SYSTEM) thêm `traceCompleteness`, danh sách tóm tắt snapshot và `traceSnapshotVersion` trên từng bản chuyển; `GET /api/food-safety-incidents/:id/trace-snapshots/:version` trả payload đầy đủ và `hashMatches` (tính lại hash khi đọc). Người báo (PH/GVCN) không thấy snapshot (Q23) → 403.
  - Hồ sơ PR5 đã chuyển ATTP trước khi có PR5b giữ `trace_completeness = NULL` cho tới snapshot đầu tiên (do lần gắn suất ăn kế tiếp tạo); CHECK chỉ buộc `NULL` ở `PENDING_SCHOOL_REVIEW`/`CANCELLED_BY_SCHOOL`, không làm hỏng CD trên azure-dev.

## Phạm vi

- Trong phạm vi: migration (enum `trace_completeness`, cột `food_safety_incidents.trace_completeness`, bảng `food_safety_incident_trace_snapshots`, cột `food_safety_report_forwardings.trace_snapshot_id` + FK tổ hợp); dựng payload + hash; tạo snapshot khi chuyển/tự lập/bổ sung allocation; bản chuyển bổ sung; API đọc snapshot.
- Ngoài phạm vi: neo blockchain snapshot (job sau commit / `blockchain-proof`); đợt kiểm tra, kết luận, chế tài NCC (PR6); email; giao diện; hộp thư `reporting` không đổi response.

### Thay thế spec cũ

- `specs/food-safety-incident-workflow`: `POST /:id/forward` và `POST /direct` nay tạo thêm snapshot v1 và gắn vào bản chuyển; `POST /:id/allocations` sau khi đã chuyển ATTP tạo snapshot mới + bản chuyển bổ sung (có thể trả 409 khi đơn vị nhận không còn cán bộ hoạt động); chi tiết đầy đủ thêm `traceCompleteness`, `traceSnapshots`, `forwardings[].traceSnapshotVersion`.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Snapshot khi gửi ATTP (Priority: P1)

BGH chuyển hồ sơ (hoặc tự lập) → hệ thống ghi snapshot v1 với mức đầy đủ và hash; bản chuyển trỏ tới snapshot.

**Acceptance Scenarios**:

1. **Given** hồ sơ chưa gắn suất ăn, **When** BGH chuyển ATTP, **Then** snapshot v1 `MISSING` với lý do `NO_ALLOCATIONS`, hồ sơ `trace_completeness = MISSING`, bản chuyển mang `trace_snapshot_id`.
2. **Given** hồ sơ đã gắn suất ăn có mẻ nấu, lô và mẫu lưu đầy đủ, **When** chuyển, **Then** snapshot `COMPLETE`, payload đủ chuỗi truy xuất và `potentialExposedPortionCount`.

### User Story 2 - Bổ sung suất ăn sau khi gửi (Priority: P1)

**Acceptance Scenarios**:

1. **Given** hồ sơ đã chuyển có snapshot v1, **When** BGH gắn thêm suất ăn mới, **Then** snapshot v2 được tạo, v1 giữ nguyên, có bản chuyển bổ sung tới cùng đơn vị, trạng thái hồ sơ không đổi.
2. **Given** chỉ gắn lại suất ăn đã có, **Then** không tạo snapshot/bản chuyển mới.
3. **Given** đơn vị nhận không còn cán bộ hoạt động, **Then** 409, không ghi gì.

### User Story 3 - ATTP/BGH đọc snapshot (Priority: P1)

**Acceptance Scenarios**:

1. **Given** cán bộ ATTP nhận hồ sơ, **When** đọc `/trace-snapshots/1`, **Then** nhận payload và `hashMatches = true`.
2. **Given** phụ huynh là người báo, **When** đọc snapshot, **Then** 403; chi tiết rút gọn không có snapshot.
3. **Given** người ngoài phạm vi, **Then** 404.

### Edge Cases

- Hai allocation dùng chung mẻ/món → lô, mẫu lưu xuất hiện một lần trong payload.
- Phiên bản cấp tuần tự dưới khóa dòng hồ sơ; `UNIQUE(incident_id, version)` chặn trùng.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Migration MUST tạo enum `trace_completeness` (`COMPLETE`, `PARTIAL`, `MISSING`), cột `food_safety_incidents.trace_completeness` (NULL) với CHECK `NULL` khi `PENDING_SCHOOL_REVIEW`/`CANCELLED_BY_SCHOOL`.
- **FR-002**: Migration MUST tạo `food_safety_incident_trace_snapshots(id, incident_id, version, completeness, missing_reasons jsonb, payload jsonb, payload_version, hash_algorithm, payload_hash, created_by_user_id, created_at)` với `UNIQUE(incident_id, version)`, `UNIQUE(incident_id, id)`, CHECK: `version ≥ 1`, `payload_version ≥ 1`, `hash_algorithm = 'KECCAK-256'`, `payload_hash ~ '^0x[0-9a-f]{64}$'`, `payload` là object, `missing_reasons` là mảng và rỗng ⇔ `COMPLETE`.
- **FR-003**: Migration MUST thêm `food_safety_report_forwardings.trace_snapshot_id` (NULL cho bản ghi cũ) với FK tổ hợp `(incident_id, trace_snapshot_id) → food_safety_incident_trace_snapshots(incident_id, id)`.
- **FR-004**: Service MUST dựng payload và lý do thiếu theo mục Clarifications, hash bằng `computeCanonicalHash`, cấp phiên bản kế tiếp và cập nhật `trace_completeness` trong cùng transaction nghiệp vụ (đã khóa dòng hồ sơ).
- **FR-005**: `forward` và `createDirect` MUST tạo snapshot v1 và gắn `trace_snapshot_id` vào bản chuyển.
- **FR-006**: `addAllocations` MUST tạo snapshot mới khi hồ sơ đã gửi ATTP (trạng thái khác `PENDING_SCHOOL_REVIEW`, chưa kết thúc) và có ≥ 1 suất ăn mới; tạo bản chuyển bổ sung khi hồ sơ có đơn vị nhận (đơn vị `ACTIVE` + cán bộ `ACTIVE`, thiếu → 409).
- **FR-007**: Mọi service MUST NOT sửa/xóa snapshot đã tạo.
- **FR-008**: `GET /:id/trace-snapshots/:version` MUST dùng phạm vi `food-safety-incident`; người xem rút gọn → 403; ngoài phạm vi/không có phiên bản → 404; trả `hashMatches` tính lại từ payload đã lưu.
- **FR-009**: Chi tiết đầy đủ MUST thêm `traceCompleteness`, `traceSnapshots` (tóm tắt, không payload) và `forwardings[].traceSnapshotVersion`; chi tiết rút gọn không đổi.

### Key Entities

- **FoodSafetyIncidentTraceSnapshot**: bản ghi bất biến chuỗi truy xuất theo phiên bản.
- **FoodSafetyIncident.traceCompleteness**: mức đầy đủ của snapshot mới nhất.
- **FoodSafetyReportForwarding.traceSnapshotId**: snapshot được gửi trong bản chuyển.

## Success Criteria _(mandatory)_

- **SC-001**: Trên DB kiểm thử, chuyển ATTP không allocation → v1 `MISSING`; gắn suất ăn → v2 + bản chuyển bổ sung; ATTP đọc v2 `hashMatches = true`.
- **SC-002**: Payload xác định (cùng dữ liệu → cùng hash) và CHECK chặn snapshot sai.
- **SC-003**: `npm run validate`, `test:unit`, `test:local:*` liên quan pass.

## Assumptions

- Không có quyền mới; dùng `food_safety_incident.forward`/`.create`/`.manage` và `food_safety_incident.view` sẵn có. Không cần thao tác operator trên azure-dev ngoài CD migration.
