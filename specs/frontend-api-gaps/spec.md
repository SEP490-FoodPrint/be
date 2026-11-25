# Feature Specification: Bổ sung API còn thiếu cho frontend khiếu nại, sự cố và NCC

**Feature Branch**: `fix/frontend-api-gaps`

**Created**: 2026-11-25

**Status**: Implemented

**Input**: Review frontend nhánh `feat/add-complaint` phát hiện ba chỗ frontend không làm đúng được vì API thiếu dữ liệu; người dùng yêu cầu "bổ sung backend trước".

## Bối cảnh

- C03 ([specs/complaint-supertype](../complaint-supertype/spec.md)) và C05 ([specs/authority-complaints](../authority-complaints/spec.md)): người gửi chỉ thấy `displayStatus` ∈ `IN_PROGRESS | RESOLVED | CLOSED`, nhưng bộ lọc `status` của danh sách so với trạng thái thật. Chọn "Đang xử lý" bỏ sót đơn `NEW`/`REOPENED`.
- `GET /api/food-safety-reports` không trả `receivedAt`, nên màn hộp nhận của ATTP không biết bản chuyển nào đã tiếp nhận để ẩn nút "Tiếp nhận".
- Chế tài NCC ([specs/supplier-enforcement](../supplier-enforcement/spec.md)) đặt `suppliers.intake_state = PAUSED_FOR_FOOD_SAFETY_INSPECTION` và chặn tạo/mở khóa nhân viên (`409`), nhưng không API nào cho admin NCC biết trạng thái này để báo trước.

## Clarifications

### Session 2026-11-25

- Quyết định mặc định (không đổi schema, không thêm quyền):
  - FR-001 áp dụng cho danh sách chỉ gồm đơn của chính người gọi theo `listScopes`: C03 với `HOMEROOM_TEACHER`/`PARENTS_COMMITTEE`; C05 với vai trò trường khác `SCHOOL_MANAGEMENT_BOARD`. Bên xử lý và người chỉ xem giữ lọc theo trạng thái thật.
  - Người gửi lọc `NEW`/`REOPENED` trả `400`, vì hai trạng thái này không hiển thị cho họ.
  - FR-003 trả trạng thái tiếp nhận trong danh sách nhân viên (`GET /api/supplier-staff`, chỉ INGREDIENT_SUPPLIER_ADMIN), không thêm vào phiên đăng nhập.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `GET /api/meal-complaints` và `GET /api/authority-complaints` MUST hiểu `status` là trạng thái hiển thị khi danh sách chỉ gồm đơn của người gửi: `IN_PROGRESS` → `NEW | IN_PROGRESS | REOPENED`; `RESOLVED`, `CLOSED` giữ nguyên; `NEW`, `REOPENED` → `400`. Các vai trò khác MUST giữ lọc theo trạng thái thật. Phạm vi đọc không đổi.
- **FR-002**: Mỗi item của `GET /api/food-safety-reports` MUST có `receivedAt: string | null` (ISO 8601, `null` khi chưa tiếp nhận).
- **FR-003**: `GET /api/supplier-staff` MUST trả thêm `supplierIntakeState` (`ACTIVE | PAUSED | PAUSED_FOR_FOOD_SAFETY_INSPECTION`) của NCC trong phạm vi quản lý; không tìm thấy NCC trả `404`.
- **FR-004**: `src/modules/README.md` và `docs/AUTHORIZATION.md` MUST ghi các thay đổi trên.

## Success Criteria _(mandatory)_

- **SC-001**: `npm run validate` và `npm run test:unit` pass; test mới kiểm tra ánh xạ bộ lọc theo vai trò (C03, C05), `receivedAt` trong danh sách báo cáo và `supplierIntakeState` (kể cả `404`).

## Phạm vi

- Trong phạm vi: service, repository, Response DTO của `feedback`, `authority-complaint`, `reporting`, `supplier-staff`; test; tài liệu.
- Ngoài phạm vi: migration, quyền mới, đổi phiên đăng nhập, tìm kiếm phía server cho C02/C05.
