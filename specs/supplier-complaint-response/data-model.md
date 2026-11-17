# Data Model: Supplier complaint response

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

## 1. Persistence đích và dữ liệu hiện có

Giữ các entity hiện có, bổ sung đúng một field complaintCode trong IngredientQualityFeedback và một PostgreSQL sequence qua migration mới. Không đổi UUID PK/FK, enum hoặc CHECK phản hồi, không tạo business model/table hoặc seed. Các thay đổi dưới đây là thiết kế đích; schema/DB hiện tại chưa được sửa.

| Entity                                              | Trường dùng                                                                                                                                                                        | Quan hệ và giới hạn                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| IngredientQualityFeedback                           | id UUID, complaintCode mới, deliveryId, ingredientLotId?, submittedByUserId, title, description, status, supplierResponse?, respondedByUserId?, respondedAt?, createdAt, updatedAt | Mã lưu một lần, unique toàn hệ thống; một delivery, một lô tùy chọn, một người gửi, một người phản hồi tùy chọn |
| Delivery                                            | id, deliveryNo, schoolId, supplierId                                                                                                                                               | Quyết định trường sở hữu và supplier chịu trách nhiệm; không lấy scope từ request                               |
| School                                              | id, name, code?                                                                                                                                                                    | code nullable, không bảo đảm duy nhất, không thay UUID                                                          |
| User                                                | id, fullName                                                                                                                                                                       | Chỉ hai field này dùng output; status/role/membership/grants/denials chỉ phục vụ auth                           |
| IngredientLot                                       | id, lotCode, deliveryItemId                                                                                                                                                        | Phải qua DeliveryItem để chứng minh cùng delivery với feedback                                                  |
| DeliveryItem                                        | id, deliveryId                                                                                                                                                                     | Dùng kiểm chứng lot, không trả object này ra output                                                             |
| Role/Permission/RolePermission/UserPermissionDenial | Thông tin identitySelect và hai permission codes                                                                                                                                   | Tái sử dụng effective permissions theo tổ chức; không tạo grant mới                                             |

FK lô và delivery của feedback độc lập; tồn tại lotId không chứng minh đúng chuyến. Không coi submittedByUser.schoolId hoặc respondedByUser.supplierId hiện tại là chủ sở hữu lịch sử. Tên hiển thị lấy từ tài khoản được tham chiếu hiện tại, không hứa lưu snapshot tên.

### ComplaintCode và sequence

- Field đích: complaintCode String @unique(map: "ingredient_quality_feedback_complaint_code_key") @map("complaint_code") @db.VarChar(25); NOT NULL, không DB default. id UUID vẫn là khóa định vị và dùng trong mọi path.
- Format chuẩn: FP-CP- + số dương tối thiểu5chữ số; uppercase, pad bằng0 tới5chữ số, số dài hơn không có leading zero. 1→FP-CP-00001, 99999→FP-CP-99999, 100000→FP-CP-100000. Không mã FP-CP-00000, không reset theo tổ chức/năm, không recycle.
- Sequence foodprint.ingredient_quality_feedback_complaint_code_seq: BIGINT1..9223372036854775807, increment1, CACHE1, NO CYCLE, OWNED BY complaint_code; tối đa19chữ số cộng prefix6ký tự vừa varchar(25). Không map sequence thành model Counter.
- CHECK mới ingredient_quality_feedback_complaint_code_format xác thực canonical-positive và range; regex canonical ^FP-CP-([0-9]{5}|[1-9][0-9]{5,18})$, suffix dương≤BIGINT_MAX. Nhánh CASE chỉ cast suffix khi regex hợp lệ; giữ CHECK response cũ.
- src/utils/complaint-code.ts có formatter/parser thuần dùng BigInt; repository nextComplaintCodeSequence(tx) chỉ lấy nextval, producer service format rồi INSERT code cùng transaction tạo đơn. Quyền và scope creator thuộc luồng phía trường; không tạo HTTP creator hoặc thêm grants trong feature supplier.
- Không gọi allocator trong list/detail/response. Khi phản hồi chỉ thay response tuple/updatedAt, giữ code; code thiếu/sai lúc đọc endpoint mới trả503 an toàn, không fallback/null/format lại. Legacy SCHOOL/SYSTEM list vẫn giữ projection cũ.

### Chuyển đổi dữ liệu cũ

Migration mới dự kiến prisma/migrations/20261120000300_ingredient_feedback_complaint_code/migration.sql, kiểm tra collision/thứ tự trước khi tạo, giữ applied history immutable. Một transaction khóa bảng ACCESS EXCLUSIVE, thêm code nullable, gán row_number theo created_at ASC/id ASC rồi enforce NOT NULL/unique/CHECK. SQL backfill padding không cắt khi vượt99999; chỉ thay code, self-assign updated_at để giữ nguyên timestamps và toàn bộ giá trị lịch sử khác.

Sequence mới được khởi tạo sau backfill: bảng rỗng next1; N bản ghi thì nextN+1. setval chỉ trong migration tạo mới, không dùng ở startup/GET/response hoặc để bù gaps; rollback/retry tạo đơn có thể bỏ số. Không đọc-sửa mã cũ theo request. Cửa sổ triển khai và readiness của producer xem [producer contract](contracts/complaint-code-producer.md).

## 2. Trusted access scope

Các type dưới đây là thiết kế input nội bộ của repository, không phải Request DTO:

