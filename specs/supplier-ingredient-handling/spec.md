# Loại nguyên liệu (Lưu kho / Dùng ngay) theo nhà cung cấp khi liên kết

## Context

Xe giao là xe đồ lưu kho khi mọi dòng hàng có `IngredientEntry.handlingType = DRY_STOCK` (`isDryDelivery`, spec `delivery-dry-classification`). `IngredientEntry` là duy nhất theo `(schoolId, ingredientId)` và `Ingredient` thuộc đúng một nhà cung cấp, nên `handlingType` đã là loại theo trường × nhà cung cấp × nguyên liệu; không thêm cột nhà cung cấp.

Hiện không có API nào tạo/sửa `IngredientEntry` (dữ liệu đến từ seed). Kích hoạt hợp đồng chỉ tạo liên kết và snapshot, nên nguyên liệu chưa có entry không đặt hàng được (`POST /supply-requests` bắt buộc `ingredientEntryId`). Trang chi tiết nhà cung cấp chỉ hiển thị toàn bộ danh mục của nhà cung cấp, không hiển thị phạm vi hợp đồng hay loại nguyên liệu.

Nhãn hiển thị: `DRY_STOCK` = "Lưu kho", `DIRECT_USE` = "Dùng ngay". Dùng lại enum `IngredientHandlingType`, không thêm giá trị.

## Requirements

### Hồ sơ hợp đồng nháp

- **FR-001**: `SupplierContractItem` có cột `handlingType IngredientHandlingType` cho phép NULL (dòng cũ giữ NULL). Migration chỉ thêm cột, không gán giá trị mặc định cho dữ liệu cũ.
- **FR-002**: `POST /supplier-contracts` và `PUT /supplier-contracts/:id` nhận `items: { ingredientId, handlingType }[]` (tối đa 200, `handlingType` ∈ `DRY_STOCK | DIRECT_USE`, bắt buộc) thay cho `ingredientIds`. Thiếu hoặc sai `handlingType`, lặp `ingredientId`, hoặc gửi `ingredientIds` đều trả 400 với thông báo tiếng Việt. Không giữ tương thích payload cũ vì payload cũ không có loại nguyên liệu; FE cập nhật cùng đợt.
- **FR-003**: Các API trả hợp đồng (`GET /supplier-contracts/:id`, chi tiết nhà cung cấp, danh sách liên kết) trả `handlingType` (có thể `null`) cho từng dòng `items[]`.

### Kích hoạt hợp đồng

- **FR-004**: `POST /supplier-contracts/:id/activate` từ chối 409 nếu còn dòng hàng có `handlingType = NULL` (hồ sơ nháp tạo trước migration), kèm thông báo yêu cầu chọn loại trong hồ sơ.
- **FR-005**: Trong cùng transaction kích hoạt, với mỗi dòng hàng: nếu chưa có `IngredientEntry(schoolId, ingredientId)` thì tạo với `handlingType` của dòng, `status = ACTIVE`, `createdByUserId = actor`; nếu đã có thì cập nhật `handlingType` theo dòng và chuyển `INACTIVE` → `ACTIVE`. Không tạo bản ghi trùng.
- **FR-006**: `snapshot.items[]` của hợp đồng có thêm `handlingType`.
- **FR-007**: Đóng hợp đồng không xoá và không đổi trạng thái `IngredientEntry` (bảng này được thực đơn, dị ứng, lô hàng tham chiếu).

### Nguyên liệu cung cấp cho trường (trang chi tiết nhà cung cấp)

