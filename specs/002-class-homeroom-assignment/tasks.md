# Tasks: Phân công giáo viên chủ nhiệm

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Contract và dữ liệu

- [x] T001 Xác nhận bốn API và permission trong `docs/AUTHORIZATION.md` và `src/modules/README.md`
- [x] T002 Thêm model lịch sử phân công vào `prisma/schema.prisma`
- [x] T003 Thêm migration versioned cho phân công GVCN
- [x] T004 Thêm `class_assignment.manage` vào permission catalog

## Phase 2: API đọc dữ liệu

- [x] T005 [US1] Thêm helper niên khóa tại `src/modules/class/academic-year.ts`
- [x] T006 [US1] Thêm validation cho academic year và assignment payload
- [x] T007 [US1] Thêm API lấy niên khóa và giáo viên hợp lệ với school scope
- [x] T008 [US1] Mở rộng danh sách lớp để trả GVCN hiện tại

## Phase 3: API mutation

- [x] T009 [US2] Thêm API gán hoặc đổi GVCN trong transaction
- [x] T010 [US3] Thêm API gỡ GVCN bằng cách đóng bản ghi hiện tại
- [x] T011 [US2] [US3] Đăng ký route và permission middleware
- [x] T012 [US1] [US2] [US3] Tách Prisma query vào `class.repository.ts` và tách Request/Response DTO theo rule mới

## Phase 4: Verification

- [x] T013 Viết test eligibility, school isolation, assignment history và validation tại `tests/class-assignment.test.ts`
- [x] T014 Thêm test phân công vào `npm run test:unit`
- [x] T015 Chạy Prisma validate/generate, typecheck, build, lint và test phân công
- [ ] T016 Chạy spec gate cho branch `feat/002-class-homeroom-assignment`
