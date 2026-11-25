# Implementation Plan: File đính kèm khiếu nại (PR-F)

**Branch**: `feat/complaint-attachments` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

## Summary

Thêm bảng `complaint_attachments`, enum/cột `issue_type` cho C02, tiện ích lưu file chứng cứ trên Cloudinary và nối vào ba module khiếu nại (`feedback`, `ingredient-quality-feedback`, `authority-complaint`) qua lớp ticket dùng chung (`complaint-ticket`).

## Technical Context

- TypeScript strict, Express 5, Prisma (CJS), PostgreSQL, multer (memory), Cloudinary SDK.
- Lưu file: `resource_type: raw`, `type: authenticated` (cùng cách `src/utils/onboarding-documents.ts`), public id `foodprint/complaints/<userId>/<uuid>.<ext>`; URL xem = `private_download_url` hạn 600 giây.

## Constitution Check

- Spec-driven: spec này + migration mới, không sửa migration cũ.
- Controller → validation (Zod, gồm mảng file) → service (DTO, upload, transaction) → repository (Prisma select/create).
- Không seed, không chạy migration trên Azure; CD triển khai migration sau khi merge `dev`.

## Design

1. **Migration** `20261210000100_complaint_attachments`: `mime_type` dùng `varchar` + CHECK. Enum `ingredient_issue_type`; cột `issue_type` + CHECK `NOT VALID`; bảng `complaint_attachments` + FK + CHECK + index.
2. **`src/utils/evidence-files.ts`**: middleware `receiveEvidenceFiles` (multer `.array("files", 5)`, bỏ qua khi không phải multipart), `evidenceFilesSchema` (Zod), `detectEvidenceFormat`, `EvidenceStorage` (upload/remove/url) mặc định Cloudinary, `storeEvidenceFiles` (kiểm tra hết rồi upload tuần tự, lỗi ⇒ xóa phần đã upload), `discardEvidenceFiles`.
3. **`complaint-ticket`**: `addComment` trả `{id}`; `addAttachments`; select file dùng chung (`ticketAttachmentsArgs`, `complaintAttachmentsArgs`); `withEvidence(storage, files, owner, run)` dọn file khi `run` lỗi; `mapTicketAttachment`, `mapTicketComment` kèm file.
4. **Module**: validation thêm `title`, `issueType`, `files`; controller ghép `req.body` + `req.files`; routes chèn `receiveEvidenceFiles` trước controller; service gọi `withEvidence` bao transaction và ghi file sau khi tạo đơn/bình luận.
5. **Tài liệu**: `src/modules/README.md`, `docs/AUTHORIZATION.md` (không đổi quyền, chỉ ghi chú multipart), plan v6 đánh dấu PR-F.

## Testing

- Unit: `tests/complaint-attachments.test.ts` (evidence-files + ticket mapping + luồng service với repository/storage giả), cập nhật `tests/meal-complaint.test.ts`, `tests/ingredient-quality-feedback.test.ts`, `tests/authority-complaint.test.ts` theo title/issueType.
- `npm run validate`, `npm run test:unit`, `npm run prisma:validate`. Migration test cần PostgreSQL local (`test:local:migrations`) nếu được phép.
