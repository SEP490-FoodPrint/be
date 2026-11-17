# API Contract: Ingredient quality feedback — supplier response

**Feature**: [spec.md](../spec.md) | **Design**: [plan.md](../plan.md)

## 1. Phạm vi và quyền

Base path hiện có: `/api/ingredient-quality-feedback`. Dùng cookie/session đăng nhập hiện hành; JWT identity được nạp lại thành AuthPrincipal ở mỗi request. Mọi thao tác đều cần quyền hiệu lực đang hoạt động và không bị denial trong tổ chức hiện tại.

| Method/path                | Ai được gọi           | Quyền và scope                                                              |
| -------------------------- | --------------------- | --------------------------------------------------------------------------- |
| GET /                      | Supplier ADMIN/STAFF  | view_details; Delivery.supplierId từ principal; output SupplierFeedbackList |
| GET /                      | SCHOOL/SYSTEM hiện có | view_own hoặc view_details; giữ legacy scope/output/order                   |
| GET /:feedbackId           | Supplier ADMIN/STAFF  | view_details; Delivery.supplierId từ principal                              |
| GET /:feedbackId           | SCHOOL                | view_details: cả trường; chỉ view_own: đúng submittedByUserId và trường     |
| POST /:feedbackId/response | Supplier ADMIN/STAFF  | Đồng thời view_details VÀ respond; scoped delivery của supplier             |

Tên đầy đủ các code: `ingredient_quality_feedback.view_own`, `ingredient_quality_feedback.view_details`, `ingredient_quality_feedback.respond`.

Chỉ có view_own không cho supplier truy cập tính năng mới. SCHOOL không được phản hồi; SYSTEM/AUTHORITY không được gọi detail hoặc response mới. SYSTEM không có bypass permission ở list legacy. Quyền mặc định cho cả hai supplier roles đã có trong catalog; tính năng không tự cấp quyền cho role/tài khoản đã tồn tại.

Liên kết ACTIVE hiện tại không phải bằng chứng sở hữu khiếu nại. Supplier vẫn đọc/phản hồi khiếu nại chưa phản hồi thuộc chuyến giao cũ sau SUSPENDED/UNLINKED, hợp đồng hết hạn hoặc trường inactive. Không nhận organization IDs để chọn scope.

## 2. Envelope và kiểu chung

```typescript
type Success<T> = {
  success: true;
  statusCode: 200;
  message: string; // tiếng Việt
  data: T;
};

type Failure = {
  success: false;
  statusCode: number;
  message: string; // tiếng Việt, không raw SQL/request values
  error?: { fields: Array<{ field: string; message: string }> };
};

type Pagination = { page: number; limit: number; hasNext: boolean };
type Status = "SUBMITTED" | "RESPONDED";
type SchoolRef = { id: string; name: string; code: string | null };
type DeliveryRef = { id: string; deliveryNo: string };
type UserRef = { id: string; fullName: string };

type SupplierFeedbackListItem = {
  id: string;
  complaintCode: string;
  title: string;
  school: SchoolRef;
  delivery: DeliveryRef;
  status: Status;
  createdAt: string;
  respondedAt: string | null;
};

type SupplierFeedbackList = {
  items: SupplierFeedbackListItem[];
  pagination: Pagination;
};

type FeedbackDetail = SupplierFeedbackListItem & {
  description: string;
  updatedAt: string;
  submittedBy: UserRef;
  ingredientLot: { id: string; lotCode: string } | null;
  supplierResponse: string | null;
  respondedBy: UserRef | null;
};
```

Các id là UUID; timestamps là ISO8601 UTC có timezone Z. code trường chưa có trả null, không trả UUID thay code; id trường luôn được giữ. Không hứa code duy nhất. Trường nullable được trả rõ null, không bỏ key.