- **FR-008**: `GET /supplier-directory/:supplierId` trả thêm `suppliedIngredients[]` khi người xem có `supplier_relationship.view` hoặc `supplier_relationship.manage`: mỗi nguyên liệu thuộc hợp đồng `ACTIVE` của trường với nhà cung cấp (liên kết `ACTIVE` hoặc `SUSPENDED`) gồm `ingredientId`, `name`, `unit`, `category`, `handlingType` (lấy từ `IngredientEntry`, `null` nếu chưa có entry) và các hợp đồng chứa nó (`id`, `number`, `startsOn`, `endsOn`). `supplier.ingredients` (danh mục đầy đủ) giữ nguyên.
- **FR-009**: API mới `PUT /supplier-partnerships/:supplierId/ingredient-handling`, body `{ items: { ingredientId, handlingType }[] }` (1–200 dòng, không lặp). Chỉ người qua `assertContractManager` (quyền `supplier_relationship.manage` và vai trò BGH/Hành chính) được gọi; người khác nhận 403.
- **FR-010**: Mọi `ingredientId` phải thuộc hợp đồng `ACTIVE` của trường với nhà cung cấp đó và liên kết `ACTIVE`/`SUSPENDED`; có nguyên liệu khác thì trả 409, không cập nhật gì.
- **FR-011**: Không cho đổi loại nếu có xe giao của trường ở trạng thái `ARRIVED` hoặc `PENDING_APPROVAL` chứa nguyên liệu bị đổi loại: trả 409, thông báo liệt kê số xe (`deliveryNo`), không cập nhật gì.
- **FR-012**: Trong một transaction (cùng khóa của module liên kết), cập nhật `IngredientEntry.handlingType` cho các dòng có thay đổi; dòng chưa có entry thì tạo như FR-005. Nếu có ít nhất một thay đổi, ghi đúng một `SupplierRelationshipEvent` `action = "INGREDIENT_HANDLING_CHANGED"`, `reason` liệt kê "Tên: Lưu kho → Dùng ngay". Không có thay đổi thì không ghi event.
- **FR-013**: Trang này không thêm/bớt nguyên liệu khỏi phạm vi cung cấp; đổi phạm vi phải qua hồ sơ hợp đồng mới.

### Đối soát dữ liệu cũ

- **FR-014**: Script chỉ đọc `npm run supplier-ingredients:audit` (`src/scripts/audit-supplier-ingredient-handling.ts`) liệt kê theo trường: nguyên liệu trong hợp đồng `ACTIVE` chưa có `IngredientEntry`, và `SupplierContractItem` có `handlingType = NULL`. Script không ghi DB và không gán loại mặc định.

### Frontend

- **FR-015**: Form hồ sơ liên kết: mỗi nguyên liệu đã chọn có ô chọn bắt buộc "Lưu kho" / "Dùng ngay", không có giá trị ngầm định; không lưu được khi còn dòng chưa chọn loại; mở lại hồ sơ nháp hiển thị loại đã lưu.
- **FR-016**: Trang chi tiết nhà cung cấp có bảng "Nguyên liệu cung cấp cho trường" (Tên, Đơn vị, Danh mục, Loại, Hợp đồng), tách khỏi khu vực "Danh mục của nhà cung cấp". Người quản lý (`canManage`) thấy nút "Chỉnh sửa"; chế độ sửa có ô chọn loại từng dòng, nút "Lưu"/"Huỷ"; lưu một lần cho cả bảng sau hộp xác nhận liệt kê thay đổi.

## Out of scope

- Gợi ý loại theo danh mục nguyên liệu; nhãn Khô/Tươi ở màn tạo đơn và chi tiết xe (đề xuất 5.2, 5.3).
- Gán loại cho dữ liệu cũ bằng script ghi.

## Acceptance

1. Lưu hồ sơ thiếu loại cho một nguyên liệu bị từ chối 400 (BE) và bị chặn trên form (FE).
2. Kích hoạt hợp đồng với nhà cung cấp mới tạo `IngredientEntry` đúng loại; tạo được đơn nhập ngay cho nguyên liệu đó.
3. Kích hoạt hợp đồng có nguyên liệu đã có entry chỉ cập nhật, không tạo trùng.
4. Đổi một nguyên liệu Lưu kho → Dùng ngay ở trang chi tiết: xe chưa đến chứa nguyên liệu đó không còn là xe đồ lưu kho; mỗi lần lưu có thay đổi tạo đúng 1 event.
5. Người không có quyền quản lý không thấy nút "Chỉnh sửa" và nhận 403 khi gọi API.
6. Nguyên liệu ngoài hợp đồng `ACTIVE` nhận 409; nguyên liệu nằm trên xe `ARRIVED`/`PENDING_APPROVAL` nhận 409 kèm số xe.
