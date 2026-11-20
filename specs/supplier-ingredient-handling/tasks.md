# Tasks

- [x] T001 Migration + Prisma: cột `supplier_contract_items.handling_type` (NULL).
- [x] T002 Validation/DTO: payload `items[]` cho hồ sơ; payload API sửa loại.
- [x] T003 `saveDraft` lưu `handlingType`; response trả `handlingType` từng dòng.
- [x] T004 `activateContract`: chặn dòng NULL, upsert `IngredientEntry`, thêm `handlingType` vào snapshot.
- [x] T005 `supplierDetail` trả `suppliedIngredients`.
- [x] T006 API `PUT /supplier-partnerships/:supplierId/ingredient-handling` (403/409/xe chờ duyệt/event).
- [x] T007 Script đối soát chỉ đọc.
- [x] T008 Unit test BE: validation 400, kích hoạt tạo/cập nhật entry, API sửa loại (403, 409 ngoài hợp đồng, 409 xe chờ duyệt, 1 event), `isDryDelivery` sau khi đổi loại.
- [x] T009 Cập nhật test dùng payload cũ `ingredientIds`.
- [x] T010 FE: form hồ sơ chọn loại bắt buộc.
- [x] T011 FE: bảng nguyên liệu cung cấp cho trường, chế độ sửa, hộp xác nhận, ẩn nút khi không có quyền.
- [x] T012 Chạy typecheck, lint, format:check, test:unit (BE) và build (FE).
- [ ] T013 Kiểm tra thủ công luồng liên kết → đặt hàng trên môi trường local.
