# Feature Specification: Email thông báo cho người gửi khiếu nại (PR-E)

**Feature Branch**: `feat/complaint-email-notifications`

**Created**: 2026-11-23

**Status**: Implemented

**Input**: Kế hoạch thiết kế DB khiếu nại & sự cố v5 (`docs/complaint_db_design_plan_v3.md` Q25, §3.1 bảng thao tác, §3.2 mục 5, §7 PR-E): "Email cho người gửi (tạo đơn, bình luận mới của bên xử lý, Đã xử lý) qua email outbox; chỉ email, không in-app; không gửi khi đóng".

## Bối cảnh

PR1–PR4 (`specs/complaint-supertype`, `system-complaint-management`, `ingredient-feedback-submission`, `authority-complaints`) đã có luồng ticket chung cho C01/C02/C03 (`MEAL`), C05 (`AUTHORITY`), C06 (`SYSTEM`) và phản ánh nguyên liệu (`INGREDIENT`) qua `complaint-ticket` (bảng cha `complaints`, bình luận, lịch sử). Người gửi chưa được báo khi đơn được ghi nhận, khi bên xử lý trả lời hay khi đơn đã xử lý. Email outbox hiện có (`email_outbox`, BullMQ + Resend, `src/utils/email-outbox.ts`) chỉ phục vụ email kết quả duyệt hồ sơ đăng ký (`registration_id NOT NULL`).

## Clarifications

### Session 2026-11-23

- Mẫu nội dung email (câu hỏi mở cuối cùng của kế hoạch v5) → người dùng yêu cầu thiết kế template riêng (2026-11-23) rồi tinh gọn: giữ khung thương hiệu `renderBrandedEmail` (đầu thư, chân thư), thêm khối dùng chung dòng phụ dưới tiêu đề, thẻ tóm tắt đơn, khung tin nhắn và tùy chọn căn giữa nút; không có thanh tiến trình (nhãn trạng thái đã thể hiện) và không ghi giờ hạn đánh giá (chỉ một dòng phụ "Đơn sẽ tự đóng sau 48 giờ…"). Nội dung chốt tại FR-004. Nút "Xem đơn trên FoodPrint" (căn giữa) trỏ tới origin giao diện (`PUBLIC_TRACE_ORIGIN` + `/`, như email thực đơn) vì chưa có đường dẫn trang khiếu nại được duyệt; thiếu cấu hình thì bỏ nút.
- Phản hồi giao diện (2026-11-23): bỏ câu hướng dẫn lựa chọn trong email "Đã xử lý"; thay biểu tượng chữ ở đầu thư bằng ảnh logo dự án lấy từ repo frontend (`public/logo.png`); áp dụng cùng template cho mọi email khác của hệ thống (hồ sơ đăng ký, mã xác minh email, mã đặt lại mật khẩu, nút căn giữa ở email thực đơn) — xem FR-007, FR-008.
- Thiết kế Figma do người dùng cung cấp (2026-11-23, ảnh mẫu dạng lá thư): email khiếu nại chuyển sang bố cục lá thư — logo + tên FoodPrint căn giữa trên cùng (bỏ dải header màu, nhãn trạng thái, thẻ đơn, khung tin nhắn), lời chào "Kính gửi …", các trường in đậm "Mã đơn / Tiêu đề / Nội dung", nút màu thương hiệu rộng toàn khung, ký "Trân trọng, FoodPrint."
- Phản hồi giao diện (2026-11-23): khung thư rộng 343px, không cố định chiều cao (cao theo nội dung); áp dụng bố cục lá thư cho mọi email của hệ thống và bỏ template header màu cũ (FR-008).
- Quyết định mặc định (không đổi nghiệp vụ đã chốt):
  - Mở rộng `email_outbox` thay vì bảng mới: `registration_id` cho phép NULL, thêm `complaint_id` + `complaint_event`; CHECK đúng một nguồn. Giữ tên hàng đợi BullMQ `registration-review-email` và khóa idempotency `registration-review/<id>` cho dòng hồ sơ đăng ký để không ảnh hưởng job đang chờ; dòng khiếu nại dùng `complaint-email/<id>`.
  - Email được ghi vào outbox **trong cùng transaction** với thao tác (transactional outbox): rollback thì không có email; dispatcher chỉ gửi sau khi commit. Lỗi gửi được outbox thử lại như hiện tại, không làm hỏng thao tác của người dùng.
  - Chỉ gửi khi tài khoản người gửi đang `ACTIVE`; tài khoản khác bỏ qua (không lỗi).
  - Áp dụng cho mọi loại đơn (`MEAL`, `INGREDIENT`, `AUTHORITY`, `SYSTEM`), kể cả C05 tạo khi phụ huynh "Chuyển ATTP" (email "đã ghi nhận" cho đơn C05; C03 đóng do chuyển ATTP không gửi email).
  - Bình luận của người gửi, Tiếp nhận, Hài lòng, Yêu cầu xử lý lại, Chuyển ATTP, Tự đóng: không gửi email.

