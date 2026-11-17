# Gộp bằng chứng blockchain về một bảng và hoàn thiện 8 điểm neo

**Feature Branch**: `feat/unified-blockchain-proofs`

**Created**: 2026-11-17

**Status**: Draft — chờ nhóm duyệt

## Bối cảnh

FoodPrint cần neo bằng chứng cho 8 nghiệp vụ:

| #   | Nghiệp vụ                                         | Hiện trạng trên `dev`                                                                           |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1–2 | Đăng ký NCC, nhà trường (UC-01, UC-02)            | Có, bảng `registration_request_versions`                                                        |
| 3   | NCC khai báo và xác nhận giao hàng (UC-50, UC-51) | Chưa có                                                                                         |
| 4   | Hoàn thành kiểm nhận (UC-26, UC-31, UC-34, UC-43) | Có, bảng `delivery_inspection_versions`                                                         |
| 5   | Hoàn thành lô chế biến (UC-22)                    | Có, bảng `cooking_batch_versions`                                                               |
| 6   | Lưu mẫu thức ăn (UC-25)                           | Có, bảng `retained_sample_versions`                                                             |
| 7   | Phân phối suất ăn (UC-23)                         | Chưa có trên `dev`. Nhánh `feat/blockchain-modules` làm bằng `traceability_anchors`, chưa có PR |
| 8   | Truy xuất nguồn gốc suất ăn (UC-09, FE-20)        | Chưa có trên `dev`. Nhánh `feat/meal-traceability` trả `blockchainProof: null`, chưa có PR      |

Vấn đề:

- 4 bảng version có khoảng 20 cột giống nhau, chỉ khác khóa ngoại. Thêm mục 3 và 7 theo cách cũ thì thành 6 bảng. Mỗi loại mới cần thêm migration, nhánh code trong repository và kiểu trả về.
- `traceability_anchors` (từ `0_init`) là một thiết kế khác cho cùng mục đích, hiện không được ghi. Nhánh `feat/blockchain-modules` định dùng nó cho mục 7, nên sẽ có hai cơ chế song song.
- Kiểm tra ngày 17/11/2026 trên DB Azure (chỉ đọc): cả 5 bảng trên đều **0 dòng**. Đổi cấu trúc lúc này không cần chuyển dữ liệu và không ảnh hưởng bằng chứng nào trên chain.

## Mục tiêu

1. Một bảng off-chain `blockchain_proofs` cho mọi loại bằng chứng, vẫn giữ khóa ngoại thật tới bản ghi nghiệp vụ.
2. Một luồng duy nhất cho tạo, gửi, gửi lại và xác minh. Thêm loại mới chỉ cần thêm hàm dựng payload và điểm gắn.
3. Bổ sung mục 3 và 7.
4. Các bước nối với nhau bằng hash của bước trước trong payload, để mục 8 kiểm chứng được cả chuỗi.

Không làm:

- Không sửa hay deploy lại contract `FoodPrintHashRegistry`.
- Không gom nhiều bản ghi vào một Merkle root (chỉ cần khi lên mainnet hoặc L2).
- Không làm giao diện truy xuất công khai (mục 8). Spec này chỉ cung cấp API kiểm chứng chuỗi để `feat/meal-traceability` gọi.
- Không chạy migration lên Azure. Việc deploy làm theo quy trình CD hiện có.

## Clarifications

### Session 2026-11-17

- Q: Gộp kiểu nào? → A: Một bảng, nhiều cột khóa ngoại cho phép `NULL`, CHECK đúng một cột khác `NULL` (exclusive arc). Không dùng cặp `entity_type` + `entity_id` không có khóa ngoại, vì sẽ mất bảo đảm `onDelete: Restrict`.
- Q: Dữ liệu cũ? → A: Azure trống, nên xóa thẳng 5 bảng cũ, không backfill. DB local và demo phải reset lại bằng migration.
- Q: `recordId` trên chain có đổi không? → A: Có, thành `foodprint:blockchain_proofs:<proofId>`. Các bản ghi demo cũ trên Sepolia không còn được tham chiếu, không ảnh hưởng gì.
- Q: API có đổi không? → A: Không. Vẫn là `/api/blockchain-proofs/:kind/...`, thêm 2 kind mới. FE giữ nguyên.
- Q: Phân phối suất ăn neo theo đơn vị nào? → A: Một bằng chứng cho một lần xác nhận phân phối của một trường trong một ngày (`confirmDistribution`), payload liệt kê mọi `MealAllocation` được xác nhận. Một giao dịch mỗi ngày thay vì mỗi lớp.

