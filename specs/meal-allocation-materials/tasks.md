# Tasks

TASK-07 bổ sung migration, hàng đợi bền vững, worker GLPK, API đọc và sửa nháp, kiểm tra lượng nguyên liệu khi ghi, nút lưu có điều kiện và kiểm thử hồ sơ đã áp dụng trước khi giao.

TASK-06 cập nhật dữ liệu dị ứng, tính nhu cầu theo món, kiểm tra lưu và giao, hiển thị theo lớp và chạy kiểm thử hồi quy.

- [x] Migration Decimal(20,2), chi tiết nguồn và bản chụp định lượng
- [x] Bộ giải tối ưu, kiểm tra Decimal và bù phần trăm
- [x] GET/PUT phân bổ hiện hữu, revision, quyền và transaction
- [x] FE, tổng theo khối/lớp, truy xuất và proof phiên bản 2
- [x] 827 unit tests qua với BLOCKCHAIN_ENABLED=false cho DB giả
- [x] 9 integration tests qua trên DB cloud tạm, đã dọn đúng DB tạm
- [x] Áp dụng riêng migration mới vào DB cloud ứng dụng sau khi người dùng cho phép
- [x] Build FE/BE, Prisma validate và typecheck qua
- [x] Mobile 390px không tràn ngang, nút áp dụng cao 44px, không có nút tính, xem trước/áp dụng dữ liệu kiểm thử qua
- [ ] npm run validate toàn repo còn bị chặn bởi lỗi format ở các file ngoài phạm vi

- [x] Tích hợp GET/PUT tự lập phương án, bỏ nút tính, hỗ trợ lô cũ và kiểm thử hồi quy.
