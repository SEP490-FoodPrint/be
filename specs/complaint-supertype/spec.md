# Feature Specification: Bảng cha khiếu nại và luồng ticket chung (PR1)

**Feature Branch**: `refactor/complaint-supertype`

**Created**: 2026-11-21

**Status**: Approved

**Input**: Kế hoạch thiết kế DB khiếu nại v5 (mô hình ticket, tham chiếu support ticket VOPS-13064) do chủ dự án duyệt. PR1 trong lộ trình PR1 → PR2 (C06) → PR3 (C02 gửi đơn) → PR4 (C05) → PR5/PR6 (sự cố) → PR-E (email).

## Bối cảnh

Hiện có hai luồng khiếu nại tách rời, mỗi luồng một bộ trạng thái riêng:

| Bản ghi                                            | Bảng                          | Trạng thái hiện tại                | Xử lý                                                                            |
| -------------------------------------------------- | ----------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| Khiếu nại suất ăn (C01 GVCN, C03 phụ huynh → BGH)  | `meal_complaints`             | `SUBMITTED → IN_REVIEW → RESOLVED` | BGH `PATCH` với `START_REVIEW`/`RESOLVE`, nội dung ghi đè trong cột `resolution` |
| Phản ánh chất lượng nguyên liệu (C02 trường → NCC) | `ingredient_quality_feedback` | `SUBMITTED → RESPONDED`            | NCC `POST …/response` đúng một lần                                               |

Người gửi không có cách phản hồi lại kết quả xử lý, không có trao đổi hai chiều, đơn không bao giờ đóng.

## Clarifications

### Session 2026-11-21 (chủ dự án chốt)

- Q25: Mọi đơn khiếu nại dùng chung luồng ticket: hai lớp trạng thái; bên xử lý chỉ "Tiếp nhận" (không "Từ chối"); bình luận hai chiều, không sửa/xóa, không có bình luận nội bộ; "Đã xử lý" bắt buộc kèm nội dung; trong 48h kể từ lần "Đã xử lý" gần nhất người gửi chọn "Hài lòng" (đóng ngay) hoặc "Yêu cầu xử lý lại" (không giới hạn số lần); không có nút "Không hài lòng"; lý do không bắt buộc; quá 48h hệ thống tự đóng; tiêu đề do hệ thống tự sinh.
- Q-c: Người gửi bình luận được khi đơn ở `NEW`, `IN_PROGRESS`, `REOPENED`; không bình luận khi `RESOLVED`/`CLOSED`.
- Q-d: Bên xử lý phải "Tiếp nhận" trước mới bình luận (chỉ ở `IN_PROGRESS`).
- Q14: Mã của đơn dùng chữ viết tắt theo loại: `MC` (suất ăn), `CP` (nguyên liệu); `AC`/`SC` đăng ký ở PR4/PR2.
- Q15: `complaints.code` là `NOT NULL`; migration có guard dừng nếu còn khiếu nại cũ.
- Q21: Đơn khiếu nại suất ăn mới không nhận loại `HEALTH_ISSUE` (vấn đề sức khỏe đi qua luồng báo cáo sự cố). Giá trị enum giữ trong DB.
- Q27: Chưa có dữ liệu khiếu nại thật. Migration không chuyển dữ liệu cũ; mở đầu bằng guard dừng nếu `meal_complaints` hoặc `ingredient_quality_feedback` còn dòng nào.
- Q28: Đổi thẳng contract API theo mô hình ticket (thay đổi phá vỡ, frontend cập nhật cùng đợt), không giữ lớp tương thích.

## Phạm vi

**Trong PR1**: bảng cha `complaints`, bảng con `meal_complaints` (C01, C03) và `ingredient_quality_feedback` (C02), bình luận, lịch sử trạng thái, máy trạng thái ticket, API ticket cho hai loại đơn hiện có, job tự đóng 48h.

**Ngoài PR1**: gửi đơn C02 qua HTTP (PR3 — PR1 chỉ giữ hàm tạo dùng chung), "Chuyển ATTP" và C05 (PR4), C06 (PR2), email cho người gửi (PR-E), miền sự cố (PR5/PR6). Giá trị `AUTHORITY`, `SYSTEM` của `complaint_kind` và `ESCALATED` của `complaint_close_reason` có trong enum nhưng chưa có luồng nào ghi.

### Thay thế spec cũ