## On-chain

Giữ nguyên contract: `confirmHash(recordId, dataHash)` ghi một lần, `getHash(recordId)` đọc lại.

- `recordId = keccak256("foodprint:blockchain_proofs:" + proof.id)`.
- `dataHash = computeCanonicalHash(payload)` (Keccak-256 trên JSON chuẩn hóa), như hiện tại.
- Không đưa lên chain dữ liệu gốc, tên, số điện thoại, URL hay đường dẫn tệp. Tệp và ảnh chỉ có SHA-256 trong payload.

## Bảng `blockchain_proofs`

| Nhóm               | Cột                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Định danh          | `id`, `entity_type` (enum `BlockchainProofEntityType`), `event_type` (enum `BlockchainProofEventType`), `version`, `previous_proof_id` (tự tham chiếu)                                   |
| Liên kết nghiệp vụ | `registration_request_id`, `delivery_id`, `cooking_batch_id`, `retained_food_sample_id`, `school_id` + `subject_date` (chỉ cho phân phối). Tất cả cho phép `NULL`, khóa ngoại `Restrict` |
| Dữ liệu            | `record_id` (bytes32 hex, unique), `data_hash`, `hash_algorithm`, `payload_version`, `snapshot` (`jsonb`, đúng payload đã băm), `change_reason`                                          |
| Giao dịch          | `network_name`, `contract_address`, `transaction_hash`, `block_number`, `transaction_status`, `attempt_count`, `last_error`, `recorded_at`                                               |
| Xác minh           | `verification_status`, `verification_result`, `verified_at`                                                                                                                              |
| Kiểm toán          | `created_by_user_id`, `created_at`, `updated_at`                                                                                                                                         |

`entity_type` và `event_type` hợp lệ:

| `entity_type`          | Cột liên kết                 | `event_type`            | Version                                                      |
| ---------------------- | ---------------------------- | ----------------------- | ------------------------------------------------------------ |
| `REGISTRATION`         | `registration_request_id`    | `SUBMITTED`, `APPROVED` | Như hiện tại: mỗi lần nộp một version, `APPROVED` tối đa một |
| `DELIVERY_DECLARATION` | `delivery_id`                | `DECLARED`              | Chỉ `1`                                                      |
| `DELIVERY_INSPECTION`  | `delivery_id`                | `INSPECTED`             | Chỉ `1`                                                      |
| `COOKING_BATCH`        | `cooking_batch_id`           | `COMPLETED`             | Chỉ `1`                                                      |
| `RETAINED_SAMPLE`      | `retained_food_sample_id`    | `STORED`, `DISPOSED`    | `1` = `STORED`, `2` = `DISPOSED`                             |
| `MEAL_DISTRIBUTION`    | `school_id` + `subject_date` | `DISTRIBUTED`           | Chỉ `1`                                                      |

Ràng buộc:

- CHECK mỗi `entity_type` chỉ có đúng cột liên kết của nó khác `NULL`, các cột liên kết khác phải `NULL`.
- CHECK cặp `entity_type` / `event_type` theo bảng trên.
- Unique `(entity_type, <cột liên kết>, version)`, viết thành partial unique index theo từng `entity_type`.
- Unique một `APPROVED` cho mỗi hồ sơ; unique `(retained_food_sample_id, event_type)`.
- Unique `record_id`; unique `transaction_hash` khi khác `NULL`.
- `version = 1` ⇔ `previous_proof_id IS NULL`.
- Giữ các CHECK hiện có về định dạng hash, `attempt_count >= 0`, `CONFIRMED` phải có `recorded_at`, xác minh xong phải có `verified_at`.
- Index cho worker: `(transaction_status)` với điều kiện `transaction_status <> 'CONFIRMED'`.
- Index tra cứu theo từng cột liên kết.

