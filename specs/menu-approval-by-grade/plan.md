# Implementation Plan: Duyệt thực đơn theo khối

**Branch**: `feat/menu-approval-by-grade` | **Spec**: [spec.md](spec.md)

## Thay đổi

- `menu-approval.repository.ts`:
  - Include `User { fullName }`.
  - Thêm `findGradeCoverage`. Hàm đọc song song các dữ liệu sau:
    - khối và số lớp ACTIVE theo niên khóa;
    - số lớp chưa gán khối;
    - suất FINALIZED theo lớp/khối;
    - `WeeklyMenuGrade` của các thực đơn khác trong tuần;
    - thực đơn toàn trường khác trong tuần.
- `menu-approval.service.ts`: thêm `mapGradeCoverage` và `weeklyPortions`, sửa nhãn người đề xuất. Giữ nguyên `portionsByDate` (lấy bữa lớn nhất trong ngày); đã kiểm tra và thấy đúng vì một học sinh có thể ăn cả hai bữa.
- `menu-approval.response.dto.ts`: thêm `MenuApprovalGradeCoverageDTO`.
- Test: `tests/menu-weekly-approval.test.ts`.

## Constitution Check

- I. Phân lớp: Pass, repository → service → DTO.
- II. Scope: Pass, `schoolId` lấy từ principal.
- III. Không DDL: Pass.
- IV. Transaction: Pass, chỉ đọc, không cần transaction.
- V. DTO allowlist: Pass, chỉ trả trường đã liệt kê.
- VI. Spec đi cùng PR: Pass.
