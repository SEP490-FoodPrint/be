# Phân loại xe giao đồ khô / đồ tươi theo mặt hàng

## Context

Trước đây backend coi mọi xe của một "NCC đồ khô" (NCC có nhiều nguyên liệu `DRY_STOCK` hơn `DIRECT_USE` trong danh mục ACTIVE của trường) là xe đồ khô, kể cả khi xe thuộc đơn đồ tươi và chở hàng tươi. Hệ quả: xe tươi chỉ cần Ban quản lý nguyên liệu duyệt (1/1), bỏ qua cấu hình phân nhóm duyệt của Ban Giám Hiệu.

## Requirements

- **FR-001**: Một đợt giao (Delivery) chỉ là xe đồ khô khi có ít nhất 1 dòng hàng và **mọi** dòng hàng có `handlingType = DRY_STOCK` (lấy từ `IngredientEntry` của dòng, nếu không có thì từ `SupplyRequestItem.IngredientEntry`).
- **FR-002**: Chỉ cần 1 dòng hàng không phải `DRY_STOCK` (đồ tươi) thì đợt giao là đồ tươi: áp dụng cấu hình phân nhóm duyệt của trường (PRIMARY xác nhận xe đến; PRIMARY + mọi REQUIRED duyệt để tiếp nhận), mọi bộ phận kiểm tra đều thấy xe.
- **FR-003**: Bỏ hoàn toàn suy luận "NCC đồ khô" theo danh mục nguyên liệu; nhà cung cấp không ảnh hưởng tới phân loại xe.
- **FR-004**: Xe đồ khô giữ nguyên hành vi hiện có: chỉ Ban quản lý nguyên liệu thấy, xác nhận xe đến và duyệt.
- **FR-005**: Không đổi schema, migration, response envelope hay API contract.

## Acceptance

1. Xe của NCC có nhiều nguyên liệu khô trong danh mục nhưng chở ít nhất 1 mặt hàng `DIRECT_USE` hiển thị cho Bếp/Dinh dưỡng/Phụ huynh và yêu cầu số bộ phận theo cấu hình trường.
2. Xe mà mọi dòng hàng là `DRY_STOCK` vẫn chỉ Ban quản lý nguyên liệu thấy và duyệt (1/1).
