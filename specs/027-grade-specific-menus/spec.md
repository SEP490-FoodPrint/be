# Thực đơn và định lượng theo khối

**Feature Branch**: `feat/027-grade-specific-menus`

## Yêu cầu đã xác nhận

- Trường có nhiều thực đơn trong cùng tuần. Mỗi thực đơn chọn một hoặc nhiều khối cùng trường; một khối chỉ thuộc một thực đơn trong tuần.
- Danh mục món giữ một định danh món chung, có các bộ nguyên liệu/gia vị theo khối. Các khối dùng chung thực đơn phải có cùng định lượng những món được chọn.
- Sao chép định lượng từ danh mục vào thực đơn để sửa công thức sau này không đổi thực đơn đã duyệt. Thiếu định lượng của một khối phải báo lỗi rõ; không dùng ngầm công thức khối khác.
- Phê duyệt, xem tuần, nhu cầu nguyên liệu, dị ứng, lập mẻ và phân bổ suất phải bám phạm vi khối. Không cộng suất hoặc dị ứng của khối khác, không phân bổ mẻ sang lớp ngoài phạm vi.
- Dữ liệu thực đơn cũ giữ nguyên phạm vi toàn trường và lịch sử. Không tạo thực đơn khối chồng tuần với thực đơn toàn trường cũ. Lớp chưa gán khối không được suy đoán thuộc khối nào.
- Quyền và phạm vi trường hiện tại vẫn được kiểm tra. Không áp dụng migration hoặc ghi dữ liệu trên Azure trong tác vụ này.

## Kiểm tra chấp nhận

1. Hai thực đơn cùng tuần có khối không giao nhau được phép tạo; khối giao nhau bị từ chối kể cả khi có request đồng thời.
2. Chọn khối trường khác bị từ chối. Khối chưa có định lượng món hoặc có định lượng khác không thể dùng chung thực đơn cho món đó.
3. Công thức đã lưu vào thực đơn không thay đổi khi sửa danh mục.
4. Preview/tạo mẻ chỉ sử dụng suất và dị ứng trong các khối được chọn. Phân bổ sang lớp ngoài khối bị từ chối.
5. Thực đơn toàn trường cũ vẫn truy xuất được và không bị nhân bản trong chuyển đổi.
