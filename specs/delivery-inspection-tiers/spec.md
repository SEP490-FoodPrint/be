# Feature Specification: Phân Nhóm Bộ Phận Duyệt Nguyên Liệu Đầu Vào (Delivery Inspection Tiers)

**Feature Branch**: `feat/delivery-inspection-tiers`

**Created**: 2026-11-19

**Status**: Ready

**Input**: User description & Task specification: "Phân nhóm bộ phận kiểm tra nguyên liệu đầu vào theo trường thành 3 nhóm (PRIMARY, REQUIRED, OPTIONAL), Ban Giám Hiệu cấu hình cho 3 role của trường (Bếp, Kho, Dinh dưỡng), Ban Phụ huynh cố định là OPTIONAL."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - BGH xem và cấu hình nhóm duyệt nguyên liệu của trường (Priority: P1)

Là thành viên Ban Giám Hiệu (`SCHOOL_MANAGEMENT_BOARD`), tôi muốn xem và cấu hình nhóm duyệt nguyên liệu cho 3 bộ phận của trường (Bếp, Kho, Dinh dưỡng) để phù hợp với quy trình kiểm nhận thực tế của nhà trường.

**Why this priority**: Cung cấp khả năng tùy biến quy trình kiểm nhận cho từng trường, chuyển từ cơ chế hardcode 4 bên sang cơ chế phân nhóm linh hoạt.

**Independent Test**:
- Đăng nhập tài khoản BGH, truy cập API cấu hình: kiểm tra trường chưa cấu hình nhận giá trị mặc định (Bếp = PRIMARY, Kho & Dinh dưỡng = REQUIRED, Phụ huynh = OPTIONAL).
- Gửi cấu hình hợp lệ (đủ 3 role, đúng 1 PRIMARY): dữ liệu được cập nhật trong transaction.
- Gửi cấu hình không hợp lệ (0 PRIMARY, 2 PRIMARY, trùng role, gửi Phụ huynh, role lạ): nhận HTTP 400 và lỗi tiếng Việt.
- Tài khoản không phải BGH hoặc thiếu permission `school_delivery_inspection.manage`: nhận HTTP 403.

**Acceptance Scenarios**:
1. **Given** trường chưa cấu hình, **When** BGH gọi `GET /api/schools/me/delivery-inspection-roles`, **Then** hệ thống trả về cấu hình mặc định với `configured: false`, Bếp là `PRIMARY`, Kho & Dinh dưỡng là `REQUIRED`, Phụ huynh là `OPTIONAL`.
2. **Given** BGH gửi `PUT /api/schools/me/delivery-inspection-roles` với 3 role hợp lệ và đúng 1 `PRIMARY`, **Then** hệ thống ghi nhận cấu hình mới và trả về `configured: true`.
3. **Given** BGH gửi payload sai (thiếu role, trùng role, 0 hoặc 2 PRIMARY, hoặc gửi `PARENTS_COMMITTEE`), **Then** hệ thống trả về HTTP 400 với thông báo lỗi tiếng Việt cụ thể.

---

### User Story 2 - Người duyệt chính xác nhận xe đã đến và tạo snapshot quy trình (Priority: P1)

Là nhân sự thuộc bộ phận duyệt chính (`PRIMARY`) của trường, tôi muốn xác nhận xe giao hàng đã đến trường để mở quy trình kiểm tra nguyên liệu.

**Why this priority**: Đảm bảo chỉ đúng 1 bộ phận chịu trách nhiệm tiếp nhận xe được quyền xác nhận xe đến, đồng thời lưu giữ snapshot bất biến cho toàn bộ đợt giao đó.

**Independent Test**:
- Tài khoản thuộc role PRIMARY gọi `POST /api/deliveries/:id/arrival`: thành công chuyển trạng thái `ARRIVED` và tạo 4 dòng snapshot trong `delivery_inspection_roles`.
- Tài khoản thuộc role REQUIRED hoặc OPTIONAL gọi `POST /api/deliveries/:id/arrival`: nhận HTTP 403.
- Khi BGH thay đổi cấu hình sau khi xe đến: đợt đang kiểm nhận vẫn áp dụng snapshot cũ lúc xe đến.

**Acceptance Scenarios**:
1. **Given** đợt giao `IN_TRANSIT` và người dùng thuộc role `PRIMARY` của trường, **When** gọi `POST /api/deliveries/:id/arrival`, **Then** đợt giao chuyển sang `ARRIVED` và tạo snapshot nhóm duyệt tương ứng.
2. **Given** người dùng thuộc role `REQUIRED` hoặc `OPTIONAL`, **When** gọi `POST /api/deliveries/:id/arrival`, **Then** hệ thống từ chối với HTTP 403 "Chỉ người duyệt chính (<tên role PRIMARY>) được xác nhận xe đã đến".

---

### User Story 3 - Duyệt kiểm nhận theo nhóm và hoàn tất tiếp nhận (Priority: P1)

Là nhân viên kiểm nhận (Bếp, Kho, Dinh dưỡng, hoặc Ban Phụ huynh), tôi muốn thực hiện đánh giá kiểm nhận (Đạt/Không đạt) theo đúng thẩm quyền và nhóm của mình.

