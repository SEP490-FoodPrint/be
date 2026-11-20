# Spec: Lưu đợt giao & loại đơn cho yêu cầu nhập hàng (TASK-05)

Nguồn: `.task_specs/TASK-05-supply-request-batch-and-type.md`.

- `supply_requests.order_type` (`ingredient_handling_type`) và `batch_no` (smallint 1|2, NULL với đơn khô) là nguồn sự thật; không đọc `requestNo`/`note`/giờ.
- D1 tái dùng `IngredientHandlingType`; D2 không trộn loại (400); D3 không có `parent_request_id`; D5 có filter `orderType`/`batchNo`; D6 không ràng buộc số đơn mỗi đợt.
- D4: migration 1 để `order_type` NULL cho dòng không suy ra được; migration 2 (`NOT NULL` + CHECK chặt) chỉ viết/áp dụng sau khi `npm run db:report:supply-batch` rỗng. **Chưa tạo/áp dụng trong PR này.**
- `POST /api/supply-requests`: `orderType` bắt buộc, `batchNo` bắt buộc với DIRECT_USE, phải null với DRY_STOCK. Đợt 2 (`DIRECT_USE` + `batchNo = 2`) bắt buộc mọi lớp chốt điểm danh.
- Đọc: supply-requests, deliveries, deliveries/inspections, supplier-order trả `orderType`, `batchNo` (+ nhãn ở supply-requests).
- Chưa chạy migration trên bất kỳ DB nào.
