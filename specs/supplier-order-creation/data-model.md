# Data Model: Supplier order creation

## Đích thiết kế

Mở rộng `foodprint.deliveries` và `foodprint.delivery_items`, giữ dữ liệu và identifiers hiện có. Không thêm bảng đơn thương mại hay yêu cầu giả. Độc lập bắt buộc trường nhận, không bắt buộc SupplyRequest/Delivery trước. Enum mới DeliveryCreationMode gồm REQUEST/STANDALONE; creationMode null đánh dấu legacy nội bộ.

## Delivery

| Field                                                             | Thiết kế                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| id / deliveryNo                                                   | Giữ PK/unique cũ; new deliveryNo DG-<UUID>, không nhận từ body.               |
| schoolId                                                          | Mới, UUID NOT NULL, FK School; ownership school chuẩn cho mọi phiếu.          |
| supplierId                                                        | Giữ, lấy từ AuthPrincipal.                                                    |
| supplyRequestId                                                   | Chuyển nullable; REQUEST bắt buộc, STANDALONE phải null.                      |
| creationMode                                                      | Mới, enum nullable; legacy null có nguồn, new REQUEST/STANDALONE.             |
| creationKey                                                       | Mới, UUID nullable cho legacy; new POST bắt buộc từ Idempotency-Key.          |
| creationFingerprint                                               | Mới, varchar(64) nullable legacy; SHA-256 canonical input, không chứa secret. |
| createdByUserId                                                   | Giữ nullable lịch sử; các đơn tạo mới bắt buộc actor hiện hành.               |
| status                                                            | DeliveryStatus hiện có, tạo CREATED; không thêm enum lifecycle.               |
| expectedArrivalAt / vehiclePlate / note                           | Giữ nullable.                                                                 |
| arrivedAt / receivedByUserId / receivedAt / createdAt / updatedAt | Giữ quy tắc và dữ liệu cũ.                                                    |

Ràng buộc SQL mới: mode null chỉ được phép khi có nguồn và creationKey/fingerprint null; REQUEST có nguồn; STANDALONE nguồn null. Mode khác null yêu cầu key/fingerprint/actor khác null. Giữ CHECK RECEIVED có người/thời điểm nhận. FK schoolId bảo đảm trường tồn tại; cùng supplier/school với nguồn được service kiểm tra trong transaction.

Index mới: (schoolId,status), (supplierId,createdAt,id); unique partial supplyRequestId WHERE creation_mode='REQUEST'; unique partial (supplierId,createdByUserId,creationKey) WHERE creation_key IS NOT NULL. Predicate Prisma partialIndexes phải phản ánh đúng SQL; không unique toàn cục supplyRequestId.

Public sourceType suy từ creationMode, legacy có nguồn trả REQUEST. Không trả creationFingerprint hoặc creationKey trong DTO nghiệp vụ. Quy tắc mới một đơn từ yêu cầu không được dùng để sửa/xóa nhiều phiếu lịch sử.

## DeliveryItem

| Field               | Thiết kế                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| id / deliveryId     | Giữ PK/FK.                                                                                          |
| ingredientId        | Mới, UUID NOT NULL, FK Ingredient, định danh nguyên liệu chuẩn.                                     |
| ingredientEntryId   | Mới, UUID nullable, FK IngredientEntry; backfill nguồn, lookup standalone nếu có.                   |
| supplyRequestItemId | Chuyển nullable; sourced bắt buộc đúng dòng nguồn, standalone null.                                 |
| actualQuantity      | Giữ Decimal(14,3)>0; ở CREATED là lượng được lập giao, REQUEST bằng requestedQuantity.              |
| unit / note         | Giữ; REQUEST copy unit/note dòng nguồn, STANDALONE unit phải bằng Ingredient.defaultUnit hiện hành. |

Giữ unique cũ (deliveryId,supplyRequestItemId); thêm unique (deliveryId,ingredientId) cho một nguyên liệu mỗi đơn. Service xác minh mỗi item có đúng source mode của parent, Ingredient.supplierId trùng parent và entry nếu có thuộc schoolId/ingredientId của parent. Không dùng CHECK để giả kiểm tra bảng khác, không thêm trigger.