**Why this priority**: Tự động hóa tiếp nhận kho khi các bộ phận bắt buộc đồng ý mà không bị nghẽn bởi bộ phận tùy chọn, đồng thời bảo vệ quy trình trước quyết định từ chối không hợp lệ.

**Independent Test**:
- Role PRIMARY + tất cả role REQUIRED duyệt `APPROVE` (kể cả khi Phụ huynh chưa duyệt): đợt giao chuyển ngay sang `RECEIVED` và nhập kho.
- Role OPTIONAL (Phụ huynh) bấm `REJECT`: hệ thống ghi nhận ý kiến, giữ nguyên trạng thái đợt giao, không tăng số lần từ chối (cap3).
- Role PRIMARY hoặc REQUIRED bấm `REJECT`: đợt giao chuyển sang `REJECTED` và tăng số lần từ chối cap3.
- Sau khi đợt giao đã `RECEIVED` hoặc `REJECTED`: mọi hành vi duyệt tiếp theo đều bị chặn với HTTP 409.

**Acceptance Scenarios**:
1. **Given** đợt giao `ARRIVED` hoặc `PENDING_APPROVAL`, **When** role `PRIMARY` và tất cả role `REQUIRED` duyệt `APPROVE`, **Then** đợt giao chuyển `RECEIVED` và các lot được nhập kho.
2. **Given** role `OPTIONAL` (Ban Phụ huynh) duyệt `REJECT`, **Then** ý kiến được lưu, trạng thái không đổi và không tính vào cap3 từ chối đợt giao.
3. **Given** role `PRIMARY` hoặc `REQUIRED` duyệt `REJECT`, **Then** đợt giao chuyển sang `REJECTED` và tính vào cap3.

---

### Edge Cases

- **Đợt giao legacy**: Các đợt giao đã `ARRIVED` hoặc `PENDING_APPROVAL` trước khi có tính năng (không có snapshot trong DB) sẽ áp dụng luật legacy (cần đủ cả 4 role duyệt APPROVE, ai trong 4 role cũng có thể xác nhận đến nếu chưa đến).
- **Nhóm REQUIRED rỗng**: BGH cấu hình 1 role PRIMARY và 2 role còn lại là OPTIONAL -> Chỉ cần role PRIMARY duyệt APPROVE là đợt giao hoàn tất `RECEIVED`.
- **Cô lập trường**: BGH trường A tuyệt đối không thể đọc hay cập nhật cấu hình của trường B; `schoolId` luôn trích xuất từ `AuthPrincipal`.
- **Không duyệt trước khi xe đến**: Mọi quyết định kiểm nhận trước khi xe chuyển `ARRIVED` đều bị từ chối với HTTP 409.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST cung cấp `GET /api/schools/me/delivery-inspection-roles` cho BGH xem cấu hình nhóm duyệt của trường (nếu chưa cấu hình, trả về mặc định: Bếp = `PRIMARY`, Kho & Dinh dưỡng = `REQUIRED`, Phụ huynh = `OPTIONAL` với `configured: false`).
- **FR-002**: Hệ thống MUST cung cấp `PUT /api/schools/me/delivery-inspection-roles` cho BGH cập nhật cấu hình nhóm duyệt cho đúng 3 role của trường (`SCHOOL_KITCHEN_STAFF`, `INGREDIENT_MANAGEMENT_DEPARTMENT`, `SCHOOL_NUTRITION_OFFICER`).
- **FR-003**: PUT MUST kiểm tra nghiêm ngặt: đúng 3 role, không trùng lặp, đúng 1 role `PRIMARY`, không chứa role ngoài enum (chặn `PARENTS_COMMITTEE`).
- **FR-004**: Cả hai API cấu hình MUST yêu cầu permission `school_delivery_inspection.manage` và role `SCHOOL_MANAGEMENT_BOARD` thuộc tổ chức `SCHOOL`.
- **FR-005**: API `POST /api/deliveries/:id/arrival` MUST chỉ cho phép role `PRIMARY` theo cấu hình hiện hành của trường xác nhận xe đến và MUST lưu snapshot cấu hình vào bảng `delivery_inspection_roles` trong cùng transaction.
- **FR-006**: API `POST /api/deliveries/:id/inspection` MUST áp dụng snapshot của đợt giao:
  - Chỉ chuyển `RECEIVED` khi role `PRIMARY` và tất cả role `REQUIRED` duyệt `APPROVE`.
  - Quyết định `REJECT` từ role `OPTIONAL` không làm chuyển trạng thái `REJECTED` và không tính vào giới hạn hủy đơn `cap3`.
  - Quyết định `REJECT` từ role `PRIMARY` hoặc `REQUIRED` chuyển đợt giao thành `REJECTED` và tính vào `cap3`.
- **FR-007**: Response DTO kiểm nhận delivery (`inspectionDTO`) MUST trả về danh sách `requiredRoles` kèm `tier`, `tierLabel`, `currentTier`, `canConfirmArrival`, và `approvalSummary` (`requiredApproved`, `requiredTotal`, `optionalApproved`, `optionalTotal`).
- **FR-008**: Bảng `SupplyRequest` đếm số lần giao bị từ chối (`redeliveryRequiredCount` / `cap3`) MUST dựa trên `status: "REJECTED"` của Delivery thay vì bất kỳ chữ ký REJECT.
