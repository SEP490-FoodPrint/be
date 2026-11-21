# Implementation Plan: Gửi phản ánh chất lượng nguyên liệu (C02, PR3)

**Branch**: `feat/ingredient-feedback-submission` | **Spec**: [spec.md](./spec.md)

## Summary

Gắn HTTP `POST /api/ingredient-quality-feedback` vào hàm tạo dùng chung PR1 đã có trong `ingredient-quality-feedback.repository.ts`; chỉnh catalog quyền mặc định theo Q11. Không có migration.

## Technical Context

Express + TypeScript strict (CommonJS), Prisma 7, PostgreSQL. Tái sử dụng `withSchoolTransaction` (Serializable, nạp lại actor, khóa trường, kiểm tra `ACTIVE`), `complaintTicketRepository.allocateCode/recordCreated`, `ingredientFeedbackTitle`, `readAndMapDetail` hiện có.

## Constitution Check

- Spec-driven: spec/plan/tasks trong `specs/ingredient-feedback-submission/`.
- Module giữ đủ lớp; service không dựng truy vấn Prisma (thêm `findDeliveryForFeedback` vào repository).
- Phạm vi trường lấy từ actor, không lấy từ body; repository áp `schoolId` trong `where`.
- Không migration, không seed, không thao tác DB từ xa.

## Thiết kế mã

- `validation.ts`: `createIngredientQualityFeedbackBodySchema` (strict, `deliveryId` UUID, `ingredientLotId` UUID/null tùy chọn, `description` trim 10–2000); `validateCreateIngredientQualityFeedbackBody`.
- `request.dto.ts`: `CreateIngredientQualityFeedbackRequest`.
- `repository.ts`: `findDeliveryForFeedback(tx, deliveryId, schoolId)` → `{id, deliveryNo, status} | null`.
- `service.ts`: `create(body, principal)` trong `withSchoolTransaction(..., "ingredient_quality_feedback.submit")`: tính read scope chi tiết của actor trước khi ghi → kiểm tra chuyến giao (404/409) → kiểm tra lô (`findLotInDelivery`, 400) → cấp mã CP → `repository.create` → `recordCreated` → `readAndMapDetail`.
- `controller.ts` / `routes.ts`: `POST /` với `requirePermission("ingredient_quality_feedback.submit")`, 201, `private, no-store`.
- `permission-catalog.ts`: thêm 3 grant cho `SCHOOL_MANAGEMENT_BOARD`; bỏ `view_details` của `SCHOOL_KITCHEN_STAFF`, `SCHOOL_NUTRITION_OFFICER`.

## Kiểm thử

- Unit `tests/ingredient-quality-feedback.test.ts`: validation tạo đơn; service create (404/409/400 lô, thứ tự gọi, Serializable); route `POST /` (403 khi thiếu quyền, 201); catalog Q11.
- Integration (`tests/supplier-onboarding.integration.test.ts`, nhóm `test:local:authorization`; hai test US2/US3 cũ đổi người xem toàn trường từ bếp sang BGH theo Q11): gửi đơn qua HTTP trên DB tạm, NCC thấy đơn, BGH thấy toàn trường, bếp chỉ thấy đơn mình.

## Rollback

Chỉ đổi mã ứng dụng và catalog mặc định; revert PR. Grant đã cấp thủ công trên DB đang chạy do operator gỡ qua API quản trị quyền.

## Complexity Tracking

Không có vi phạm hiến chương.
