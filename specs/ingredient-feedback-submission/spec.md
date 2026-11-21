# Feature Specification: Gửi phản ánh chất lượng nguyên liệu (C02, PR3)

**Feature Branch**: `feat/ingredient-feedback-submission`

**Created**: 2026-11-21

**Status**: Implemented

**Input**: Kế hoạch thiết kế DB khiếu nại v5 (`docs/complaint_db_design_plan_v3.md` §1 Q1/Q11, §3.3 mục 2, §7 PR3): "Luồng gửi C02 cho BGH/Bếp/Dinh dưỡng (`ingredient_quality_feedback.submit`); BGH xem toàn trường; NCC xử lý theo luồng ticket chung".

## Bối cảnh

PR1 (`specs/complaint-supertype/`) đã dựng bảng cha `complaints` + bảng con `ingredient_quality_feedback` (kind `INGREDIENT`, `delivery_id NOT NULL`, `ingredient_lot_id NULL`), mã `FP-CP-NNNNN` (Feistel), tiêu đề tự sinh `Phản ánh chất lượng nguyên liệu chuyến giao <số chuyến giao>` và các thao tác ticket cho NCC/người gửi. PR1 chỉ giữ hàm tạo dùng chung trong repository, chưa có endpoint gửi đơn. PR3 mở luồng gửi qua HTTP và chỉnh phạm vi xem theo Q11.

## Clarifications

### Session 2026-11-21

- Q: Ai được gửi? → A: Q1 — BGH (`SCHOOL_MANAGEMENT_BOARD`), nhân viên bếp (`SCHOOL_KITCHEN_STAFF`), nhân viên dinh dưỡng (`SCHOOL_NUTRITION_OFFICER`), kiểm tra bằng quyền `ingredient_quality_feedback.submit`.
- Q: Chuyến giao ở trạng thái nào được phản ánh? → A: Chỉ chuyến giao của trường người gửi ở `RECEIVED` hoặc `REJECTED` (trường đã kiểm nhận xong).
- Q: Độ dài mô tả? → A: 10–2000 ký tự sau khi bỏ khoảng trắng hai đầu (giống C01/C03/C06).
- Q: Quyền xem? → A: Q11 — BGH xem toàn trường (`submit`, `view_own`, `view_details`); bếp/dinh dưỡng chỉ xem đơn mình gửi (`submit`, `view_own`; bỏ `view_details` khỏi catalog mặc định).
- Q: Giới hạn số đơn cho một chuyến giao? → A: Không giới hạn; mỗi lần gửi tạo một đơn mới, có hoặc không kèm lô.

## Phạm vi

- Trong phạm vi: `POST /api/ingredient-quality-feedback` (gửi đơn), cập nhật catalog quyền mặc định theo Q11, tài liệu và kiểm thử.
- Ngoài phạm vi: thay đổi schema/migration (bảng đã có từ PR1), email (PR-E), tệp/ảnh đính kèm, chỉnh quyền trên DB đang chạy (operator thực hiện qua API quản trị quyền), giao diện.

### Thay thế spec cũ

- `specs/complaint-supertype/` FR-003/FR-011 giữ nguyên; spec này bổ sung endpoint gửi mà PR1 để ngoài phạm vi.
- `specs/supplier-complaint-response/` và `docs/AUTHORIZATION.md` câu "tính năng không sửa catalog": từ PR3 catalog mặc định thay đổi như mục Clarifications (BGH thêm 3 quyền C02; bếp/dinh dưỡng bỏ `view_details`). Quyền của NCC không đổi.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Trường gửi phản ánh chất lượng nguyên liệu (Priority: P1)

Là BGH, nhân viên bếp hoặc nhân viên dinh dưỡng, tôi muốn phản ánh chất lượng nguyên liệu của một chuyến giao (tùy chọn chỉ rõ lô) tới NCC đã giao.

**Independent Test**: Gửi đơn cho chuyến giao `RECEIVED` của trường mình, kèm/không kèm lô; đọc lại chi tiết.

**Acceptance Scenarios**:

1. **Given** tài khoản trường ACTIVE có `ingredient_quality_feedback.submit`, trường `ACTIVE`, chuyến giao thuộc trường ở `RECEIVED`/`REJECTED`, **When** gửi `{deliveryId, ingredientLotId?, description}` hợp lệ, **Then** đơn được tạo ở `NEW` với mã `FP-CP-NNNNN`, tiêu đề tự sinh theo số chuyến giao, snapshot vai trò và trường của người gửi, một dòng lịch sử `→ NEW`; trả 201 kèm chi tiết, người gửi thấy "Đang xử lý".
2. **Given** body có trường lạ (`title`, `status`, `code`, `senderUserId`, `supplierId`…), UUID sai, hoặc mô tả < 10 / > 2000 ký tự sau trim, **When** gửi, **Then** 400 tiếng Việt chỉ rõ trường, không tạo đơn.
3. **Given** chuyến giao không tồn tại hoặc thuộc trường khác, **When** gửi, **Then** 404; **Given** chuyến giao của trường nhưng chưa ở `RECEIVED`/`REJECTED`, **Then** 409.
4. **Given** `ingredientLotId` không thuộc chuyến giao đã chọn, **When** gửi, **Then** 400 chỉ rõ `ingredientLotId`.
5. **Given** tài khoản thiếu quyền gửi, tài khoản không thuộc trường, hoặc trường không còn `ACTIVE`, **When** gửi, **Then** 403 (thiếu quyền/không thuộc trường) hoặc 409 (trường ngừng hoạt động); quyền và phạm vi được nạp lại trong transaction.

