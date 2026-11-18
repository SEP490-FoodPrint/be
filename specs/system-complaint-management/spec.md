# Feature Specification: System Complaint Management (C06)

**Feature Slug**: `system-complaint-management`  
**Target Branch**: `feat/system-complaint-management`  
**Created**: 2026-11-18  
**Status**: Ready for Implementation

---

## 1. Executive Summary

Tính năng Quản lý Khiếu nại Kỹ thuật Hệ thống (C06) cho phép tất cả người dùng trong hệ thống FoodPrint (Ban giám hiệu, Nhân viên bếp, Giáo viên, Y tế, Nhà cung cấp, Cán bộ ATTP, Quản trị viên) gửi báo cáo lỗi kỹ thuật, sự cố vận hành hoặc góp ý cải tiến phần mềm đến Quản trị viên Hệ thống (System Admin). Toàn bộ dữ liệu được lưu trữ theo mô hình Class-Table Inheritance thông qua bảng cha `complaints` (`kind = 'SYSTEM'`) và bảng con `system_complaints`, dùng chung dãy mã thống nhất `FP-CP-xxxxx` và cơ chế phiên bản phản hồi (`complaint_response_versions`).

---

## 2. User Stories & Acceptance Criteria

### US1: Người dùng gửi khiếu nại / báo lỗi kỹ thuật hệ thống (C06)

- **Actor**: Bất kỳ người dùng đã xác thực (mọi role: BGH, Bếp, NCC, GV, ATTP, System Admin).
- **Mục tiêu**: Báo cáo lỗi màn hình, lỗi API, lỗi dữ liệu hoặc phản ánh đề xuất cải tiến kỹ thuật.
- **Yêu cầu (AC)**:
  - **AC 1.1**: Người dùng gửi payload gồm `title` (string 5-255 ký tự) và `description` (string 10-5000 ký tự).
  - **AC 1.2**: Hệ thống cấp mã khiếu nại tự động theo định dạng `FP-CP-xxxxx` từ sequence dùng chung `foodprint.complaint_code_seq`.
  - **AC 1.3**: Bản ghi cha `complaints` được tạo với `kind = 'SYSTEM'`, `status = 'SUBMITTED'`, snapshot thông tin tổ chức người gửi (`sender_school_id`, `sender_supplier_id`, `sender_commune_food_safety_unit_id` tùy thuộc người gửi).
  - **AC 1.4**: Bản ghi con `system_complaints` được tạo đồng thời trong cùng transaction `Serializable`.
  - **AC 1.5**: Ghi nhận một bản ghi khởi tạo trạng thái trong `complaint_status_histories` (`from_status = NULL`, `to_status = 'SUBMITTED'`).
  - **AC 1.6**: Trả về HTTP 201 kèm DTO đầy đủ thông tin khiếu nại vừa tạo.

### US2: Người dùng xem danh sách và chi tiết khiếu nại của chính mình

- **Actor**: Người gửi khiếu nại (bất kỳ role).
- **Yêu cầu (AC)**:
  - **AC 2.1**: API `GET /api/system-complaints/my` trả về danh sách phân trang các khiếu nại hệ thống do chính user gửi (`sender_user_id = auth.id`), sắp xếp `createdAt DESC`.
  - **AC 2.2**: API `GET /api/system-complaints/:id` cho phép người gửi xem chi tiết khiếu nại của mình gồm mã, tiêu đề, mô tả, trạng thái và nội dung phản hồi chính thức mới nhất (nếu đã được phản hồi).
  - **AC 2.3**: Nếu user truy cập khiếu nại của người khác mà không có quyền quản trị hệ thống, hệ thống trả về HTTP 404 (Fail-closed isolation).

### US3: Quản trị viên hệ thống (System Admin) quản lý và phản hồi khiếu nại

- **Actor**: `SYSTEM_ADMIN` (sở hữu quyền xem và phản hồi hệ thống).
- **Yêu cầu (AC)**:
  - **AC 3.1**: API `GET /api/system-complaints` cho phép xem toàn bộ khiếu nại hệ thống với các bộ lọc `status`, tìm kiếm theo `q` (mã hoặc tiêu đề), phân trang `page`, `limit`.
  - **AC 3.2**: Phản hồi lần đầu: `POST /api/system-complaints/:id/responses` nhận `content` (string 10-5000 ký tự).
    - Tạo `ComplaintResponseVersion` với `version = 1`, `previous_version_id = NULL`.
    - Cập nhật `Complaint.status = 'RESPONDED'`, `Complaint.current_response_version_id` trỏ tới version vừa tạo.
    - Ghi nhận `ComplaintStatusHistory` chuyển trạng thái sang `RESPONDED`.
    - Trả về HTTP 201 kèm dữ liệu version phản hồi.
  - **AC 3.3**: Sửa phản hồi (v2+): Khi đã có phản hồi trước đó, System Admin có thể gửi phản hồi đính chính / bổ sung:
    - Yêu cầu `content` và bắt buộc có `changeReason` (string 5-500 ký tự giải thích lý do sửa).
    - Tạo `ComplaintResponseVersion` với `version = previous.version + 1`, `previous_version_id` trỏ tới version trước.
    - Cập nhật `Complaint.current_response_version_id` sang version mới.
    - Giữ nguyên trạng thái `RESPONDED`.
  - **AC 3.4**: API `GET /api/system-complaints/:id/responses` cho phép xem toàn bộ lịch sử các phiên bản phản hồi theo thứ tự thời gian.

---

## 3. Data Dictionary & Constraints

### 3.1 Bảng `system_complaints`

| Tên cột   | Kiểu             | Ràng buộc                                            | Mô tả                                  |
| --------- | ---------------- | ---------------------------------------------------- | -------------------------------------- |
| `id`      | `uuid`           | `PRIMARY KEY`                                        | Khóa chính, khớp với `complaints.id`   |
| `kind`    | `complaint_kind` | `NOT NULL DEFAULT 'SYSTEM'`                          | Phân loại đơn, CHECK `kind = 'SYSTEM'` |
| FK tổ hợp | `(id, kind)`     | `REFERENCES complaints(id, kind) ON DELETE RESTRICT` | Ràng buộc kế thừa bảng cha             |

---

## 4. Security & Compliance

- Tuân thủ Zero Trust & Scope Validation: User thường chỉ được xem khiếu nại do chính mình tạo. System Admin được quyền truy cập toàn diện khiếu nại `kind = 'SYSTEM'`.
- Chống Race Condition: Mọi thao tác cập nhật phản hồi đều chạy trong transaction `Serializable` với cơ chế khóa lạc quan hoặc Serializable retry.
- Audit Trail: Lưu trữ bất biến lịch sử phản hồi và lịch sử trạng thái.
