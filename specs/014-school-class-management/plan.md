# Implementation Plan: Quản lý lớp học cho Ban Giám hiệu

**Branch**: `feat/014-school-class-management` | **Spec**: [spec.md](spec.md) | **Contracts**: [contracts.md](contracts.md)

## Design

Mở rộng module `src/modules/class/` hiện có, không tạo module mới và không đổi schema.

- **Validation**: thêm `createClassSchema`, `updateClassSchema`, `classStatusSchema`, `copyClassesSchema` bằng `z.strictObject`, tái dùng `academicYearSchema`, `classIdParamsSchema` và `parse`.
- **Repository**: thêm truy vấn theo thao tác, tất cả nhận transaction client và `schoolId` trong `WHERE`: đọc niên khóa đã cấu hình, đọc lớp để ghi, tìm tên trùng không phân biệt hoa thường, tạo / sửa / đổi trạng thái lớp, liệt kê lớp ACTIVE để sao chép. Tái dùng `findCurrentAssignment` và `endAssignment`.
- **Service**: thêm `createClass`, `updateClass`, `changeStatus`, `copyClasses`, đều chạy trong `withSchoolTransaction(db, principal, "class.manage", …)` và kiểm tra role BGH. Helper `requireWritableYear` kiểm tra niên khóa đã cấu hình và còn ghi được. Lỗi P2002 được đổi thành 409. Kết quả map bằng `classDto` hiện có.
- **Controller/routes**: thêm 4 handler; `POST /copy` đăng ký trước các route `/:classId`.
- **Permission**: thêm `class.manage` vào catalog và grant cho `SCHOOL_MANAGEMENT_BOARD`.

`withSchoolTransaction` khóa dòng `schools` bằng `FOR UPDATE`, nên kiểm tra trùng tên trước khi ghi được tuần tự hóa giữa các request cùng trường.

## Constitution Check

| Principle               | Result | Design                                                                                        |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------- |
| I. Layered architecture | PASS   | Validation → controller → service → repository; DTO chỉ dùng trong service.                   |
| II. Tenant isolation    | PASS   | `schoolId` lấy từ principal được nạp lại trong transaction; repository lọc theo `schoolId`.   |
| III. Database safety    | PASS   | Không migration, không DDL. Permission mới chỉ vào DB qua `auth:bootstrap` khi được cho phép. |
| IV. Atomicity           | PASS   | Mỗi thao tác ghi (kể cả đóng GVCN và sao chép nhiều lớp) nằm trong một transaction.           |
| V. HTTP contract        | PASS   | Giữ envelope; trả `ClassItemDTO` theo allowlist hiện có.                                      |
| VI. Spec-driven         | PASS   | Spec, plan, tasks commit trước code trên nhánh cùng số.                                       |

## Validation strategy

Chạy `npm run validate` và `npm run test:unit`. Test mới được thêm vào `tests/class-assignment.test.ts` (đã nằm trong `test:unit`) bằng fake repository, không cần PostgreSQL. Test tích hợp phân quyền thực chỉ chạy khi có PostgreSQL local tạm.

## Verification results

Sẽ được cập nhật sau khi triển khai.
