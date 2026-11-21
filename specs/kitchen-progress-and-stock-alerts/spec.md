# Spec: Cảnh báo tiến độ bếp, cảnh báo đồ lưu kho và các chỉnh sửa bếp / kho

## Bối cảnh

- Bếp không biết khối nào chưa nấu xong bữa trưa / bữa xế khi trường có nhiều thực đơn theo khối.
- Ban quản lý nguyên liệu không được báo khi đồ lưu kho (`DRY_STOCK`) không đủ cho thực đơn đã duyệt; lỗi chỉ lộ ra lúc bếp lập mẻ (409 "Không đủ nguyên liệu").
- Một số quy tắc bếp / kho / cung ứng chưa khớp nghiệp vụ (mục FR-003 → FR-008).

## Yêu cầu chức năng

### Tiến độ chế biến trong ngày

- **FR-001**: `GET /v1/kitchen/day-progress` (quyền `cooking_batch.view`, phạm vi trường của người dùng) trả về, cho mỗi thực đơn đã duyệt của hôm nay (giờ Việt Nam) và mỗi bữa có món:
  - trạng thái gộp `NOT_STARTED | IN_PROGRESS | COOKED_NO_SAMPLE | DONE`;
  - số món theo từng trạng thái;
  - danh sách món chưa hoàn tất kèm trạng thái từng món.
- Trạng thái của món:
  - không có lô nấu → `NOT_STARTED`;
  - còn lô chưa nấu xong → `IN_PROGRESS`;
  - mọi lô nấu xong nhưng còn lô chưa lưu mẫu → `COOKED_NO_SAMPLE`;
  - còn lại → `DONE`.
- Màn hình dùng dữ liệu này để cảnh báo theo giờ ăn (FE): ≤ 90 phút trước giờ ăn mức vàng, ≤ 30 phút hoặc quá giờ mức đỏ, chưa lưu mẫu luôn nhắc. Chỉ cảnh báo trên màn hình.

### Cảnh báo đồ lưu kho

- **FR-002**: `GET /ingredient-lots/stock-alerts` (quyền `inventory.view`, phạm vi trường) trả về các nguyên liệu lưu kho sẽ thiếu cho các ngày thực đơn **đã duyệt** từ hôm nay.
  - Nguyên liệu lưu kho: mọi mục ACTIVE của nguyên liệu trong trường đều là `DRY_STOCK`. Nguyên liệu có cả hai loại thì không tính.
  - Nhu cầu = định mức món (`menu_day_dish_ingredients`) × số suất của món, cộng gia vị chung của bữa (`menu_meal_seasonings`) × tổng suất. Gia vị chung thay cho phần gia vị cùng nguyên liệu trong công thức món (không tính hai lần).
  - Số suất: lớp đã chốt suất dùng số đã chốt (kể cả nhóm suất), lớp chưa chốt ước tính bằng `registered_meal_portions`. Món thay thế chỉ tính cho nhóm suất có món đó. Khi lớp chốt suất nhiều hơn ước tính, phần chênh hiện thành lượng cần nhập thêm.
  - Phần đã phân bổ cho bữa (lô nấu mọi trạng thái, lô gia vị chung) được trừ vào nhu cầu của bữa đó.
  - Tồn kho còn trống = lô `AVAILABLE` của chuyến đã `RECEIVED`, trừ phần đang giữ (lô nấu `UNCONFIRMED`/`CONFIRMED`, gia vị chưa dùng). Lô hết hạn trước ngày dùng không được tính.
  - Yêu cầu nhập đồ lưu kho ở trạng thái `SENT | ACCEPTED | IN_PROGRESS`, phần chưa nhận, được tính là "đã đặt" từ ngày giao yêu cầu.
  - Mô phỏng theo từng ngày (hạn sớm dùng trước). Trả về: nhu cầu, tồn còn trống, đã đặt, **lượng cần nhập thêm**, ngày bắt đầu thiếu, mức `URGENT` (ngày thiếu là hôm nay hoặc ngày mai) hoặc `UPCOMING`.
  - Cảnh báo tự hết khi yêu cầu nhập đã gửi đủ (hoặc nhiều hơn) lượng cần, giao kịp ngày thiếu. Tính lại ở mỗi lần đọc, không lưu trạng thái.

### Chỉnh sửa bếp / kho / cung ứng

- **FR-003**: Chế độ `SEPARATE_BY_LOT`: các lô cùng nguyên liệu và cùng cơ sở nguồn (`source_facility_id`) gộp vào một mẻ; lô không rõ cơ sở nguồn vẫn tách riêng. Lỗi thiếu nguyên liệu ghi tên nguyên liệu.
- **FR-004**: Tủ lưu mẫu: `compartmentCount` từ 1 đến 500 và không vượt `capacity` (mỗi mẫu một ngăn), lỗi 400 ở trường `compartmentCount`.
- **FR-005**: `GET /v1/menus/approval-week`: mỗi tuần trong `weeks` có `weekNumber` theo năm học (null nếu ngoài năm học).
- **FR-006**: Danh sách đơn cung ứng phía NCC sắp xếp theo `requestedDeliveryDate` giảm dần, đơn chưa có ngày xếp cuối, `id` giữ thứ tự ổn định.
- **FR-007**: Đơn cung ứng chuyển `IN_PROGRESS → COMPLETED` khi một chuyến giao vừa `RECEIVED` và không còn chuyến nào đang chạy (`CREATED`, `PREPARING`, `IN_TRANSIT`, `ARRIVED`, `PENDING_APPROVAL`, `APPROVED`).
- **FR-008**: Thông báo / chú thích hiển thị đổi "đồ khô" thành "đồ lưu kho". Mã `DRY_STOCK` và cấu trúc DB không đổi.

## Ngoài phạm vi

- Không gửi email / thông báo đẩy cho cảnh báo; không tự tạo yêu cầu nhập.
- Không thay đổi cấu trúc DB, không có migration.
- Món chỉ lập lô cho một phần số suất vẫn tính theo các lô đã có trong FR-001.
