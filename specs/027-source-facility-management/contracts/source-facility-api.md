# Contract: Source Facility API

**Spec**: [../spec.md](../spec.md) | **Data model**: [../data-model.md](../data-model.md)

## 1. Base và điều kiện truy cập

Base: /api/source-facilities. Tất cả endpoint dùng cơ chế session/JWT hiện có theo docs/AUTH_SESSIONS.md, yêu cầu tài khoản ACTIVE, đúng INGREDIENT_SUPPLIER_ADMIN, tổ chức SUPPLIER với supplierId hợp lệ, supplier ACTIVE và permission hiệu lực source_facility.manage. Staff, SYSTEM và vai trò khác bị chặn kể cả được gán permission.

Scope supplier lấy từ AuthPrincipal hiện tại, không từ query/body. Mỗi write kiểm tra lại actor/quyền/membership/supplier và target trong cùng transaction. Các quy tắc cookie/CSRF, rate limiter và phiên Redis của ứng dụng vẫn áp dụng.

sourceFacilityId là UUID thật, chuẩn hóa theo requestUuidSchema. facilityCode không thay UUID trong đường dẫn và không quyết định scope: hai supplier có thể cùng mã FP-SF-00001.

## 2. Năm endpoint

| Method | Path tương đối                | Input                            | Thành công                                     |
| ------ | ----------------------------- | -------------------------------- | ---------------------------------------------- |
| GET    | /                             | page, limit                      | 200; data là trang danh sách                   |
| GET    | /:sourceFacilityId            | UUID params                      | 200; data là chi tiết                          |
| POST   | /                             | Create body                      | 201; data là chi tiết cơ sở mới, mã không null |
| PATCH  | /:sourceFacilityId            | UUID params, Update body         | 200; data là chi tiết sau sửa                  |
| POST   | /:sourceFacilityId/deactivate | UUID params, body absent hoặc {} | 200; data là chi tiết INACTIVE                 |

Không có DELETE hoặc endpoint kích hoạt lại.

## 3. Input và validation

Body là JSON object strict; không nhận array, null hoặc trường ngoài allowlist. Bốn trường tùy chọn có thể gửi null/chuỗi rỗng/chuỗi chỉ khoảng trắng để biểu diễn không có thông tin. Tất cả chuỗi trim trước kiểm tra.

| Trường       | Create                  | Update                       | Quy tắc                                                                            |
| ------------ | ----------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| name         | Bắt buộc                | Optional, omitted giữ nguyên | Chuỗi 1–255 ký tự sau trim, không null; unique trong supplier kể cả cơ sở đã dừng. |
| address      | Optional, mặc định null | Optional, cho clear          | Chuỗi địa chỉ hoặc null; không thêm giới hạn nghiệp vụ mới.                        |
| contactName  | Optional, mặc định null | Optional, cho clear          | Chuỗi tối đa 255 ký tự khi có giá trị.                                             |
| contactPhone | Optional, mặc định null | Optional, cho clear          | Chuỗi tối đa 30 ký tự; không chuyển số, giữ 0 đầu/dấu +.                           |
| contactEmail | Optional, mặc định null | Optional, cho clear          | Chuỗi đúng định dạng email khi có giá trị.                                         |

Update phải có ít nhất một trường hợp lệ; omitted khác với null. Trường readonly luôn bị từ chối khi có trong body, kể cả giá trị null/rỗng/giống hiện tại: id, supplierId, facilityCode, status, isVisible, createdByUserId, updatedByUserId, createdAt, updatedAt.

Create tối thiểu:

```json
{ "name": "Cơ sở rau A" }
```

Create có đầy đủ thông tin người dùng:

```json
{
  "name": "Cơ sở rau A",
  "address": "Địa chỉ cơ sở cung cấp",
  "contactName": "Nguyễn Văn A",
  "contactPhone": "0901234567",
  "contactEmail": "lienhe@example.test"
}
```

Update chỉ sửa địa chỉ và bỏ email:

```json
{ "address": "Địa chỉ mới", "contactEmail": null }
```

List chỉ nhận page và limit dạng chuỗi số nguyên dương an toàn: mặc định page=1, limit=20, limit tối đa 100; offset (page-1)*limit tối đa 2147483647. Không nhận supplierId, search, status hoặc sort. Query không hợp lệ trả 400 theo trường.

Deactivate không nhận status hoặc lý do; absent body được chuẩn hóa thành {}. Gửi trường khác hoặc body null/array bị từ chối 400.

## 4. Output allowlist

| Trường                                           | List item | Detail/create/update/deactivate | Dạng JSON                                           |
| ------------------------------------------------ | --------- | ------------------------------- | --------------------------------------------------- |
| id                                               | Có        | Có                              | UUID string                                         |
| supplierId                                       | Có        | Có                              | UUID string                                         |
| facilityCode                                     | Có        | Có                              | string hoặc null cho legacy; create mới luôn string |
| name                                             | Có        | Có                              | string                                              |
| status                                           | Có        | Có                              | ACTIVE hoặc INACTIVE                                |
| isVisible                                        | Có        | Có                              | boolean                                             |
| createdAt, updatedAt                             | Có        | Có                              | ISO 8601 UTC string                                 |
| address, contactName, contactPhone, contactEmail | Không     | Có                              | string hoặc null                                    |