- SupplierReadScope/ResponseScope: readonly supplierId.
- SchoolReadScope: readonly schoolId và submittedByUserId tùy quyền; có view_details thì không ràng người gửi, chỉ view_own thì bắt buộc đúng actor.
- SystemListScope: discriminator SYSTEM; chỉ list với quyền đọc hiện có.
- ReadScope: union có discriminator, giữ rõ ngữ cảnh query. Detail chỉ nhận Supplier/School scope; response chỉ nhận Supplier scope.

Services nhận AuthPrincipal từ middleware, xác lập scope qua resource-access; repository chỉ nhận scope tin cậy. Không truyền AuthPrincipal vào repository để repository tự quyết định quyền. readActor trong repository trả principal đã map bằng principalFromIdentity để service recheck.

## 3. Response projections

### Supplier list

`SupplierFeedbackListItem`:

- id UUID, complaintCode string bắt buộc đã lưu, title.
- school: {id, name, code: string|null}.
- delivery: {id, deliveryNo}.
- status: SUBMITTED|RESPONDED.
- createdAt: ISO UTC string.
- respondedAt: ISO UTC string|null.

Không trả description, raw ingredientLotId, submittedByUserId, user data hoặc toàn bộ delivery trên list supplier. Không include toàn bộ lịch sử liên kết.

### Detail chung supplier/school

`FeedbackDetail` thêm vào item trên:

- description, updatedAt ISO UTC.
- submittedBy: {id, fullName}.
- ingredientLot: {id, lotCode}|null.
- supplierResponse: string|null.
- respondedBy: {id, fullName}|null.

Tất cả field nullable xuất hiện với null khi chưa có dữ liệu; complaintCode không nullable. Detail supplier/SCHOOL và response trả cùng id+complaintCode của bản ghi gốc. SUBMITTED có supplierResponse/respondedBy/respondedAt null. RESPONDED có đầy đủ ba trường; thiếu tuple hoặc lot không cùng chuyến là lỗi dữ liệu503, không map bản ghi sai. Không trả hidden raw lotId trước kiểm chứng.

### Legacy SCHOOL/SYSTEM list

Giữ mười fields: id, deliveryId, ingredientLotId, submittedByUserId, title, description, status, respondedAt, createdAt, updatedAt. Service vẫn map allowlist và Dates tường minh; order id ASC, cùng envelope/pagination/filter. Scope và projection này chỉ là compatibility list đã tồn tại, không dùng làm output supplier mới. Không bổ sung supplierResponse/respondedBy vào list legacy.

### Pagination

`{items, pagination:{page,limit,hasNext}}`; page1, limit20 mặc định, limit≤100, offset≤2.147.483.647. Supplier order createdAt DESC/id ASC; không total count hoặc server-side search/filter.

## 4. Request validation

| Input                  | Quy tắc                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| List query             | Chỉ page/limit, positive safe integer ở dạng string, defaults/limits theo paginationSchema |
| Detail/response params | Chỉ feedbackId, UUID hợp lệ, lowercase sau normalize                                       |
| Detail/response query  | Object rỗng strict                                                                         |
| Response body          | Object strict đúng một field supplierResponse, bắt buộc string                             |
| supplierResponse       | trim hai đầu, 1–5.000 Unicode code points; giữ nội dung/newline bên trong                  |

Không cho client gửi complaintCode, status, schoolId, supplierId, respondedByUserId, respondedAt hoặc updatedAt. feedbackId trong paths luôn UUID; dùng FP-CP-00001 thay UUID bị400, không lookup code. Schemas trong validation.ts là nguồn z.infer cho request.dto.ts; repository không import DTO. Error field paths qua parseRequest, nhiều lỗi được báo cùng nhau.

## 5. Vòng đời và bất biến

| Trạng thái trước | Hành động                           | Trạng thái sau / kết quả                                                   |
| ---------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| SUBMITTED        | Người đủ quyền gửi phản hồi hợp lệ  | RESPONDED; cùng commit nội dung/actor/time/updatedAt, giữ id/complaintCode |
| RESPONDED        | Gửi lại dù cùng nội dung hoặc actor | 409, không ghi đè/tạo reply khác                                           |
| Bất kỳ           | Xem danh sách/chi tiết              | Không ghi business data hoặc timestamps                                    |
| Bất kỳ           | Ngoài scope hoặc thiếu quyền        | 404 hoặc403 phù hợp, không ghi                                             |
| SUBMITTED        | Lỗi readback/commit                 | Rollback hoặc retry wrapper, không để tuple một phần                       |

CHECK chk_ingredient_feedback_response hiện có buộc SUBMITTED có ba cột response null; RESPONDED có đủ nội dung/người/thời điểm. Validation mới chặt hơn ở nội dung không rỗng và giới hạn độ dài; không sửa CHECK lịch sử.

## 6. Consistency và locking

Đọc detail + lot trong cùng withReadTransaction snapshot; list truy vấn đơn có limit+1. Phản hồi dùng authorizationTransaction với cùng tx cho toàn bộ metadata, locks, actor recheck, scoped target recheck, update và readback.

Thứ tự: school → supplier → actor user → actor role → hai permission rows theo ID → delivery → complaint. Parents khóa để phối hợp lifecycle/admin writers, không đồng nghĩa yêu cầu school/relationship/contract còn ACTIVE. Conditional update luôn gồm supplier scope và SUBMITTED; không updateById không điều kiện.

Dùng existing primary keys cho unique reads, findFirst/updateMany cho filter sở hữu. SQL locking chỉ repository và tagged parameters, không queryRawUnsafe, không SELECT * hoặc client-supplied table/column. Áp dụng lại toàn bộ checks ở mỗi attempt, tối đa3 theo wrapper chung.
