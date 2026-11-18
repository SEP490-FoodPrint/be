# Feature Specification: Complaint Supertype & Response Versioning Foundation (PR1)

**Feature Branch**: `refactor/complaint-supertype`

**Created**: 2026-11-18

**Status**: Ready for Implementation

**Input**: `TASK-3-complaint_db_design_plan_v3.md` (PR1 scope: tạo bảng cha `complaints`, `complaint_response_versions`, `complaint_status_histories`, sequence dùng chung `complaint_code_seq`, migrate dữ liệu và refactor 2 module hiện có)

## Clarifications

### Session 2026-11-18 (Chốt từ TASK-3 v3)

- Q: Có xóa UUID cũ của `meal_complaints` và `ingredient_quality_feedback` khi chuyển sang Class-Table Inheritance không? → A: Giữ nguyên UUID hiện có làm `id` (PK) của bảng cha và bảng con, không làm thay đổi hay đứt gãy endpoint chi tiết/phản hồi hiện hành.
- Q: Trạng thái của bảng cha xử lý thế nào khi API cũ suất ăn đang dùng `RESOLVED`? → A: Luồng mới chuẩn hóa enum `ComplaintStatus`: `SUBMITTED`, `IN_REVIEW`, `RESPONDED`, `CLOSED`. Tầng service của module `feedback` ánh xạ hai chiều `RESOLVED` (ở API client) ↔ `RESPONDED` (ở CSDL) để giữ 100% tương thích ngược với Frontend hiện tại.
- Q: Mã khiếu nại cấp thế nào khi gộp chung? → A: Toàn bộ khiếu nại dùng chung một PostgreSQL sequence duy nhất `foodprint.complaint_code_seq`, format chuẩn `FP-CP-00001` (không cắt sau 99999). Chuyển sequence cũ `ingredient_quality_feedback_complaint_code_seq` thành `complaint_code_seq` và gán mã cho tất cả `meal_complaints` cũ.
- Q: Phản hồi và kết luận cũ của hai bảng con lưu vào đâu? → A: Toàn bộ phản hồi (`supplier_response` của NCC, `resolution` của BGH) được chuyển vào bảng `complaint_response_versions` với `version = 1`, và cập nhật `current_response_version_id` trên bảng cha `complaints`.
- Q: Khiếu nại suất ăn cũ có trường nào để scope BGH rõ ràng không? → A: Bổ sung cột `school_id` vào `meal_complaints` (`FK -> schools NOT NULL`), được backfill thông qua liên kết `DailyMealPortion -> Class -> school_id`.

---

## User Scenarios & Testing (Mandatory)

### User Story 1 - Tương thích ngược toàn diện cho Khiếu nại Suất ăn (Priority: P1)

Là Ban Giám hiệu, Giáo viên chủ nhiệm hoặc Phụ huynh học sinh đang sử dụng tính năng khiếu nại suất ăn (`/api/meal-complaints`), tôi muốn hệ thống tiếp tục hoạt động chính xác với đầy đủ dữ liệu cũ, không bị lỗi cấu trúc hay sai lệch trạng thái sau khi chuyển sang bảng cha `complaints`.

**Why this priority**: Bảo đảm không làm gián đoạn nghiệp vụ nhà trường và phụ huynh đang vận hành trên môi trường thực tế.