Không xóa, không ghi đè bằng chứng đã tạo. Gửi lại giao dịch không tạo bằng chứng mới.

## Xóa bảng cũ

Migration xóa `delivery_inspection_versions`, `cooking_batch_versions`, `retained_sample_versions`, `registration_request_versions`, `traceability_anchors` cùng các enum chỉ chúng dùng (`retained_sample_event_type`, `registration_proof_event_type`). Trước khi xóa, migration kiểm tra cả 5 bảng đều rỗng; nếu không thì dừng với lỗi, để không mất bằng chứng nếu môi trường nào đó đã có dữ liệu.

Code đang dùng `traceability_anchors` phải sửa theo:

- `kitchen.service` (chặn xóa mẻ đã có lịch sử): đếm `blockchain_proofs` theo `cooking_batch_id`.
- Module `traceability` (`GET /api/traceability-anchors`): FE không gọi. Bỏ route và module; `tests/modules.test.ts` sửa tương ứng.

## Payload

Giữ nguyên 6 payload đang có (`DELIVERY_INSPECTED`, `COOKING_COMPLETED`, `SAMPLE_STORED`, `SAMPLE_DISPOSED`, `REGISTRATION_SUBMITTED`, `REGISTRATION_APPROVED`) theo spec `blockchain-anchoring` và `registration-document-proofs`, trừ hai bổ sung sau để nối chuỗi:

- `DELIVERY_INSPECTED` thêm `declarationHash`: `data_hash` của bằng chứng `DELIVERY_DECLARATION` cùng delivery, hoặc `null` nếu không có (delivery cũ, hoặc blockchain tắt lúc khai báo).
- `payload_version` của `DELIVERY_INSPECTED` tăng lên `2`.

Payload mới:

**`DELIVERY_DECLARED`** (mục 3): `deliveryId, deliveryNo, supplierId, schoolId, supplyRequestId, expectedArrivalAt, vehiclePlate, declaredAt, declaredByUserId`, cùng:

- `items[]`: `{ deliveryItemId, ingredientId, supplyRequestItemId, requestedQuantity, requestedUnit, quantity, unit, lots[] }`, sắp theo `deliveryItemId`;
- `lots[]`: `{ id, lotCode, manufactureDate, expiryDate, quantity, unit, sourceFacilityId }`, sắp theo `id`.

**`MEAL_DISTRIBUTED`** (mục 7): `schoolId, date (YYYY-MM-DD), distributedAt, distributedByUserId, totalPortions`, cùng:

- `allocations[]`: `{ mealAllocationId, dailyMealPortionId, classId, mealType, portions }`, sắp theo `mealAllocationId`;
- `batches[]`: `{ mealAllocationId, cookingBatchId, dishId, portions, cookingCompletedHash }`, sắp theo `mealAllocationId`, `cookingBatchId` rồi `dishId`. `cookingCompletedHash` là `data_hash` của bằng chứng `COOKING_BATCH`, hoặc `null`.

Quy tắc chung giữ nguyên: chỉ kiểu nguyên thủy, Date thành ISO UTC, Decimal thành chuỗi `toFixed(3)`, không có `undefined`, chỉ id người dùng.

Chuỗi liên kết sau khi xong:

```
DELIVERY_DECLARED ──declarationHash──▶ DELIVERY_INSPECTED ──deliveryInspectionHash──▶ COOKING_COMPLETED
COOKING_COMPLETED ──cookingCompletedHash──▶ SAMPLE_STORED, MEAL_DISTRIBUTED
```

## Điểm gắn mới

