# Tasks: Nhập danh sách lớp học từ Excel

## Setup

- [x] T001 Chốt thiết kế: frontend đọc/ghi Excel, backend nhận JSON; dòng trùng tên là `SKIP`; lưu tất cả hoặc không.

## Backend

- [x] T002 Thêm `importClassesSchema`, Request/Response DTO.
- [x] T003 Thêm `findTeachersByUsernames` và `findBusyTeachers` vào repository.
- [x] T004 Thêm `importClasses` và hàm kiểm tra dòng trong service.
- [x] T005 Thêm controller handler và route `POST /import`.
- [x] T006 Cập nhật `docs/AUTHORIZATION.md` và `src/modules/README.md`.

## Verification

- [x] T007 Thêm unit test cho acceptance scenario 1–7.
- [x] T008 Chạy `npm run validate`, `npm run test:unit`; ghi kết quả vào `plan.md`.
