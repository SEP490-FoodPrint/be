# Tasks: API và kiến trúc cho hai role

**Input**: spec/plan/research/data-model/contracts đã cập nhật phạm vi menu/kitchen/retained-sample.

## Setup

- [x] T001 Đọc quy tắc, audit27routes và bảo toàn7file xác nhận trong `specs/009-api-architecture-completion/research.md`.
- [x] T002 Thu hẹp spec/plan và hoàn tác thay đổi ngoài phạm vi tại `specs/009-api-architecture-completion/spec.md`.
- [x] T003 Generate client theo schema dev hiện có, dùng shared Zod helpers nguyên trạng tại `src/utils/request-validation.ts`.

## US1 — Sổ lưu mẫu

**Independent test**: Hai alias với cùng filter trả cùng kết quả/count/scope và expiresAt đúng24h.

- [ ] T004 [US1] Thêm contract/validation tests tại `tests/retained-sample-contract.test.ts`.
- [ ] T005 [US1] Chuyển repo/DTO/Zod/mapper và bổ sung filter/count/expiresAt tại `src/modules/retained-sample/`.
- [ ] T006 [US1] Kiểm chứng alias tại `src/routes/index.ts`, `src/modules/retained-sample/retained-sample.routes.ts`.

## US2 — Giữ nghiệp vụ thực đơn/chế biến

**Independent test**: Routes và lifecycle/kho/menu/approval giữ hành vi.

- [ ] T007 [P] [US2] Chuyển kitchen thành repo/DTO/Zod, giữ helper/transaction/complete compatibility tại `src/modules/kitchen/`.
- [ ] T008 [P] [US2] Chuyển menu thành repo/DTO/Zod, giữ ingredient availability từ dev và response contract tại `src/modules/menu/`.
- [ ] T009 [US2] Kiểm chứng27routes/gỡPUT/weeklyapproval tại `tests/modules.test.ts`, `tests/menu-weekly-approval.test.ts`.

## US3 — Kiến trúc đúng trong phạm vi

**Independent test**: Guard AST áp dụng đúng3module và không có source diff module khác.

- [ ] T010 [US3] Thêm AST architecture/scope tests cho3module tại `tests/menu-kitchen-architecture.test.ts`, đăng ký test mới trong `package.json`.
- [ ] T011 [US3] Audit DTO consumers/query args/serialization/transaction trong `src/modules/menu/`, `src/modules/kitchen/`, `src/modules/retained-sample/`.

## Polish and verification

- [ ] T012 Cập nhật mô tả chỉ3module tại `src/modules/README.md`, `specs/009-api-architecture-completion/contracts/api-audit.md`.
- [ ] T013 Chạy lint/format/typecheck/build/unit và ghi kết quả tại `specs/009-api-architecture-completion/plan.md`.
- [ ] T014 Chạy integration liên quan trên disposable local khi cần/sẵn sàng, ghi giới hạn thật tại `specs/009-api-architecture-completion/plan.md`.
- [ ] T015 Chạy spec gate/diff check/scope audit cuối và hoàn tất `specs/009-api-architecture-completion/tasks.md`.

## Dependencies and execution

Setup hoàn tất trước source tiếp theo. T004→T005→T006; T007/T008 song song trên module khác nhau. Root giữ tests/modules, routes/index, package/docs; helper API kitchen ổn định để không sửa meal modules. T009–T015 sau tích hợp. Mọi task cũ ngoài3module bị hủy theo chỉ đạo người dùng, không để thành việc tồn đọng cần thực hiện.
