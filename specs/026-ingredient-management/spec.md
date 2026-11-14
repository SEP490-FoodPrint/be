# Quản lý nguyên liệu và Phiếu nhập hàng

- API danh mục nguyên liệu `GET /api/ingredients` trả về thông tin nguyên liệu từ cơ sở dữ liệu thật cho bộ phận Quản lý Nguyên liệu & Kho.
- Bổ sung thông tin Nhà cung cấp đối tác (`supplierId`, `supplierName` hoặc object `supplier: { id, name }`) từ bảng `suppliers` liên kết qua `supplier_id`.
- Bổ sung trường mô tả và yêu cầu bảo quản quy cách (`description`) từ bảng `ingredients`.
- Danh mục nguyên liệu chuẩn hóa định dạng dữ liệu DTO, phục vụ màn hình Danh mục nguyên liệu bên frontend hiển thị chính xác theo DB mà không phụ thuộc mock data.
- API danh sách đợt giao nhận `GET /api/deliveries` truy vấn trực tiếp từ cơ sở dữ liệu thật, mở rộng thông tin Nhà cung cấp đối tác (`Supplier.name`), mã đơn đặt hàng gốc (`SupplyRequest.requestNo`), ngày giờ giao nhận, hội đồng nghiệm thu 4 bên (`deliveryApprovals`) và chi tiết hàng giao (`deliveryItems`).
- Cho phép vai trò Quản lý nguyên liệu (quyền `supply_request.create`) truy cập API tổng hợp suất ăn điểm danh theo ngày `GET /api/v1/daily-meal-portions` để tự động tính toán cân đối sĩ số đơn giao Đợt 2 từ dữ liệu chốt của GVCN.
- API quản lý kho và lô hàng nguyên liệu `GET /api/ingredient-lots` truy vấn trực tiếp từ cơ sở dữ liệu thật, mở rộng thông tin chi tiết mặt hàng nguyên liệu, nhà cung cấp, cơ sở nguồn và phiếu giao nhận phục vụ màn hình Quản lý Kho đồ khô.
- API danh sách đợt giao hàng `GET /api/deliveries` bổ sung thông tin liên hệ nhà cung cấp và ngày hẹn giao phục vụ màn hình Theo dõi đơn hàng & Vận chuyển.
- Loại bỏ hoàn toàn mock data ở cả frontend và backend, đồng bộ 100% dữ liệu thực từ PostgreSQL.
