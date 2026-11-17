# Data Model: Nhà cung cấp xem trường đã liên kết

**Spec**: [spec.md](spec.md) | **Contract**: [supplier-schools-api.md](contracts/supplier-schools-api.md)

## Phạm vi dữ liệu

Chỉ dùng model hiện có trong `prisma/schema.prisma`, schema foodprint. Không thêm/đổi trường, index, khóa hoặc migration. Các kiểu dưới đây mô tả projection/API, không phải model lưu trữ mới.

## 1. Trusted access scope

`SupplierSchoolReadScope = { readonly supplierId: string }`, được tạo từ principal sau kiểm tra admin SUPPLIER có quyền view hoặc manage liên kết hiệu lực. Không nhận scope từ params/query/body; schoolId/contractId/documentId chỉ là định danh tài nguyên phải được đối chiếu với scope.

## 2. School

| Trường                                                         | Kiểu API             | Sử dụng                                               |
| -------------------------------------------------------------- | -------------------- | ----------------------------------------------------- |
| id                                                             | UUID                 | Danh sách và chi tiết                                 |
| name                                                           | string               | Danh sách và chi tiết                                 |
| code, address, email, phone                                    | string hoặc null     | Danh sách và chi tiết; address ánh xạ từ address_line |
| status                                                         | ACTIVE hoặc INACTIVE | Trạng thái trường, tách biệt liên kết                 |
| description, websiteUrl, logoUrl, coverImageUrl, boardingScale | string hoặc null     | Chỉ chi tiết                                          |

Quan hệ School→SchoolSupplierRelationship và School→SupplierContract được áp supplierId tin cậy. Không chọn users, classes, students, registrations, lịch bếp hoặc dữ liệu hoạt động khác.

## 3. SchoolSupplierRelationship và quan hệ đại diện

Các trường nội bộ: id, schoolId, supplierId, status, linkedAt, suspendedAt, unlinkedAt, suspensionReason, unlinkReason. Chỉ đọc; không gửi actorId, linkNote hoặc nhật ký sự kiện.

API trả nested `relationship`:

| Trường                         | Kiểu API                        | Sử dụng               |
| ------------------------------ | ------------------------------- | --------------------- |
| status                         | ACTIVE, SUSPENDED hoặc UNLINKED | Danh sách và chi tiết |
| linkedAt                       | ISO UTC timestamp               | Danh sách và chi tiết |
| suspendedAt, unlinkedAt        | ISO UTC timestamp hoặc null     | Chi tiết              |
| suspensionReason, unlinkReason | string hoặc null                | Chi tiết              |

Invariants hiện có: partial unique `uq_school_supplier_current` cho schoolId+supplierId khi ACTIVE/SUSPENDED; một cặp có nhiều UNLINKED.

Thuật toán đại diện cho từng schoolId trong một supplier:

1. Chọn nhóm ACTIVE/SUSPENDED trước UNLINKED.
2. Trong nhóm, chọn linkedAt DESC rồi id ASC.
3. Sau khi chọn đúng một quan hệ cho mỗi trường, sắp các trường theo linkedAt của đại diện DESC rồi schoolId ASC; sau đó mới phân trang.

Cả list và detail dùng cùng quy tắc. Không dùng trường status=ACTIVE để lọc hồ sơ; không loại lịch sử UNLINKED. Quan hệ đại diện không quyết định danh sách hợp đồng chỉ thuộc đợt hiện tại.

## 4. SupplierContract và SupplierContractItem

| Trường API                 | Kiểu                            | Mapping/quy tắc                                   |
| -------------------------- | ------------------------------- | ------------------------------------------------- |
| id                         | UUID                            | SupplierContract.id                               |
| number                     | string hoặc null                | Giá trị hiện có                                   |
| status                     | ACTIVE hoặc CLOSED              | DRAFT loại ở query                                |
| signedOn, startsOn, endsOn | YYYY-MM-DD hoặc null            | Date-only, không chuyển ngày theo timezone client |
| scopeNote                  | string hoặc null                | Phạm vi cung cấp                                  |
| ingredients                | mảng { id: UUID, name: string } | ContractItem→Ingredient, sắp ingredientId ASC     |
| activatedAt, closedAt      | ISO UTC timestamp hoặc null     | Giữ giá trị hiện có                               |
| closeReason                | string hoặc null                | Giữ giá trị hiện có                               |
| documents                  | mảng metadata mục5              | SIGNED_CONTRACT/APPENDIX, không bytes             |

