# Phân bổ suất ăn theo lô

Nhân viên bếp đọc và áp dụng phân bổ của trường cho ngày hiện tại theo giờ Việt Nam tại `/api/meal-allocations`.

- FR-001. GET trả số suất theo bữa, trạng thái nấu và lưu mẫu, nhu cầu đã chốt, lô và phân bổ. Ưu tiên hoàn tất nấu trước lưu mẫu. Chỉ mở khi đủ suất theo từng bữa và từng món của mỗi lô đã có mẫu.
- FR-002. PUT áp dụng toàn bộ lô có thể chỉnh theo phiên bản dữ liệu. Kiểm quyền, ngày, bữa, dung lượng, nhu cầu, dòng đã khóa và lưu trong một transaction.
- FR-003. Dùng số suất kế hoạch của lô. Khóa khi dữ liệu món, nhóm suất, dị ứng hoặc lịch sử không chứng minh được suất hoàn chỉnh nhóm chung.
- FR-004. Gỡ route cũ và alias v1. Giữ dữ liệu lịch sử, liên kết truy xuất và trạng thái đã khóa.
- FR-005. FE giữ thao tác chọn lớp và ưu tiên. Nút cấp trang gửi một lần. Trạng thái khóa dẫn tới đúng trang nấu hoặc lưu mẫu.
- FR-006. Fixture local ngày 12/11/2026 gồm 100 suất, hai lô 60/40 và ba trạng thái chưa nấu, thiếu mẫu và sẵn sàng.
