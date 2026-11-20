# Plan

## Constitution Check

- Thay đổi nằm trong module `supplier-onboarding`; truy vấn mới đặt trong `supplier-onboarding.repository.ts`, quy tắc nghiệp vụ trong service. Payload mới dùng Zod `z.strictObject` + `safeParse` (lỗi 400 tiếng Việt có đường dẫn trường).
- Phạm vi trường lấy từ `AuthPrincipal`; mọi ghi chạy qua `write()` hiện có (khóa cha + advisory lock trường–NCC, nạp lại actor trong transaction).
- Một migration mới chỉ thêm cột NULL; không seed, không backfill. Migration không được chạy trên DB dùng chung khi chưa có xác nhận; CD trên `dev` áp dụng sau khi PR được merge.
- Không dùng mã nghiệp vụ mới (không có bảng danh sách nghiệp vụ mới).

## Data

- `prisma/migrations/20261124000100_supplier_contract_item_handling/migration.sql`: `ALTER TABLE foodprint.supplier_contract_items ADD COLUMN handling_type foodprint.ingredient_handling_type NULL;`
- `SupplierContractItem.handlingType IngredientHandlingType? @map("handling_type")`.

## Backend

1. Validation: thay `ingredientIds` bằng `items` (Zod schema `contractItemSchema`); `handlingPayload` cho API mới. Request DTO thêm `ContractItemRequestDTO`, `IngredientHandlingRequestDTO`.
2. Repository: `ingredientEntryRepository.upsertForContract(tx, schoolId, actorId, items)`, `findEntries`, `activeContractScope(tx, schoolId, supplierId)`, `pendingDeliveriesWith(tx, schoolId, ingredientIds)`; `contractInclude` đã trả mọi cột của item nên có sẵn `handlingType`.
3. Service:
   - `saveDraft` ghi `handlingType` từng dòng.
   - `activateContract` kiểm tra NULL (FR-004), upsert entry (FR-005), snapshot (FR-006).
   - `supplierDetail` trả `suppliedIngredients` (FR-008).
   - `updateIngredientHandling` (FR-009 → FR-012).
4. Routes/controller: `PUT /supplier-partnerships/:supplierId/ingredient-handling` với `manage`. Đăng ký trước route `POST /supplier-partnerships/:id/:action` không xung đột vì khác method.
5. Script `src/scripts/audit-supplier-ingredient-handling.ts` + npm script `supplier-ingredients:audit`; chỉ `SELECT`.

## Frontend (repo `fe`, nhánh riêng từ `main`)

- `SupplierRelationshipService`: `updateIngredientHandling(supplierId, items)`.
- `SupplierWorkspace`: form nháp lưu `items` (`{ ingredientId, handlingType }`), ô chọn bắt buộc cạnh nguyên liệu đã chọn; bảng "Nguyên liệu cung cấp cho trường" có chế độ xem/sửa và hộp xác nhận; khu vực danh mục đầy đủ đổi tên "Danh mục của nhà cung cấp".
- Nhãn chung `HANDLING_TYPE_LABELS` trong `src/constants/ui.js`.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:unit` (test mới trong `tests/supplier-ingredient-handling.test.ts`, thêm vào `test:unit`).
- `npm run prisma:validate`; migration được kiểm bởi `test:migrations` trên PostgreSQL local khi có xác nhận chạy.
- FE: `npm run build`.
