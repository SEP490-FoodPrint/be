# API Contract: Trường đã liên kết của nhà cung cấp

**Spec**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md)

Thiết kế cho giai đoạn implement; các endpoint dưới đây chưa được triển khai bởi lệnh plan.

## 1. Authentication và access scope

- Dùng xác thực/phiên hiện hành của FoodPrint. Mỗi request tải account ACTIVE, role, membership và effective permissions từ DB.
- Chỉ INGREDIENT_SUPPLIER_ADMIN thuộc SUPPLIER có supplierId, không có schoolId/communeFoodSafetyUnitId.
- Bắt buộc ít nhất một quyền hiệu lực: supplier_relationship.view hoặc supplier_relationship.manage. Hai quyền là OR; grant phải active và không bị denial của người dùng trong tổ chức hiện tại.
- SYSTEM_ADMIN, supplier staff, SCHOOL và AUTHORITY bị403 ở tính năng này dù có các quyền trên; quyền của các API khác giữ nguyên.
- Supplier scope chỉ lấy từ principal. Không nhận supplierId/organizationId làm bộ chọn phạm vi.
- Chức năng chỉ có GET; không thay đổi dữ liệu hoặc quyền đặt hàng.

## 2. Endpoint matrix

Base: `/api/supplier-schools`.

| Method | Path                                                   | Query       | data khi200                |
| ------ | ------------------------------------------------------ | ----------- | -------------------------- |
| GET    | /                                                      | page, limit | SchoolList                 |
| GET    | /:schoolId                                             | rỗng        | SchoolDetail               |
| GET    | /:schoolId/contracts                                   | page, limit | ContractList               |
| GET    | /:schoolId/contracts/:contractId                       | rỗng        | Contract                   |
| GET    | /:schoolId/contracts/:contractId/documents/:documentId | disposition | Bytes, không JSON envelope |

Mọi path parameter là UUID, chuẩn hóa lowercase. Mỗi query object là strict: tham số ngoài bảng, mảng hoặc object bị400; không hỗ trợ status/search/supplierId.

Pagination: page mặc định 1, limit mặc định 20, limit tối đa100; biểu diễn chuỗi số nguyên dương chuẩn, safe integer; offset=(page-1)*limit không vượt2147483647. Trang vượt dữ liệu trả items=[]/hasNext=false khi parent hợp lệ.

Disposition nhận duy nhất inline hoặc attachment, mặc định inline.

## 3. JSON envelope và reusable schemas

