# Tasks: Quản lý tài khoản nhân viên trường học

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Branch**: `feat/023-school-staff-account-management`

## Phase 1: Setup & Validation Contracts

**Goal**: Thiết lập các Zod schema và Type DTO cho danh sách, tạo mới, chỉnh sửa và cập nhật trạng thái tài khoản nhân sự trường học.

- [x] T001 Khai báo Zod validation schemas cho query phân trang, params (`schoolId`, `userId`), create, update và toggle status trong `src/modules/user/user.validation.ts`.
- [x] T002 Định nghĩa Request DTOs trong `src/modules/user/user.request.dto.ts` và Response DTOs chuẩn trong `src/modules/user/user.response.dto.ts`.

## Phase 2: Data Access Layer (Repository)

**Goal**: Triển khai các phương thức truy vấn và biến đổi dữ liệu với Prisma ORM, đảm bảo lọc bỏ tài khoản quản trị trường và hỗ trợ transaction.

- [x] T003 Bổ sung trường `phone` và loại trừ vai trò `SCHOOL_ADMINISTRATION` trong truy vấn danh sách nhân viên trường tại `src/modules/user/user.repository.ts`.
- [x] T004 Triển khai `findRoleByCode`, `findUserByEmailOrUsername`, `findSchoolUser`, `createSchoolUser`, `updateSchoolUser` hỗ trợ `TransactionClient` trong `src/modules/user/user.repository.ts`.

## Phase 3: Service Layer (Business Logic)

**Goal**: Cài đặt logic nghiệp vụ: mã hóa mật khẩu mặc định 123456, kiểm tra tính hợp lệ của 6 vai trò nhân viên trường học, ánh xạ alias vai trò và bọc transaction an toàn.

- [x] T005 Triển khai `createSchoolAccount` trong `src/modules/user/user.service.ts`: kiểm tra trùng lặp email/username, mã hóa mật khẩu mặc định `123456` bằng bcryptjs, ánh xạ `INGREDIENT_MANAGEMENT` -> `INGREDIENT_MANAGEMENT_DEPARTMENT`.
- [x] T006 Triển khai `updateSchoolAccount` và `toggleAccountStatus` trong `src/modules/user/user.service.ts` với kiểm tra thuộc đúng trường và ngăn chặn tự đổi trạng thái của chính mình.

## Phase 4: Controller, Routing & Documentation

**Goal**: Gắn kết luồng API Express, áp dụng middleware bảo vệ quyền hạn và cập nhật tài liệu hợp đồng phân quyền.

- [x] T007 Cài đặt các action handlers cho create, update và toggle status trong `src/modules/user/user.controller.ts`.
- [x] T008 Đăng ký các endpoints `POST /`, `PUT /:userId`, `PATCH /:userId/status` trên router trường học với `requirePermission("school_user.manage")` trong `src/modules/user/user.routes.ts`.
- [x] T009 Cập nhật ma trận phân quyền cho các endpoint tài khoản trường học trong `docs/AUTHORIZATION.md`.
