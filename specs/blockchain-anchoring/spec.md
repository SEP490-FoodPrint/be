# Neo bằng chứng kiểm nhận, mẻ nấu và mẫu lưu lên blockchain

**Feature Branch**: `feat/blockchain-anchoring`

**Created**: 2026-11-15

**Status**: Draft — chờ duyệt

## Mục tiêu và phạm vi

FoodPrint ghi hash của dữ liệu nghiệp vụ đã chốt lên contract `FoodPrintHashRegistry` trên Ethereum Sepolia (dev local dùng Hardhat), để chứng minh dữ liệu trong PostgreSQL không bị sửa sau thời điểm neo. PostgreSQL vẫn là nguồn dữ liệu chính; lỗi blockchain không chặn và không rollback nghiệp vụ.

Phạm vi gồm ba nghiệp vụ:

1. **UC 4 Kiểm nhận**: biên bản kiểm nhận của một `Delivery` khi kết thúc ở `RECEIVED` hoặc `REJECTED`.
2. **UC 5 Hoàn thành mẻ**: một `CookingBatch` khi chuyển sang `COMPLETED`.
3. **UC 6 Lưu mẫu**: một `RetainedFoodSample` khi lưu, rồi khi tiêu huỷ.

Không làm: khai báo NCC, phân phối suất ăn (nhánh `feat/blockchain-modules` phụ trách), đăng ký NCC hoặc trường, chứng nhận, sự cố ATTP, trang QR công khai, frontend; sửa hoặc deploy contract; mọi thao tác lên Sepolia, Azure hay DB remote.

## Clarifications

### Session 2026-11-15

- Q: Mạng nào? → A: Ethereum Sepolia (`11155111`); local Hardhat (`31337`). Không dùng Polygon Amoy như `BLOCKCHAIN_GLOBAL.md` mục 5.
- Q: Lưu bằng chứng ở đâu? → A: Mỗi nghiệp vụ một bảng version riêng theo `BLOCKCHAIN_GLOBAL.md` mục 3.1 (nhóm A, B, C). Không mở rộng `traceability_anchors`; bảng đó giữ nguyên cho module phân phối suất ăn.
- Q: Hạ tầng hash? → A: Dùng chung `src/utils/canonical-hash.ts` của nhánh `feat/blockchain-modules` (`canonicalizeJson` + `computeCanonicalHash`, Keccak-256). File được đưa vào nguyên văn để hai nhánh merge không xung đột.
- Q: Cách gửi giao dịch? → A: Theo nhánh `feat/blockchain-modules`. Dùng nguyên văn `src/utils/blockchain.ts` (`anchorHashOnChain`, `readHashFromChain`) và gửi ngầm sau khi transaction DB commit. Không có worker, outbox hay BullMQ. Code cũ trong `stash@{0}` bị bỏ.
- Q: Ai được xác minh? → A: Quyền mới `traceability.verify` cấp cho `SCHOOL_MANAGEMENT_BOARD` và `SCHOOL_NUTRITION_OFFICER`.
- `RetainedFoodSample` không có cột người tiêu huỷ. `disposedByUserId` trong payload lấy từ `created_by_user_id` của version tiêu huỷ; không thêm cột vào bảng nghiệp vụ.

## Bảng version

Ba bảng mới, cùng cấu trúc nhóm A và B:

| Bảng                           | Nhóm C (liên kết nghiệp vụ)                                    | Version                                                                  |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `delivery_inspection_versions` | `delivery_id`                                                  | Chỉ `1`: biên bản không sửa được sau khi kết thúc                        |
| `cooking_batch_versions`       | `cooking_batch_id`                                             | Chỉ `1`: mẻ đã `COMPLETED` không đổi                                     |
| `retained_sample_versions`     | `retained_food_sample_id`, `event_type` (`STORED`, `DISPOSED`) | `1` = `STORED`; `2` = `DISPOSED`, `previous_version_id` trỏ về version 1 |

**Nhóm A**: `id`, `version`, `data_hash`, `transaction_hash`, `block_number`, `transaction_status` (enum có sẵn `BlockchainAnchorStatus`; luồng này chỉ dùng `PREPARED`, `CONFIRMED`, `FAILED`), `created_at`, `created_by_user_id`.

**Nhóm B**: `previous_version_id` (tự tham chiếu, `NULL` ở version 1), `snapshot` (`jsonb`, đúng payload đã hash), `change_reason` (`NULL` ở version 1; `"Tiêu huỷ mẫu"` ở version 2 của mẫu), `recorded_at` (thời điểm `CONFIRMED`).

