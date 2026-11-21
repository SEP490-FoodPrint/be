# Feature Specification: Khiếu nại gửi System Admin theo luồng ticket (C06, PR2)

**Feature Branch**: `feat/system-complaint-management`

**Created**: 2026-11-17

**Updated**: 2026-11-21 — tiếp tục sau khi PR1 (`specs/complaint-supertype/`) đã merge; viết lại theo thiết kế DB v5 (`docs/complaint_db_design_plan_v3.md` §3.3 mục 4, §7 PR2) và mô hình ticket Q25

**Status**: Implemented

**Input**: User description: "là system admin tôi muốn xem được danh sách, xem chi tiết, phản hồi khiếu nại từ tất cả vai trò trong hệ thống" + plan v5: "Đăng ký chữ viết tắt C06 `SC`; tạo `system_complaints`; luồng gửi C06 cho mọi vai trò; System Admin xử lý theo luồng ticket chung".

## Bối cảnh

PR1 đã tạo bảng cha `complaints` (kind `MEAL | INGREDIENT | AUTHORITY | SYSTEM`, CHECK `complaints_code_kind` đã nhận `FP-SC-%` cho `SYSTEM`), bình luận hai chiều, lịch sử trạng thái, luồng ticket `NEW → IN_PROGRESS → RESOLVED → CLOSED` (+ `REOPENED`) và job tự đóng 48h áp dụng cho mọi kind. PR2 thêm loại đơn thứ ba: người dùng thuộc trường, nhà cung cấp hoặc đơn vị ATTP gửi khiếu nại trực tiếp tới System Admin; System Admin xử lý theo đúng luồng ticket chung.

## Clarifications

### Session 2026-11-17

- Q: System Admin xử lý nhóm khiếu nại nào? → A: Khiếu nại gửi trực tiếp tới System Admin; tách khỏi khiếu nại suất ăn gửi BGH và phản ánh nguyên liệu gửi NCC.
- Q: Các luồng liên quan? → A: Sáu luồng (GV → BGH; BGH → NCC; PH → BGH; BGH → ATTP; PH leo thang → ATTP; mọi vai trò → System Admin). Tính năng này chỉ là luồng cuối.

### Session 2026-11-21 (chủ dự án chốt khi tiếp tục)

- Q: Mô hình xử lý? → A: Theo Q25 (plan v5) — thay mô hình "phản hồi một lần" của bản nháp 2026-11-17 bằng luồng ticket chung của PR1 (Tiếp nhận, bình luận hai chiều, Đã xử lý kèm nội dung, Hài lòng / Yêu cầu xử lý lại trong 48h, tự đóng).
- Q: Mã nghiệp vụ? → A: `FP-SC-NNNNN` (Q14), Feistel qua `business_code_counters`, không dùng `FP-CP-` như bản nháp cũ.
- Q: Vai trò nào được gửi? → A: **Mọi vai trò trừ System Admin** (11 vai trò thuộc SCHOOL/SUPPLIER/AUTHORITY, kể cả `SCHOOL_ADMINISTRATION`): Q24 chỉ áp dụng cho luồng khiếu nại/sự cố nghiệp vụ ATTP–suất ăn, còn C06 là kênh hỗ trợ hệ thống. System Admin chỉ ở phía xử lý.
- Q: Tiêu đề? → A: Người gửi chọn **phân loại** (`ACCOUNT`, `PERMISSION`, `DATA`, `TECHNICAL`, `OTHER`); tiêu đề hệ thống tự sinh theo phân loại (giữ Q25). Bảng con `system_complaints` thêm cột `category`.
- Q: Độ dài mô tả? → A: 10–2000 ký tự sau khi bỏ khoảng trắng hai đầu (giống C01/C03).

## Phạm vi

- Trong phạm vi: bảng con `system_complaints`; đăng ký chữ viết tắt `SC`; quyền `system_complaint.submit|view|respond`; API `/api/system-complaints` (gửi, danh sách, chi tiết, tiếp nhận, bình luận, đã xử lý, hài lòng, yêu cầu xử lý lại).
- Ngoài phạm vi: email thông báo (PR-E), tệp đính kèm, phân công người xử lý, chuyển tiếp sang luồng khác, giao diện.

### Thay thế spec cũ

Bản nháp ngày 2026-11-17 của chính spec này (một câu trả lời chính thức, trạng thái chưa phản hồi/đã phản hồi, mã `FP-CP-`, tiến tới `FP-CP-100000`) được thay hoàn toàn bằng nội dung hiện tại.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Người dùng gửi khiếu nại tới System Admin (Priority: P1)

Là người dùng thuộc trường, nhà cung cấp hoặc đơn vị ATTP có quyền gửi, tôi muốn gửi một khiếu nại về tài khoản, phân quyền, dữ liệu hoặc lỗi hệ thống tới System Admin và theo dõi đơn của mình.

**Independent Test**: Gửi đơn từ một tài khoản trường, một tài khoản NCC và một tài khoản ATTP; đọc lại danh sách/chi tiết của chính mình.

