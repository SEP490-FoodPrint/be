# Implementation Plan: Duyệt thực đơn theo tuần

**Branch**: `fix/004-menu-weekly-approval` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)

## Summary

Thay luồng duyệt theo ngày bằng quyết định nguyên tuần và thêm hồ sơ duyệt dành cho Ban Giám hiệu. Phần mới được tách thành module `menu-approval` theo kiến trúc hiện hành, còn router menu chỉ gắn controller mới vào hai endpoint hiện hữu/mới.

## Technical Context

**Language/Version**: TypeScript strict, Node.js 24  
**Primary Dependencies**: Express, Zod 4, Prisma 7  
**Storage**: PostgreSQL qua Prisma, không đổi schema  
**Testing**: Node test runner qua `tsx --test`  
**Target Platform**: Backend CommonJS hiện hữu  
**Project Type**: REST API  
**Performance Goals**: Một truy vấn hồ sơ và một truy vấn tổng hợp nhu cầu; quyết định chạy trong một transaction  
**Constraints**: Không dùng organization id từ request; không trả Prisma record; không sửa CI/CD hay migration

## Constitution Check

- PASS: Có spec/plan/tasks cùng số `004` với branch trước khi code.
- PASS: Controller chỉ parse input, gọi service và gửi response helper.
- PASS: Validation dùng `z.strictObject()` và `safeParse`, Request DTO suy ra từ schema.
- PASS: Service giữ phân quyền/nghiệp vụ/mapping DTO, không tạo `where`, `select`, `include`.
- PASS: Repository giữ toàn bộ Prisma query và nhận transaction client cho các thao tác nguyên tử.
- PASS: Request/Response DTO là hai file riêng.
- PASS: Không có thay đổi schema, migration, generated client hoặc dữ liệu.

## Project Structure

```text
specs/004-menu-weekly-approval/
├── spec.md
├── plan.md
└── tasks.md

src/modules/menu-approval/
├── menu-approval.controller.ts
├── menu-approval.repository.ts
├── menu-approval.request.dto.ts
├── menu-approval.response.dto.ts
├── menu-approval.service.ts
└── menu-approval.validation.ts
```

`src/modules/menu/menu.routes.ts` đăng ký controller mới dưới `/api/v1/menus`. Tài liệu module và unit-test được cập nhật trong cùng PR.

## Design

### Read path

1. Middleware xác thực và kiểm tra `menu.view`.
2. Zod parse `menuId`.
3. Service kiểm tra vai trò Ban Giám hiệu và phạm vi trường.
4. Repository đọc tuần theo cặp `id + schoolId`, rồi tổng hợp `DailyMealPortion FINALIZED` theo ngày/ca.
5. Service map allowlist sang `MenuApprovalDetailResponseDTO`; số suất ngày là max giữa các ca.

### Write path

1. Middleware yêu cầu ít nhất một trong `menu.review`/`menu.approve`; Zod loại trường lạ và normalize feedback.
2. Service chọn đúng permission theo decision và mở `withSchoolTransaction` để tải lại identity/quyền/phạm vi.
3. Service bắt buộc actor là Ban Giám hiệu, đọc tuần có scope qua repository và kiểm tra trạng thái/nội dung.
4. Repository tạo lịch sử cấp tuần, cập nhật mọi ngày và tuần bằng cùng transaction client.
5. Service map kết quả sang response DTO.

## Risk Controls

- Giữ route cũ nhưng không gọi implementation duyệt theo ngày trong `menu.service.ts`.
- Không cherry-pick commit PR cũ để tránh kéo lịch sử/kiến trúc lỗi và phần ngoài scope.
- Unit-test dùng repository giả để chứng minh service không phụ thuộc Prisma query shape.
- Chạy Spec gate trên diff với `origin/dev` trước khi push.