**Cột vận hành chung**: `payload_version`, `hash_algorithm` (`KECCAK-256`), `network_name`, `contract_address`, `attempt_count`, `last_error`, `verification_status` (enum có sẵn `BlockchainVerificationStatus`), `verification_result`, `verified_at`, `updated_at`.

Ràng buộc:

- Unique `(business_id, version)`; unique `transaction_hash` khi khác `NULL`.
- `retained_sample_versions`: `version = 1` ⇔ `STORED`, `version = 2` ⇔ `DISPOSED`; `previous_version_id` bắt buộc khi version 2.
- `CONFIRMED` phải có `recorded_at`; `transaction_hash` và `block_number` chỉ được `NULL` trong trường hợp ở mục "Giới hạn đã biết"; `VERIFIED`/`MISMATCH`/`FAILED` (xác minh) phải có `verified_at`.
- Không xoá, không ghi đè version đã tạo. Thử lại giao dịch không tạo version mới.

## Thời điểm tạo version

Version được tạo ở trạng thái `PREPARED` trong **cùng transaction** với nghiệp vụ. Nếu transaction rollback thì không còn version. Code cũ chỉ được **thêm** bước tạo version; thứ tự và điều kiện giữ nguyên.

| Nghiệp vụ     | Vị trí                                                                                                                | Điều kiện                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Kiểm nhận     | `createDeliveryInspectionService().decide()`, sau `inspections.decide(...)` và khối `cancelRemainder`, trước `return` | Chỉ ở nhánh ghi mới, khi `saved.status` là `RECEIVED` hoặc `REJECTED` |
| Hoàn thành mẻ | `createKitchenLifecycle().complete()`, sau `consumeMealSeasonings(...)`, trước `return`                               | Không ở nhánh mẻ đã `COMPLETED`                                       |
| Lưu mẫu       | `createRetainedSampleService().create()`, sau `repository.create(...)`                                                | Không ở nhánh `existing`                                              |
| Tiêu huỷ mẫu  | `createRetainedSampleService().dispose()`, sau `repository.dispose(...)`                                              | Không ở nhánh mẫu đã `DISPOSED`                                       |

## Payload và hash

- `data_hash = computeCanonicalHash(payload)`: Keccak-256 của `canonicalizeJson(payload)` (UTF-8), dạng `0x` + 64 hex viết thường.
- `canonicalizeJson` bỏ key có giá trị `undefined` và chưa xử lý `Date`/`Decimal`. Vì vậy hàm dựng payload chỉ trả kiểu nguyên thuỷ: Date → ISO UTC; cột `@db.Date` → `YYYY-MM-DD`; Decimal → chuỗi `toFixed(3)`; số chỉ là số nguyên an toàn; giá trị không có → `null` (không để `undefined`).
- `recordId = ethers.id("foodprint:<bảng>:" + id của version)`, ví dụ `foodprint:delivery_inspection_versions:<uuid>`.
- Mọi payload có `v: 1` và `type`. Chỉ đưa id người dùng, không đưa tên hay số điện thoại. Ảnh dùng `photoHash` có sẵn, không đưa `photoPublicId` hay URL. Không đưa `note` tự do, trừ `reason` của biên bản và `disposalNote`.

**`DELIVERY_INSPECTED`**: `deliveryId, deliveryNo, schoolId, supplierId, supplyRequestId, creationMode, outcome, expectedArrivalAt, arrivedAt, receivedAt, receivedByUserId, vehiclePlate`, cùng các mảng sau:

- `approvals[]`: `{ roleCode, userId, decision, reason, photoHash, decidedAt }`, sắp theo `roleCode`.
- `items[]`: `{ deliveryItemId, ingredientId, supplyRequestItemId, requestedQuantity, requestedUnit, actualQuantity, unit, lots[] }`, sắp theo `deliveryItemId`. `requestedQuantity`/`requestedUnit` lấy từ `SupplyRequestItem.requestedQuantity`/`unit`.
- `lots[]`: `{ id, lotCode, manufactureDate, expiryDate, receivedQuantity, unit, sourceFacilityId }`, sắp theo `id`.

Không đưa `ingredientEntryId`, vì trường này có thể được gắn trong lúc tiếp nhận.

