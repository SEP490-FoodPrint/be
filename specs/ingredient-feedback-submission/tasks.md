# Tasks: Gửi phản ánh chất lượng nguyên liệu (C02, PR3)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Quyền

- [x] T001 Cập nhật catalog mặc định trong `src/constants/permission-catalog.ts` theo Q11 (FR-007).

## Phase 2: Gửi đơn (US1)

- [x] T002 Schema/validator tạo đơn trong `ingredient-quality-feedback.validation.ts`; Request DTO trong `.request.dto.ts`.
- [x] T003 `findDeliveryForFeedback` trong `ingredient-quality-feedback.repository.ts`.
- [x] T004 `create` trong `ingredient-quality-feedback.service.ts` (FR-002–FR-006).
- [x] T005 Controller `create` + route `POST /` trong `.controller.ts`, `.routes.ts`.

## Phase 3: Tài liệu & kiểm thử (US2, US3)

- [x] T006 Cập nhật `src/modules/README.md`, `docs/AUTHORIZATION.md`.
- [x] T007 Unit test trong `tests/ingredient-quality-feedback.test.ts` và test catalog liên quan.
- [x] T008 Integration: luồng gửi C02 qua HTTP trên DB tạm.
- [x] T009 `npm run validate`, `npm run test:unit`, `npm run test:local:*` liên quan; ghi kết quả thật.
