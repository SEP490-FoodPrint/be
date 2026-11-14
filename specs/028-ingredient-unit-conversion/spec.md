# Quy đổi đơn vị nguyên liệu

Hệ thống nhận diện các cách viết thông dụng của cùng một đơn vị khối lượng hoặc thể tích khi lưu công thức và lập hoặc hoàn thành mẻ. Đặc biệt, `lít`, `lit`, `l` quy đổi được với `ml`. Dữ liệu đơn vị đang lưu giữ nguyên.

Không suy đoán quy đổi giữa khối lượng và thể tích hoặc giữa các đơn vị đếm khác nhau. Đơn vị đếm giống nhau tiếp tục dùng được; đơn vị không hợp lệ hoặc không tương thích trả lỗi rõ hai đơn vị.

## Kiểm tra chấp nhận

- Quy đổi hai chiều giữa lít và ml, kg và g chính xác bằng số thập phân; không phân biệt chữ hoa và dạng Unicode tương đương.
- Kiểm tra công thức theo khối và lập mẻ dùng cùng quy tắc.
- `kg` với `lít`, `quả` với `hộp` bị từ chối; `quả` với `quả` tiếp tục hoạt động.
- Không thay đổi schema, dữ liệu kho, giao dịch tồn kho hoặc dữ liệu hiện có.