**`COOKING_COMPLETED`**: `batchId, batchCode, batchGroupId, menuDayId, mealType, cookingMode (= cookingModeApplied), plannedPortions, completedAt, completedByUserId`, cùng các mảng sau:

- `dishes[]`: `{ dishId, plannedPortions }`, sắp theo `dishId`.
- `lots[]`: `{ ingredientLotId, dishId, quantityUsed, unit, deliveryInspectionHash }`, sắp theo `ingredientLotId` rồi `dishId`.

`deliveryInspectionHash` đi theo đường lô → `DeliveryItem` → `Delivery` → `data_hash` của version kiểm nhận. Lô không có version kiểm nhận (dữ liệu cũ) thì để `null`. Gia vị theo bữa không nằm trong `v1`.

**`SAMPLE_STORED`** (version 1): `sampleId, cookingBatchId, dishId, sampledAt, recordedByUserId, quantity, unit, storageUnitId, storageLocation, photoHash, cookingCompletedHash`.

**`SAMPLE_DISPOSED`** (version 2): `sampleId, disposedAt, disposalNote, disposedByUserId, previousHash` (= `data_hash` của version 1).

Các hash tham chiếu được chốt lúc tạo version. Khi xác minh, hệ thống đọc lại chúng từ `snapshot`, không tra lại.

## Vòng đời giao dịch

`PREPARED → CONFIRMED | FAILED`, giống module phân phối suất ăn của nhánh `feat/blockchain-modules`.

- Version mới lưu `network_name` (= `BLOCKCHAIN_NETWORK`, không dùng `networkName` do `anchorHashOnChain` trả về vì hàm đó gọi mọi mạng khác Hardhat là "Polygon Amoy") và `contract_address` của file deployment.
- Sau khi transaction nghiệp vụ commit, service gọi ngầm (`void ... .catch(console.warn)`) `anchorVersion(kind, versionId)`. Kết quả nghiệp vụ trả về ngay, không chờ blockchain.
- `anchorVersion`:
  - Đọc `readHashFromChain(recordId)` trước. Nếu đã có và khớp `data_hash` → `CONFIRMED`, không gửi lại. Nếu đã có nhưng khác → `FAILED` "Hash trên chain khác hash đã lưu".
  - Nếu chưa có → `anchorHashOnChain(recordId, data_hash)` → `CONFIRMED`, kèm `transaction_hash`, `block_number`, `recorded_at`.
  - Mọi lỗi (RPC, revert, quá hạn 15 giây chờ receipt) → `FAILED`, tăng `attempt_count`, ghi `last_error` (tối đa 500 ký tự, không chứa bí mật).
- Các lần gửi trong cùng tiến trình được xếp hàng tuần tự (một promise chain), để hai giao dịch gửi liền nhau không trùng nonce.
- Chỉ cập nhật khi trạng thái đang là `PREPARED` hoặc `FAILED` (cập nhật có điều kiện), để không ghi đè `CONFIRMED`.
- Version còn `PREPARED` (server tắt trước khi gửi) hoặc `FAILED` được gửi lại bằng API `anchor` bên dưới. Không có tự động thử lại.

Giới hạn đã biết: nếu server tắt sau khi giao dịch lên chain nhưng trước khi lưu `CONFIRMED`, version vẫn `PREPARED`. Lần gọi `anchor` sau sẽ đọc thấy hash trên chain và chuyển `CONFIRMED` nhưng không có `transaction_hash`. Trường hợp này lưu `CONFIRMED` với `transaction_hash = NULL`, `block_number = NULL` và ghi `last_error` "Đã có trên chain, không rõ giao dịch".

## API

Quyền: đọc cần `traceability.view`, xác minh cần `traceability.verify`. Phạm vi: người dùng trường chỉ thấy version của nghiệp vụ thuộc trường mình (kiểm nhận theo `Delivery.schoolId`, mẻ và mẫu theo `CookingBatch → MenuDay → WeeklyMenu.schoolId`); `SYSTEM` thấy tất cả. `:kind` thuộc `deliveries`, `cooking-batches`, `retained-samples`; mọi id là UUID.

