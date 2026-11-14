# Quản lý nguyên liệu và Phiếu nhập hàng

- API danh mục nguyên liệu `GET /api/ingredients` trả về thông tin nguyên liệu từ cơ sở dữ liệu thật cho bộ phận Quản lý Nguyên liệu & Kho.
- Bổ sung thông tin Nhà cung cấp đối tác (`supplierId`, `supplierName` hoặc object `supplier: { id, name }`) từ bảng `suppliers` liên kết qua `supplier_id`.
- Bổ sung trường mô tả và yêu cầu bảo quản quy cách (`description`) từ bảng `ingredients`.
- Danh mục nguyên liệu chuẩn hóa định dạng dữ liệu DTO, phục vụ màn hình Danh mục nguyên liệu bên frontend hiển thị chính xác theo DB mà không phụ thuộc mock data.
- API danh sách đợt giao nhận `GET /api/deliveries` truy vấn trực tiếp từ cơ sở dữ liệu thật, mở rộng thông tin Nhà cung cấp đối tác (`Supplier.name`), mã đơn đặt hàng gốc (`SupplyRequest.requestNo`), ngày giờ giao nhận, hội đồng nghiệm thu 4 bên (`deliveryApprovals`) và chi tiết hàng giao (`deliveryItems`).
- Loại bỏ hoàn toàn mock data ở cả frontend và backend, đồng bộ 100% dữ liệu thực từ PostgreSQL.