Standalone creation không tạo IngredientEntry. Trước receipt, repository tìm entry trường/nguyên liệu đã cấu hình và service kiểm tra mapping/handlingType, gắn ingredientEntryId cùng transaction với receipt. Không có mapping -> 409, không nhập kho. Kitchen/menu dùng mapping chuẩn; không có nguồn thì không dereference SupplyRequestItem.

## Migration và dữ liệu lịch sử

1. Thêm enum/cột nullable trước, chưa thay FK nguồn ngay.
2. Preflight join tất cả Delivery -> SupplyRequest để backfill schoolId; DeliveryItem -> SupplyRequestItem -> IngredientEntry để backfill ingredientId/ingredientEntryId. Xác minh school/supplier/source của từng dòng nhất quán.
3. Nếu thiếu/mâu thuẫn mapping hoặc duplicate (deliveryId,ingredientId), dừng migration và báo số lượng/ID an toàn để review; không đoán, xóa hoặc gộp dữ liệu.
4. Backfill cột mới bằng mapping xác định; không thay mã, số lượng, trạng thái, các quyết định hoặc timestamps nghiệp vụ cũ. SQL backfill không cập nhật updated_at vì không sửa nội dung giao dịch lịch sử.
5. Đặt schoolId và ingredientId NOT NULL; nguồn nullable; thêm FK/index/CHECK mới. Legacy creationMode/key/hash giữ null, không sinh key hoặc ép lịch sử vào unique REQUEST.
6. Các fixture/writer hiện có phải thêm canonical fields, không dùng default giả. Review SQL mới cùng schema và SCHEMA_BASELINE.md; giữ applied migrations bất biến.

Không chạy migration/deploy trong bước plan. Khi implement, chỉ viết migration review được; áp dụng thử cần disposable local đã chọn/ủy quyền, remote deploy theo quy định repository. Không reset/drop bảng hoặc seed business data.

## Quy tắc tạo và đồng thời

- REQUEST: nguồn ACCEPTED/IN_PROGRESS, nhưng chưa có bất kỳ phiếu liên quan kể cả legacy; copy mọi dòng/Decimal/unit, create CREATED, nguồn ACCEPTED -> IN_PROGRESS. Có nguồn IN_PROGRESS mà chưa có phiếu chỉ được dùng nếu đủ guard công việc đã nhận. Không nhận field items/schoolId override.
- STANDALONE: school liên kết ACTIVE, school/supplier/admin đủ điều kiện cung ứng mới, nguyên liệu ACTIVE đúng supplier, lượng dương, 1..100 dòng riêng biệt; source FK luôn null. Không cần lịch sử từ chối và không đổi nguồn cũ.
- Replay: actor hiện hành còn quyền/scope + key/hash trùng -> cùng phiếu, không đổi updatedAt; key/hash khác ->409. REQUEST key mới dù cùng nội dung vẫn bị giới hạn nguồn.
- Service mở Serializable transaction, cùng tx cho reload actor, locks, source/relationship/ingredients, lookup replay và create/update. Parent locks trước advisory pair lock, nguồn và ingredient locks sau parent; IDs sắp tăng dần trong mỗi loại. Retry serialization/deadlock qua helper hiện có, không side effect ngoài transaction trước commit.

## Kiểm nhận sau tạo

Các phiếu vẫn cần trạng thái ARRIVED/PENDING_APPROVAL và lô hợp lệ để kiểm nhận; feature không mở transition giao vận hay tự tạo lô. Legacy/REQUEST giữ source budget và cancellation count hiện tại. STANDALONE không có request budget hoặc chuỗi giao lại tự động; vẫn đủ bốn approval mới RECEIVED, một REJECT đóng phiếu. Bất kỳ reject nào cũng không được gọi cancelRemainder(null) hoặc sửa yêu cầu khác.
