# Implementation Plan: Quản lý tài khoản nhân viên trường học

**Branch**: `feat/023-school-staff-account-management` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

**Input**: `specs/023-school-staff-account-management/spec.md`, bao gồm các yêu cầu và hành vi đã xác nhận cho tính năng quản lý tài khoản nhân viên trường học.

## Summary

Bổ sung đầy đủ các endpoint CRUD và quản lý trạng thái tài khoản nhân sự cho trường học theo chuẩn kiến trúc của FoodPrint Backend. Các vai trò được quản lý bao gồm 6 vai trò nhân viên: `SCHOOL_MANAGEMENT_BOARD`, `SCHOOL_NUTRITION_OFFICER`, `SCHOOL_KITCHEN_STAFF`, `HOMEROOM_TEACHER`, `PARENTS_COMMITTEE`, `INGREDIENT_MANAGEMENT_DEPARTMENT` (với alias `INGREDIENT_MANAGEMENT`). Tài khoản quản trị `SCHOOL_ADMINISTRATION` được bảo vệ, không hiển thị trong danh sách nhân viên và không cho phép can thiệp qua các endpoint này.

Khi tạo tài khoản mới, hệ thống tự động băm mật khẩu mặc định là `123456` với `bcryptjs`, thiết lập trạng thái khởi tạo `ACTIVE`, gán đúng `schoolId` và vai trò. Cho phép cập nhật thông tin họ tên, số điện thoại, vai trò và bật/tắt trạng thái hoạt động qua transaction an toàn.

## Technical Context

**Language/Version**: Node.js 24.22.1 theo `.nvmrc`; TypeScript 6.0.3 strict; CommonJS, Node16 module resolution.

**Primary Dependencies**: Express 4.21.2, Prisma/client/adapter-pg 7.10.1, Zod 4.6.7, bcryptjs, PostgreSQL.

**Storage**: PostgreSQL schema `foodprint` qua Prisma ORM. Tái sử dụng bảng `User`, `Role`, `School` hiện có, không phát sinh migration cấu trúc mới.

**Testing**: Kiểm thử đơn vị Zod validation, HTTP injection handlers, controller và service logic.

**Target Platform**: Backend REST service Node.js/Express.

**Constraints**: Mọi thay đổi ghi dữ liệu phải nằm trong database transaction (`withSchoolTransaction`). Yêu cầu xác thực bearer token và quyền `school_user.manage`. Bắt buộc gửi header `X-CSRF-Protection: 1` cho các request thay đổi trạng thái (POST/PUT/PATCH).

## Constitution Check

| Nguyên tắc                       | Đánh giá | Chi tiết giải pháp                                                                                                                                            |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Module phân lớp               | PASS     | Tuân thủ nghiêm ngặt 3 lớp: routes -> controller -> service -> repository. Request/Response DTO và Zod validation tách biệt hoàn toàn.                        |
| II. Phân quyền/cô lập            | PASS     | Phân quyền qua `requirePermission("school_user.manage")` kết hợp kiểm tra scope tổ chức `schoolId` từ token và URL params. Không bypass.                      |
| III. An toàn DB                  | PASS     | Không thay đổi DDL/schema, tái sử dụng các model và quan hệ đã có trong baseline. Truy vấn tối ưu qua Prisma repository.                                      |
| IV. Transaction/cache/rate limit | PASS     | Dùng `withSchoolTransaction` cho các thao tác create, update, toggle status đảm bảo tính nguyên tử.                                                           |
| V. HTTP/DTO                      | PASS     | Zod validation strict, trả về `successResponse` với mã HTTP chuẩn (200, 201, 400, 404, 409). Không trả về mật khẩu hoặc thông tin nhạy cảm.                   |
| VI. Spec-driven                  | PASS     | Đầy đủ `spec.md`, `plan.md`, `tasks.md` trong thư mục `specs/023-school-staff-account-management/` gắn với branch `feat/023-school-staff-account-management`. |

## Project Structure

### Documentation (this feature)

```text
specs/023-school-staff-account-management/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code

```text
src/modules/user/
├── user.controller.ts     # Controller xử lý createSchoolUser, updateSchoolUser, toggleSchoolUserStatus
├── user.repository.ts     # Query Prisma: findSchoolUser, createSchoolUser, updateSchoolUser, findRoleByCode, findUserByEmailOrUsername
├── user.request.dto.ts    # Request DTOs: SchoolAccountQueryDto, CreateSchoolAccountDto, UpdateSchoolAccountDto, ToggleSchoolAccountStatusDto
├── user.response.dto.ts   # Response DTOs: SchoolAccountItemDto, SchoolAccountListResponseDto, SchoolAccountDetailResponseDto
├── user.routes.ts         # Khai báo routes cho school account management dưới router trường học
├── user.service.ts        # Nghiệp vụ: mã hóa mật khẩu mặc định 123456, kiểm tra vai trò hợp lệ, bọc transaction
└── user.validation.ts     # Zod schemas: params, query, create, update, status toggle
docs/
└── AUTHORIZATION.md       # Cập nhật tài liệu phân quyền endpoint school accounts
```
