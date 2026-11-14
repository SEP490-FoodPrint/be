# Công việc

- [x] Ghi nhận phạm vi: nhiều khối dùng chung khi bộ định lượng giống nhau.
- [x] Thiết kế schema và file migration bảo toàn dữ liệu cũ; Prisma validate/generate đạt. Chưa áp dụng migration lên cơ sở dữ liệu.
- [x] API danh mục lưu/trả bộ định lượng theo khối; preview kiểm tra định lượng tương đương và không dùng công thức khối khác khi thiếu.
- [x] Nối kiểm tra recipe theo khối vào thao tác tạo thực đơn; không cho đổi phạm vi khối qua cập nhật.
- [x] BE nhận nhiều thực đơn mỗi tuần theo các tập khối không giao nhau, chặn phạm vi trùng và khối ngoài trường.
- [x] Truy vấn dị ứng khi tạo/gửi duyệt và tính nhu cầu, dị ứng nguyên liệu/gia vị khi lập mẻ lọc theo phạm vi khối của ngày thực đơn.
- [x] Lọc dị ứng, nhu cầu, mẻ và phân bổ theo khối; chặn bù suất giữa các thực đơn và phân bổ sang lớp ngoài khối.
- [x] Giao diện chọn khối, quản lý định lượng và chọn thực đơn khi tuần có nhiều thực đơn; nối phạm vi vào màn duyệt, bếp và phân bổ ở repo FE.
- [x] Giữ snapshot của bữa không chỉnh sửa khi lưu lại thực đơn theo khối; màn duyệt lấy nhà cung cấp từ nguyên liệu đã lưu.
- [x] Chạy kiểm thử, typecheck, lint, build và kiểm tra định dạng các file thay đổi; xem `verification.md` về kết quả và giới hạn.
- [ ] Kiểm chứng migration trên PostgreSQL tạm được chỉ định và luồng tích hợp trên dữ liệu đã migrate. Chưa chạy migration hay kiểm tra giao diện trực tiếp trong tác vụ này.