| Nghiệp vụ          | Vị trí                                                                           | Điều kiện                                         |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------- |
| NCC xác nhận giao  | `supplierOrderService.dispatch`, sau `dispatchDelivery` trả `count = 1`          | Blockchain bật; delivery chuyển sang `IN_TRANSIT` |
| Xác nhận phân phối | `mealAllocationService.confirmDistribution`, sau `confirmAllocationDistribution` | Blockchain bật; không ở nhánh đã `DISTRIBUTED`    |

Cách gắn như các điểm hiện có: tạo bằng chứng `PREPARED` trong cùng transaction, gọi `scheduleAnchor` sau khi commit, dùng chung hàng đợi gửi. Lỗi blockchain không ảnh hưởng nghiệp vụ.

## API

Giữ nguyên route, phản hồi và mã lỗi của `/api/blockchain-proofs/:kind/...`. `kind` thêm 2 giá trị:

| `kind`                  | `recordId` trong URL                    | Đọc / xác minh                                                                                                                                                     | Gửi lại               |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `delivery-declarations` | `deliveryId`                            | Trường: `traceability.view` / `traceability.verify`, theo `Delivery.schoolId`. NCC có `delivery.manage`: xem, xác minh, gửi lại bằng chứng của delivery thuộc mình | Như xác minh          |
| `meal-distributions`    | `mealAllocationId` bất kỳ trong ngày đó | Trường: `traceability.view` / `traceability.verify`, theo `school_id`                                                                                              | `traceability.verify` |

Thêm một API phục vụ mục 8:

- `GET /api/blockchain-proofs/chains/meal-allocations/:mealAllocationId`: trả các bằng chứng trên chuỗi phân phối → mẻ nấu → mẫu lưu → kiểm nhận → khai báo của một suất ăn, mỗi nút kèm `kind`, `recordId`, `dataHash`, `transactionStatus`, `explorerUrl`.
- Query `verify=true`: xác minh từng nút như API `verify`, và kiểm tra mỗi hash tham chiếu trong `snapshot` bằng đúng `data_hash` của nút trước. Hash tham chiếu không khớp thì nút đó `MISMATCH` "Liên kết với bước trước không khớp".
- Quyền: `traceability.view`, phạm vi trường. Mở cho phụ huynh hoặc công khai là việc của `feat/meal-traceability`.

## Đối chiếu nghiệp vụ

Ngoài xác minh toàn vẹn (dựng lại payload, so với chain), bằng chứng kiểm nhận và phân phối còn đối chiếu với bước trước. Kết quả nằm trong `verificationResult`, không đổi trạng thái `VERIFIED`:

- Kiểm nhận so với khai báo: liệt kê mặt hàng có số lượng thực nhận khác số lượng khai, và lô có trong biên bản nhưng không có trong khai báo.
- Phân phối so với mẻ nấu: tổng suất phân phối của mỗi mẻ không vượt `plannedPortions` của mẻ.

## Quyết định khi triển khai

1. Phân phối suất ăn dùng `blockchain_proofs`; `traceability_anchors` bị xóa. Nhánh `feat/blockchain-modules` cần bỏ phần ghi bảng này trước khi merge.
2. NCC xem bằng chứng khai báo bằng permission sẵn có `delivery.manage`, không thêm permission mới.
3. `feat/meal-traceability` lấy bằng chứng qua API chuỗi.
4. Với kind `meal-distributions`, `recordId` trong phản hồi là `<schoolId>:<YYYY-MM-DD>`.
5. `declaredAt` của khai báo là thời điểm tạo bằng chứng, được chốt trong `snapshot`; người khai là `created_by_user_id`.
6. Đối chiếu nghiệp vụ dùng dữ liệu đã neo, chỉ thêm ghi chú vào `verificationResult`. API chuỗi không dừng khi một bằng chứng thuộc mạng hoặc contract khác: bằng chứng đó được đánh dấu `FAILED`.

## Ảnh hưởng tới các nhánh đang mở

### `feat/blockchain-modules` (Nodaco35): cần sửa trước khi merge

Sau khi PR này vào `dev`, bảng `traceability_anchors` và model `TraceabilityAnchor` **không còn**. Nhánh này đang dùng chúng, nên merge `dev` vào sẽ lỗi typecheck và lỗi runtime.

