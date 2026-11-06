# Tasks: Phân công giáo viên chủ nhiệm

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Contract và dữ liệu

- [ ] T001 Xác nhận bốn API và permission trong `docs/AUTHORIZATION.md` và `src/modules/README.md`
- [ ] T002 Thêm model lịch sử phân công vào `prisma/schema.prisma`
- [ ] T003 Thêm migration versioned cho phân công GVCN
- [ ] T004 Thêm `class_assignment.manage` vào permission catalog

## Phase 2: API đọc dữ liệu

- [ ] T005 [US1] Thêm helper niên khóa tại `src/modules/class/academic-year.ts`
- [ ] T006 [US1] Thêm validation cho academic year và assignment payload
- [ ] T007 [US1] Thêm API lấy niên khóa và giáo viên hợp lệ với school scope
- [ ] T008 [US1] Mở rộng danh sách lớp để trả GVCN hiện tại

## Phase 3: API mutation

- [ ] T009 [US2] Thêm API gán hoặc đổi GVCN trong transaction
- [ ] T010 [US3] Thêm API gỡ GVCN bằng cách đóng bản ghi hiện tại
- [ ] T011 [US2] [US3] Đăng ký route và permission middleware

## Phase 4: Verification

- [ ] T012 Viết test eligibility, school isolation, assignment history và validation tại `tests/class-assignment.test.ts`
- [ ] T013 Thêm test phân công vào `npm run test:unit`
- [ ] T014 Chạy Prisma validate/generate, typecheck, build, lint và test phân công
- [ ] T015 Chạy spec gate cho branch `feat/002-class-homeroom-assignment`
