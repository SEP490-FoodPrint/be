# Implementation Plan: Giờ phục vụ bữa ăn

**Branch**: `feat/007-school-meal-times` | **Date**: 2026-11-07

Mở rộng module `organization`: Zod strict validation, DTO tường minh, service kiểm tra BGH và permission, repository Prisma, PATCH qua `withSchoolTransaction`. Thêm permission vào catalog/grant mặc định cho BGH. Không đổi schema.

## Contract

- `GET|PATCH /api/schools/me/meal-times`
- PATCH: `{ "lunchTime": "11:00" | null, "afternoonMealTime": "15:00" | null }`
- Response data: cùng shape, chuẩn hóa `HH:mm`.

## Verification

Prettier, targeted/unit tests, lint, typecheck, build và spec gate.