### User Story 2 - Phạm vi xem theo Q11 (Priority: P1)

BGH xem mọi đơn C02 của trường (kể cả đơn của bếp/dinh dưỡng) ở vai trò quan sát; bếp/dinh dưỡng chỉ xem đơn mình gửi. Chỉ người gửi được bình luận phía người gửi, Hài lòng, Yêu cầu xử lý lại.

**Acceptance Scenarios**:

1. **Given** catalog mặc định, **When** BGH xem danh sách, **Then** thấy mọi đơn của trường; đơn không do BGH gửi có `allowedActions = []`.
2. **Given** catalog mặc định, **When** bếp xem danh sách/chi tiết, **Then** chỉ thấy đơn mình gửi; đơn của người khác trả 404.
3. **Given** BGH không phải người gửi, **When** Hài lòng/Yêu cầu xử lý lại/bình luận, **Then** 404.

### User Story 3 - NCC xử lý theo luồng ticket chung (Priority: P1)

Đơn mới xuất hiện trong danh sách của NCC đã giao chuyến; NCC Tiếp nhận, bình luận, Đã xử lý như PR1.

### Edge Cases

- Chuyến giao `REJECTED` vẫn được phản ánh (ví dụ nhiều lô hỏng).
- Lô có trong DB nhưng thuộc chuyến giao khác của cùng trường → 400.
- Tài khoản đổi trường/bị thu quyền giữa lúc xác thực và lúc ghi → 403, không tạo đơn.
- Hai người gửi đồng thời cho cùng chuyến giao → hai đơn khác mã.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST cung cấp `POST /api/ingredient-quality-feedback`, body strict `{deliveryId: uuid, ingredientLotId?: uuid | null, description: string}`; mô tả trim, 10–2000 ký tự.
- **FR-002**: Route MUST yêu cầu `ingredient_quality_feedback.submit`; service MUST nạp lại actor, kiểm tra quyền gửi + quyền xem chi tiết (`view_own` hoặc `view_details`), cùng trường và trường `ACTIVE` trong transaction Serializable (`withSchoolTransaction`).
- **FR-003**: Chuyến giao MUST thuộc `schoolId` của actor (không suy từ body); không thấy → 404; trạng thái ngoài `RECEIVED`/`REJECTED` → 409.
- **FR-004**: Nếu có `ingredientLotId`, lô MUST thuộc một `DeliveryItem` của chuyến giao đó; sai → 400 tại `ingredientLotId`.
- **FR-005**: Mã MUST cấp bằng `allocateCode("CP")` trong cùng transaction; tiêu đề `ingredientFeedbackTitle(deliveryNo)`; trạng thái `NEW`; ghi `complaint_status_histories` (`→ NEW`).
- **FR-006**: Phản hồi 201 trả chi tiết đơn (cùng DTO `GET /:feedbackId`), header `Cache-Control: private, no-store`.
- **FR-007**: Catalog mặc định MUST: `SCHOOL_MANAGEMENT_BOARD` có `submit`, `view_own`, `view_details`; `SCHOOL_KITCHEN_STAFF`, `SCHOOL_NUTRITION_OFFICER` chỉ `submit`, `view_own`. Quyền NCC không đổi.
- **FR-008**: Không giới hạn số đơn cho một chuyến giao.

### Key Entities

- **Complaint** (`kind = INGREDIENT`), **IngredientQualityFeedback** (chuyến giao, lô tùy chọn) — không đổi schema.

## Success Criteria _(mandatory)_

- **SC-001**: Ba vai trò trường gửi được đơn qua HTTP; NCC của chuyến giao thấy và xử lý được đơn đó trên DB kiểm thử.
- **SC-002**: Mọi body/trạng thái không hợp lệ bị từ chối mà không tạo dòng `complaints`.
- **SC-003**: `npm run validate`, `test:unit` và các nhóm `test:local:*` liên quan pass.

## Assumptions

- `auth:bootstrap` trên DB đã có role không thêm/bỏ quyền của role khác System Admin; trên azure-dev operator phải cấp 3 quyền C02 cho BGH và bỏ `view_details` của bếp/dinh dưỡng qua API quản trị quyền nếu muốn áp Q11.
- Email cho người gửi khi tạo đơn thuộc PR-E.
