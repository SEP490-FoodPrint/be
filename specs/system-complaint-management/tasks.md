# Tasks: System Complaint Management (PR2)

**Feature Branch**: `feat/system-complaint-management`  
**Created**: 2026-11-18  
**Status**: Completed  

---

## Phase 1: Spec & Schema Migration
- [x] Soạn thảo `specs/system-complaint-management/spec.md`
- [x] Soạn thảo `specs/system-complaint-management/plan.md`
- [x] Soạn thảo `specs/system-complaint-management/tasks.md`
- [x] Soạn thảo file migration SQL `prisma/migrations/20261124000100_system_complaint/migration.sql`
- [x] Cập nhật `prisma/schema.prisma` bổ sung model `SystemComplaint`
- [x] Chạy `npm run prisma:validate` và `npm run prisma:generate`

---

## Phase 2: Backend Implementation
- [x] Tạo file `src/modules/system-complaint/system-complaint.validation.ts` với Zod schemas
- [x] Tạo file `src/modules/system-complaint/system-complaint.repository.ts` với các truy vấn DB
- [x] Tạo file `src/modules/system-complaint/system-complaint.service.ts` xử lý logic C06 và versioning phản hồi
- [x] Tạo file `src/modules/system-complaint/system-complaint.routes.ts` thiết lập các route API
- [x] Đăng ký router vào `src/routes/index.ts` tại `/system-complaints`

---

## Phase 3: Testing & Verification
- [x] Viết test suite kiểm thử tính năng `system-complaint`
- [x] Chạy kiểm tra `node tests/spec-gate.test.mjs`
- [x] Chạy `npm run typecheck`
- [x] Chạy `npm run build`
