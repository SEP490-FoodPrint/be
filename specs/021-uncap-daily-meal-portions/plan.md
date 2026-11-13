# Implementation Plan: Bỏ giới hạn trần suất ăn bán trú và sắp xếp lịch sử theo ngày

**Branch**: `feat/021-uncap-daily-meal-portions` | **Spec**: [spec.md](spec.md)

## Design

- Trong `src/modules/meal-attendance/meal-attendance.service.ts`:
  - Trong hàm `saveDraft`: Bỏ khối lệnh ném lỗi `HttpError(422, "Tổng số suất vượt số suất đã đăng ký của lớp")` khi `input.totalPortions > assigned.registeredMealPortions`.
  - Trong hàm `getAll`: Cập nhật `orderBy: [{ mealDate: "desc" }, { mealType: "asc" }, { id: "desc" }]`.

## Constitution Check

| Principle               | Result | Design                                                                    |
| ----------------------- | ------ | ------------------------------------------------------------------------- |
| I. Layered architecture | PASS   | Thay đổi logic kiểm tra nghiệp vụ và thứ tự sắp xếp trong service layer.  |
| II. Tenant isolation    | PASS   | Vẫn giữ nguyên phân quyền giáo viên theo lớp và trường.                   |
| III. Database safety    | PASS   | Không DDL, không migration, không sửa schema.                             |
| IV. Atomicity           | PASS   | Giữ nguyên transaction `withSchoolTransaction`.                           |
| V. HTTP contract        | PASS   | Giữ nguyên response DTO và payload.                                       |
| VI. Spec-driven         | PASS   | Spec, plan, tasks đi kèm với branch `feat/021-uncap-daily-meal-portions`. |

## Validation strategy

- Chạy `npm run test:unit` với các test case của `tests/meal-submission.test.ts`.
- Chạy `npm run typecheck` và `npm run build`.
