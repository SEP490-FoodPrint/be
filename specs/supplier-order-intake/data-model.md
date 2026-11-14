# Data Model: Supplier order intake

## Phạm vi dữ liệu

Tái sử dụng schema PostgreSQL/Prisma đã có. Không thêm bảng, cột, enum, index, trigger hoặc migration; không seed quyền hay tài khoản. Các grants view/accept cho cả hai role đã có trong permission catalog.

## SupplyRequest — yêu cầu cung ứng

| Field hiện có                                                          | Ý nghĩa / cách dùng                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| id                                                                     | UUID kỹ thuật, dùng để đọc chi tiết/tiếp nhận.                  |
| requestNo                                                              | Mã yêu cầu duy nhất, chỉ đọc trong tính năng này.               |
| schoolId / supplierId                                                  | Hai đơn vị của đơn; supplierId phải khớp membership actor.      |
| status                                                                 | DRAFT, SENT, ACCEPTED, IN_PROGRESS, COMPLETED, CANCELLED.       |
| requestedDeliveryDate                                                  | Ngày mong muốn, nullable; đầu ra YYYY-MM-DD.                    |
| note                                                                   | Ghi chú yêu cầu, nullable.                                      |
| sentAt                                                                 | Thời điểm gửi nullable; không suy đoán cho dữ liệu cũ.          |
| acceptedByUserId                                                       | UUID người nhận đầu tiên, nullable; FK User.                    |
| acceptedAt                                                             | Thời điểm nhận đầu tiên, nullable.                              |
| createdAt / updatedAt                                                  | Mốc thời gian hiện có, đầu ra ISO 8601 UTC.                     |
| contractId / contractSnapshot / createdByUserId / supplierResponseNote | Giữ nguyên dữ liệu, không đưa vào projection của tính năng này. |

Quan hệ: SupplyRequest thuộc một School và Supplier, có nhiều SupplyRequestItem và một người tiếp nhận tùy chọn. Không truy vấn toàn bộ hồ sơ User để trả thông tin người nhận.

Index hiện có `(supplierId,status)`, `(schoolId,status)`, acceptedByUserId; giữ nguyên. Danh sách giữ thứ tự id tăng dần như module hiện hành, không thêm thứ tự thời gian hay index chưa được yêu cầu.

## SupplyRequestItem — dòng yêu cầu

| Field / quan hệ               | Cách dùng                                                                |
| ----------------------------- | ------------------------------------------------------------------------ |
| id                            | UUID dòng, sắp xếp tăng dần khi trả chi tiết.                            |
| supplyRequestId               | Liên kết đến yêu cầu thuộc supplier scope.                               |
| ingredientEntryId             | Nguyên liệu trong danh mục riêng của trường.                             |
| requestedQuantity             | Decimal(14,3), serialize bằng chuỗi thập phân, không chuyển sang Number. |
| unit                          | Đơn vị đã lưu trong yêu cầu, không lấy defaultUnit hiện tại.             |
| note                          | Ghi chú dòng, nullable.                                                  |
| IngredientEntry -> Ingredient | Lấy tên Ingredient hiện tại; không lọc status ACTIVE.                    |

Giữ unique `(supplyRequestId,ingredientEntryId)` và ràng buộc số lượng của schema/migration hiện hành. Tính năng chỉ đọc dòng; không tạo, xóa hoặc sửa số lượng/đơn vị. Tên nguyên liệu hiện tại có thể khác lúc gửi vì chưa có snapshot tên.

## School, Supplier, User và quyền

- School chỉ được select id/name để hiển thị; trạng thái admin trường dùng trong kiểm tra nhận mới.
- Supplier lấy từ membership hiện hành, intakeState quyết định có được nhận mới. Không dùng supplierId do người dùng tự nhập.
- User actor phải ACTIVE, org SUPPLIER và role ADMIN hoặc STAFF đúng mã hiện hành. Denial và inactive permission vẫn có hiệu lực. Người nhận là actor của lần transition thành công đầu tiên.
- Với đọc, principal được nạp theo từng request. Với ghi, guard nạp lại actor/quyền/membership và trạng thái nghiệp vụ trong cùng tx với cập nhật.

## Chuyển trạng thái trong tính năng

| Trạng thái hiện tại | List/detail SUPPLIER | POST accept                               |
| ------------------- | -------------------- | ----------------------------------------- |
| DRAFT               | Ẩn / 404             | 404, không ghi                            |
| SENT                | Hiển thị             | ACCEPTED nếu đủ điều kiện; ghi actor/time |
| ACCEPTED            | Hiển thị             | Trả receipt cũ, không ghi                 |
| IN_PROGRESS         | Hiển thị             | Trả receipt cũ, không ghi                 |
| COMPLETED           | Hiển thị             | 409, không ghi                            |
| CANCELLED           | Hiển thị             | 409, không ghi                            |

Ngoài scope luôn 404 với detail/accept. Với dữ liệu lịch sử thiếu sentAt/acceptedAt/acceptedByUserId, giữ null; không dùng sentAt làm điều kiện ẩn bổ sung ngoài tập trạng thái quy định.

## Nguyên tử và đồng thời

- Service giữ boundary `authorizationTransaction` Serializable; tối đa ba lượt khi lỗi conflict được nhận diện.
- Khóa theo protocol hiện có: School -> Supplier -> User (ID tăng dần trong mỗi loại) -> Role actor FOR SHARE -> yêu cầu; nạp lại actor và đơn sau khóa.
- Cùng tx cho guard và các repository reads/writes. Có role check sau reload trước cả return receipt; DRAFT được che ở lần resolve ban đầu và lần đọc lại.
- Update có điều kiện id + supplierId + SENT, ghi status/acceptedByUserId/acceptedAt cùng lần; đọc receipt sau ghi trong cùng tx.
- Retry không kiểm tra intake như nhận mới và không đổi updatedAt. Thao tác thất bại rollback toàn bộ.
- Không mở API hủy mới. Khi kiểm chứng trạng thái bị hủy đồng thời, harness dùng cùng thứ tự khóa để xác minh tiếp nhận từ chối khi CANCELLED đã thắng thứ tự xử lý; không mô tả hủy và nhận cùng thành công một lần.
