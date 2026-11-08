# Implementation Plan

## Phạm vi

Áp dụng delta nghiệp vụ theo thứ tự: giờ ăn trường, phân công GVCN, scope lớp GVCN, workflow suất ăn hằng ngày.

## Thiết kế

- Giữ router hiện tại dưới `/api`; bổ sung route vào organization, class và meal-attendance.
- Validation chuẩn hóa input; Request/Response DTO tách riêng cho các module.
- Service giữ authorization, business rules và transaction boundary.
- Repository giữ truy vấn Prisma và nhận transaction client cho các ghi nguyên tử.
- Dùng `withSchoolTransaction` để tải lại principal/quyền và khóa phạm vi trường.

## Constitution Check

- Kiến trúc module phân lớp: PASS.
- Permission và school isolation: PASS.
- Migration đã applied bất biến: PASS; không có thay đổi `prisma/**`.
- Transaction cho assignment và submission/allergy: PASS.
- Response envelope và serialize thời gian rõ ràng: PASS.
- Spec/plan/tasks cùng branch `feat/008-conflicted-feature-integration`: PASS.

## Kiểm thử

- Focused tests cho giờ ăn, phân công, scope và draft/finalize.
- Prisma validate/generate, typecheck, lint, format, unit test và build.
- Migration checksum trước/sau; không chạy lệnh database trên Azure.