## User Scenarios & Testing

### User Story 1 - Người gửi nhận email khi đơn được ghi nhận (Priority: P1)

Người gửi tạo đơn (mọi loại) và nhận email "đã ghi nhận" kèm mã đơn và tiêu đề.

**Acceptance Scenarios**:

1. **Given** phụ huynh gửi khiếu nại suất ăn, **When** tạo thành công, **Then** `email_outbox` có một dòng `complaint_event = CREATED` gửi tới email của phụ huynh.
2. **Given** tạo đơn thất bại (rollback), **Then** không có dòng outbox nào.

### User Story 2 - Người gửi nhận email khi bên xử lý bình luận (Priority: P1)

**Acceptance Scenarios**:

1. **Given** đơn `IN_PROGRESS`, **When** bên xử lý bình luận, **Then** outbox có dòng `HANDLER_COMMENT` chứa nội dung bình luận.
2. **When** người gửi bình luận, **Then** không có email mới.

### User Story 3 - Người gửi nhận email khi đơn "Đã xử lý" (Priority: P1)

**Acceptance Scenarios**:

1. **When** bên xử lý báo Đã xử lý, **Then** outbox có dòng `RESOLVED` chứa nội dung xử lý và hạn đánh giá 48h.
2. **When** đơn đóng (Hài lòng, Chuyển ATTP, Tự đóng), **Then** không có email.

## Requirements

### Functional Requirements

- **FR-001**: Migration mới: enum `complaint_email_event` (`CREATED`, `HANDLER_COMMENT`, `RESOLVED`); `email_outbox.registration_id` cho phép NULL; thêm `complaint_id uuid` (FK `complaints`, `ON DELETE RESTRICT`) và `complaint_event`; CHECK `email_outbox_source_check` (`num_nonnulls(registration_id, complaint_id) = 1`) và `email_outbox_complaint_event_check` (`complaint_id IS NULL` ⇔ `complaint_event IS NULL`); index `idx_email_outbox_complaint (complaint_id)`. Dữ liệu cũ không đổi.
- **FR-002**: Khi tạo đơn (mọi loại), sau khi ghi lịch sử `NEW`, service ghi outbox `CREATED` cho người gửi trong cùng transaction.
- **FR-003**: Khi bên xử lý (`HANDLER`) bình luận `MESSAGE` → outbox `HANDLER_COMMENT`; khi bên xử lý chuyển `RESOLVED` (kèm bình luận `RESOLUTION`) → outbox `RESOLVED`. Không ghi email cho thao tác khác.
- **FR-004**: Nội dung (tiếng Việt, bố cục lá thư `renderLetterEmail`, mọi giá trị động được escape, có bản text tương đương):
  - Chung: logo + "FoodPrint" + khẩu hiệu căn giữa; "Kính gửi <full_name>,"; trường "Mã đơn: <mã>", "Tiêu đề: <tiêu đề>"; nút rộng toàn khung (chỉ khi có cấu hình origin giao diện); "Trân trọng, FoodPrint."; chân thư email tự động.
  - Bên xử lý theo loại: `MEAL` Ban Giám hiệu nhà trường; `INGREDIENT` nhà cung cấp; `AUTHORITY` đơn vị ATTP phường/xã; `SYSTEM` Quản trị hệ thống FoodPrint.
  - `CREATED`: tiêu đề `[FoodPrint] Đã ghi nhận đơn <mã>`; "Chúng tôi đã nhận được đơn của bạn với nội dung như sau:"; trường "Nội dung" (mô tả người gửi nhập); "Đơn đã được chuyển tới <bên xử lý> và sẽ được phản hồi trong thời gian sớm nhất. Toàn bộ trao đổi diễn ra ngay trên trang đơn…"; nút "Theo dõi & trao đổi tại đây".
  - `HANDLER_COMMENT`: `[FoodPrint] Có phản hồi mới cho đơn <mã>`; "<Bên xử lý> vừa phản hồi đơn của bạn:"; trường "Phản hồi (<người viết> · HH:mm dd/MM/yyyy)" = bình luận mới nhất của bên xử lý; nút "Xem & trả lời phản hồi".
  - `RESOLVED`: `[FoodPrint] Đơn <mã> đã được xử lý`; "<Bên xử lý> đã xử lý đơn của bạn với kết quả như sau:"; trường "Kết quả xử lý (<người viết> · thời gian)" = bình luận `RESOLUTION`; dòng nhạt "Đơn sẽ tự đóng sau 48 giờ nếu bạn không phản hồi."; nút "Xem kết quả xử lý"; không có hướng dẫn lựa chọn hay giờ hạn.