Phân phối suất ăn (UC-23) và chuỗi truy xuất đã được làm trong PR này. Đề nghị:

| Phần trên nhánh                                                                                | Xử lý                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockchain-distribution.service.ts` (ghi `traceabilityAnchor`, `recordId` theo trường + ngày) | Bỏ. `mealAllocationService.confirmDistribution` đã gọi `blockchainProofService.prepareMealDistributed` và gửi sau khi commit                |
| Route `/api/dev/blockchain-distribution`                                                       | Bỏ. Xem bằng chứng qua `GET /api/blockchain-proofs/meal-distributions/:mealAllocationId/versions`, gửi lại qua `POST …/versions/:id/anchor` |
| `blockchain-traceability.service.ts`, route `/api/dev/blockchain-traceability/*`               | Thay bằng `GET /api/blockchain-proofs/chains/meal-allocations/:mealAllocationId?verify=true`                                                |
| Sửa trong `meal-allocation.service.ts`                                                         | Bỏ, để giữ bản trên `dev`                                                                                                                   |
| `src/utils/blockchain.ts`, `src/utils/canonical-hash.ts`                                       | Đã có trên `dev`, giữ bản trên `dev`                                                                                                        |
| `blockchain-todo`                                                                              | Không liên quan, giữ hoặc bỏ tùy nhánh                                                                                                      |

Lý do không giữ cách ghi cũ:

- Contract chỉ cho ghi mỗi `recordId` một lần (`AlreadyConfirmed`). `recordId` theo trường + ngày nên không gửi lại được nếu lần đầu lỗi.
- Nhánh cũ gửi giao dịch rồi mới ghi DB, nên nếu ghi DB lỗi thì có hash trên chain mà hệ thống không biết. Ở đây bằng chứng được tạo `PREPARED` trong cùng transaction nghiệp vụ, rồi mới gửi.
- Payload không được lưu lại, nên không xác minh lại được. Ở đây `snapshot` giữ đúng payload đã băm.

### `feat/meal-traceability` (Nodaco35)

Để điền `blockchainProof` (đang trả `null`), gọi API chuỗi ở trên, hoặc dùng `blockchainProofService.chain(...)` trong service. Mỗi nút có `kind`, `dataHash`, `transactionStatus`, `explorerUrl`, `links[]` và, khi `verify=true`, `verificationStatus`. Cờ `intact` cho biết cả chuỗi có nguyên vẹn không.

### Nhánh khác đụng module `blockchain-proof`

Repository không còn `createDeliveryVersion`, `createCookingBatchVersion`, `createSampleVersion`, `createRegistrationVersion`; dùng `createVersion(tx, subject, data)`. `proofRecordId` chỉ nhận id bằng chứng.

## Kiểm tra chấp nhận

- Migration chạy được trên DB rỗng; dừng với lỗi nếu một trong 5 bảng cũ có dữ liệu. `prisma migrate diff` không còn khác biệt.
- Các test hiện có của UC4–UC6 và UC-01/02 chạy qua với bảng mới, không sửa kết quả mong đợi (trừ `declarationHash` mới).
- NCC xác nhận giao tạo đúng một bằng chứng `DELIVERY_DECLARATION`; rollback thì không còn. Kiểm nhận sau đó có `declarationHash` khớp.
- Xác nhận phân phối tạo đúng một bằng chứng mỗi trường mỗi ngày; gọi lại khi đã `DISTRIBUTED` không tạo thêm.
- CHECK chặn bằng chứng có hai cột liên kết, hoặc sai cặp `entity_type` / `event_type`.
- Không xóa được bản ghi nghiệp vụ đã có bằng chứng.
- API chuỗi trả đủ nút cho một suất ăn; sửa dữ liệu của một lô nguyên liệu thì nút kiểm nhận và mọi nút phía sau báo không khớp.
- Blockchain tắt: không tạo bằng chứng, nghiệp vụ chạy như cũ, `anchor` và `verify` trả 409.
- FE không phải sửa để các màn hiện có tiếp tục chạy.
