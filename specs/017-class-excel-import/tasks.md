# Tasks: Nhập danh sách lớp học từ Excel

## Setup

- [x] T001 Chốt thiết kế: frontend đọc/ghi Excel, backend nhận JSON; dòng trùng tên là `SKIP`; lưu tất cả hoặc không.

## Backend

- [ ] T002 Thêm `importClassesSchema`, Request/Response DTO.
- [ ] T003 Thêm `findTeachersByUsernames` và `findBusyTeachers` vào repository.
- [ ] T004 Thêm `importClasses` và hàm kiểm tra dòng trong service.
- [ ] T005 Thêm controller handler và route `POST /import`.
- [ ] T006 Cập nhật `docs/AUTHORIZATION.md` và `src/modules/README.md`.

## Verification

- [ ] T007 Thêm unit test cho acceptance scenario 1–7.
- [ ] T008 Chạy `npm run validate`, `npm run test:unit`; ghi kết quả vào `plan.md`.
