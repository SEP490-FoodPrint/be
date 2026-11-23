# Implementation Plan: Email thông báo cho người gửi khiếu nại (PR-E)

**Branch**: `feat/complaint-email-notifications` | **Spec**: [spec.md](./spec.md)

## Summary

Mở rộng `email_outbox` để nhận dòng của khiếu nại, thêm renderer email khiếu nại dùng giao diện thương hiệu, và một helper dùng chung trong `complaint-ticket` để 4 service khiếu nại ghi outbox trong cùng transaction khi tạo đơn, khi bên xử lý bình luận và khi Đã xử lý.

## Technical Context

Express + TypeScript strict (CommonJS), Prisma 7, PostgreSQL 18. Tái sử dụng email outbox (BullMQ + Resend, dispatcher 5 giây trong process API), `readEmailLogoUrl`, repository `complaint-ticket` dùng chung.

## Constitution Check

- Spec-driven: `specs/complaint-email-notifications/`.
- Service quyết định khi nào gửi; repository chỉ đọc người nhận và ghi outbox; renderer là hàm thuần trong `src/utils`.
- Migration mới, không sửa migration cũ; CHECK trong SQL; không function/trigger.
- Không thao tác DB từ xa; CD triển khai migration.

## Data Model

Migration `prisma/migrations/20261203000100_complaint_email_outbox/migration.sql`: enum `complaint_email_event`; `email_outbox.registration_id DROP NOT NULL`; cột `complaint_id` (FK `email_outbox_complaint_id_fkey`), `complaint_event`; CHECK `email_outbox_source_check`, `email_outbox_complaint_event_check`; index `idx_email_outbox_complaint`. Prisma: `EmailOutbox.registrationId String?`, quan hệ `registration RegistrationRequest?`, `complaint Complaint?`; `Complaint.emailOutbox EmailOutbox[]`; enum `ComplaintEmailEvent`.

## Implementation

- `src/utils/branded-email.ts`: thêm khối tùy chọn `subtitle` (dòng phụ), `summary` (thẻ đơn), `message` (khung tin nhắn) và `action.align = "center"` cho HTML và bản text; email cũ không dùng thì không đổi.
- `src/utils/branded-email.ts`: `renderLetterEmail` (bố cục lá thư theo thiết kế Figma: logo căn giữa, trường in đậm, nút rộng toàn khung, lời ký). `src/utils/complaint-email.ts`: `buildComplaintEmail({event, kind, code, title, description, recipientName, comment?, appUrl?}, {logoUrl})` → `{subject, text, html}`.
- `complaint-ticket.repository.ts`: `findEmailRecipient(tx, complaintId)` (loại, mã, tiêu đề, mô tả, email/họ tên/trạng thái người gửi, bình luận mới nhất của bên xử lý), `queueEmail(tx, …)`.
- `complaint-ticket.service.ts`: `queueRequesterEmail(tx, tickets, complaintId, event)` — gọi sau khi ghi bình luận/chuyển trạng thái; bỏ qua người gửi không `ACTIVE`.
- Gọi helper trong `feedback`, `ingredient-quality-feedback`, `authority-complaint`, `system-complaint` (create/escalate-create, comment khi `HANDLER`, resolve).
- `email-outbox.ts`: khóa idempotency theo nguồn; thông báo lỗi chung. `src/scripts/email-outbox.ts`: thêm `complaintId`.

- Logo & email khác (FR-007, FR-008): `src/utils/email-logo.ts` (logo base64 + `EMAIL_LOGO_CID`), `sendMail` đính kèm inline; `readEmailAppUrl` dùng chung. `renderLetterEmail` thêm khối `code` (OTP) và `bullets`, khung 343px cao theo nội dung; bỏ `renderBrandedEmail`; `registration-review-email.ts`, `verification-email.ts`, `password-reset-email.ts`, `menu-notification.service.ts` chuyển sang bố cục lá thư.

## Testing

- Unit: renderer (escape, tiêu đề, hạn 48h), helper (bỏ qua tài khoản không ACTIVE), service fake ghi đúng sự kiện.
- Migration test: CHECK nguồn/sự kiện, dòng đăng ký cũ hợp lệ.
- Integration (`authorization`): luồng tạo → tiếp nhận → bình luận hai phía → Đã xử lý → Hài lòng đếm đúng dòng outbox theo sự kiện.