- **Spec 019 (`019-meal-complaint-submission`)** và **Spec 012**: phần trạng thái `SUBMITTED/IN_REVIEW/RESOLVED/CLOSED`, `PATCH /api/meal-complaints/:id` (`START_REVIEW`, `RESOLVE`), trường `resolution`/`handler`/`resolvedAt` được thay bằng spec này. Luồng chọn suất ăn hôm nay (`/meal-options`, điều kiện `DISTRIBUTED`/`FINALIZED`) giữ nguyên, trừ việc bỏ `HEALTH_ISSUE` (Q21).
- **Spec `supplier-complaint-response`**: `POST /api/ingredient-quality-feedback/:feedbackId/response`, trạng thái `SUBMITTED/RESPONDED`, `supplierResponse`/`respondedBy` được thay bằng các thao tác ticket ở đây. Phạm vi xem, khóa thứ tự và kiểm tra lại actor trong transaction của NCC giữ nguyên.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Bên xử lý tiếp nhận, trao đổi và báo đã xử lý (Priority: P1)

BGH (với C01/C03) hoặc NCC của chuyến giao (với C02) tiếp nhận đơn mới, trao đổi với người gửi bằng bình luận rồi bấm "Đã xử lý" kèm nội dung.

**Independent Test**: Tạo đơn `NEW`, bên xử lý gọi Tiếp nhận → bình luận → Đã xử lý; đơn qua `IN_PROGRESS` rồi `RESOLVED`, nội dung xử lý là bình luận loại `RESOLUTION`.

**Acceptance Scenarios**:

1. **Given** đơn `NEW`, **When** bên xử lý bình luận, **Then** trả `409` (phải tiếp nhận trước).
2. **Given** đơn `NEW` hoặc `REOPENED`, **When** bên xử lý Tiếp nhận, **Then** đơn sang `IN_PROGRESS` và có một dòng lịch sử.
3. **Given** đơn `IN_PROGRESS`, **When** bên xử lý gửi "Đã xử lý" với nội dung rỗng, **Then** trả `400`; với nội dung hợp lệ thì đơn sang `RESOLVED`, `lastResolvedAt` = thời điểm này, `resolvedCount` tăng 1.
4. **Given** hai yêu cầu Tiếp nhận đồng thời, **Then** chỉ một yêu cầu thành công, yêu cầu còn lại nhận `409`.

### User Story 2 - Người gửi đánh giá trong 48h (Priority: P1)

Người gửi theo dõi đơn của mình, bình luận khi đơn chưa xử lý xong và sau khi bên xử lý báo "Đã xử lý" thì chọn "Hài lòng" hoặc "Yêu cầu xử lý lại" trong 48h.

**Acceptance Scenarios**:

1. **Given** đơn `RESOLVED` chưa quá 48h, **When** người gửi bấm Hài lòng, **Then** đơn `CLOSED` với `closeReason = SATISFIED`.
2. **Given** đơn `RESOLVED` chưa quá 48h, **When** người gửi bấm Yêu cầu xử lý lại (có hoặc không kèm lý do), **Then** đơn sang `REOPENED`; nếu có lý do thì lưu thành bình luận `REOPEN_NOTE`. Không giới hạn số lần.
3. **Given** đơn `RESOLVED` đã quá 48h (job chưa kịp chạy), **When** người gửi thao tác, **Then** trả `409`.
4. **Given** đơn `RESOLVED` hoặc `CLOSED`, **When** người gửi bình luận, **Then** trả `409`.
5. **Given** người dùng không phải người gửi, **When** gọi Hài lòng/Yêu cầu xử lý lại, **Then** trả `403`/`404` theo phạm vi.

### User Story 3 - Hệ thống tự đóng đơn quá hạn (Priority: P1)

**Acceptance Scenarios**:

1. **Given** đơn `RESOLVED` có `lastResolvedAt` cách đây ≥ 48h, **When** job chạy, **Then** đơn `CLOSED` với `closeReason = AUTO_CLOSED`, `closedByUserId = NULL`, lịch sử ghi `actorType = SYSTEM`.
2. **Given** người gửi vừa Yêu cầu xử lý lại trước khi job chạy, **Then** job bỏ qua đơn (cập nhật có điều kiện không khớp).
3. Job chạy lại nhiều lần hoặc nhiều tiến trình cùng lúc không đóng trùng và không ghi trùng lịch sử.

### User Story 4 - Hai lớp hiển thị trạng thái (Priority: P2)