**Acceptance Scenarios**:
1. **Given** các đơn khiếu nại suất ăn đã tồn tại trước migration, **When** người dùng gọi API lấy danh sách `GET /api/meal-complaints` hoặc chi tiết `GET /api/meal-complaints/:id`, **Then** hệ thống trả về đúng hợp đồng DTO cũ (gồm `id`, `complaintType`, `description`, `status` (`SUBMITTED | IN_REVIEW | RESOLVED`), `submitter`, `handler`, `resolution`, `meal` options/details) mà không thiếu bất kỳ trường nào.
2. **Given** một đơn khiếu nại suất ăn ở trạng thái `SUBMITTED` hoặc `IN_REVIEW`, **When** BGH gửi phản hồi qua `PATCH /api/meal-complaints/:id` với `status: "RESOLVED"` và nội dung `resolution`, **Then** hệ thống ghi nhận trạng thái `RESPONDED` trong bảng `complaints`, tạo bản ghi phản hồi phiên bản 1 trong `complaint_response_versions`, ghi nhật ký trong `complaint_status_histories`, và trả về HTTP response với `status: "RESOLVED"` đúng chuẩn cũ.
3. **Given** GVCN hoặc Phụ huynh tạo đơn khiếu nại suất ăn mới qua `POST /api/meal-complaints`, **When** yêu cầu hợp lệ được xử lý, **Then** hệ thống tạo đồng thời bản ghi cha trong `complaints` (với mã `FP-CP-00001` mới từ sequence dùng chung, `kind = 'MEAL'`, `school_id`, role snapshot) và bản ghi con trong `meal_complaints` trong cùng một transaction an toàn.

---

### User Story 2 - Tương thích ngược toàn diện cho Khiếu nại Chất lượng Nguyên liệu (Priority: P1)

Là Nhà cung cấp hoặc Nhà trường đang sử dụng module `ingredient-quality-feedback`, tôi muốn đọc danh sách, xem chi tiết và gửi phản hồi đầu tiên cho khiếu nại nguyên liệu mà không bị ảnh hưởng bởi việc tái cấu trúc CSDL.

**Why this priority**: Bảo đảm hợp đồng API giữa trường và nhà cung cấp (`POST /api/ingredient-quality-feedback/:id/response`) giữ nguyên vẹn.

**Acceptance Scenarios**:
1. **Given** nhà cung cấp mở danh sách hoặc xem chi tiết một khiếu nại nguyên liệu, **When** gọi `GET /api/ingredient-quality-feedback` hoặc `GET /api/ingredient-quality-feedback/:id`, **Then** dữ liệu trả về giữ nguyên mã `complaintCode`, tiêu đề `title`, mô tả `description`, thông tin chuyến giao hàng, và phản hồi `supplierResponse` (lấy từ phiên bản phản hồi hiện hành).
2. **Given** một khiếu nại nguyên liệu đang ở trạng thái `SUBMITTED`, **When** nhà cung cấp gửi phản hồi lần đầu qua `POST /api/ingredient-quality-feedback/:id/response`, **Then** hệ thống cập nhật trạng thái `RESPONDED`, tạo `complaint_response_versions` bản 1, cập nhật `current_response_version_id`, ghi nhận vào `complaint_status_histories`, và từ chối nếu khiếu nại đã phản hồi trước đó (HTTP 409).

---

### User Story 3 - Tính bất biến và Versioning của Phản hồi (Priority: P1)

Là quản trị viên hệ thống hoặc kiểm toán viên, tôi muốn mọi phản hồi chính thức cho khiếu nại đều được lưu trữ theo cơ chế versioning (append-only), có người phản hồi, thời điểm và lý do sửa đổi để phục vụ tra cứu minh bạch.

**Why this priority**: Ngăn chặn việc ghi đè làm mất dấu vết giải quyết khiếu nại giữa các bên.

**Acceptance Scenarios**:
1. **Given** một bản ghi phản hồi phiên bản 1 đã được tạo, **When** đọc thông tin phản hồi hiện hành, **Then** `change_reason` có thể rỗng.
2. **Given** các phiên bản chỉnh sửa tiếp theo (v2 trở lên), **When** hệ thống tạo phiên bản mới, **Then** CSDL và dịch vụ bắt buộc phải có `change_reason` không rỗng và tham chiếu đúng `previous_version_id`.

---

## Functional Requirements

