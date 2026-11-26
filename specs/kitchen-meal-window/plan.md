# Implementation Plan: Chặn xử lý lô nấu ngoài khung giờ bữa

**Branch**: `feat/kitchen-meal-window` | **Spec**: [spec.md](./spec.md)

## Technical Context

TypeScript, Express, Prisma. Dùng cột có sẵn `School.lunchTime`; không đổi schema Prisma hay migration.

## Thiết kế

1. `src/modules/kitchen/kitchen.service.ts`: hàm thuần `assertMealWindow(mealType, lunchTime, now)` so giờ hiện tại (UTC+7, `HH:mm`) với giờ bữa trưa (FR-001, FR-002, FR-004).
2. `createKitchenLifecycle` và `createKitchenService` nhận thêm `now: () => Date` (mặc định giờ hệ thống) để test cố định thời điểm.
3. `confirm` kiểm tra sau bước trả kết quả cho lô không còn `UNCONFIRMED`; `complete` kiểm tra sau bước từ chối lô chưa `CONFIRMED`, trong cùng transaction đã khóa lô (FR-003).
4. `tests/meal-window.test.ts` kiểm tra hàm thuần; `tests/authorization.integration.test.ts` tiêm 10:00 giờ VN cho dịch vụ bếp (SC-001, SC-002).

## Constitution Check

Kiểm tra nghiệp vụ nằm ở service, lỗi tiếng Việt qua `HttpError`. Không seed, reset, migration hay `db push`.
