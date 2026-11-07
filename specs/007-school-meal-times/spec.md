# Feature Specification: Giờ phục vụ bữa ăn

**Feature Branch**: `feat/007-school-meal-times`

**Created**: 2026-11-07

**Status**: Ready

## Requirements

- Cung cấp `GET /api/schools/me/meal-times` và `PATCH /api/schools/me/meal-times`.
- Phạm vi trường luôn lấy từ `AuthPrincipal`, không nhận `schoolId` từ client.
- Chỉ BGH thuộc trường và có `school_meal_times.manage` được truy cập.
- PATCH nhận strict body `{ lunchTime, afternoonMealTime }`; mỗi giá trị là `HH:mm` hoặc `null`.
- Nếu cùng có giá trị, giờ ăn trưa phải sớm hơn giờ ăn chiều.
- Response chỉ gồm hai giờ ở dạng `HH:mm` hoặc `null`.
- PATCH xác minh lại actor/quyền/scope trong transaction.
- Tái sử dụng hai cột hiện có trên `School`; không tạo migration.

## Success criteria

- API chỉ đọc/ghi trường trong phiên; payload sai trả 400, sai quyền/scope trả 403.
- Unit tests, lint, typecheck và build pass.
