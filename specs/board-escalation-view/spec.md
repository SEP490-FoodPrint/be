# Feature Specification: Ban Giám hiệu không xem thông tin leo thang ATTP

**Feature Branch**: `fix/board-escalation-view`

**Created**: 2026-11-25

**Status**: Implemented

**Input**: Người dùng yêu cầu "loại bỏ tính năng xem thông tin leo thang của ban giám hiệu ở phần backend cũng như frontend".

## Bối cảnh

[specs/authority-complaints](../authority-complaints/spec.md) (User Story 3, FR-005) cho BGH xem chỉ đọc danh sách/chi tiết C05 của trường và C03 trả `escalatedAuthorityComplaint {id, code}` cho mọi người xem. Yêu cầu mới thay thế User Story 3: C05 chỉ giữa phụ huynh gửi và đơn vị ATTP nhận.

## Clarifications

### Session 2026-11-25

- BGH (`SCHOOL_MANAGEMENT_BOARD`) không còn grant `authority_complaint.view` trong catalog; phạm vi `authority-complaint` trả `403` cho BGH kể cả khi DB còn grant cũ (bootstrap giữ grant hiện có của vai trò không phải System Admin, nên chặn bằng code).
- C03 vẫn giữ trạng thái `CLOSED` và `closeReason = ESCALATED` cho BGH (đó là trạng thái của đơn C03), cùng bình luận `ESCALATION_NOTE` trong luồng trao đổi; chỉ bỏ liên kết tới hồ sơ C05.
- Không migration, không xóa dữ liệu grant trên DB đã triển khai; operator có thể gỡ grant cũ qua API quản trị quyền.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: `listScopes["authority-complaint"]` MUST trả `403` cho `SCHOOL_MANAGEMENT_BOARD`; `INITIAL_ROLE_PERMISSIONS` MUST bỏ cặp (`SCHOOL_MANAGEMENT_BOARD`, `authority_complaint.view`). Mọi endpoint `/api/authority-complaints` vì vậy trả `403` cho BGH.
- **FR-002**: `escalatedAuthorityComplaint` của C03 MUST là `null` khi người xem không phải người gửi C03.
- **FR-003**: `docs/AUTHORIZATION.md` và `src/modules/README.md` MUST ghi thay đổi. User Story 3 của `specs/authority-complaints` được thay bằng spec này.

## Success Criteria _(mandatory)_

- **SC-001**: `npm run validate`, `npm run test:unit` và `test:local:authorization` pass; test kiểm tra catalog, phạm vi `403` cho BGH và `escalatedAuthorityComplaint = null` với BGH.

## Phạm vi

- Trong phạm vi: `resource-access`, `permission-catalog`, service `feedback` và `authority-complaint`, test, tài liệu.
- Ngoài phạm vi: migration/DML, thay đổi luồng Chuyển ATTP của phụ huynh hoặc luồng xử lý của ATTP.
