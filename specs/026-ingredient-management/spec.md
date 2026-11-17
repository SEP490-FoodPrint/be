# Quản lý nguyên liệu và Phiếu nhập hàng

- API danh mục nguyên liệu `GET /api/ingredients` trả về thông tin nguyên liệu từ cơ sở dữ liệu thật cho bộ phận Quản lý Nguyên liệu & Kho.
- Bổ sung thông tin Nhà cung cấp đối tác (`supplierId`, `supplierName` hoặc object `supplier: { id, name }`) từ bảng `suppliers` liên kết qua `supplier_id`.
- Bổ sung trường mô tả và yêu cầu bảo quản quy cách (`description`) từ bảng `ingredients`.
- Danh mục nguyên liệu chuẩn hóa định dạng dữ liệu DTO, phục vụ màn hình Danh mục nguyên liệu bên frontend hiển thị chính xác theo DB mà không phụ thuộc mock data.
- API danh sách đợt giao nhận `GET /api/deliveries` truy vấn trực tiếp từ cơ sở dữ liệu thật, mở rộng thông tin Nhà cung cấp đối tác (`Supplier.name`), mã đơn đặt hàng gốc (`SupplyRequest.requestNo`), ngày giờ giao nhận, hội đồng nghiệm thu 4 bên (`deliveryApprovals`) và chi tiết hàng giao (`deliveryItems`).
- Cho phép vai trò Quản lý nguyên liệu (quyền `supply_request.create`) truy cập API tổng hợp suất ăn điểm danh theo ngày `GET /api/v1/daily-meal-portions` để tự động tính toán cân đối sĩ số đơn giao Đợt 2 từ dữ liệu chốt của GVCN.
- API quản lý kho và lô hàng nguyên liệu `GET /api/ingredient-lots` truy vấn trực tiếp từ cơ sở dữ liệu thật, mở rộng thông tin chi tiết mặt hàng nguyên liệu, nhà cung cấp, cơ sở nguồn và phiếu giao nhận phục vụ màn hình Quản lý Kho đồ khô.
- API danh sách đợt giao hàng `GET /api/deliveries` bổ sung thông tin liên hệ nhà cung cấp và ngày hẹn giao phục vụ màn hình Theo dõi đơn hàng & Vận chuyển.
- Bổ sung trường `note` trong `SupplyRequest` lưu thông tin lịch hẹn giao và hướng dẫn vận chuyển khi tạo đơn đặt hàng nháp.
- Mở rộng quyền xem chi tiết đơn đặt hàng `GET /api/supply-requests/:id` cho tài khoản trường học (School), trả về đầy đủ thông tin nhà cung cấp và danh sách mặt hàng nguyên liệu (`supplyRequestItems`).
- API danh sách đơn đặt hàng `GET /api/supply-requests` bổ sung ngày hẹn giao, ghi chú và thông tin nhà cung cấp cho trường học.
- API tổng hợp suất ăn `GET /api/v1/daily-meal-portions` bổ sung thông tin khối lớp (`gradeId`, `gradeName`) cho từng lớp học, phục vụ tính toán chính xác số suất ăn tối đa và phân bổ đợt 1 / đợt 2 theo thực đơn toàn trường hoặc theo khối lớp.
- Loại bỏ hoàn toàn mock data ở cả frontend và backend, đồng bộ 100% dữ liệu thực từ PostgreSQL.
