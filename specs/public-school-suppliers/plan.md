# Implementation Plan: Công khai danh sách nhà cung cấp và nguyên liệu của trường học

**Branch**: `feat/public-school-suppliers` | **Spec**: [spec.md](spec.md)

## Thay đổi

- `src/modules/organization/organization.response.dto.ts`:
  - Định nghĩa DTO `PublicSupplierCertificationDTO`, `PublicSupplierIngredientDTO`, `PublicSchoolSupplierDTO`.
- `src/modules/organization/organization.repository.ts`:
  - Khai báo kiểu dữ liệu `PublicSchoolSupplierDbRow`.
  - Bổ sung hàm `findPublicSchoolSuppliers(schoolId)` truy vấn `schoolSupplierRelationship` với điều kiện `status: "ACTIVE"` và các hợp đồng/nguyên liệu `ACTIVE`.
- `src/modules/organization/organization.service.ts`:
  - Thêm phương thức `getPublicSchoolSuppliers(schoolCode)`.
  - Kiểm tra trường học qua `findSchoolForMenu(schoolCode)`, ném lỗi 404 nếu không tìm thấy.
  - Phân tách và tổng hợp danh mục nguyên liệu theo hợp đồng (`contractedIngredients`) và nguyên liệu nhà cung cấp có (`availableIngredients`).
- `src/modules/organization/organization.controller.ts`:
  - Thêm handler `getPublicSchoolSuppliers`.
- `src/modules/organization/organization.routes.ts`:
  - Đăng ký route công khai `GET /public/:schoolCode/suppliers`.
- `tests/organization.test.ts`:
  - Bổ sung unit test cho chức năng lấy danh sách nhà cung cấp công khai của trường học.

## Constitution Check

- I. Phân lớp kiến trúc: Pass (Controller -> Service -> Repository).
- II. Scope theo principal: Pass (API công khai tuân thủ phạm vi `schoolCode`).
- III. Không DDL/migration: Pass (không thay đổi schema database, tái sử dụng các bảng quan hệ và nguyên liệu hiện có).
- IV. Transaction: Pass (truy vấn dữ liệu chỉ đọc thông qua repository).
- V. DTO tương thích: Pass (định nghĩa rõ cấu trúc dữ liệu phản hồi).
- VI. Spec đi cùng PR: Pass.
