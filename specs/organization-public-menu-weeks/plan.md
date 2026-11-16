# Implementation Plan: Đồng bộ thực đơn theo tuần học và khối cho tổ chức trường học

**Branch**: `feat/organization-public-menu-weeks` | **Spec**: [spec.md](spec.md)

## Thay đổi

- `src/utils/date-time.ts`: bổ sung các hàm tiện ích getSchoolMonday, getSchoolWeekSchedule, calculateAcademicWeekNumber, generateAcademicWeeks.
- `src/modules/menu/menu.service.ts`: tái sử dụng các hàm tiện ích ngày học từ src/utils/date-time.ts.
- `src/modules/organization/organization.repository.ts`: thêm findCurrentAcademicYear, findApprovedWeekStartDates, findWeekGrades.
- `src/modules/organization/organization.response.dto.ts`: bổ sung các trường tuần học và khối lớp trong DTO.
- `src/modules/organization/organization.service.ts`: tích hợp tính toán tuần học và lọc thực đơn theo khối.
- `tests/organization.test.ts`: cập nhật mock repository cho unit tests.

## Constitution Check

- I. Phân lớp kiến trúc: Pass (Controller -> Service -> Repository).
- II. Scope theo principal: Pass (API công khai tuân thủ phạm vi trường học).
- III. Không DDL/migration: Pass (không thay đổi schema database).
- IV. Transaction: Pass (các truy vấn đọc dữ liệu tuân thủ chuẩn read transaction).
- V. DTO tương thích: Pass.
- VI. Spec đi cùng PR: Pass.