Thành công dùng sendSuccess hiện có:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thông báo tiếng Việt theo thao tác",
  "data": {}
}
```

Các kiểu tham chiếu:

```typescript
type Pagination = { page: number; limit: number; hasNext: boolean };
type RelationshipSummary = {
  status: "ACTIVE" | "SUSPENDED" | "UNLINKED";
  linkedAt: string; // ISO UTC timestamp
};
type SchoolListItem = {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
  relationship: RelationshipSummary;
};
type SchoolDetail = Omit<SchoolListItem, "relationship"> & {
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  boardingScale: string | null;
  relationship: RelationshipSummary & {
    suspendedAt: string | null;
    unlinkedAt: string | null;
    suspensionReason: string | null;
    unlinkReason: string | null;
  };
};
type DocumentMetadata = {
  id: string;
  kind: "SIGNED_CONTRACT" | "APPENDIX";
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};
type Contract = {
  id: string;
  number: string | null;
  status: "ACTIVE" | "CLOSED";
  signedOn: string | null; // YYYY-MM-DD
  startsOn: string | null; // YYYY-MM-DD
  endsOn: string | null; // YYYY-MM-DD
  scopeNote: string | null;
  ingredients: { id: string; name: string }[];
  activatedAt: string | null; // ISO UTC timestamp
  closedAt: string | null; // ISO UTC timestamp
  closeReason: string | null;
  documents: DocumentMetadata[];
};
type SchoolList = { items: SchoolListItem[]; pagination: Pagination };
type ContractList = { items: Contract[]; pagination: Pagination };
```

Giữ null và [], không thay bằng dữ liệu tự suy diễn. Không có trường ngoài allowlist. List/detail JSON đặt Cache-Control: private, no-store.

## 4. GET danh sách trường

- Mỗi mục giữ `id` UUID và trả đồng thời `code` là mã trường để hiển thị. `code` chưa có thì null; không dùng mã trường thay `schoolId` trong các đường dẫn chi tiết/hợp đồng.
- Chỉ trường có ít nhất một quan hệ bất kỳ với supplierId hiện tại. DRAFT đơn thuần không làm phát sinh liên kết.
- Mỗi trường một mục. Quan hệ đại diện: ACTIVE/SUSPENDED trước UNLINKED, rồi linkedAt DESC/id ASC.
- Thứ tự danh sách: linkedAt của đại diện DESC, schoolId ASC; chọn đại diện trước phân trang.
- Trả đủ ACTIVE/SUSPENDED/UNLINKED và cả trường INACTIVE. Không gộp trạng thái trường và trạng thái liên kết.
- Nhà cung cấp chưa có quan hệ nhận200 items rỗng.
- Message: "Lấy danh sách trường đã liên kết thành công".

## 5. GET chi tiết trường

- Kiểm tra schoolId có quan hệ bất kỳ với supplierId hiện tại; không cần ACTIVE.
- Chọn cùng đại diện như danh sách, bổ sung thông tin hồ sơ/mốc/lý do theo schema SchoolDetail.
- Không trả nhúng hợp đồng; client dùng endpoint contracts phân trang độc lập. Chưa có hợp đồng không ngăn xem trường.
- Message: "Lấy chi tiết trường đã liên kết thành công".

## 6. GET danh sách và chi tiết hợp đồng

- Parent trường phải có ít nhất một quan hệ với nhà cung cấp hiện tại; không có parent được phép thì404, không trả list rỗng.
- Mọi hợp đồng phải khớp schoolId của path và supplierId tin cậy, status ACTIVE/CLOSED.
- Bao gồm các đợt liên kết cũ, cả relationshipId null khi cặp vẫn có quan hệ. Không bắt relationshipId bằng đại diện hiện tại.
- Không dùng ngày bắt đầu/kết thúc, trạng thái trường hoặc trạng thái quan hệ làm điều kiện đọc.
- List sắp createdAt DESC/id ASC; không xuất createdAt trong contract response chỉ để phục vụ sort. Chưa có hợp đồng được phép:200 items=[].
- Danh mục nguyên liệu sắp id ASC, giữ nguyên cả nguyên liệu ngừng hoạt động. Metadata documents chỉ SIGNED_CONTRACT/APPENDIX, sắp createdAt ASC/id ASC, trả tất cả tệp phù hợp.
- Không chọn/nhúng content, sha256, uploader, snapshot, certification, revision, eligibility hoặc nội dung hồ sơ nội bộ.
- Message list: "Lấy danh sách hợp đồng thành công"; detail: "Lấy chi tiết hợp đồng thành công".

## 7. GET nội dung tệp

Mỗi request độc lập phải xác minh toàn bộ: tài khoản/quyền, cặp có quan hệ, schoolId, supplierId hiện tại, contractId, contract status ACTIVE/CLOSED, documentId và kind SIGNED_CONTRACT/APPENDIX. Không dựa vào request danh sách trước đó hoặc tổ chức hiện tại của uploader.

Thành công200 trả nguyên bytes. Hai chế độ inline/attachment trả cùng nội dung. Đọc và kiểm tra tệp hoàn tất trước khi đặt headers thành công:

| Header                  | Giá trị                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content-Type            | MIME hợp lệ đã lưu: application/pdf, image/png hoặc image/jpeg                                                                                        |
| Content-Disposition     | inline hoặc attachment theo query; fallback filename an toàn và filename* UTF-8 mã hóa theo RFC5987; không chèn tên thô/control characters vào header |
| Content-Length          | Số byte thực của nội dung                                                                                                                             |
| X-Content-Type-Options  | nosniff                                                                                                                                               |
| Content-Security-Policy | sandbox                                                                                                                                               |
| Cache-Control           | private, no-store                                                                                                                                     |

Không redirect, không URL công khai hoặc credentials trong link, không base64 trong JSON. Không cần Range, preview conversion hoặc ký điện tử.

Không có bản ghi hoặc bị loại theo scope/status/kind:404. Có bản ghi nhưng content rỗng, MIME không hợp lệ hoặc không đọc được:503; không gửi200 rỗng. Lỗi trả JSON theo mục8; metadata trường/hợp đồng vẫn xem được bằng request riêng.

## 8. Errors

| HTTP | Trường hợp                                                                                | Nội dung                                                       |
| ---- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 400  | UUID, pagination, query lạ hoặc disposition sai                                           | Validation tổng hợp tiếng Việt, không lộ input thô             |
| 401  | Thiếu/không hợp lệ phiên xác thực                                                         | Theo auth hiện hành                                            |
| 403  | Account không ACTIVE, sai role/org/membership hoặc thiếu quyền hiệu lực                   | Theo auth/scope, không có nội dung tài nguyên                  |
| 404  | Không tồn tại, ngoài cặp/trường/supplier, DRAFT, COMPLIANCE hoặc không có relation parent | Chung message "Không tìm thấy dữ liệu trong phạm vi được phép" |
| 429  | Vượt rate limit                                                                           | Middleware hiện hành                                           |
| 503  | Lỗi đọc/DB/nội dung tệp không hợp lệ hoặc Redis fail-closed                               | Thông báo tiếng Việt đã sanitize, không raw error              |

Ví dụ validation giữ envelope hiện có (không đổi tên error thành errors):

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Nội dung yêu cầu không hợp lệ",
  "error": {
    "fields": [{ "field": "supplierId", "message": "Trường không được phép" }]
  }
}
```

404 dùng cùng status/message cho id hợp lệ nhưng không tồn tại và ngoài phạm vi, không kèm metadata. Invalid UUID vẫn400. Lỗi DB được chuẩn hóa trước global handler, không ghi raw SQL/driver error trong response.

## 9. Compatibility

Giữ nguyên /api/school-supplier-relationships, /api/schools/:schoolId/suppliers, /api/supplier-contracts/:id, /api/supplier-contract-documents/:id và các thao tác ghi hợp đồng phía trường. Default view grant mới chỉ áp cho role admin khởi tạo mới; hệ thống hiện hữu cần operator cấp grant theo [quickstart.md](../quickstart.md), không thay điều kiện bảo vệ endpoint.