Không trả actor IDs, quan hệ User, quyền, dữ liệu tổ chức khác, scalar bigint cấp số hoặc bản ghi Prisma trực tiếp.

Success envelope dùng sendSuccess, statusCode trùng HTTP status. Ví dụ một create đầu tiên của supplier:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Thêm cơ sở cung cấp thành công",
  "data": {
    "id": "11111111-1111-4111-8111-111111111111",
    "supplierId": "22222222-2222-4222-8222-222222222222",
    "facilityCode": "FP-SF-00001",
    "name": "Cơ sở rau A",
    "address": null,
    "contactName": null,
    "contactPhone": null,
    "contactEmail": null,
    "status": "ACTIVE",
    "isVisible": true,
    "createdAt": "2026-11-14T03:00:00.000Z",
    "updatedAt": "2026-11-14T03:00:00.000Z"
  }
}
```

List data là object gồm items và pagination với page, limit, hasNext; không thêm total. Thứ tự id tăng ổn định trên tập dữ liệu không đổi. Có cả ACTIVE/INACTIVE, không loại isVisible=false trong danh sách quản trị. Không có kết quả hoặc vượt trang cuối trả items=[] và hasNext=false.

## 5. Quy tắc mã và dừng hoạt động

- Tạo mới tự cấp FP-SF- + số dương pad tối thiểu năm chữ số, dãy riêng từng supplier; A tạo 00001/00002, B vẫn bắt đầu 00001.
- Mã canonical cũ của supplier, kể cả ở cơ sở đã dừng/không hiển thị, được tính khi cấp số; vượt 99999 thành 100000. Không dùng phần số hoặc dãy của hồ sơ đăng ký.
- Mã mới có string không rỗng. Legacy null/không chuẩn được giữ nguyên khi đọc/sửa/dừng; không backfill hoặc sinh lại mã khi đọc.
- Dừng ACTIVE sang INACTIVE giữ mã, isVisible và toàn bộ liên kết; đặt updatedByUserId/updatedAt. Dừng lặp thành công và không ghi lại audit.
- Cơ sở INACTIVE vẫn xem/sửa thông tin được; PATCH không bật lại trạng thái hoặc thay mã.

## 6. Lỗi

| HTTP | Trường hợp                                                                | Hợp đồng                                                                    |
| ---- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 400  | Input/query/params sai, field readonly, PATCH rỗng                        | Gom lỗi tiếng Việt tại error.fields với field/message; không lộ raw values. |
| 401  | Chưa xác thực, phiên/token không hợp lệ                                   | Theo cơ chế auth hiện có.                                                   |
| 403  | Sai role/permission/membership, supplier/tài khoản không ACTIVE           | Không trả dữ liệu cơ sở.                                                    |
| 404  | Target không tồn tại hoặc thuộc supplier khác                             | Cùng thông báo “Không tìm thấy cơ sở cung cấp”.                             |
| 409  | Tên đã tồn tại trong cùng supplier                                        | Thông báo tiếng Việt; không trả dữ liệu cơ sở trùng.                        |
| 429  | Rate limit hiện có                                                        | Giữ hợp đồng limiter ứng dụng.                                              |
| 503  | DB/session/limiter unavailable, hết retry transaction, mã vượt độ dài lưu | Lỗi an toàn, không SQL/credential hoặc kết quả ghi một phần.                |

Ví dụ lỗi validation:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Nội dung yêu cầu không hợp lệ",
  "error": {
    "fields": [
      { "field": "facilityCode", "message": "Trường không được phép" },
      { "field": "name", "message": "Trường không được để trống" }
    ]
  }
}
```

Không yêu cầu thứ tự danh sách lỗi cố định. Root code không được tự bổ sung cho /api/source-facilities; dùng nguyên response helper hiện có. Conflict unique mã được retry nội bộ, không báo nhầm thành lỗi trùng tên 409.

## 7. Truy vết yêu cầu

| Yêu cầu spec                   | Phần hợp đồng | Kiểm chứng chính                                                          |
| ------------------------------ | ------------- | ------------------------------------------------------------------------- |
| FR-001–003, FR-013–014         | 1, 2, 6       | Cả năm thao tác, staff/SYSTEM denied, tenant 404, actor recheck trong tx. |
| FR-004–005, FR-009–010, FR-015 | 3, 4, 6       | Zod strict, normalize/omit, readonly fields, errors, DTO allowlist/ISO.   |
| FR-006–008, FR-017             | 3–5           | Unique scoped, list pagination, numeric max, đồng thời, legacy.           |
| FR-011–012, FR-016             | 4–5           | Dừng lặp, audit bất biến, giữ mã và IngredientLot links.                  |
