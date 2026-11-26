# Feature Specification: File đính kèm hồ sơ sự cố ATTP (PR-G)

**Feature Branch**: `feat/food-safety-incident-attachments`

**Created**: 2026-11-26

**Status**: Implemented

**Input**: Kế hoạch thiết kế DB v6 (`docs/complaint_db_design_plan_v3.md` §1.1 Q29–Q31, Q35, §5.3, §7 PR-G): "`food_safety_incident_attachments`; upload ở báo cáo sự cố, BGH xác minh/chuyển ATTP, ATTP ghi kết quả kiểm tra; projection cho người báo theo Q23".

## Bối cảnh

Hồ sơ sự cố ATTP chỉ nhận văn bản; người báo, BGH và cán bộ ATTP không gửi được ảnh/PDF chứng cứ (ảnh học sinh có triệu chứng, biên bản xác minh, biên bản kiểm tra). PR-F (`specs/complaint-attachments`) đã làm phần khiếu nại; PR-G làm phần sự cố bằng cùng tiện ích `src/utils/evidence-files.ts`.

## Clarifications

### Session 2026-11-25

- Q: Đính kèm ở bước nào? → A: Tạo báo cáo (PH/GVCN), BGH tự lập hồ sơ, BGH xác minh sơ bộ/chuyển ATTP, ATTP ghi kết quả kiểm tra (Q29).
- Q: Loại file và giới hạn? → A: JPG/PNG/WEBP và PDF, ≤ 5 MiB/file, tối đa 5 file mỗi lần gửi (Q30).
- Q: Bắt buộc/xóa được không? → A: Tùy chọn; đã gửi thì không sửa/xóa (Q31).
- Q: Trường của báo cáo có thay đổi? → A: Không, chỉ thêm file (Q35).
- Q: Người báo có thấy file BGH gửi khi xác minh không? → A: Không; người báo thấy file `REPORT` của mình và file kết quả kiểm tra (chốt 2026-11-25).
- Q: Snapshot truy xuất có đưa file vào không? → A: Có, đưa `sha256` file `REPORT`/`SCHOOL_REVIEW` vào payload (chốt 2026-11-25).
- Quyết định mặc định: Không lưu cột `url` như bản phác §5.3; giống PR-F, URL xem là URL ký Cloudinary hạn 10 phút sinh lại mỗi lần đọc. Hủy hồ sơ (`/cancel`), gắn suất ăn, lập đợt kiểm tra và đóng hồ sơ không nhận file (không thuộc Q29). Payload snapshot mới tăng `payloadVersion` lên 2; snapshot đã có giữ v1.

## Phạm vi

- Trong phạm vi: migration (enum `food_safety_incident_attachment_stage`, bảng `food_safety_incident_attachments`); nhận `multipart/form-data` ở 4 endpoint FR-002; DTO chi tiết hồ sơ và kết quả kiểm tra trả file; payload snapshot v2.
- Ngoài phạm vi: xóa/sửa file, quét virus, giao diện, neo blockchain snapshot (vẫn hoãn), file trong email.

### Thay thế spec cũ

- `specs/food-safety-incident-trace-snapshots/` (PR5b): snapshot mới dùng payload v2 = v1 + `evidenceFiles`; `TRACE_PAYLOAD_VERSION = 2`. Snapshot v1 đã lưu không đổi, `hashMatches` vẫn tính trên payload đã lưu.
- `specs/food-safety-incident-workflow/` (PR5) và `specs/food-safety-inspections/` (PR6a): các body báo cáo/tự lập/chuyển/ghi kết quả nhận thêm `files` và dạng multipart; chi tiết hồ sơ thêm `attachments`, `inspections[].attachments`.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Người báo đính kèm chứng cứ (Priority: P1)

**Acceptance Scenarios**:

1. **Given** phụ huynh/GVCN có quyền báo cáo, **When** `POST /api/food-safety-incidents` multipart (`title`, `description`, `reportedSymptomaticCount`, …) kèm 1–5 file hợp lệ, **Then** 201, file lưu bước `REPORT`, chi tiết người báo trả `attachments`.
2. **Given** 6 file, file > 5 MiB, file GIF hoặc nội dung không khớp, **Then** 400/413, không tạo hồ sơ, không lưu file.
3. **Given** lỗi sau khi upload (lớp không thuộc trường, GVCN không chủ nhiệm, lỗi DB), **Then** file vừa upload bị xóa (best-effort).
4. **Given** BGH tự lập hồ sơ `POST /direct` kèm file, **Then** file bước `REPORT`, có trong snapshot v1 của hồ sơ.

### User Story 2 - BGH đính kèm khi xác minh/chuyển ATTP (Priority: P1)

**Acceptance Scenarios**:

1. **Given** hồ sơ `PENDING_SCHOOL_REVIEW`, **When** BGH `POST /:id/forward` multipart (`preliminaryAssessment`, `preliminaryNote?`) kèm file, **Then** file bước `SCHOOL_REVIEW` được ghi trước khi chụp snapshot; payload snapshot có `sha256` của file `REPORT` và `SCHOOL_REVIEW`.
2. **Given** người báo xem chi tiết, **Then** không thấy file `SCHOOL_REVIEW`; BGH/ATTP nhận hồ sơ/System Admin thấy cả `REPORT` và `SCHOOL_REVIEW`.

### User Story 3 - ATTP đính kèm biên bản kiểm tra (Priority: P1)

**Acceptance Scenarios**:

1. **Given** đợt kiểm tra `PLANNED`, **When** cán bộ ATTP `POST /:id/inspections/:inspectionId/result` multipart (`resultSummary`, `overallConclusion`, `findings` dạng chuỗi JSON) kèm file, **Then** file bước `INSPECTION_RESULT` gắn đợt đó; phản hồi và chi tiết hồ sơ trả `inspections[].attachments` cho mọi người xem hồ sơ.
2. **Given** đợt đã có kết quả, **Then** 409 và file vừa upload bị xóa.

### Edge Cases

- Request JSON vẫn hoạt động như cũ (không có file).
- Multipart gửi chuỗi: `reportedSymptomaticCount` nhận chuỗi chữ số; `classId`, `occurredAt`, ghi chú để trống thì bỏ trường; `findings` sai JSON → 400 tại `findings`.
- Vai trò/quyền sai bị chặn trước khi upload (không tạo file rác).
- Transaction thử lại không upload lại: file upload một lần trước transaction.
- Không ký được URL (thiếu cấu hình) → `url: null`, chi tiết vẫn đọc được.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Bảng append-only `food_safety_incident_attachments` (`id`, `incident_id` FK, `stage` enum `REPORT|SCHOOL_REVIEW|INSPECTION_RESULT`, `inspection_id` NULL với FK tổ hợp `(incident_id, inspection_id)` → `food_safety_inspections(incident_id, id)`, `uploaded_by_user_id` FK, `storage_public_id` UNIQUE, `mime_type`, `size_bytes`, `original_filename`, `sha256`, `created_at`); CHECK `(stage = 'INSPECTION_RESULT') = (inspection_id IS NOT NULL)`, MIME, kích thước 1..5242880, `sha256` hex 64, tên file/public id không rỗng; index `(incident_id, created_at, id)`. Không có API sửa/xóa.
- **FR-002**: Nhận `multipart/form-data` (trường file `files`, quy tắc như PR-F) và vẫn nhận JSON: `POST /api/food-safety-incidents` (`REPORT`), `POST /api/food-safety-incidents/direct` (`REPORT`), `POST /api/food-safety-incidents/:id/forward` (`SCHOOL_REVIEW`), `POST /api/food-safety-incidents/:id/inspections/:inspectionId/result` (`INSPECTION_RESULT`).
- **FR-003**: Service kiểm tra vai trò/quyền, upload file (`foodprint/food-safety-incidents/<userId>/<uuid>.<ext>`) trước transaction, ghi file trong cùng transaction với thao tác; lỗi sau upload ⇒ xóa file đã upload.
- **FR-004**: `GET /api/food-safety-incidents/:id`: `attachments` gồm file `REPORT` (projection người báo) hoặc `REPORT` + `SCHOOL_REVIEW` (projection đầy đủ); `inspections[].attachments` gồm file `INSPECTION_RESULT` của đợt (cả hai projection). Kết quả kiểm tra trả `inspection.attachments`. Mỗi file: `id`, `stage`, `fileName`, `mimeType`, `sizeBytes`, `createdAt`, `url` (ký 10 phút hoặc `null`). Không trả `storage_public_id`, `sha256`. Danh sách không trả file.
- **FR-005**: Snapshot truy xuất mới (`payloadVersion` 2) thêm `evidenceFiles` = file `REPORT`/`SCHOOL_REVIEW` hiện có (`id`, `stage`, `mimeType`, `sizeBytes`, `sha256`, sắp theo `id`); file không ảnh hưởng `completeness`. Snapshot cũ giữ nguyên.
- **FR-006**: Quyền, phạm vi, trạng thái hồ sơ và đợt kiểm tra giữ nguyên.

### Key Entities

- **FoodSafetyIncidentAttachment**: một file ảnh/PDF đính kèm hồ sơ sự cố ở một bước nghiệp vụ, tùy chọn gắn đợt kiểm tra.

## Success Criteria _(mandatory)_

- **SC-001**: Unit test validation multipart, luồng báo cáo/tự lập/chuyển/ghi kết quả có file, dọn file khi lỗi, projection theo người xem, payload v2; `npm run validate` và `test:unit` qua.
- **SC-002**: Migration áp được trên PostgreSQL rỗng và `prisma migrate diff` khớp `schema.prisma`.
