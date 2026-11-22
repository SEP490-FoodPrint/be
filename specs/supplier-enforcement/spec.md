# Feature Specification: Chế tài NCC theo sự cố ATTP (PR6b)

**Feature Branch**: `feat/supplier-enforcement`

**Created**: 2026-11-22

**Status**: Implemented

**Input**: Kế hoạch thiết kế DB khiếu nại & sự cố v5 (`docs/complaint_db_design_plan_v3.md` §1 Q5/Q13, D9/D11, §5.2 mục 4, §7 PR6) và `docs/complaint_state_diagrams.md` ("Yêu cầu chế tài"): "`supplier_enforcement_actions` + `supplier_restrictions` + `supplier_restriction_locked_accounts`; mở rộng `account-lifecycle` cho `LOCKED`/unlock có lịch sử, thu hồi session, bảo vệ đa sự cố".

## Bối cảnh

PR6a (`specs/food-safety-inspections`) cho ATTP lập đợt kiểm tra, ghi kết luận theo NCC (`AT_FAULT|CLEARED|INCONCLUSIVE`) và đóng hồ sơ. Chưa có cách tác động lên NCC có lỗi: tạm dừng tiếp nhận đơn, khóa tài khoản, và gỡ các hạn chế đó khi sự cố được giải quyết. Q5: ATTP đề nghị, System Admin duyệt và thực thi; đóng hồ sơ không tự gỡ hạn chế; `RESTORE` không vượt qua hạn chế còn hiệu lực khác. Q13: `LOCK_ACCOUNT` = `AccountStatus.LOCKED` (tạm, mở lại được), tách biệt với `DEACTIVATED`.

## Clarifications

### Session 2026-11-22

