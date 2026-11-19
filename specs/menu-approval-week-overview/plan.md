# Implementation Plan: Duyệt thực đơn theo tuần

**Spec**: [spec.md](spec.md)

## Thiết kế

- **Route**: `GET /menus/approval-week` đăng ký trong `menu.routes.ts`, trước `/:menuId` để không bị bắt nhầm làm `menuId`.
- **Validation**: `menuApprovalWeekQuerySchema` (`date` tùy chọn, `YYYY-MM-DD`, strict).
- **Repository** (`menu-approval.repository.ts`), nhận phạm vi `Prisma.WeeklyMenuWhereInput` do service xác lập:
  - `findWeekDetails(scope, weekStartDate)`: `weeklyMenu.findMany` với `approvalDetailInclude`, `status != DRAFT`.
  - `listSubmittedWeeks(scope)`: `groupBy(weekStartDate, status)` đếm số thực đơn.
- **Service** (`getWeek`): kiểm tra vai trò BGH (`requireBoardSchool`), lấy phạm vi `listScopes.menu(principal)`, quy `date` về thứ Hai (`getSchoolMonday`), chọn tuần mặc định, map từng thực đơn bằng `mapDetail` hiện có, tính `weekNumber` bằng `calculateAcademicWeekNumber`.
- **DTO**: `MenuApprovalWeekResponseDTO`, `MenuApprovalWeekOptionDTO`; `MenuApprovalDetailResponseDTO` thêm `isSchoolWide`, `grades`.

Không có migration. Bảng dùng: `weekly_menus`, `weekly_menu_grades`, `school_grades`, `menu_days` và các bảng chi tiết món sẵn có.

## Constitution Check

| Nguyên tắc                         | Kết quả                                                                                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Kiến trúc module phân lớp       | Đạt: controller → validation → service (map DTO) → repository (query Prisma); controller/repository không import DTO.                                                                                       |
| II. Phân quyền và cô lập tổ chức   | Đạt: principal tin cậy; `listScopes.menu` (`menu.view` + `schoolId`) áp vào `WHERE`; thêm vai trò BGH như `approval-detail`; không nhận organization ID từ query; endpoint ghi vào `docs/AUTHORIZATION.md`. |
| III. An toàn cơ sở dữ liệu         | Đạt: chỉ đọc, không đổi schema, không migration.                                                                                                                                                            |
| IV. Transaction, cache, rate limit | Đạt: chỉ đọc nên không cần transaction; không dùng cache; giữ rate limiter chung.                                                                                                                           |
| V. Hợp đồng HTTP                   | Đạt: envelope `sendSuccess`; ngày trả dạng `YYYY-MM-DD`/chuỗi định dạng, map allowlist trong service.                                                                                                       |
| VI. Spec-Driven                    | Đạt: spec/plan/tasks trong `specs/menu-approval-week-overview/`, nhánh `feat/menu-approval-week-overview`; không có `NEEDS CLARIFICATION`.                                                                  |

## Complexity Tracking

Không có vi phạm cần ghi nhận.
