# Implementation Plan: Thông báo ngắn gọn, dễ hiểu cho người dùng

**Branch**: `fix/user-facing-messages` | **Spec**: [spec.md](./spec.md)

## Technical Context

TypeScript, Express, Prisma. Thay đổi nội dung thông báo trong `src/` và kỳ vọng trong unit test; không đổi schema Prisma hay migration.

## Thiết kế

1. Thay các câu dài hoặc kỹ thuật trong validation, service và repository bằng câu ngắn (FR-001).
2. Dùng `src/utils/short-list.ts` để rút gọn danh sách trong thông báo (FR-002).
3. Dùng câu chung trong `src/utils/request-validation.ts` và `src/middlewares/error.middleware.ts`, giữ lỗi theo trường (FR-003, FR-004).
4. Cập nhật unit test so khớp thông báo.
5. Khi gộp `dev`, giữ logic của `dev` trong `round-dish-planning.ts` và `supply-round.repository.ts`, chỉ đặt lại câu thông báo (FR-005).

## Constitution Check

Validation vẫn trả HTTP 400 bằng tiếng Việt kèm đường dẫn trường, không lộ giá trị thô. Không seed, reset, migration hay `db push`.
