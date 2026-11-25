# Feature Specification: File đính kèm khiếu nại, tiêu đề người gửi nhập, loại vấn đề C02 (PR-F)

**Feature Branch**: `feat/complaint-attachments`

**Created**: 2026-11-25

**Status**: Implemented

**Input**: Kế hoạch thiết kế DB khiếu nại v6 (`docs/complaint_db_design_plan_v3.md` §1.1 Q29–Q35, §3.4, §7 PR-F): "`complaint_attachments`; upload ảnh/PDF khi tạo C01/C03/C02, bình luận, Đã xử lý, Chuyển ATTP; tiêu đề người gửi nhập (Q33); enum `ingredient_issue_type` + cột `issue_type` (Q34)".

## Bối cảnh

Các đơn khiếu nại (C01/C03 suất ăn, C02 nguyên liệu, C05 ATTP) chỉ nhận văn bản; người gửi không đính kèm được ảnh/PDF chứng minh, tiêu đề do hệ thống tự sinh và C02 không phân loại vấn đề. Chủ dự án chốt bổ sung ngày 2026-11-25.

## Clarifications

### Session 2026-11-25

- Q: Đính kèm ở đâu? → A: Tạo C01/C03, tạo C02, bình luận và "Đã xử lý" của cả hai bên trên C01/C03/C02/C05, "Chuyển ATTP" (file gắn vào C05 mới).
- Q: Loại file và giới hạn? → A: JPG/PNG/WEBP và PDF, mỗi file ≤ 5 MiB, tối đa 5 file mỗi lần gửi.
- Q: Bắt buộc/xóa được không? → A: Tùy chọn; đã gửi thì không sửa/xóa (append-only).
- Q: Bình luận chỉ có file không có chữ? → A: Không; nội dung vẫn bắt buộc như hiện tại.
- Q: C05 và file của C03? → A: ATTP xem được file của C03 gốc (lúc tạo + trong bình luận); phụ huynh đính kèm thêm khi chuyển.
- Q: Tiêu đề? → A: C01/C03 và C02 bắt buộc người gửi nhập, 5–255 ký tự (sau trim). C05 vẫn tự sinh.
- Q: Loại vấn đề C02? → A: Bắt buộc, 6 giá trị: `SPOILED_OR_NOT_FRESH` (Hư hỏng/kém tươi), `QUANTITY_MISMATCH` (Sai số lượng/khối lượng), `WRONG_SPECIFICATION` (Sai quy cách/chủng loại), `EXPIRED_OR_MISSING_LABEL` (Hết hạn/thiếu nhãn mác), `LATE_DELIVERY` (Giao trễ/sai thời gian), `OTHER` (Khác).
- Quyết định mặc định: Yêu cầu xử lý lại không nhận file (không nằm trong Q29). Đơn C02 cũ không có loại vấn đề trả `issueType: null`. Link xem file là URL ký Cloudinary có hạn 10 phút, sinh lại mỗi lần đọc chi tiết.

## Phạm vi

- Trong phạm vi: migration (`complaint_attachments`, enum + cột `ingredient_quality_feedback.issue_type`); middleware nhận `multipart/form-data` (trường `files`) cho các endpoint liệt kê ở FR-002; lưu Cloudinary (raw, authenticated); DTO chi tiết trả file; tiêu đề và loại vấn đề.
- Ngoài phạm vi: file đính kèm sự cố ATTP (PR-G), xóa/sửa file, quét virus, giao diện, đưa file vào email.

### Thay thế spec cũ

- `specs/019-meal-complaint-submission/`, `specs/complaint-supertype/`: tiêu đề C01/C03 không còn tự sinh mà do người gửi nhập (`title` bắt buộc trong body tạo).
- `specs/ingredient-feedback-submission` (PR3) / `specs/complaint-supertype/`: tiêu đề C02 do người gửi nhập; thêm `issueType` bắt buộc.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Người gửi đính kèm chứng cứ khi tạo đơn (Priority: P1)

**Acceptance Scenarios**:

1. **Given** GVCN/phụ huynh được gửi khiếu nại suất ăn, **When** `POST /api/meal-complaints` dạng multipart với `dailyMealPortionId`, `complaintType`, `title`, `description` và 1–5 file hợp lệ, **Then** 201, đơn có tiêu đề đã nhập và `attachments` gồm đủ file theo thứ tự gửi.
2. **Given** gửi JSON như trước nhưng thiếu `title`, **Then** 400 kèm đường dẫn trường `title`.
3. **Given** 6 file, file > 5 MiB, file GIF hoặc nội dung không khớp loại, **Then** 400/413, không tạo đơn, không lưu file nào.
4. **Given** tài khoản trường gửi C02 `POST /api/ingredient-quality-feedback` với `title`, `issueType`, `description`, file, **Then** 201 với `issueType` và `attachments`; thiếu/sai `issueType` → 400.
5. **Given** tạo đơn thất bại sau khi đã upload (403/404/409/lỗi DB), **Then** các file vừa upload bị xóa khỏi Cloudinary (best-effort, lỗi xóa chỉ ghi log).