- **FR-005**: Worker outbox gửi dòng khiếu nại với khóa idempotency `complaint-email/<id>`; dòng hồ sơ đăng ký giữ `registration-review/<id>`. Script `email:outbox:*` hiển thị thêm `complaintId`.
- **FR-006**: Chỉ ghi outbox khi người gửi `ACTIVE`.

- **FR-007**: Logo: đầu thư thương hiệu dùng ảnh logo dự án (từ repo frontend `public/logo.png`, cắt viền trong suốt, 96×96, PNG 256 màu, ~5 KB) 40×40 cạnh tên FoodPrint, căn giữa đầu thư, nhúng inline bằng `cid:foodprint-logo`; `sendMail` tự đính kèm ảnh (`contentId`) khi HTML tham chiếu `cid:foodprint-logo`. `EMAIL_LOGO_URL` (https) vẫn thay thế được bằng ảnh công khai.
- **FR-008**: Mọi email của hệ thống dùng chung bố cục lá thư `renderLetterEmail` (khung rộng 343px, cao theo nội dung, không `max-height`/`min-height`): hồ sơ đăng ký (đã tiếp nhận, đã phê duyệt có nút "Đăng nhập FoodPrint", từ chối kèm trường "Lý do từ chối"; trường "Mã hồ sơ", "Tổ chức"; tiêu đề `[FoodPrint] …` kèm mã hồ sơ), mã xác minh email và mã đặt lại mật khẩu ("Kính gửi Quý khách,", khối mã lớn căn giữa, hiệu lực 10 phút, giữ bản text có mã), email thực đơn (BGH duyệt/yêu cầu chỉnh sửa, nhắc hạn: thông tin thành trường in đậm, nhận xét là trường xuống dòng, danh sách khối còn thiếu). Nút luôn rộng toàn khung.

## Thay thế spec cũ

- Mục email trong kế hoạch v5 (Q25, §3.2 mục 5) trước đây để sang PR-E: nay thực hiện theo spec này; các spec ticket cũ (`specs/complaint-supertype`, …) không sửa.

## Phạm vi

- Trong phạm vi: migration mở rộng `email_outbox`, renderer email khiếu nại, ghi outbox ở 4 service khiếu nại, cập nhật worker/script outbox, logo inline và template thương hiệu cho mọi email hiện có (FR-007, FR-008), test, tài liệu.
- Ngoài phạm vi: thông báo in-app; email cho bên xử lý; email khi đóng; nút liên kết tới giao diện; email cho sự cố ATTP/chế tài NCC.

## Success Criteria

- **SC-001**: Mỗi lần tạo đơn / bình luận của bên xử lý / Đã xử lý thành công tạo đúng một dòng outbox cho người gửi; các thao tác khác không tạo dòng nào.
- **SC-002**: Migration test xác nhận CHECK nguồn và CHECK sự kiện; parity Prisma–migration giữ nguyên.
