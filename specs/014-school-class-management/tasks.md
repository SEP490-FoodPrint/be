# Tasks: Quản lý lớp học cho Ban Giám hiệu

## Setup

- [x] T001 Đọc quy tắc repo, schema `classes`, `school_academic_years` và module `class` hiện có.
- [x] T002 Chốt quyết định: không khối/cấp học, niên khóa phải được cấu hình, không xóa cứng, có sao chép lớp.

## Backend

- [x] T003 Thêm schema validation và Request/Response DTO cho tạo, sửa, đổi trạng thái, sao chép lớp.
- [x] T004 Thêm các truy vấn repository theo thao tác, lọc theo `schoolId`.
- [x] T005 Thêm service `createClass`, `updateClass`, `changeStatus`, `copyClasses` trong `withSchoolTransaction`; đổi P2002 thành 409.
- [x] T006 Thêm controller handler và route; `POST /copy` đứng trước `/:classId`.
- [x] T007 Thêm permission `class.manage` vào catalog và grant cho `SCHOOL_MANAGEMENT_BOARD`.
- [x] T008 Cập nhật `docs/AUTHORIZATION.md` và `src/modules/README.md`.

## Verification

- [x] T009 Thêm unit test cho các acceptance scenario 1–8 trong `tests/class-assignment.test.ts`.
- [x] T010 Chạy `npm run validate`, `npm run test:unit` và spec gate; ghi kết quả vào `plan.md`.
- [ ] T011 External: chạy `npm run auth:bootstrap` và `npm run test:authorization` trên PostgreSQL local khi được cho phép.

## Bổ sung: gán GVCN khi tạo lớp (FR-009)

- [x] T012 Thêm `homeroomTeacherUserId` tùy chọn vào validation tạo lớp.
- [x] T013 Thêm truy vấn repository tìm phân công hiện tại của giáo viên trong niên khóa.
- [x] T014 Service tạo lớp kiểm tra `class_assignment.manage`, giáo viên hợp lệ, giáo viên chưa chủ nhiệm lớp khác, rồi tạo phân công trong cùng transaction.
- [x] T015 Thêm unit test cho acceptance scenario 9.
