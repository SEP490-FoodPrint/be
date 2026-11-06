# HTTP Contract: School & Supplier Directory

**Base path**: /api | **Spec**: [spec.md](../spec.md)

Mọi endpoint dưới đây là GET, dùng session/authentication hiện hành. Không yêu cầu CSRF header cho GET. Success 200 theo sendSuccess:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công",
  "data": {}
}
```

data phụ thuộc endpoint. Lỗi theo sendError: success=false, statusCode, message tiếng Việt, error tùy chọn. Validation trả error.fields là mảng {field,message}; không phản chiếu giá trị hoặc key lạ trong message. Không thêm code lỗi của /api/v1 vào API này.

## Endpoint và quyền

| Endpoint                                           | Permission                                                                     | Phạm vi                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| /schools                                           | school.manage                                                                  | SYSTEM toàn bộ; SCHOOL own                                                           |
| /schools/summary                                   | school.manage                                                                  | Chỉ SYSTEM_ADMIN thuộc SYSTEM                                                        |
| /schools/:id                                       | school.manage                                                                  | SYSTEM toàn bộ; SCHOOL own                                                           |
| /schools/:schoolId/classes                         | class.view                                                                     | SYSTEM toàn bộ; SCHOOL own                                                           |
| /schools/:schoolId/suppliers                       | supplier_relationship.view OR supplier_relationship.manage                     | SYSTEM toàn bộ; SCHOOL own; SUPPLIER quan hệ của chính supplier tại trường được chọn |
| /schools/:schoolId/accounts                        | user.manage với SYSTEM; school_user.manage và SCHOOL_ADMINISTRATION với SCHOOL | SYSTEM toàn bộ; SCHOOL own; SUPPLIER không có phạm vi tài khoản trường               |
| /suppliers                                         | supplier.view OR supplier.manage                                               | SYSTEM toàn bộ; SUPPLIER own; SCHOOL qua quan hệ ACTIVE/SUSPENDED                    |
| /suppliers/summary                                 | supplier.view OR supplier.manage                                               | Chỉ SYSTEM_ADMIN thuộc SYSTEM                                                        |
| /suppliers/:id                                     | supplier.view OR supplier.manage                                               | Như danh sách supplier                                                               |
| /suppliers/:supplierId/certifications              | supplier_certification.view                                                    | SYSTEM toàn bộ; SUPPLIER own; SCHOOL không được mở                                   |
| /supplier-certifications/:id/documents/:documentId | supplier_certification.view                                                    | SYSTEM toàn bộ; SUPPLIER own                                                         |

Nhóm con dùng quyền nhóm, không đòi thêm school.manage/supplier.view. Scope tương ứng từ resource-access là bắt buộc, không chỉ permission. Params chỉ thu hẹp scope. System Admin thiếu permission vẫn 403. Tài khoản chưa ACTIVE không có quyền nghiệp vụ. Không thêm/grant quyền tự động.

## Query và params

Hai list /schools và /suppliers nhận đúng:

| Query  | Dạng                  | Mặc định/quy tắc                               |
| ------ | --------------------- | ---------------------------------------------- |
| page   | Chuỗi số nguyên dương | 1; safe integer                                |
| limit  | Chuỗi số nguyên dương | 20; tối đa 100                                 |
| search | Chuỗi đơn             | Trim, tối đa 255 sau trim; blank như không gửi |
| status | ACTIVE hoặc INACTIVE  | Không gửi thì cả hai                           |

offset=(page-1)*limit không vượt 2147483647. Từ chối giá trị lặp/array/object, unknown key, status rỗng, chữ thường hoặc nhiều trạng thái. Search một phần tên OR mã (code/taxCode), không phân biệt hoa/thường, có phân biệt dấu; %, _ và backslash là ký tự literal.

Nhóm con nhận đúng page/limit với cùng quy tắc. Summary/detail/document chỉ nhận query rỗng. Mọi ID path là UUID hợp lệ (không phân biệt hoa/thường); không có body. sortBy/sortOrder chưa hỗ trợ.

Ví dụ: /schools?page=1&limit=5&search=Hoa&status=ACTIVE. Bộ lọc áp dụng trước phân trang.

## Hai danh sách và chi tiết cơ bản

data danh sách:

```json
{
  "items": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Trường Hoa",
      "code": "TH-HOA",
      "email": "contact@example.com",
      "phone": null,
      "address": "Địa chỉ đã lưu",
      "status": "ACTIVE",
      "createdAt": "2026-11-07T00:00:00.000Z",
      "updatedAt": "2026-11-07T00:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 12, "hasNext": true }
}
```

Supplier thay code bằng taxCode; hai mã nullable, email/phone/address nullable; id/name/status/timestamps bắt buộc. Date là ISO 8601. Địa chỉ không ghép fallback hoặc lấy từ applicant. Thứ tự id tăng dần.

Detail trả trực tiếp một item cùng shape trong data, bao gồm INACTIVE, không nhúng nhóm liên quan. Không lấy bản ghi từ trang danh sách hoặc fallback public detail. Trường public chỉ ACTIVE giữ nguyên.

Pagination chung: total sau scope/search/status, trước chia trang; hasNext = offset + số items < total. Vượt trang cuối trả items=[], total thực, hasNext=false; không có kết quả trả total=0. Count/items cùng snapshot.

## Summary

data mỗi summary:

```json
{ "total": 100, "activeCount": 85 }
```

Đếm toàn bộ scope loại đơn vị, total gồm ACTIVE/INACTIVE, activeCount chỉ ACTIVE. Query danh sách không được gửi sang summary. Dữ liệu trống 0/0.

## Dữ liệu trường

Mỗi endpoint con trả data={items,pagination} theo quy tắc chung, order id asc. Parent không tồn tại/ngoài scope trả 404; parent có scope và chưa có children trả 200 danh sách rỗng.

### Classes

Mỗi item: id, schoolId, name, academicYear (string|null), registeredMealPortions (integer), status (ACTIVE|INACTIVE), createdAt, updatedAt. Bao gồm mọi năm học/trạng thái đã lưu, không lọc năm học ngầm.

### Suppliers (quan hệ)

Mỗi item: id (quan hệ), schoolId, supplierId, supplierName (string), supplierStatus (ACTIVE|INACTIVE), status (ACTIVE|SUSPENDED|UNLINKED), linkedAt, unlinkedAt (ISO|null), suspendedAt (ISO|null), createdAt, updatedAt.

Giữ mọi lần liên kết, kể cả UNLINKED; không gộp theo supplierId. SUPPLIER chỉ nhận quan hệ của chính mình, không nhận danh sách supplier khác tại trường. Quyền supplier relationship không thay thế quyền xem hồ sơ supplier.

### Accounts

Mỗi item: id, schoolId, fullName, email, roleCode, roleName, status theo AccountStatus hiện hành. Chỉ tài khoản có schoolId đúng trường, bao gồm UNVERIFIED, ACTIVE, INACTIVE, LOCKED và DEACTIVATED đang gắn trường. roleCode/name từ Role, không đổi code/label hiện có; không trả password, token, grants.

## Chứng nhận nhà cung cấp

data={items,pagination}, order id asc. Parent supplier hợp lệ và không có chứng nhận → rỗng; ngoài scope/không tồn tại →404.

Mỗi item: id, supplierId, certificationType, certificateNo, issuedDate (ISO|null), expiryDate (ISO|null), status (ACTIVE|INACTIVE), createdAt, updatedAt, documents.

documents là mảng:

```json
[
  {
    "id": "22222222-2222-4222-8222-222222222222",
    "field": "certificate_0",
    "format": "pdf",
    "fileName": "giay-chung-nhan.pdf",
    "bytes": 102400
  }
]
```

Giữ thứ tự metadata đã lưu trong nhóm. format thuộc pdf/png/jpg theo adapter hiện có; bytes safe integer dương. Không file hợp lệ →[]. Không trả documentUrl/publicId, profileData hoặc URL ký số trong list. Chứng nhận hết hạn/INACTIVE vẫn đọc được, không tự đổi status.

## Xem hoặc tải từng minh chứng

GET /supplier-certifications/:id/documents/:documentId trả data:

```json
{ "url": "<URL có chữ ký từ storage adapter>", "expiresIn": 60 }
```

Header Cache-Control: no-store. Chỉ tạo URL sau khi kiểm tra scope chứng nhận, anchor hồ sơ APPROVED/SUPPLIER và tệp trong đúng nhóm certificate_N của anchor. Không cần registration.view tại endpoint này. Endpoint review tài liệu hồ sơ hiện có giữ quyền cũ.

URL inline hỗ trợ xem PDF/ảnh, người dùng tải bằng trình xem; hết hạn thì gọi lại endpoint để lấy URL mới. Không đảm bảo backend biết trước asset đã bị xóa tại provider khi metadata vẫn còn; provider báo lỗi khi mở URL trong tình huống đó.

## Lỗi và thứ tự kiểm tra

| HTTP | Điều kiện                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 400  | Query/params sai, quá giới hạn hoặc key không hỗ trợ                                                       |
| 401  | Thiếu/sai/hết phiên                                                                                        |
| 403  | Người dùng không ACTIVE, thiếu quyền, summary sai role/org hoặc loại tổ chức không được mở tài nguyên      |
| 404  | ID hợp lệ nhưng tài nguyên/parent ngoài scope, không tồn tại, tệp sai nhóm hoặc không có metadata khả dụng |
| 503  | DB/session/storage tạm lỗi; không trả URL dự phòng công khai                                               |
| 429  | Rate limiter hiện có từ chối                                                                               |

Middleware auth/permission có thể trả 401/403 trước validation. Sau validation thành công, mọi truy vấn đối tượng dùng trusted scope; không kiểm tra existence toàn cục rồi lộ sự tồn tại ngoài tenant. Với groups rỗng, cần parent check có scope trước khi trả 200.

## Tương thích và tích hợp

Generic GET /classes, /users, /school-supplier-relationships, /supplier-certifications giữ page/limit, envelope và trường cũ. Endpoint mới ở trên bổ sung khả năng lấy dữ liệu theo parent; không cần thêm filter cho generic API. Hai list school/supplier thêm trường, giữ page/limit/hasNext. Frontend gọi summary riêng; lấy detail trực tiếp theo ID; tải nhóm theo quyền và xử lý 403 từng nhóm; gọi file endpoint khi mở tệp.