### User Story 2 - Hai bên đính kèm khi trao đổi và xử lý (Priority: P1)

**Acceptance Scenarios**:

1. **Given** đơn ở trạng thái cho phép bình luận, **When** `POST /:id/comments` multipart `content` + file, **Then** 201, bình luận mới có `attachments`.
2. **Given** bên xử lý ở `IN_PROGRESS`, **When** `POST /:id/resolve` multipart `content` + file, **Then** bình luận `RESOLUTION` có `attachments`.
3. **Given** bình luận chỉ có file, **Then** 400 (thiếu nội dung).

### User Story 3 - ATTP xem chứng cứ của đơn gốc (Priority: P1)

**Acceptance Scenarios**:

1. **Given** phụ huynh "Chuyển ATTP" (`POST /api/authority-complaints` multipart `mealComplaintId`, `reason?`, file), **Then** file gắn vào C05 (cấp đơn); chi tiết C05 trả `attachments` của C05 và `escalatedFrom.attachments` + file trong `escalatedFrom.comments[]` của C03.
2. **Given** phụ huynh gửi xem chi tiết C05, **Then** thấy cùng dữ liệu file như ATTP. BGH vẫn không xem C05 (`specs/board-escalation-view`).

### Edge Cases

- Request không phải multipart vẫn hoạt động như cũ (không có file).
- Trường văn bản trong multipart là chuỗi; `ingredientLotId` để trống thì bỏ trường.
- Upload lỗi một file ⇒ xóa các file đã upload trong lần đó và trả 503, không tạo đơn/bình luận.
- Transaction được thử lại (serialization) không upload lại: file upload một lần trước transaction.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Bảng append-only `complaint_attachments` (`id`, `complaint_id` FK, `comment_id` NULL FK → `complaint_comments`, `uploaded_by_user_id` FK, `uploader_side`, `storage_public_id` UNIQUE, `mime_type`, `size_bytes`, `original_filename`, `sha256`, `created_at`); CHECK loại MIME, kích thước 1..5242880, `sha256` hex 64, `original_filename` không rỗng. Index `(complaint_id, created_at, id)`, `(comment_id)`. Không có API sửa/xóa.
- **FR-002**: Các endpoint nhận `multipart/form-data` với trường file `files` (≤ 5 file, ≤ 5 MiB/file, JPG/PNG/WEBP/PDF kiểm tra magic bytes) và vẫn nhận JSON: `POST /api/meal-complaints`, `POST /api/meal-complaints/:id/comments`, `POST /api/meal-complaints/:id/resolve`, `POST /api/ingredient-quality-feedback`, `POST /api/ingredient-quality-feedback/:feedbackId/comments`, `POST /api/ingredient-quality-feedback/:feedbackId/resolve`, `POST /api/authority-complaints`, `POST /api/authority-complaints/:id/comments`, `POST /api/authority-complaints/:id/resolve`.
- **FR-003**: Service kiểm tra file trước, upload trước transaction, ghi `complaint_attachments` trong cùng transaction với đơn/bình luận (`comment_id` = bình luận vừa tạo; NULL cho file lúc tạo đơn/Chuyển ATTP); lỗi sau upload ⇒ xóa file đã upload.
- **FR-004**: Chi tiết C01/C03, C02, C05 trả `attachments` (file cấp đơn) và `comments[].attachments`; C05 trả thêm `escalatedFrom.attachments` và `escalatedFrom.comments[].attachments`. Mỗi file: `id`, `fileName`, `mimeType`, `sizeBytes`, `uploaderSide`, `createdAt`, `url` (URL ký 10 phút). Không trả `storage_public_id`, `sha256`. Danh sách không trả file.
- **FR-005**: `title` bắt buộc 5–255 ký tự (đếm theo ký tự Unicode, sau trim) khi tạo C01/C03 và C02.
- **FR-006**: Enum `ingredient_issue_type` (6 giá trị Q34); cột `ingredient_quality_feedback.issue_type` NULL cho dòng cũ, CHECK `issue_type IS NOT NULL` `NOT VALID` cho dòng mới; `issueType` bắt buộc khi tạo C02; DTO danh sách/chi tiết C02 trả `issueType` (có thể `null`).
- **FR-007**: Phân quyền, phạm vi, trạng thái ticket và email giữ nguyên; file được xem theo đúng phạm vi đọc đơn.

### Key Entities

- **ComplaintAttachment**: một file ảnh/PDF đính kèm một đơn khiếu nại, tùy chọn gắn một bình luận.

## Success Criteria _(mandatory)_

- **SC-001**: Unit test cho validation (title, issueType, file), luồng tạo/bình luận/xử lý có file, dọn file khi lỗi, ánh xạ DTO file; `npm run validate` và `test:unit` qua.
- **SC-002**: Migration áp được trên PostgreSQL rỗng và `prisma migrate diff` khớp `schema.prisma`.