- `GET /api/blockchain-proofs/:kind/:recordId/versions`: danh sách version của một bản ghi nghiệp vụ, theo `version` tăng dần.
- `POST /api/blockchain-proofs/:kind/versions/:versionId/anchor` (quyền `traceability.verify`): gửi lại version `PREPARED` hoặc `FAILED` theo `anchorVersion`, rồi chờ kết quả và trả version. Version đã `CONFIRMED` → 409 "Bằng chứng đã được xác nhận trên blockchain".
- `POST /api/blockchain-proofs/:kind/versions/:versionId/verify`:
  - Không tồn tại hoặc ngoài phạm vi → 404 "Không tìm thấy bằng chứng blockchain".
  - Blockchain đang tắt → 409 "Chức năng blockchain đang tắt".
  - Chưa `CONFIRMED` → 409 "Bằng chứng chưa được xác nhận trên blockchain".
  - Khác network đang cấu hình → 409.
  - Dựng lại payload từ dữ liệu hiện tại, với hash tham chiếu và `disposedByUserId` lấy từ `snapshot`/version. Đọc hash trên chain tại `contract_address` của chính version đó:
    - lỗi RPC → `FAILED` "Không kết nối được blockchain";
    - chưa có trên chain → `MISMATCH` "Không tìm thấy bản ghi trên blockchain";
    - khác `data_hash` → `MISMATCH` "Hash trên blockchain khác hash đã lưu trong hệ thống";
    - hash tính lại khác → `MISMATCH` "Dữ liệu hiện tại khác dữ liệu đã neo: <các trường khác so với snapshot>";
    - còn lại → `VERIFIED` "Dữ liệu khớp với bản ghi trên blockchain".
  - Lưu `verification_status`, `verification_result` (tối đa 500 ký tự), `verified_at`.

Phản hồi cho mỗi version: `id, kind, recordId, version, eventType, dataHash, transactionStatus, transactionHash, blockNumber (chuỗi), networkName, explorerUrl (chỉ khi Sepolia và có transactionHash), recordedAt, verificationStatus, verificationResult, verifiedAt`. Thời gian theo ISO.

## Khi tắt blockchain

`BLOCKCHAIN_ENABLED=false` là mặc định. Khi tắt: không tạo version, không đọc file deployment, ba luồng nghiệp vụ chạy như cũ. API `anchor` và `verify` trả 409.

## Biến môi trường

| Biến                            | Ý nghĩa                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `BLOCKCHAIN_ENABLED`            | `true` để bật; mặc định `false`                                                                                                 |
| `BLOCKCHAIN_NETWORK`            | `localhost` hoặc `sepolia`, lưu vào `network_name`                                                                              |
| `BLOCKCHAIN_RPC_URL`            | RPC của mạng đó                                                                                                                 |
| `BLOCKCHAIN_DEPLOYMENT_PATH`    | File JSON deployment, mặc định `./blockchain/FoodPrintHashRegistry.json`                                                        |
| `BLOCKCHAIN_WRITER_PRIVATE_KEY` | Tiến trình API đọc để ký; `0x` + 64 hex. Bỏ trống thì `blockchain.ts` dùng tài khoản #0 của RPC, chỉ chạy được với Hardhat node |

Mỗi lần gửi, `blockchain.ts` kiểm tra chain ID khớp file deployment và contract có tồn tại; sai thì version `FAILED`. Thông báo lỗi không in giá trị bí mật. Vì `blockchain.ts` mặc định trỏ tới thư mục `FoodPrintBlockChain`, `.env.example` luôn đặt `BLOCKCHAIN_DEPLOYMENT_PATH`.

## Kiểm tra chấp nhận

- Kiểm nhận kết thúc (`RECEIVED` hoặc `REJECTED`) tạo đúng một version 1 trong cùng transaction. Rollback thì không còn version. Còn `PENDING_APPROVAL` hoặc ký lặp lại thì không tạo.
- Hoàn thành mẻ tạo một version 1, chứa hash kiểm nhận của từng lô (lô cũ thì `null`). Gọi lại trên mẻ đã hoàn thành không tạo thêm.
- Lưu mẫu tạo version 1 `STORED`. Tiêu huỷ tạo version 2 `DISPOSED` trỏ về version 1. Gọi lặp lại không tạo thêm.
- Sau khi commit, version được gửi ngầm và chuyển `CONFIRMED`, có `transaction_hash`, `block_number`, `recorded_at`. RPC lỗi thì nghiệp vụ vẫn thành công, version `FAILED` và gửi lại được qua API `anchor` mà không ghi trùng lên chain.
- Verify trả `VERIFIED` khi dữ liệu không đổi, và `MISMATCH` kèm tên trường khi dữ liệu đã neo bị sửa.
- Tắt blockchain thì nghiệp vụ không thay đổi.
