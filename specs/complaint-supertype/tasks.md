# Tasks: Complaint Supertype & Response Versioning Foundation (PR1)

**Feature Branch**: `refactor/complaint-supertype`

**Created**: 2026-11-18

**Status**: Completed

---

## Phase 1: Spec, Schema & Migration Design

- [x] Soạn thảo `specs/complaint-supertype/spec.md` với các User Story, Acceptance Criteria và ranh giới nghiệp vụ
- [x] Soạn thảo `specs/complaint-supertype/plan.md` với sơ đồ ERD, trình tự migration và rollback plan
- [x] Soạn thảo `specs/complaint-supertype/tasks.md`
- [x] Soạn thảo file migration SQL `prisma/migrations/20261123000100_complaint_supertype/migration.sql` thực hiện Class-Table Inheritance và migrate an toàn toàn bộ dữ liệu cũ
- [x] Cập nhật file `prisma/schema.prisma` với các model `Complaint`, `ComplaintResponseVersion`, `ComplaintStatusHistory` và quan hệ Class-Table Inheritance cho `MealComplaint`, `IngredientQualityFeedback`
- [x] Chạy `npm run prisma:validate` và `npm run prisma:generate`

---

## Phase 2: Refactor Module `feedback` (Khiếu nại suất ăn)

- [x] Cập nhật `src/modules/feedback/feedback.repository.ts`:
  - Điều chỉnh `complaintInclude` đọc thông tin từ `Complaint` và `currentResponseVersion`
  - Điều chỉnh hàm `list` để tìm kiếm và lọc theo các trường bảng cha
  - Điều chỉnh hàm `create` để chèn cả `Complaint` và `MealComplaint` trong cùng transaction
  - Điều chỉnh hàm `updateStatus` để cập nhật `Complaint.status`, tạo `ComplaintResponseVersion` và `ComplaintStatusHistory`
- [x] Cập nhật `src/modules/feedback/feedback.service.ts`:
  - Ánh xạ `RESOLVED` (Client) ↔ `RESPONDED` (DB)
  - Đảm bảo các DTOs trả về đúng cấu trúc cũ
- [x] Kiểm tra các unit test cho module `feedback`

---

## Phase 3: Refactor Module `ingredient-quality-feedback` (Khiếu nại nguyên liệu)

- [x] Cập nhật `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository.ts`:
  - Đổi tên sequence trong `nextComplaintCodeSequence` thành `foodprint.complaint_code_seq`
  - Cập nhật các câu lệnh select (`legacyFeedbackSelect`, `supplierFeedbackListSelect`, `feedbackDetailSelect`) để đọc qua quan hệ bảng cha `Complaint`
  - Điều chỉnh `respondIfSubmitted` thực hiện transaction ghi nhận phiên bản phản hồi và cập nhật trạng thái bảng cha
- [x] Cập nhật `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service.ts`:
  - Giữ nguyên hợp đồng xử lý và ánh xạ DTO
- [x] Kiểm tra các unit test cho module `ingredient-quality-feedback`

---

## Phase 4: Verification, Lint & Build

- [x] Chạy `node tests/spec-gate.test.mjs` kiểm tra hợp lệ Spec Gate
- [x] Chạy `npm run typecheck` kiểm tra tính đúng đắn của toàn bộ kiểu dữ liệu TypeScript
- [x] Chạy `npm run build` kiểm tra biên dịch backend thành công
- [x] Chạy `npm run build` phía Frontend `FoodPrintFE` bảo đảm không xung đột hay ảnh hưởng
