# Data Model: Tra cứu đơn vị

**Spec**: [spec.md](spec.md) | **Contract**: [admin-directory.md](contracts/admin-directory.md)

## Mô hình lưu trữ

Không thêm model, cột, index, CHECK hoặc migration. Toàn bộ chức năng là đọc, không có chuyển trạng thái.

| Entity hiện có             | Trường sử dụng                                                                                                         | Quan hệ và giới hạn                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| School                     | id, name, code?, email?, phone?, address?, status, createdAt, updatedAt                                                | classes/users/relationships; code unique khi có giá trị; address ánh xạ address_line |
| Supplier                   | id, name, taxCode?, email?, phone?, address?, status, createdAt, updatedAt                                             | certifications/relationships; taxCode unique khi có                                  |
| Class                      | id, schoolId, name, academicYear?, registeredMealPortions, status, createdAt, updatedAt                                | Thuộc School; số suất đã lưu, không suy ra học sinh                                  |
| SchoolSupplierRelationship | id, schoolId, supplierId, status, linkedAt, unlinkedAt?, suspendedAt?, createdAt, updatedAt                            | Nhiều lần liên kết lịch sử; ACTIVE/SUSPENDED/UNLINKED; unique hiện hành giữ nguyên   |
| User                       | id, schoolId?, fullName, email, roleId, roleCode, status                                                               | Chỉ tài khoản gắn đúng trường; join Role theo FK hiện có                             |
| Role                       | code, name                                                                                                             | Mỗi User một role; không lấy grants                                                  |
| SupplierCertification      | id, supplierId, certificationType, certificateNo, issuedDate?, expiryDate?, documentUrl?, status, createdAt, updatedAt | Unique supplierId/certificateNo; documentUrl dùng nội bộ, không xuất thô             |
| RegistrationRequest        | id, applicantUserId, status, requestType, profileData, supportingDocuments                                             | Chỉ hồ sơ APPROVED/SUPPLIER có anchor chứng nhận hợp lệ                              |

Dấu ? chỉ null của dữ liệu lưu trữ. Loại hồ sơ dùng RegistrationRequest.requestType; không thêm cột hay suy ra loại từ tổ chức hiện tại của applicant.

## Read models và serialization

- School/Supplier item và detail cùng projection cơ bản trong hợp đồng; các giá trị null được giữ nguyên.
- Class item giữ các trường danh sách cũ; registeredMealPortions là integer, không phải Decimal.
- Relationship item giữ các trường cũ, bổ sung supplierName/supplierStatus. status là trạng thái quan hệ, không ghi đè trạng thái supplier.
- School account item: id/schoolId/fullName/email/roleCode/roleName/status. Không passwordHash, username hoặc grants trong endpoint con mới.
- Certification item giữ các trường cũ, thêm documents: danh sách id/field/format/fileName/bytes. documentUrl và publicId không thuộc DTO.
- Thời điểm và ngày chứng nhận serialize ISO 8601 bằng toISOString; ngày cấp/hết hạn null giữ null. Giữ biểu diễn ngày đã có của generic list.
- Pagination: page/limit/total integer, hasNext boolean; summary: total/activeCount integer. Không thêm totalPages trong phiên bản này.

## Liên kết minh chứng

1. Parse documentUrl chỉ nếu khớp chính xác đường dẫn nội bộ /api/registration-requests/<uuid>/documents/<uuid>, không query/fragment/host tùy ý.
2. Đọc hồ sơ APPROVED/SUPPLIER; parse bằng readDocuments(supportingDocuments, applicantUserId), kiểm tra metadata hợp lệ và ID không trùng gây mơ hồ.
3. Anchor tồn tại trong metadata, field khớp certificate_N và index hợp lệ trong profileData.certifications. Anchor xác định nhóm; không tìm tệp bằng tên/số chứng nhận khi anchor hỏng. Kiểm tra ID metadata không trùng, bytes là safe integer dương và format thuộc pdf/png/jpg trước khi xuất DTO.
4. Tệp cùng field tạo nhóm; quyền sở hữu là supplierId của chứng nhận hiện tại qua trusted scope. Không dựa vào applicant hiện thuộc supplier nào.
5. Metadata thiếu/hỏng/không rõ ràng → mảng rỗng, mở tệp 404; không sửa dữ liệu legacy.

## Validation và invariants

- Query list: page/limit dạng chuỗi số nguyên dương; page default 1, limit default 20/max 100, safe integer, offset <=2147483647.
- search: chuỗi đơn, trim rồi max 255, rỗng bỏ điều kiện; status enum ACTIVE/INACTIVE. Từ chối arrays, objects, unknown keys; cả params/query dùng strictObject/safeParse.
- Params UUID; page vượt cuối không tự sửa page.
- Trusted scope AND selector/filter; selector không thể thay scope.
- Một response nhiều truy vấn dùng cùng tx RepeatableRead; giữa các response không giữ snapshot.
- Chỉ mapping allowlist tại service; repository trả persistence result, không import DTO.
