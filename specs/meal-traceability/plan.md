# Plan: Meal Traceability

## Architecture & Module Organization

Triển khai module `src/modules/meal-traceability/` theo chuẩn 7 file:

1. `meal-traceability.routes.ts`: Đăng ký route `GET /api/meal-traceability`.
2. `meal-traceability.controller.ts`: Controller nhận HTTP query, validate, gọi service, trả response qua `sendSuccess`.
3. `meal-traceability.validation.ts`: Zod schema `z.strictObject()` xác thực query (`classId`, `date`, `mealType`, `mealAllocationId`).
4. `meal-traceability.request.dto.ts`: Type inferred từ schema validation.
5. `meal-traceability.response.dto.ts`: Output contract định nghĩa rõ các trường trả về.
6. `meal-traceability.service.ts`: Orchestration logic, gọi repository, map dữ liệu sang Response DTO (đảm bảo `blockchainProof: null`).
7. `meal-traceability.repository.ts`: Truy vấn Prisma schema hiện hành, không sửa đổi cấu trúc CSDL.

Đăng ký router vào `src/routes/index.ts`.
