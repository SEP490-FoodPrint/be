# Triển khai

1. Kiểm tra lịch sử/checksum migration và DB đích bằng truy vấn chỉ đọc. Lần kiểm tra hiện tại chỉ pending `20261126000100_measurement_units`; không có checksum lệch.
2. Sau khi được cho phép riêng, chạy deploy migration hiện hữu. Migration là transaction, chỉ thêm danh mục/alias/unit_id và backfill liên kết; không sửa số lượng hoặc chuỗi lịch sử.
3. Chạy bootstrap chọn riêng `--permission-code=measurement_unit.manage`, kèm `--azure` và host đích đúng cấu hình. Không chạy bootstrap toàn catalog vì DB ứng dụng còn thiếu một permission khác ngoài phạm vi.
4. Kiểm tra bảng, toàn bộ nguyên liệu có alias được nối đúng; kiểm tra quyền mới chỉ cấp System Admin. Không xóa dữ liệu cũ hoặc đổi trạng thái quyền khác.
5. Chạy BE/FE mới; System Admin mở `/system/measurement-units`; tài khoản trường mở yêu cầu nhập hàng và kiểm tra cảnh báo. Mã cũ vẫn đọc cột chuỗi, unit_id nullable bảo đảm tương thích expand.

Nếu phát hiện lỗi, dừng phát hành code mới và giữ schema mở rộng; không rollback bằng cách xóa bảng/cột đã có dữ liệu. Sửa bằng migration bổ sung nếu cần. Kiểm thử chỉ tạo/xóa đúng DB cloud tạm thuộc lần chạy, không dùng dữ liệu giả trên DB ứng dụng.