1. **Bảng cha `complaints`**:
   - `id` (`UUID PK`)
   - `kind` (`enum complaint_kind`: `MEAL | INGREDIENT | AUTHORITY | SYSTEM`)
   - `complaint_code` (`VARCHAR(25) NOT NULL UNIQUE`) theo mẫu `FP-CP-00001`
   - `sender_user_id` (`UUID NOT NULL FK -> users`)
   - `sender_role_code` (`VARCHAR(60) NOT NULL FK -> roles(code)`)
   - `sender_school_id` (`UUID NULL FK -> schools`)
   - `sender_supplier_id` (`UUID NULL FK -> suppliers`)
   - `sender_commune_food_safety_unit_id` (`UUID NULL FK -> commune_food_safety_units`)
   - `title` (`VARCHAR(255) NULL`)
   - `description` (`TEXT NOT NULL`)
   - `status` (`enum complaint_status`: `SUBMITTED | IN_REVIEW | RESPONDED | CLOSED`)
   - `current_response_version_id` (`UUID NULL FK -> complaint_response_versions(id)`)
   - `created_at`, `updated_at`
   - Khóa ngoại tổ hợp và tính duy nhất: `UNIQUE(id, kind)`.
   - Ràng buộc SQL CHECK: `num_nonnulls(sender_school_id, sender_supplier_id, sender_commune_food_safety_unit_id) <= 1`.
   - Ràng buộc SQL CHECK nhất quán trạng thái phản hồi:
     - `status IN ('SUBMITTED', 'IN_REVIEW')` => `current_response_version_id IS NULL`
     - `status = 'RESPONDED'` => `current_response_version_id IS NOT NULL`
     - `status = 'CLOSED'` hợp lệ cho cả hai trường hợp.

2. **Bảng `complaint_response_versions`**:
   - `id` (`UUID PK`)
   - `complaint_id` (`UUID NOT NULL FK -> complaints ON DELETE CASCADE`)
   - `version` (`INT NOT NULL CHECK (version >= 1)`)
   - `previous_version_id` (`UUID NULL FK -> complaint_response_versions`)
   - `content` (`TEXT NOT NULL`)
   - `change_reason` (`TEXT NULL`)
   - `responded_by_user_id` (`UUID NULL FK -> users`)
   - `responded_role_code` (`VARCHAR(60) NULL FK -> roles(code)`)
   - `created_at` (`TIMESTAMPTZ NOT NULL DEFAULT now()`)
   - `UNIQUE(complaint_id, version)`
   - `UNIQUE(complaint_id, id)`
   - CHECK: `version = 1 OR (change_reason IS NOT NULL AND length(btrim(change_reason)) > 0)`.

3. **Bảng `complaint_status_histories`**:
   - `id` (`UUID PK DEFAULT gen_random_uuid()`)
   - `complaint_id` (`UUID NOT NULL FK -> complaints ON DELETE CASCADE`)
   - `from_status` (`complaint_status NULL`)
   - `to_status` (`complaint_status NOT NULL`)
   - `response_version_id` (`UUID NULL FK -> complaint_response_versions`)
   - `actor_user_id` (`UUID NULL FK -> users`)
   - `actor_role_code` (`VARCHAR(60) NULL FK -> roles(code)`)
   - `note` (`TEXT NULL`)
   - `created_at` (`TIMESTAMPTZ NOT NULL DEFAULT now()`).

4. **Bảng con `meal_complaints`**:
   - `id` (`UUID PK`)
   - `kind` (`complaint_kind NOT NULL DEFAULT 'MEAL' CHECK (kind = 'MEAL')`)
   - `daily_meal_portion_id` (`UUID NOT NULL FK -> daily_meal_portions`)
   - `school_id` (`UUID NOT NULL FK -> schools`)
   - `complaint_type` (`MealComplaintType NOT NULL`)
   - `FOREIGN KEY (id, kind) REFERENCES complaints(id, kind) ON DELETE RESTRICT`.

5. **Bảng con `ingredient_quality_feedback`**:
   - `id` (`UUID PK`)
   - `kind` (`complaint_kind NOT NULL DEFAULT 'INGREDIENT' CHECK (kind = 'INGREDIENT')`)
   - `delivery_id` (`UUID NOT NULL FK -> deliveries`)
   - `ingredient_lot_id` (`UUID NULL FK -> ingredient_lots`)
   - `FOREIGN KEY (id, kind) REFERENCES complaints(id, kind) ON DELETE RESTRICT`.
