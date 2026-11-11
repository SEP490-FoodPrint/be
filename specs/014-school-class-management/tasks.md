# Tasks: Quản lý lớp học cho Ban Giám hiệu

## Setup

- [x] T001 Đọc quy tắc repo, schema `classes`, `school_academic_years` và module `class` hiện có.
- [x] T002 Chốt quyết định: không khối/cấp học, niên khóa phải được cấu hình, không xóa cứng, có sao chép lớp.

## Backend

- [ ] T003 Thêm schema validation và Request/Response DTO cho tạo, sửa, đổi trạng thái, sao chép lớp.
- [ ] T004 Thêm các truy vấn repository theo thao tác, lọc theo `schoolId`.
- [ ] T005 Thêm service `createClass`, `updateClass`, `changeStatus`, `copyClasses` trong `withSchoolTransaction`; đổi P2002 thành 409.
- [ ] T006 Thêm controller handler và route; `POST /copy` đứng trước `/:classId`.
- [ ] T007 Thêm permission `class.manage` vào catalog và grant cho `SCHOOL_MANAGEMENT_BOARD`.
- [ ] T008 Cập nhật `docs/AUTHORIZATION.md` và `src/modules/README.md`.

## Verification

- [ ] T009 Thêm unit test cho các acceptance scenario 1–8 trong `tests/class-assignment.test.ts`.
- [ ] T010 Chạy `npm run validate`, `npm run test:unit` và spec gate; ghi kết quả vào `plan.md`.
- [ ] T011 External: chạy `npm run auth:bootstrap` và `npm run test:authorization` trên PostgreSQL local khi được cho phép.
