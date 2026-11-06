# Tasks: Cấu hình chế độ nấu của trường

**Input**: Design documents from `/specs/003-school-cooking-mode/`

**Prerequisites**: `spec.md`, `plan.md`

**Tests**: Bắt buộc vì tính năng thay đổi authorization, transaction và hợp đồng HTTP.

## Phase 1: Specification and contracts

- [ ] T001 Hoàn thiện yêu cầu, edge cases và success criteria trong `specs/003-school-cooking-mode/spec.md`.
- [ ] T002 Hoàn thiện thiết kế phân lớp, transaction và Constitution Check trong `specs/003-school-cooking-mode/plan.md`.

## Phase 2: Foundational authorization

- [ ] T003 [P] Thêm permission `school_cooking_mode.manage` và grant mặc định cho Ban Giám hiệu trong `src/constants/permission-catalog.ts`.
- [ ] T004 [P] Ghi hợp đồng endpoint/quyền và lưu ý không sửa hồi tố kế hoạch trong `src/modules/README.md`.

## Phase 3: User Story 1 - Xem chế độ nấu (Priority: P1)

**Goal**: Ban Giám hiệu có quyền đọc chế độ nấu của đúng trường trong phiên.

**Independent Test**: Gọi GET với BGH hợp lệ, thiếu quyền và sai role; xác nhận data/scope/status.

- [ ] T005 [US1] Thêm repository read projection cho `cookingMode` trong `src/modules/organization/organization.repository.ts`.
- [ ] T006 [US1] Thêm Response DTO và service authorization/mapping trong `src/modules/organization/organization.response.dto.ts` và `src/modules/organization/organization.service.ts`.
- [ ] T007 [US1] Thêm controller/route GET với permission middleware trong `src/modules/organization/organization.controller.ts` và `src/modules/organization/organization.routes.ts`.
- [ ] T008 [P] [US1] Thêm unit/HTTP tests cho read scope và role trong `tests/cooking-mode.test.ts`.

## Phase 4: User Story 2 - Cập nhật chế độ nấu (Priority: P1)

**Goal**: Ban Giám hiệu cập nhật một enum hợp lệ cho đúng trường, với quyền được kiểm tra lại trong transaction.

**Independent Test**: PATCH hai enum hợp lệ, payload sai/dư trường, thiếu quyền, sai role và kiểm tra kết quả persistence.

- [ ] T009 [P] [US2] Thêm strict Zod schema và Request DTO trong `src/modules/organization/organization.validation.ts` và `src/modules/organization/organization.request.dto.ts`.
- [ ] T010 [US2] Thêm repository update nhận transaction client trong `src/modules/organization/organization.repository.ts`.
- [ ] T011 [US2] Thêm service transaction/recheck role-scope và explicit response mapping trong `src/modules/organization/organization.service.ts`.
- [ ] T012 [US2] Thêm controller/route PATCH trong `src/modules/organization/organization.controller.ts` và `src/modules/organization/organization.routes.ts`.
- [ ] T013 [P] [US2] Thêm validation, route và service tests trong `tests/cooking-mode.test.ts` và `tests/organization.test.ts`.
- [ ] T014 [US2] Mở rộng authorization integration test cho từ chối nhân viên bếp và cập nhật thành công của BGH trong `tests/authorization.integration.test.ts`.

## Phase 5: Quality gates and handoff

- [ ] T015 Đăng ký `tests/cooking-mode.test.ts` trong `npm run test:unit` tại `package.json`.
- [ ] T016 Chạy format, lint, typecheck, build, unit tests và targeted tests; sửa mọi lỗi trong phạm vi PR.
- [ ] T017 Chạy Spec gate với branch/base/head ref thực tế và xác nhận PASS.
- [ ] T018 Kiểm tra GitHub CI gồm Code quality, PostgreSQL migrations, Spec gate và Backend quality; ghi kết quả thật trong PR.
- [ ] T019 Ghi rõ bước bootstrap permission sau merge trong mô tả PR, không tự seed hoặc ghi Azure từ nhánh feature.

## Dependencies & Execution Order

```text
T001-T002
   ├── T003-T004
   ├── US1: T005 → T006 → T007 → T008
   └── US2: T009 → T010 → T011 → T012 → T013-T014
                         ↓
                    T015-T019
```

- T003, T004 và T009 có thể thực hiện song song vì sửa file khác nhau.
- US1 và phần validation của US2 có thể phát triển độc lập sau khi chốt spec.
- T010-T012 phải giữ cùng transaction client và hoàn tất trước integration test T014.

## Requirement Coverage

| Requirement                    | Tasks            |
| ------------------------------ | ---------------- |
| FR-001, FR-004, FR-005, FR-009 | T005-T008        |
| FR-002, FR-003, FR-007, FR-008 | T009-T014        |
| FR-006                         | T003, T019       |
| FR-010, FR-011                 | T002, T004, T019 |
| FR-012                         | T008, T013-T018  |

## Completion Evidence

- Điền sau khi chạy local checks và GitHub CI.
