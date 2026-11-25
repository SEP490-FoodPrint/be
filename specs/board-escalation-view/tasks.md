# Tasks: Ban Giám hiệu không xem thông tin leo thang ATTP

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Code

- [x] T001 Chặn BGH ở `listScopes["authority-complaint"]`, bỏ grant trong catalog (FR-001).
- [x] T002 Đơn giản bộ lọc trạng thái C05 cho vai trò trường (FR-001).
- [x] T003 Ẩn `escalatedAuthorityComplaint` với người xem không phải người gửi C03 (FR-002).

## Phase 2: Tài liệu & kiểm thử

- [x] T004 `tests/authority-complaint.test.ts`, `tests/authorization.integration.test.ts` (SC-001).
- [x] T005 `docs/AUTHORIZATION.md`, `src/modules/README.md` (FR-003).
- [x] T006 `npm run validate`, `npm run test:unit`, `test:local:authorization`, spec gate.