**Acceptance Scenarios**:

1. **Given** tài khoản ACTIVE (không phải System Admin) có `system_complaint.submit`, **When** gửi `{category, description}` hợp lệ, **Then** đơn được tạo ở `NEW` với mã `FP-SC-NNNNN`, tiêu đề tự sinh theo phân loại, snapshot vai trò và tổ chức hiện tại của người gửi, một dòng lịch sử `→ NEW`; người gửi thấy trạng thái hiển thị "Đang xử lý".
2. **Given** body có trường lạ (`title`, `status`, `code`, `senderUserId`…), phân loại không hợp lệ, hoặc mô tả < 10 / > 2000 ký tự sau khi trim, **When** gửi, **Then** nhận 400 tiếng Việt chỉ rõ trường, không tạo đơn.
3. **Given** System Admin hoặc tài khoản thiếu quyền gửi, **When** gửi, **Then** 403.
4. **Given** người gửi, **When** xem danh sách/chi tiết, **Then** chỉ thấy đơn do chính mình gửi (kể cả sau khi đổi tổ chức/vai trò); đơn của người khác trả 404.

### User Story 2 - System Admin xem và xử lý theo luồng ticket (Priority: P1)

Là System Admin có quyền xem, tôi muốn xem mọi đơn C06 từ mọi tổ chức; nếu có thêm quyền xử lý, tôi muốn tiếp nhận, trao đổi và báo đã xử lý.

**Acceptance Scenarios**:

1. **Given** System Admin có `system_complaint.view`, **When** xem danh sách, **Then** thấy mọi đơn `kind = SYSTEM`, mới nhất trước, thứ tự phụ theo `id`; không thấy đơn MEAL/INGREDIENT/AUTHORITY; lọc được theo trạng thái, phân loại, khoảng ngày, tìm theo mã/mô tả/tên người gửi.
2. **Given** chi tiết đơn, **Then** thấy mô tả, người gửi, vai trò và tổ chức tại lúc gửi (hoặc `null` nếu không có), toàn bộ bình luận và trường ticket; định danh của đơn thuộc luồng khác trả 404 giống định danh không tồn tại.
3. **Given** System Admin có cả `system_complaint.view` và `system_complaint.respond`, **When** Tiếp nhận đơn `NEW`/`REOPENED`, **Then** đơn sang `IN_PROGRESS`; khi đó được bình luận và báo "Đã xử lý" kèm nội dung bắt buộc (lưu bình luận `RESOLUTION`, `last_resolved_at = now`, `resolved_count + 1`).
4. **Given** System Admin chỉ có quyền xem, **Then** đọc được nhưng `allowedActions = []` và mọi thao tác ghi trả 403.
5. **Given** hai System Admin cùng Tiếp nhận / cùng báo Đã xử lý một đơn, **Then** chỉ một yêu cầu thành công, yêu cầu kia 409, chỉ một dòng lịch sử được ghi.

### User Story 3 - Người gửi đánh giá trong 48h (Priority: P1)

Giống PR1: ở `RESOLVED` và trong 48h kể từ `last_resolved_at`, người gửi chọn Hài lòng (đóng `SATISFIED`) hoặc Yêu cầu xử lý lại (về `REOPENED`, lý do tùy chọn lưu `REOPEN_NOTE`). Quá 48h: thao tác trả 409; job tự đóng của PR1 đóng `AUTO_CLOSED`.

### Edge Cases