Bên xử lý thấy `NEW / IN_PROGRESS / REOPENED / RESOLVED / CLOSED` và nhãn "Có tin nhắn mới" khi đơn `IN_PROGRESS` có bình luận mới nhất do người gửi viết. Người gửi chỉ thấy `IN_PROGRESS` (Đang xử lý), `RESOLVED` (Đã xử lý), `CLOSED` (Đã đóng).

### Edge Cases

- Người gửi đổi trường/tài khoản bị khóa: mọi thao tác ghi nạp lại actor trong transaction; không còn quyền hoặc phạm vi thì `403`.
- Bình luận chỉ gồm khoảng trắng: `400`.
- Khiếu nại suất ăn mới với `HEALTH_ISSUE`: `400`.
- Bộ lọc `status` trong danh sách nhận giá trị trạng thái DB mới.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST lưu mọi đơn khiếu nại trong bảng cha `complaints` với `kind` ∈ {`MEAL`, `INGREDIENT`, `AUTHORITY`, `SYSTEM`}; bảng con `meal_complaints` (`MEAL`) và `ingredient_quality_feedback` (`INGREDIENT`) dùng chung `id` và trỏ về cha bằng FK tổ hợp `(id, kind)`.
- **FR-002**: Mỗi đơn MUST có `code` duy nhất, `NOT NULL`, cấp một lần trong transaction tạo: `FP-MC-NNNNN` cho `MEAL`, `FP-CP-NNNNN` cho `INGREDIENT` (Feistel, bộ đếm `business_code_counters`). CHECK SQL buộc chữ viết tắt khớp `kind`; `CP` vẫn chấp nhận định dạng tuần tự cũ.
- **FR-003**: Tiêu đề MUST do hệ thống sinh: `MEAL` → `Khiếu nại suất ăn lớp <tên lớp> - <Bữa trưa|Bữa chiều> ngày <dd/MM/yyyy>`; `INGREDIENT` → `Phản ánh chất lượng nguyên liệu chuyến giao <số chuyến giao>`. Người gửi không nhập tiêu đề.
- **FR-004**: Trạng thái DB MUST thuộc `NEW | IN_PROGRESS | REOPENED | RESOLVED | CLOSED`; chỉ được chuyển theo bảng:

  | Thao tác                     | Ai        | Từ → Đến                              | Điều kiện                        |
  | ---------------------------- | --------- | ------------------------------------- | -------------------------------- |
  | Tạo đơn                      | Người gửi | — → `NEW`                             |                                  |
  | Tiếp nhận (`ACCEPT`)         | Bên xử lý | `NEW`/`REOPENED` → `IN_PROGRESS`      |                                  |
  | Bình luận (`COMMENT`)        | Người gửi | giữ nguyên                            | `NEW`, `IN_PROGRESS`, `REOPENED` |
  | Bình luận (`COMMENT`)        | Bên xử lý | giữ nguyên                            | `IN_PROGRESS`                    |
  | Đã xử lý (`RESOLVE`)         | Bên xử lý | `IN_PROGRESS` → `RESOLVED`            | Nội dung bắt buộc                |
  | Hài lòng (`SATISFY`)         | Người gửi | `RESOLVED` → `CLOSED` (`SATISFIED`)   | Trước `lastResolvedAt + 48h`     |
  | Yêu cầu xử lý lại (`REOPEN`) | Người gửi | `RESOLVED` → `REOPENED`               | Trước `lastResolvedAt + 48h`     |
  | Tự đóng                      | Hệ thống  | `RESOLVED` → `CLOSED` (`AUTO_CLOSED`) | Từ `lastResolvedAt + 48h`        |