complaintCode là trường riêng bắt buộc string, unique toàn hệ thống, ví dụ FP-CP-00001. Mã được lưu một lần trên khiếu nại gốc từ luồng Ban Giám hiệu tạo đơn theo [producer contract](complaint-code-producer.md); supplier chỉ đọc nguyên giá trị. Số dương pad tối thiểu5chữ số, sau99999 là FP-CP-100000; không reset theo trường/supplier/năm. Supplier list, detail supplier/SCHOOL và kết quả response trả cùng UUID/mã đã lưu. Không nhầm complaintCode với school.code: chỉ school.code được phép null.

SUBMITTED: supplierResponse/respondedBy/respondedAt null. RESPONDED: có đủ nội dung/người/thời điểm. UserRef chỉ id/fullName, không email, phone, username, role, membership hoặc credential. Không có attachment/hội thoại.

Supplier list và các endpoint detail/response mới trả `Cache-Control: private, no-store`. Lỗi dùng sendError/global handler hiện có; đường dẫn này không ở /api/v1 nên không thêm top-level code mới.

## 3. GET danh sách supplier

`GET /api/ingredient-quality-feedback?page=1&limit=20`

- Chỉ chấp nhận page/limit. Mặc định1/20; positive safe integers, limit≤100, offset≤2.147.483.647.
- Không hỗ trợ status/schoolId/supplierId/search/sort; field lạ, array hoặc object thay scalar bị400.
- Order createdAt DESC, id ASC; lấy limit+1 để xác định hasNext.
- Gồm cả SUBMITTED và RESPONDED, tất cả người gửi thuộc các chuyến của supplier.
- Thành công200 `Success<SupplierFeedbackList>`.
- Chưa có dữ liệu hoặc vượt trang cuối: items[], hasNext=false; không404.
- Danh sách không có nội dung phản hồi hay mô tả đầy đủ, đọc detail để lấy.

## 4. GET chi tiết supplier hoặc school

`GET /api/ingredient-quality-feedback/:feedbackId`

- feedbackId UUID, normalize lowercase. Query chỉ object rỗng.
- complaintCode không dùng thay feedbackId; đường dẫn chứa FP-CP-00001 trả400 do không phải UUID, không lookup mã hoặc chuyển thành UUID.
- Thành công200 `Success<FeedbackDetail>`.
- SCHOOL dùng phạm vi hiện hữu: Delivery.schoolId của actor; có view_details được đọc cả trường, chỉ view_own thì còn phải đúng người gửi. Không mở rộng phạm vi user chỉ vì họ biết UUID.
- ingredientLot null chỉ khi khiếu nại không chỉ định lô. Nếu có lotId nhưng lô không thuộc delivery/scope của feedback:503 với thông báo an toàn, không trả foreign lot id/code.
- Tác giả/người phản hồi vẫn hiển thị theo tài khoản tham chiếu dù đã bị khóa/chuyển tổ chức; không dùng membership hiện tại của họ để cấp quyền đọc.
- Không tồn tại hoặc ngoài scope: cùng404 `Không tìm thấy khiếu nại trong phạm vi được phép`.

## 5. POST phản hồi

`POST /api/ingredient-quality-feedback/:feedbackId/response`

Query rỗng, Content-Type application/json. Dùng cơ chế CSRF hiện có: header `X-CSRF-Protection: 1`; nếu có Origin phải đúng origin được cấu hình. Không thêm auth/CSRF scheme riêng.

Body duy nhất:

```json
{
  "supplierResponse": "Nhà cung cấp đã kiểm tra chuyến giao và sẽ phối hợp xử lý với nhà trường."
}
```