Trường persistence dùng lọc/sort nhưng không trả: schoolId, supplierId, relationshipId, createdAt. List và detail contract dùng cùng allowlist trên. Sort list createdAt DESC/id ASC, page độc lập. Không loại nguyên liệu đã INACTIVE khỏi hợp đồng lịch sử; vẫn là danh mục đã ghi nhận, không suy diễn đơn giá hoặc số lượng.

Điều kiện đọc: đúng schoolId+supplierId, status ACTIVE/CLOSED và cặp có ít nhất một quan hệ bất kỳ. Không yêu cầu relationshipId hiện tại hoặc khác null; không kiểm tra ngày hiệu lực để cho phép đọc. Không trả snapshot, certification/exemption, revision, users hoặc eligibility/issues nội bộ.

## 5. SupplierContractDocument

| Metadata API | Kiểu                          |
| ------------ | ----------------------------- |
| id           | UUID                          |
| kind         | SIGNED_CONTRACT hoặc APPENDIX |
| fileName     | string                        |
| mimeType     | string                        |
| size         | integer byte                  |
| createdAt    | ISO UTC timestamp             |

Metadata sắp createdAt ASC/id ASC để có thứ tự cố định. Không chọn sha256, uploadedByUserId hoặc content khi list/detail hợp đồng; số tệp không bị cắt ngầm.

Nội dung chỉ được chọn ở endpoint tệp riêng: scope phải khớp schoolId+supplierId+contractId+documentId, trạng thái hợp đồng và kind hợp lệ, parent pair có quan hệ. Service trả binary DTO riêng `{ fileName, mimeType, content: Uint8Array }`, map allowlist và kiểm tra bytes/MIME hợp lệ trước khi controller gửi. Không serialize DTO này thành JSON.

Tài liệu COMPLIANCE, DRAFT hoặc tài nguyên ngoài scope đều như không tìm thấy. Bản ghi thiếu404; bytes rỗng/không hợp lệ hoặc lỗi đọc503. Không dựa vào tổ chức hiện tại của uploader.

## 6. Pagination và validation

- Mỗi list nhận `{ page, limit }`: số nguyên dương, default1/20, limit<=100, offset=(page-1)*limit<=2147483647, Number.isSafeInteger.
- Query lạ (kể cả supplierId, organizationId, schoolId hoặc status) bị400; không thêm filter chưa có trong spec.
- Params UUID được validate và chuẩn hóa lowercase bằng requestUuidSchema.
- Detail trường/contract chỉ nhận query rỗng. Nội dung tệp chỉ nhận disposition=inline|attachment, default inline.
- Response list: `{ items, pagination: { page, limit, hasNext } }`; lấy limit+1 trước khi cắt và map; không yêu cầu total/count.
- Trường thuộc scope nhưng chưa có hợp đồng: items rỗng200; parent không tồn tại/ngoài scope:404.

## 7. State và serialization

Không có state transition hoặc side effect trong tính năng. ACTIVE hợp đồng không có nghĩa đang trong thời hạn; CLOSED không làm mất quyền đọc lịch sử. Tất cả optional nullable giữ null, mảng trống là []; Date serialize theo kiểu timestamp/date-only đã định nghĩa. Mọi projection chỉ gồm trường allowlist, không spread persistence record.

## 8. Cấu hình quyền

Thêm default grant existing supplier_relationship.view cho INGREDIENT_SUPPLIER_ADMIN trong catalog source. Không tạo permission/grant tự động ở runtime, không sửa inactive flags hoặc current-org denial. Role đã tồn tại cần operator cấu hình riêng; default catalog không phải thay đổi schema hoặc lệnh seed được thực thi bởi plan.
