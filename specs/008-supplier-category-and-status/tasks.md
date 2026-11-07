# Tasks: Đồng bộ danh mục nguyên liệu thịt và lọc nhà cung cấp khả dụng

**Input**: Design documents from `/specs/008-supplier-category-and-status/`

**Prerequisites**: `spec.md`, `plan.md`

**Tests**: Kiểm tra unit tests và spec validation gate của hệ thống CI.

## Phase 1: Specification and contracts

- [x] T001 Hoàn thiện tài liệu đặc tả yêu cầu và kịch bản nghiệm thu trong `specs/008-supplier-category-and-status/spec.md`.
- [x] T002 Hoàn thiện kế hoạch triển khai và kiểm tra Hiến chương trong `specs/008-supplier-category-and-status/plan.md`.

## Phase 2: Implementation

- [x] T003 Cập nhật hàm `directory` trong `src/modules/supplier-onboarding/supplier-onboarding.service.ts` để mặc định lọc `status = 'ACTIVE'` khi không có query status.
- [x] T004 Cập nhật điều kiện lọc `category` trong `directory` để nhận diện cả "Thịt" và "Thịt tươi" khi người dùng chọn nhóm thịt.
- [x] T005 Cập nhật hàm `categories` trong `src/modules/supplier-onboarding/supplier-onboarding.service.ts` để chuẩn hóa "Thịt" thành "Thịt tươi", loại bỏ phần tử trùng lặp và sắp xếp theo tiếng Việt.

## Phase 3: Quality gates and verification

- [x] T006 Chạy kiểm tra định dạng và quy tắc code bằng Prettier và ESLint.
- [x] T007 Chạy toàn bộ bộ kiểm thử đơn vị `npm run test:unit`.
- [x] T008 Kiểm tra tính tương thích của Spec gate thông qua script kiểm thử spec-gate.
