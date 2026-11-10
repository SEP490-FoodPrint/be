# Tasks: API và kiến trúc cho hai role

**Input**: spec/plan/research/data-model/contracts đã cập nhật phạm vi menu/kitchen/retained-sample.

## Setup

- [x] T001 Đọc quy tắc, audit27routes và bảo toàn7file xác nhận trong `specs/010-api-architecture-completion/research.md`.
- [x] T002 Thu hẹp spec/plan và hoàn tác thay đổi ngoài phạm vi tại `specs/010-api-architecture-completion/spec.md`.
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

- [ ] T012 Cập nhật mô tả chỉ3module tại `src/modules/README.md`, `specs/010-api-architecture-completion/contracts/api-audit.md`.
- [ ] T013 Chạy lint/format/typecheck/build/unit và ghi kết quả tại `specs/010-api-architecture-completion/plan.md`.
- [ ] T014 Chạy integration liên quan trên disposable local khi cần/sẵn sàng, ghi giới hạn thật tại `specs/010-api-architecture-completion/plan.md`.
- [ ] T015 Chạy spec gate/diff check/scope audit cuối và hoàn tất `specs/010-api-architecture-completion/tasks.md`.

## Review bổ sung — filter/search và chức năng không làm

- [x] T016 Đối chiếu query và handlers thực tế với MDv3.4, cập nhật FR012–FR016 tại `specs/010-api-architecture-completion/spec.md`.
- [x] T017 Thêm menu search title/tên món với cùng scope/list/count tại `src/modules/menu/menu.validation.ts`, `src/modules/menu/menu.repository.ts`.
- [x] T018 Chuẩn hóa kitchen query Zod, kiểm tra date range, đưa filter builder về repo và gỡ edit mẻ thừa tại `src/modules/kitchen/`.
- [x] T019 Hoàn thiện retained filter/count/mapper/expiry qua repo tại `src/modules/retained-sample/`.
- [x] T020 Thêm tests filter/pagination/scope và route loại bỏ tại `tests/kitchen-nutrition-lists.test.ts`, `tests/modules.test.ts`, đăng ký `package.json`.
- [x] T021 Gỡ in/xuất đúng hai role tại `../fe/src/pages/SCHOOL/MenuPlanning/MenuDetail/` và rà `../fe/src/pages/SCHOOL/KitchenCooking/`, giữ các màn khác.
- [x] T022 Kiểm tra BE/FE và ghi kết quả thực tại `specs/010-api-architecture-completion/plan.md`, cập nhật contract `contracts/api-audit.md`.

## Academic week numbering

- [x] T030 Add scoped academic-calendar API and replace menu ISO week numbering in `src/modules/menu/` without schema/migration changes.
- [x] T031 Use API year/week options, date keys and `Thực đơn tuần N` headings in FE MenuPlanning/MenuService; remove calendar mock dependency.
- [x] T032 Verify calendar boundaries, school scope, missing configuration, validation and FE contract/build; record results in plan.

## Dependencies and execution

## Performance review — 2026-11-10

- [x] T035 Verify Prisma lifetime, actual transaction concurrency and FE cache races without connecting to a remote database.
- [x] T036 Scope and bound kitchen read caches, isolate cancellation, and protect invalidation/refresh/session races in the existing service/storage helpers.
- [x] T037 Add regression coverage to existing FE tests, run checks/build, and record evidence and limits in plan.

## Real API integration

- [x] T033 Audit every mounted screen/API for the nutrition/kitchen roles and record verified behavior, missing integration and environment limits in `contracts/api-audit.md`.
- [x] T034 Fix proven contract defects (week-preserving edit, exact quantities, scoped context/cache, schedule hydration, finalized dish demand, sample null/filter/page, batch response mapping) and add repeatable frontend regression tests. Keep unfinished screen integrations and real DB verification in T024–T029 pending.

- [x] T023 Audit FE/BE/Prisma/transport và ghi FR017–FR024 tại `specs/010-api-architecture-completion/spec.md`.
- [ ] T024 Thêm school context/ingredient option contract và lot projection thật trong `src/modules/menu/`, `src/modules/kitchen/`.
- [ ] T025 Thêm sample filters/stats và hasSample query trong `src/modules/retained-sample/`, `src/modules/kitchen/`, cùng tests.
- [ ] T026 [P] Gỡ production mock, nối API thực và sửa full-week edit tại `../fe/src/pages/SCHOOL/MenuPlanning/`, `../fe/src/services/MenuService/`.
- [ ] T027 [P] Gỡ production mock và nối create/confirm/complete/sample/dispose/list/detail tại `../fe/src/pages/SCHOOL/KitchenCooking/`, `../fe/src/services/KitchenService/`.
- [ ] T028 Thêm FE transport/contract/empty/error regression tests và đăng ký scripts trong `../fe/tests/`, `../fe/package.json`.
- [ ] T029 Kiểm chứng DB mapping/persistence bằng API+PostgreSQL disposable, kiểm tra UI và ghi bằng chứng tại `specs/010-api-architecture-completion/plan.md`.

Setup hoàn tất trước source tiếp theo. T004→T005→T006; T007/T008 song song trên module khác nhau. Root giữ tests/modules, routes/index, package/docs; helper API kitchen ổn định để không sửa meal modules. T009–T015 sau tích hợp. Mọi task cũ ngoài3module bị hủy theo chỉ đạo người dùng, không để thành việc tồn đọng cần thực hiện.