- Tài khoản NCC tạo mới/kích hoạt khi NCC đang có hạn chế `ACCOUNT_LOCKED` hiệu lực? → A (cách 1): từ chối `409`. Áp dụng cho tạo nhân viên NCC (`POST /api/supplier-staff`) và mở khóa nhân viên (`PATCH …/status` → `ACTIVE`). Tương tự, System Admin đặt `intakeState = ACTIVE` cho NCC (`PATCH /api/users/:userId/intake-state`) khi NCC còn bất kỳ hạn chế nào hiệu lực → `409`.
- PostgreSQL Azure là 18.6 → dùng thẳng `UNIQUE NULLS NOT DISTINCT` cho `supplier_restrictions` (không cần index trên `COALESCE`).
- Quyết định mặc định (không đổi nghiệp vụ đã chốt):
  - Mã quyền mới: `supplier_enforcement.request` (`COMMUNE_FOOD_SAFETY_OFFICER`: đề nghị, xem yêu cầu thuộc hồ sơ đơn vị mình nhận) và `supplier_enforcement.decide` (`SYSTEM_ADMIN`: xem mọi yêu cầu, duyệt, từ chối, chạy lại thu hồi phiên).
  - Đề nghị (`POST /api/food-safety-incidents/:id/enforcement-actions`): `{supplierId, actionType, reason (10–2000), evidenceInspectionId?}`; cán bộ ATTP thuộc đơn vị đang nhận hồ sơ (hồ sơ khác → 404).
    - `PAUSE_INTAKE`, `LOCK_ACCOUNT`: hồ sơ ở `AUTHORITY_ACKNOWLEDGED`, `UNDER_INSPECTION` hoặc `INSPECTION_COMPLETED` (khác → 409); NCC phải thuộc danh sách NCC của hồ sơ như PR6a (NCC trong snapshot truy xuất, fallback quan hệ cung cấp khác `UNLINKED`) hoặc đã có kết luận trong một đợt của hồ sơ (khác → 400 `supplierId`). Đã có hạn chế cùng loại đang hiệu lực của NCC cho hồ sơ này → 409.
    - `LOCK_ACCOUNT` bắt buộc `evidenceInspectionId`: đợt thuộc hồ sơ, `COMPLETED`, có kết luận `AT_FAULT` cho đúng NCC (khác → 409).
    - `RESTORE`: mọi trạng thái hồ sơ (kể cả `CLOSED`); phải còn ít nhất một hạn chế đang hiệu lực của NCC gắn với hồ sơ (khác → 409).
    - `evidenceInspectionId` (nếu có) phải thuộc hồ sơ (khác → 400).
    - Tối đa một yêu cầu `PENDING` mỗi `(hồ sơ, NCC, loại)` → trùng 409.
  - Duyệt (`POST /api/supplier-enforcement-actions/:actionId/approve {note?}`) và từ chối (`…/reject {note}` bắt buộc): chỉ System Admin, chỉ yêu cầu `PENDING` (khác → 409). Duyệt = thực thi ngay trong cùng transaction `Serializable`, khóa dòng `Supplier` `FOR UPDATE` trước rồi khóa dòng yêu cầu; kiểm tra lại điều kiện lúc duyệt (căn cứ `LOCK_ACCOUNT`, hạn chế trùng, còn hạn chế để gỡ) → không thỏa 409 (System Admin từ chối yêu cầu).
    - `PAUSE_INTAKE`: tạo hạn chế `PAUSE_INTAKE`; `Supplier.intakeState = PAUSED_FOR_FOOD_SAFETY_INSPECTION`.
    - `LOCK_ACCOUNT`: tạo hạn chế `ACCOUNT_LOCKED`; tạm dừng tiếp nhận như trên; mọi tài khoản `ACTIVE` của NCC (admin + nhân viên) → `LOCKED`, ghi `supplier_restriction_locked_accounts` (`previous_status = ACTIVE`) và `account_status_histories`. Tài khoản đang `LOCKED`/`DEACTIVATED`/`INACTIVE`/`UNVERIFIED` giữ nguyên, không ghi. Sau commit thu hồi toàn bộ phiên Redis của các tài khoản vừa khóa; lỗi thu hồi → `execution_status = FAILED` + `execution_note`, System Admin chạy lại `POST …/:actionId/retry` (chỉ `LOCK_ACCOUNT` `FAILED`) → `APPLIED`. `authenticate` vẫn chặn vì `loadPrincipal` đọc trạng thái tài khoản từ DB mỗi request.
    - `RESTORE` (chống xung đột đa sự cố, §5.2 mục 4): gỡ (`is_active = false`, `lifted_at`, `lifted_by_action_id`) mọi hạn chế đang hiệu lực của NCC thuộc hồ sơ; nếu NCC không còn hạn chế nào hiệu lực (sự cố khác hoặc thủ công) → `intakeState = ACTIVE` (chỉ khi đang `PAUSED_FOR_FOOD_SAFETY_INSPECTION`). Với hạn chế `ACCOUNT_LOCKED` vừa gỡ: đóng liên kết (`unlocked_at`); tài khoản trong liên kết hiện vẫn `LOCKED` → nếu NCC không còn hạn chế `ACCOUNT_LOCKED` khác hiệu lực thì mở về `ACTIVE` + lịch sử, ngược lại giữ `LOCKED` và chuyển liên kết sang hạn chế `ACCOUNT_LOCKED` còn hiệu lực sớm nhất (để lần gỡ sau mở đúng tài khoản). Tài khoản không còn `LOCKED` (ví dụ đã `DEACTIVATED`) giữ nguyên.
    - Mọi lần duyệt ghi `execution_status = APPLIED`, `executed_at`; `execution_note` nêu rõ phần "được duyệt nhưng chưa gỡ thực tế vì còn hạn chế khác".
  - Xem: `GET /api/supplier-enforcement-actions?page&limit&incidentId&supplierId&actionType&decisionStatus&executionStatus` (System Admin: mọi yêu cầu; cán bộ ATTP: yêu cầu thuộc hồ sơ đơn vị đang nhận) và `GET /api/supplier-enforcement-actions/:actionId` (thêm `activeRestrictions` của NCC cho System Admin).
  - Không có mã nghiệp vụ `FP-XX` cho yêu cầu chế tài: đây là bản ghi con của hồ sơ sự cố (hiển thị kèm mã `FP-IC` của hồ sơ), giống đợt kiểm tra PR6a.

