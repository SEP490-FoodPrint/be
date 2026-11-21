# Spec: Sửa cảnh báo đồ lưu kho, lọc ngày kiểm tra giao hàng và khai dị ứng lớp theo nhóm

## Bối cảnh

- Ban quản lý nguyên liệu đã lập yêu cầu nhập đồ lưu kho nhưng cảnh báo "Đồ lưu kho sắp thiếu, cần nhập gấp" vẫn hiện, vì phần đã đặt chỉ được tính từ ngày giao yêu cầu (mặc định ngày mai).
- Trang "Giao hàng nguyên liệu" lọc theo hôm nay vẫn hiện xe có ngày hẹn đến khác, vì ngày giao trường yêu cầu trên đơn cũng được dùng để lọc.
- Dị ứng của lớp đang khai theo một danh sách chung với một số học sinh chung, nên không biểu diễn được trường hợp nhiều nhóm học sinh dị ứng các tập nguyên liệu khác nhau (ví dụ A: 1, B: 1, A + B: 1).

## Yêu cầu chức năng

### Cảnh báo đồ lưu kho

- **FR-001**: Trong `GET /ingredient-lots/stock-alerts`, yêu cầu nhập đồ lưu kho ở trạng thái `SENT | ACCEPTED | IN_PROGRESS` (phần chưa nhận) được tính là "đã đặt" và bù được mọi ngày thiếu, kể cả ngày trước ngày giao yêu cầu. Lô đang có trong kho được dùng trước phần đã đặt.
  - Cảnh báo (cả mức `URGENT`) tự hết ngay khi đã lập yêu cầu nhập đủ (hoặc nhiều hơn) lượng cần, không phụ thuộc ngày giao.
  - Yêu cầu bị hủy (`CANCELLED`, NCC không nhận phần còn lại) không còn tính là đã đặt, nên cảnh báo hiện lại.
  - Tính lại ở mỗi lần đọc, không lưu trạng thái, không đổi cấu trúc DB.

### Lọc ngày danh sách kiểm tra giao hàng

- **FR-002**: Bộ lọc `date` của `GET /deliveries/inspections` lấy xe theo ngày giờ hẹn đến (`expectedArrivalAt`) hoặc ngày xe đến thực tế (`arrivedAt`). Ngày giao trường yêu cầu (`requestedDeliveryDate`) chỉ dùng khi xe chưa có cả hai mốc trên, để xe đã hẹn ngày khác không hiện vào ngày yêu cầu của đơn. Không đổi cấu trúc DB.

### Dị ứng lớp theo nhóm

- **FR-003**: Dị ứng của lớp khai theo nhóm có số thứ tự. Mỗi nhóm là một tập nguyên liệu (mục nguyên liệu của trường) mà một nhóm học sinh cùng phải tránh, kèm số học sinh của nhóm. Ví dụ A: 1, B: 1, A + B: 1 là 3 học sinh dị ứng; mỗi nhóm chỉ tính một lần ở mọi nơi.
  - `PUT` dị ứng lớp của GVCN nhận `{ groups: [{ ingredientEntryIds, affectedCount }] }`; body cũ `{ ingredientEntryIds, affectedCount }` được coi là một nhóm. Tổng số học sinh các nhóm không vượt số suất đăng ký của lớp; hai nhóm không được trùng đúng một tập nguyên liệu.
  - Báo suất hằng ngày gửi `allergies: [{ groupNo, portionCount }]`, bắt buộc đủ mọi nhóm của lớp (0 khi cả nhóm nghỉ). Mỗi nhóm không vượt số học sinh của nhóm; tổng các nhóm không vượt `totalPortions`.
  - Suất dị ứng hằng ngày lưu bản chụp thành phần nhóm của hôm đó và tham chiếu trực tiếp `ingredient_entries`, nên sửa nhóm của lớp không ghi đè hay chặn các ngày đã báo.
  - Chia nhóm suất: mỗi nhóm dị ứng tính một lần vào nhóm suất riêng tránh được nhiều nguyên liệu của nhóm nhất; bằng nhau thì chọn nhóm suất tránh ít nguyên liệu hơn, rồi nhóm đứng trước. Không nhóm riêng nào tránh nguyên liệu của nhóm thì suất vào nhóm thường.
  - Phân bổ món: nhóm dị ứng nào gặp nguyên liệu của món thì cả nhóm được trừ khỏi nhu cầu món đó, mỗi nhóm một lần.
  - Kiểm tra dị ứng khi lập thực đơn cộng số học sinh theo nhóm (lớp + nhóm), không đếm trùng khi một nhóm khớp nhiều nguyên liệu.
  - Danh mục dị ứng của trường trả thêm `groupNo` cho mỗi dòng.
  - Migration `20261128000100_class_allergy_groups` thêm `group_no` vào `class_allergies` và `daily_allergy_portions`; dữ liệu hiện có (danh sách chung) thành nhóm 1.

## Ngoài phạm vi

- Không thêm thực thể học sinh; số học sinh dị ứng vẫn là số tổng hợp theo lớp.
- Không thêm nút "NCC từ chối đơn"; cảnh báo đồ lưu kho chỉ hiện lại khi yêu cầu chuyển `CANCELLED`.
