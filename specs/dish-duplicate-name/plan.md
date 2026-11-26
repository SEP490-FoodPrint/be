# Implementation Plan: Báo rõ khi tạo món trùng tên

**Branch**: `fix/dish-duplicate-name` | **Spec**: [spec.md](./spec.md)

## Technical Context

TypeScript, Express, Prisma. Dùng ràng buộc có sẵn `@@unique([schoolId, name])`; không đổi schema hay migration.

## Thiết kế

1. `dish.repository.ts`: `dishByName` tìm món cùng trường theo tên không phân biệt hoa thường; `dishWriteError` đổi `P2002` khi ghi món thành 409 (FR-002).
2. `dish.service.ts`: `assertDishNameFree` chạy đầu transaction lưu món, bỏ qua chính món đang sửa (FR-001, FR-003).
3. Thêm test trùng tên và cập nhật mock `dish.findFirst` trong `tests/menu-create-allergies.test.ts` (SC-001).

## Constitution Check

Kiểm tra nghiệp vụ nằm ở service, truy vấn ở repository, lỗi tiếng Việt qua `HttpError`. Không seed, reset, migration hay `db push`.