## Phạm vi

- Trong phạm vi: migration (`supplier_enforcement_actions`, `supplier_restrictions`, `supplier_restriction_locked_accounts`, `account_status_histories`, enum); quyền `supplier_enforcement.request`/`.decide`; module `supplier-enforcement` (đề nghị, danh sách, chi tiết, duyệt/thực thi, từ chối, chạy lại thu hồi phiên); chặn tạo/mở khóa tài khoản NCC và mở lại tiếp nhận khi còn hạn chế.
- Ngoài phạm vi: tạo/gỡ hạn chế thủ công không gắn sự cố (bảng hỗ trợ `incident_id IS NULL`, chưa có API); email thông báo (PR-E); giao diện; neo blockchain.

### Thay thế spec cũ

- `specs/food-safety-inspections`: kết luận `AT_FAULT` của đợt `COMPLETED` là căn cứ bắt buộc của `LOCK_ACCOUNT`.
- Luồng quản lý nhân viên NCC (`supplier-staff`) và `account-lifecycle` `PATCH …/intake-state`: thêm điều kiện 409 nêu ở Clarifications.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - ATTP đề nghị chế tài (Priority: P1)

**Acceptance Scenarios**:

1. **Given** hồ sơ `UNDER_INSPECTION` có NCC trong snapshot, **When** cán bộ đơn vị nhận đề nghị `PAUSE_INTAKE`, **Then** yêu cầu `PENDING`/`NOT_APPLIED`; đề nghị trùng → 409.
2. **Given** đợt `COMPLETED` có NCC `AT_FAULT`, **When** đề nghị `LOCK_ACCOUNT` kèm đợt đó, **Then** `PENDING`; thiếu căn cứ hoặc NCC `CLEARED` → 409/400.
3. Cán bộ đơn vị khác → 404; vai trò khác → 403.

### User Story 2 - System Admin duyệt/từ chối (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `PAUSE_INTAKE` `PENDING`, **When** duyệt, **Then** hạn chế hiệu lực, NCC `PAUSED_FOR_FOOD_SAFETY_INSPECTION`, yêu cầu `APPROVED`/`APPLIED`; duyệt lại → 409.
2. **Given** `LOCK_ACCOUNT` `PENDING`, **When** duyệt, **Then** tài khoản `ACTIVE` của NCC → `LOCKED`, phiên bị thu hồi (request tiếp theo 401/403), có lịch sử; tài khoản đã `LOCKED` trước đó không bị ghi liên kết.
3. **When** từ chối không ghi chú → 400; có ghi chú → `REJECTED`/`NOT_APPLIED`.

### User Story 3 - Gỡ hạn chế không vượt sự cố khác (Priority: P1)

**Acceptance Scenarios**:

1. **Given** NCC bị khóa bởi hồ sơ A và hồ sơ B, **When** duyệt `RESTORE` của A, **Then** hạn chế của A gỡ, tài khoản vẫn `LOCKED`, tiếp nhận vẫn tạm dừng, `execution_note` nêu lý do; duyệt `RESTORE` của B → tài khoản `ACTIVE`, tiếp nhận `ACTIVE`.
2. Tài khoản bị quản trị NCC khóa trước sự cố không được mở bởi `RESTORE`.

### User Story 4 - Chặn tài khoản mới khi NCC đang bị khóa (Priority: P1)

**Acceptance Scenarios**:

1. **Given** NCC có `ACCOUNT_LOCKED` hiệu lực, **When** tạo nhân viên hoặc mở khóa nhân viên, **Then** 409.
2. **Given** NCC có hạn chế hiệu lực, **When** System Admin đặt `intakeState = ACTIVE`, **Then** 409.

### Edge Cases

