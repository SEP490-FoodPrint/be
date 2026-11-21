# Kế hoạch

## Thay đổi

| Phần       | File                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration  | `prisma/migrations/<timestamp>_unified_blockchain_proofs/migration.sql`: kiểm tra 5 bảng cũ rỗng, xóa chúng, tạo enum và bảng `blockchain_proofs`                                                                                                 |
| Schema     | `prisma/schema.prisma`: model `BlockchainProof`, 2 enum mới; xóa 5 model cũ và back-relation ở `Delivery`, `CookingBatch`, `RetainedFoodSample`, `RegistrationRequest`, `School`, `User`, `IngredientLot`, `MealAllocation`, `FoodSafetyIncident` |
| Payload    | `blockchain-proof.payload.ts`: `buildDeliveryDeclaredPayload`, `buildMealDistributedPayload`; `declarationHash` trong payload kiểm nhận                                                                                                           |
| Repository | `blockchain-proof.repository.ts`: một bảng cấu hình theo `kind` (`entityType`, cột liên kết, hàm đọc nghiệp vụ, hàm phạm vi) thay cho các nhánh rẽ theo bảng                                                                                      |
| Service    | `blockchain-proof.service.ts`: `prepare(kind, ...)` chung; `prepareDeliveryDeclared`, `prepareMealDistributed`; `verifyChain`                                                                                                                     |
| Route      | `blockchain-proof.routes.ts`, `validation.ts`, `response.dto.ts`: 2 kind mới, route chuỗi                                                                                                                                                         |
| Điểm gắn   | `supplier-order.service.ts` (`dispatch`), `meal-allocation.service.ts` (`confirmDistribution`): tham số `proofs` có giá trị mặc định, như `onboarding`                                                                                            |
| Dọn dẹp    | `kitchen.service.ts` đếm `blockchainProof`; xóa `src/modules/traceability/` và route `/traceability-anchors`                                                                                                                                      |
| Test       | `tests/blockchain-proof.test.ts`, `tests/registration-proof.test.ts` chuyển sang bảng mới; test mới cho 2 kind, CHECK, chuỗi; `tests/modules.test.ts`                                                                                             |
| Tài liệu   | `docs/AUTHORIZATION.md`, `README.md`, `src/modules/README.md`                                                                                                                                                                                     |

## Quyết định

- Exclusive arc thay vì polymorphic: giữ khóa ngoại `Restrict`, CHECK đảm bảo đúng một liên kết. Đổi lại, thêm loại mới cần một migration nhỏ thêm cột.
- Phân phối liên kết bằng `school_id` + `subject_date` chứ không bằng `meal_allocation_id`, vì một lần xác nhận gồm nhiều phân bổ. Tra từ một `mealAllocationId` đi qua `DailyMealPortion` để lấy trường và ngày.
- Repository dùng một bảng cấu hình theo `kind`. Service không còn biết tên bảng, chỉ gọi theo `kind`.
- Migration tự dừng nếu bảng cũ có dữ liệu, thay vì backfill. Azure đã được kiểm tra rỗng; nếu có môi trường khác có dữ liệu thì cần làm backfill riêng.
- `payload_version` của kiểm nhận tăng lên 2 vì thêm `declarationHash`. Không có dữ liệu v1 cần giữ tương thích.

- (22/11/2026) `linkChecks(rows, lotDeliveries, cookingBatchScope?)`: `buildChain` truyền `subjects.cookingBatchIds`. Liên kết mẻ của nút phân phối chỉ kiểm tra mẻ trong phạm vi và gộp theo `field`. Không đổi payload, hash, schema hay response DTO.

## Rủi ro

- Đổi cấu trúc ngay sau PR #122 và #137: các nhánh đang mở có đụng module `blockchain-proof` phải rebase.
- `feat/blockchain-modules` cần viết lại phần ghi `traceability_anchors`. Phải chốt với tác giả trước.
- DB local và demo phải reset; bằng chứng demo cũ trên Sepolia không còn tham chiếu.
- Một bảng lớn hơn từng bảng riêng. Với partial index theo từng cột liên kết và index trạng thái, quy mô đồ án không bị ảnh hưởng.
