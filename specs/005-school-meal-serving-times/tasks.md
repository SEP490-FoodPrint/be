# Tasks: Cấu hình giờ phục vụ bữa ăn của trường

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Foundational Authorization & Specification

- [x] T001 Khởi tạo branch `feat/005-school-meal-serving-times` và bộ spec tại `specs/005-school-meal-serving-times/`
- [ ] T002 Thêm permission `school_meal_time.manage` và grant mặc định cho Ban Giám hiệu trong `src/constants/permission-catalog.ts`

## Phase 2: DTO & Validation

- [ ] T003 Thêm Zod schema `mealTimesBodySchema` và `validateMealTimes` trong `src/modules/organization/organization.validation.ts`
- [ ] T004 Thêm Request DTO `MealTimesRequestDTO` trong `src/modules/organization/organization.request.dto.ts`
- [ ] T005 Thêm Response DTO `MealTimesResponseDTO` trong `src/modules/organization/organization.response.dto.ts`

## Phase 3: Persistence, Service & API Routing

- [ ] T006 Thêm repository methods `getMealTimes` và `updateMealTimes` trong `src/modules/organization/organization.repository.ts`
- [ ] T007 Thêm service logic, assertion authorization và mapping format time trong `src/modules/organization/organization.service.ts`
- [ ] T008 Thêm controller methods và đăng ký route `GET|PATCH /me/meal-times` trong `src/modules/organization/organization.controller.ts` và `src/modules/organization/organization.routes.ts`

## Phase 4: Verification & Quality Gate

- [ ] T009 Thêm unit tests cho validation, routing và authorization
- [ ] T010 Chạy `npm run validate` (lint, format:check, typecheck, build)
- [ ] T011 Chạy `npm run test:unit`
- [ ] T012 Kiểm tra Spec gate với `npm run spec:check`