- Hai lượt duyệt đồng thời cùng một yêu cầu: một thành công, một 409.
- `RESTORE` khi hạn chế đã được gỡ bởi yêu cầu khác: 409 lúc duyệt.
- Đóng hồ sơ (`CLOSED`) không gỡ hạn chế; vẫn đề nghị `RESTORE` được.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Migration MUST tạo enum `supplier_enforcement_action_type` (`PAUSE_INTAKE`, `LOCK_ACCOUNT`, `RESTORE`), `supplier_enforcement_decision_status` (`PENDING`, `APPROVED`, `REJECTED`), `supplier_enforcement_execution_status` (`NOT_APPLIED`, `APPLIED`, `FAILED`), `supplier_restriction_type` (`PAUSE_INTAKE`, `ACCOUNT_LOCKED`).
- **FR-002**: Migration MUST tạo `supplier_enforcement_actions` với FK tổ hợp `(incident_id, evidence_inspection_id) → food_safety_inspections(incident_id, id)`, CHECK `LOCK_ACCOUNT ⇒ evidence_inspection_id NOT NULL`, lý do không rỗng, cặp quyết định (`PENDING` ⇔ chưa có người/thời điểm quyết định), `REJECTED` cần ghi chú, `NOT_APPLIED` ⇔ chưa `APPROVED` ⇔ `executed_at IS NULL`, `FAILED` cần `execution_note`; partial unique một `PENDING` mỗi `(incident_id, supplier_id, action_type)`.
- **FR-003**: Migration MUST tạo `supplier_restrictions` với CHECK `incident_id IS NULL OR source_action_id IS NOT NULL`, `is_active = (lifted_at IS NULL)`; FK tổ hợp tới yêu cầu cùng NCC/hồ sơ; `UNIQUE NULLS NOT DISTINCT (supplier_id, incident_id, restriction_type) WHERE is_active`.
- **FR-004**: Migration MUST tạo `supplier_restriction_locked_accounts` (PK `(restriction_id, user_id)`, `previous_status`, `locked_at`, `unlocked_at`) và `account_status_histories` (append-only, `from_status <> to_status`, lý do không rỗng).
- **FR-005**: Đề nghị, duyệt, từ chối, chạy lại MUST theo Clarifications, trong transaction phân quyền có nạp lại actor; chuyển trạng thái có điều kiện, thua đồng thời → 409.
- **FR-006**: Thu hồi phiên Redis MUST chạy sau commit; lỗi → `FAILED` + chạy lại được.
- **FR-007**: Tạo/mở khóa tài khoản NCC và mở lại tiếp nhận MUST bị chặn 409 theo Clarifications.
- **FR-008**: Catalog MUST thêm `supplier_enforcement.request` (grant `COMMUNE_FOOD_SAFETY_OFFICER`) và `supplier_enforcement.decide` (grant `SYSTEM_ADMIN`); resource `supplier-enforcement`.

### Key Entities

- **SupplierEnforcementAction**: yêu cầu chế tài của ATTP, quyết định và kết quả thực thi.
- **SupplierRestriction**: hạn chế đang/đã hiệu lực trên NCC theo từng sự cố.
- **SupplierRestrictionLockedAccount**: tài khoản bị khóa bởi đúng hạn chế nào.
- **AccountStatusHistory**: lịch sử khóa/mở tài khoản.

## Success Criteria _(mandatory)_

- **SC-001**: Trên DB kiểm thử, luồng HTTP đề nghị → duyệt `PAUSE_INTAKE`/`LOCK_ACCOUNT` của hai hồ sơ → `RESTORE` lần lượt chạy đúng như US3; tài khoản bị khóa không gọi được API.
- **SC-002**: CHECK/unique chặn dữ liệu sai (thiếu căn cứ, hai hạn chế cùng loại, quyết định không nhất quán).
- **SC-003**: `npm run validate`, `test:unit`, `test:local:*` liên quan pass.

## Assumptions

- Trên azure-dev sau khi merge: operator chạy `auth:bootstrap -- --azure` để tạo hai quyền mới (bootstrap cấp `SYSTEM_ADMIN`), rồi cấp `supplier_enforcement.request` cho `COMMUNE_FOOD_SAFETY_OFFICER` qua API quản trị quyền.