- Người gửi bị khóa/đổi vai trò/đổi tổ chức sau khi gửi: đơn giữ snapshot lúc gửi; System Admin vẫn xử lý; người gửi chỉ thao tác được khi tài khoản còn ACTIVE và còn quyền gửi.
- Tổ chức của người gửi không còn hoạt động: không chặn việc gửi (C06 là kênh hỗ trợ), chỉ yêu cầu tài khoản ACTIVE và quyền hiệu lực.
- Tài khoản thuộc tổ chức nhưng principal thiếu định danh tổ chức tương ứng: 403, không tự gán tổ chức.
- Hết dải 100.000 mã `SC`: lỗi rõ ràng, không quay vòng (cơ chế dùng chung `allocateBusinessCode`).
- Chuyển ATTP (`ESCALATED`) không áp dụng cho C06 (CHECK `complaints_escalated_kind` đã chặn ở DB).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Thêm bảng con `system_complaints(id, kind DEFAULT 'SYSTEM' CHECK = 'SYSTEM', category)` với `PRIMARY KEY (id)`, `UNIQUE (id, kind)` và `FOREIGN KEY (id, kind) → complaints(id, kind)`; enum mới `system_complaint_category` = `ACCOUNT | PERMISSION | DATA | TECHNICAL | OTHER`. Không sửa bảng cha, bảng bình luận, lịch sử hay dữ liệu hiện có; không function/trigger.
- **FR-002**: Đăng ký chữ viết tắt `SC` ("khiếu nại gửi hệ thống") trong `src/utils/business-code.ts`; mã cấp trong transaction tạo đơn qua `allocateBusinessCode`.
- **FR-003**: Thêm quyền `system_complaint.submit` (gán mặc định cho 11 vai trò không phải System Admin), `system_complaint.view` và `system_complaint.respond` (gán mặc định cho `SYSTEM_ADMIN`) vào catalog bootstrap. Không có ngoại lệ System Admin ngầm định.
- **FR-004**: Gửi đơn (`POST /api/system-complaints`) yêu cầu `system_complaint.submit`, vai trò khác `SYSTEM_ADMIN`, tổ chức khác `SYSTEM` và principal có định danh tổ chức tương ứng; trong transaction nạp lại actor, kiểm tra lại quyền và tổ chức không đổi. Body `z.strictObject({category, description})`; mô tả 10–2000 ký tự sau trim. Tiêu đề tự sinh theo phân loại. Snapshot `sender_role_code` và đúng một trong `sender_school_id`/`sender_supplier_id`/`sender_commune_food_safety_unit_id` theo tổ chức của actor.
- **FR-005**: Phạm vi đọc: System Admin (`orgType SYSTEM`, role `SYSTEM_ADMIN`, có `system_complaint.view`) → `{kind: 'SYSTEM'}`; người dùng khác có `system_complaint.submit` → `{kind: 'SYSTEM', senderUserId: principal.id}`; còn lại 403. Phạm vi áp dụng trong `where` của repository; luôn lọc `kind = 'SYSTEM'`.
- **FR-006**: Danh sách phân trang (mặc định 20, tối đa 100), `submittedAt desc, id desc`, lọc `status`, `category`, `from`/`to` (YYYY-MM-DD), `search` (mã, mô tả, tên người gửi). Mỗi mục: `id`, `code`, `title`, `category`, `description`, `submittedAt`, `updatedAt`, `sender {id, fullName}`, `senderRole {code, name}`, `senderOrganization {type, id, name} | null`, các trường ticket chung của PR1. Chi tiết thêm `comments`.
- **FR-007**: Bên xử lý: System Admin còn ACTIVE có đồng thời `system_complaint.view` và `system_complaint.respond`, kiểm tra lại trong transaction. Tiếp nhận (`/accept`), bình luận (`/comments`, chỉ ở `IN_PROGRESS`), Đã xử lý (`/resolve`, bắt buộc `content`) theo `complaint-ticket.lifecycle`.
- **FR-008**: Người gửi: chỉ chính người gửi, còn ACTIVE và có `system_complaint.submit`; bình luận ở `NEW`/`IN_PROGRESS`/`REOPENED`; Hài lòng (`/satisfy`) / Yêu cầu xử lý lại (`/reopen`, `reason` tùy chọn) trong 48h.
- **FR-009**: Mọi chuyển trạng thái dùng cập nhật có điều kiện của `complaintTicketRepository.transition` với `kind: 'SYSTEM'`; 0 dòng ⇒ 409; lịch sử ghi trong cùng transaction. Hiển thị hai lớp trạng thái và nhãn "Có tin nhắn mới" như PR1.
- **FR-010**: Lỗi tiếng Việt: 401 chưa đăng nhập, 403 thiếu quyền/sai vai trò, 400 dữ liệu sai, 404 không tìm thấy trong luồng/phạm vi, 409 xung đột trạng thái, 503 sự cố. Không lộ dữ liệu nội bộ.
- **FR-011**: Không ảnh hưởng luồng MEAL/INGREDIENT: không đổi API, quyền hay phạm vi của `feedback` và `ingredient-quality-feedback`.

### Key Entities

- **SystemComplaint** (`system_complaints`): bảng con kind `SYSTEM`, giữ `category`; mọi thuộc tính chung ở `complaints`.
- **Complaint / ComplaintComment / ComplaintStatusHistory**: dùng lại từ PR1.

## Success Criteria _(mandatory)_

- **SC-001**: Bộ test tích hợp: người gửi thuộc trường, NCC và ATTP tạo được đơn `FP-SC-`; System Admin thấy 100% đơn SYSTEM và 0 đơn MEAL/INGREDIENT; người gửi chỉ thấy đơn của mình.
- **SC-002**: 100% thao tác trái phép trong bộ test (System Admin gửi đơn, người gửi tiếp nhận, admin chỉ có quyền xem thao tác ghi, đơn của người khác) bị chặn.
- **SC-003**: Hai thao tác đồng thời trên cùng đơn chỉ một thành công, một dòng lịch sử.
- **SC-004**: Migration mới qua `test:migrations` (kể cả parity `migrate diff`) và CHECK/FK bảng con chặn sai kind.

## Assumptions

- Quyền mới chỉ tự gán khi bootstrap trên DB mới; trên DB đã có vai trò, bootstrap chỉ thêm cho `SYSTEM_ADMIN`, việc gán `system_complaint.submit` cho các vai trò khác do System Admin thực hiện qua API quản trị quyền (thao tác vận hành, ngoài PR).
- Email cho người gửi làm ở PR-E.