- supplierResponse bắt buộc string; bỏ khoảng trắng ở hai đầu, giữ newline bên trong.
- Giới hạn1–5.000 Unicode code points sau trim; không đếm byte/UTF-16 units, không tự normalize Unicode.
- Reject unknown fields, null/non-string/blank/over-limit; trả400 kèm error.fields, không echo nội dung. complaintCode/id/actor/time/status đều không được gửi trong body phản hồi.
- Chỉ SUBMITTED được phản hồi. Actor/time/status do server xác lập và ghi cùng commit; role/scope/phân quyền kiểm tra lại trong transaction.
- Thành công200 `Success<FeedbackDetail>` với id UUID và complaintCode gốc không đổi, status RESPONDED, đúng text/actor/time vừa lưu. POST không cấp số dù transaction retry; mã vẫn là mã đã cấp khi tạo khiếu nại.
- POST lại, kể cả cùng body:409 `Khiếu nại đã được phản hồi`; không coi là phản hồi mới hoặc ghi đè.
- Hai người có đủ quyền cùng gửi cho một đơn hợp lệ: một200, một409 trong điều kiện hạ tầng bình thường; không expose serialization error. Wrapper retry hết lượt hoặc hạ tầng lỗi thì503 an toàn.
- Sau khi200, supplier có quyền và trường có quyền GET detail đều đọc cùng kết quả trên một bản ghi. Không gửi email, tạo notification hoặc sửa giao hàng.

## 6. Legacy list SCHOOL/SYSTEM

Cùng `GET /` giữ output cũ:

```typescript
type LegacyFeedbackListItem = {
  id: string;
  deliveryId: string;
  ingredientLotId: string | null;
  submittedByUserId: string;
  title: string;
  description: string;
  status: Status;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type LegacyFeedbackList = {
  items: LegacyFeedbackListItem[];
  pagination: Pagination;
};
```

Giữ order id ASC, pagination defaults/limits và dữ liệu/scopes hiện hành; không bổ sung supplierResponse vào legacy list. Hành vi supplier là projection mới ở mục3. Endpoint SCHOOL detail mục4 là bổ sung để đọc phản hồi, không làm quyền view_own trở thành quyền đọc cả trường. Không thay endpoint/permission nghiệp vụ meal-complaints.

Legacy list không thêm complaintCode để giữ10fields hiện có; SCHOOL đọc mã chung qua detail mới. Hợp đồng trả mã của HTTP tạo đơn BGH thuộc producer phía trường, không được hiểu là endpoint đã được triển khai trong feature supplier này.

## 7. Lỗi

| Status | Điều kiện                                                                                                                           | Hành vi                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 400    | Params/query/body sai schema, field lạ                                                                                              | Message tiếng Việt; error.fields cho RequestValidationError; không phản chiếu raw input       |
| 401    | Chưa đăng nhập/session không hợp lệ hoặc hết hạn                                                                                    | Không đọc/ghi dữ liệu nghiệp vụ                                                               |
| 403    | Actor inactive/role/org sai, thiếu một quyền cần thiết, permission inactive/denied, CSRF không hợp lệ                               | Không ghi phản hồi                                                                            |
| 404    | UUID hợp lệ không tồn tại hoặc ngoài trusted scope                                                                                  | Cùng message ở mục4, không lộ tồn tại foreign record                                          |
| 409    | Scoped target đã RESPONDED hoặc conditional update không còn SUBMITTED                                                              | Không đổi câu trả lời hiện tại                                                                |
| 429    | Limiter hiện có từ chối                                                                                                             | Shared envelope/policy hiện hành                                                              |
| 503    | DB/session/rate-limit dependency lỗi, retry hết lượt, dữ liệu detail không nhất quán hoặc complaintCode thiếu/sai trên endpoint mới | Thông báo an toàn, không SQL/credential, không tuple phản hồi một phần; không cấp/fallback mã |

Guards auth/scope chạy trước validation của module; middleware CSRF/rate-limit toàn cục có thể từ chối trước auth. Không cam kết thứ tự lỗi khác cơ chế chung hiện tại. Khi mất kết nối sau commit, client có thể chưa nhận kết quả; đọc lại detail để xác nhận, không ghi đè bằng gửi lại.