- **FR-005**: Mọi chuyển trạng thái MUST là cập nhật có điều kiện trên trạng thái nguồn (và mốc 48h với thao tác của người gửi); không khớp ⇒ `409`. Mỗi chuyển trạng thái ghi một dòng `complaint_status_histories` trong cùng transaction.
- **FR-006**: Bình luận MUST lưu trong `complaint_comments` (append-only, không có API sửa/xóa, không có bình luận nội bộ) với `authorSide` (`REQUESTER`/`HANDLER`) và `commentType` (`MESSAGE`, `RESOLUTION`, `REOPEN_NOTE`; `ESCALATION_NOTE` dành cho PR4). Nội dung sau khi trim từ 1 đến 5000 ký tự.
- **FR-007**: "Đã xử lý" MUST lưu nội dung thành bình luận `RESOLUTION`, đặt `lastResolvedAt = now`, tăng `resolvedCount`. Lý do của "Yêu cầu xử lý lại" là tùy chọn; có thì lưu bình luận `REOPEN_NOTE`.
- **FR-008**: Job tự đóng MUST chạy cùng tiến trình API, mặc định 5 phút một lần, đóng theo lô các đơn `RESOLVED` có `lastResolvedAt <= now − 48h`; idempotent; không gửi thông báo.
- **FR-009**: Response MUST có `status` (DB), `displayStatus` theo lớp người xem (người gửi: `IN_PROGRESS`/`RESOLVED`/`CLOSED`), `hasNewMessage` (chỉ bên xử lý), `closeReason`, `lastResolvedAt`, `resolvedCount`, `feedbackDeadlineAt` (= `lastResolvedAt + 48h` khi `RESOLVED`), `allowedActions` ⊆ {`ACCEPT`, `COMMENT`, `RESOLVE`, `SATISFY`, `REOPEN`}; chi tiết có danh sách bình luận theo thời gian tăng dần.
- **FR-010**: Quyền giữ nguyên mã hiện có, không thêm mã mới:
  - `MEAL`: xem `meal_complaint.view` (phạm vi như cũ); bên xử lý là BGH có `meal_complaint.respond` cùng trường; người gửi (GVCN/phụ huynh) cần `meal_complaint.submit` và là `senderUserId`.
  - `INGREDIENT`: xem theo `ingredientQualityFeedbackReadScope` cũ; bên xử lý là admin/nhân viên NCC của chuyến giao có `view_details` + `respond`; người gửi là tài khoản trường có `ingredient_quality_feedback.submit` và là `senderUserId`.
  - Mọi thao tác ghi nạp lại actor và kiểm tra lại quyền/phạm vi trong transaction.
- **FR-011**: API MUST đổi như sau (thay đổi phá vỡ, Q28):
  - `/api/meal-complaints`: giữ `GET /`, `GET /meal-options`, `GET /:id`, `POST /`; bỏ `PATCH /:id`; thêm `POST /:id/accept`, `POST /:id/comments` (`{content}`), `POST /:id/resolve` (`{content}`), `POST /:id/satisfy`, `POST /:id/reopen` (`{reason?}`).
  - `/api/ingredient-quality-feedback` (kể cả mount lồng): giữ `GET /`, `GET /:feedbackId`; bỏ `POST /:feedbackId/response`; thêm `POST /:feedbackId/accept`, `/comments`, `/resolve`, `/satisfy`, `/reopen` cùng body như trên.
- **FR-012**: Tạo khiếu nại suất ăn MUST từ chối `complaintType = HEALTH_ISSUE` (Q21); lưu `meal_complaints.school_id` lấy từ lớp của suất ăn.
- **FR-013**: Migration MUST dừng (`RAISE EXCEPTION`) nếu `meal_complaints` hoặc `ingredient_quality_feedback` có dòng; không chuyển dữ liệu; gỡ enum `complaint_status`, `ingredient_quality_feedback_status` và sequence mã CP cũ.
- **FR-014**: `business-codes:backfill` chỉ còn backfill `IC` (khiếu nại không còn mã NULL).

### Key Entities

- **Complaint**: mã, loại, người gửi (snapshot vai trò và tổ chức), tiêu đề, mô tả, trạng thái ticket, mốc "Đã xử lý" gần nhất, số lần xử lý, lý do/thời điểm/người đóng.
- **MealComplaint**: suất ăn, trường nhận, loại khiếu nại.
- **IngredientQualityFeedback**: chuyến giao, lô (tùy chọn).
- **ComplaintComment**: tác giả, phía, loại, nội dung, thời điểm.
- **ComplaintStatusHistory**: trạng thái nguồn/đích, lý do đóng, actor (người dùng hoặc hệ thống).

## Success Criteria _(mandatory)_

- **SC-001**: Mọi chuyển trạng thái ngoài bảng FR-004 bị từ chối (`409`) và được kiểm thử.
- **SC-002**: Không có đơn `RESOLVED` nào quá 48h tồn tại sau một chu kỳ job.
- **SC-003**: `npm run validate`, `npm run test:unit` và các nhóm `test:local` liên quan qua.
- **SC-004**: CHECK DB chặn được trạng thái không nhất quán (đóng mà không có lý do, `RESOLVED` không có `lastResolvedAt`, mã sai loại).

## Assumptions

- Chưa có dữ liệu khiếu nại thật trên mọi môi trường (Q27); nếu guard dừng, dữ liệu phải được xử lý thủ công có ủy quyền.
- Frontend cập nhật cùng đợt với PR1 (Q28).
