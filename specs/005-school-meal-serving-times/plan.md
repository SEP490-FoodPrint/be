# Architecture & Implementation Plan: Cấu hình giờ phục vụ bữa ăn của trường

**Feature Branch**: `feat/005-school-meal-serving-times`

## Proposed Changes

### 1. Permission Catalog

- File: `src/constants/permission-catalog.ts`
- Thêm quyền `school_meal_time.manage` vào danh mục quyền hệ thống `INITIAL_PERMISSIONS`.
- Gán quyền mặc định cho `SCHOOL_MANAGEMENT_BOARD` trong `INITIAL_ROLE_PERMISSIONS`.

### 2. Validation & DTO

- File: `src/modules/organization/organization.validation.ts`
  - Thêm `mealTimesBodySchema` bằng Zod strict object.
  - Regex kiểm tra định dạng giờ `^(?:[01]\d|2[0-3]):[0-5]\d$`.
  - Refine kiểm tra `lunchTime < afternoonMealTime` nếu cả hai được cung cấp.
  - Export `validateMealTimes` trả về type suy diễn.
- File: `src/modules/organization/organization.request.dto.ts`
  - Export `MealTimesRequestDTO = z.infer<typeof mealTimesBodySchema>`.
- File: `src/modules/organization/organization.response.dto.ts`
  - Export `MealTimesResponseDTO` chứa `lunchTime: string | null` và `afternoonMealTime: string | null`.

### 3. Repository, Service & Controller

- File: `src/modules/organization/organization.repository.ts`
  - Bổ sung phương thức `getMealTimes(schoolId: string)` và `updateMealTimes(schoolId: string, data: { lunchTime: Date | null, afternoonMealTime: Date | null })`.
- File: `src/modules/organization/organization.service.ts`
  - Helper chuyển đổi giữa chuỗi `"HH:mm"` và `Date` (UTC epoch cho kiểu PostgreSQL TIME).
  - Assertion `assertMealTimeManager(principal: AuthPrincipal)` kiểm tra vai trò `SCHOOL_MANAGEMENT_BOARD`, `orgType: "SCHOOL"`, và quyền `school_meal_time.manage`.
  - Bổ sung `getMealTimes` và `updateMealTimes`.
- File: `src/modules/organization/organization.controller.ts`
  - Bổ sung controller methods: `getMealTimes` và `updateMealTimes`.
- File: `src/modules/organization/organization.routes.ts`
  - Đăng ký `GET /me/meal-times` và `PATCH /me/meal-times` kèm middleware `requirePermission("school_meal_time.manage")`.

### 4. Verification & Testing

- File: `tests/cooking-mode.test.ts` (hoặc test riêng)
  - Thêm unit tests cho `validateMealTimes`, routing, authorization check và service mapping.
