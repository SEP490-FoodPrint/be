# Module nghiệp vụ FoodPrint

## Query cho nhân viên dinh dưỡng và bếp

Các API v1 của menu/kitchen/retained-sample lọc và phân trang tại DB với page mặc định1, limit mặc định20/tối đa100. Menu nhận search tiêu đề/tên món cùng date/weekStartDate/status. Kitchen nhận ngày/khoảng ngày, trạng thái, ca, phương thức, món/ngày thực đơn và search mã mẻ/tên món/số suất; KPI dùng cùng điều kiện. Lưu mẫu nhận status và search tủ/mẻ/món, trả totalItems/hasNext và expiresAt ISO. Mọi điều kiện kết hợp school scope từ principal, không lấy scope từ query.

Ba module không cung cấp endpoint xuất báo cáo/in. PUT chỉnh sửa mẻ và code xử lý tương ứng đã bỏ; delete/confirm/complete/lưu mẫu vẫn giữ. Xem [query contract](../../specs/010-api-architecture-completion/contracts/api-audit.md#query-đã-kiểm-chứng--09112026).

## Khóa tài khoản và tạm dừng tiếp nhận

Module `account-lifecycle` quản lý ba route dưới `/api/users/:userId`, chỉ cho System Admin có `user.manage`. Trạng thái tạm dừng của trường/NCC/cán bộ tách khỏi account status; luồng tạo/gửi đơn dùng guard tại transaction hiện có. `supply-order` bổ sung nhận đơn, `reporting` bổ sung cán bộ nhận báo cáo. Xem `docs/AUTHORIZATION.md` và `specs/022-account-deactivation/contracts/account-lifecycle-api.md` về quyền và hợp đồng.

Migration `20261112000100_account_lifecycle_intake` cùng các kiểm thử PostgreSQL chưa được xác nhận triển khai. Quyền `food_safety_report.receive` cho role cán bộ đã tồn tại cần được System Admin chủ động gán sau bootstrap catalog được phép; bootstrap không thay quyền role non-System đã cấu hình.

## Cấu trúc và phạm vi

31 module bao phủ 41 models trong Prisma: 31 models chính có API GET danh sách; 10 bảng chi tiết/liên kết thuộc module cha, chưa mở endpoint riêng. Tên và field lấy từ `prisma/schema.prisma`, nguồn thiết kế được ghi tại [SCHEMA_BASELINE.md](../../database/SCHEMA_BASELINE.md).

Mỗi thư mục có bốn file:

- `<module>.routes.ts`: khai báo route và middleware xác thực/phân quyền.
- `<module>.controller.ts`: validate query, gọi service, dùng `sendSuccess`; lỗi được chuyển tới `next(error)` qua `asyncHandler`.
- `<module>.service.ts`: truy vấn `findMany` qua Prisma client dùng chung, chọn trường trả về và thứ tự cố định theo khóa chính. Factory nhận reader để test mà không mở kết nối DB.
- `<module>.validation.ts`: parser phân trang; bổ sung filter đã được thống nhất tại đây khi phát triển tiếp.

Các router được đăng ký tại [routes/index.ts](../routes/index.ts). Client được lấy khi service thực sự đọc dữ liệu, nên import app để test HTTP không mở kết nối DB.

Module auth còn hỗ trợ đổi mật khẩu bằng mật khẩu cũ và khôi phục qua mã email 6 chữ số; xem [PASSWORD_RECOVERY.md](../../docs/PASSWORD_RECOVERY.md) cho API và luồng frontend.

## Duyệt thực đơn tuần

Ban Giám hiệu quyết định nguyên `WeeklyMenu`; `MenuDay` chỉ là dữ liệu chi tiết và được đồng bộ trạng thái trong cùng transaction.

- `GET /api/v1/menus/:menuId/approval-detail`: hồ sơ duyệt thuộc trường hiện tại, yêu cầu vai trò Ban Giám hiệu và quyền `menu.view`.
- `POST /api/v1/menus/:menuId/reviews`: body `{ "decision": "APPROVED" | "REVISION_REQUESTED", "feedback": "..." }`. Phê duyệt cần `menu.approve`; yêu cầu chỉnh sửa cần `menu.review` và bắt buộc có `feedback`.

Chỉ tuần `PENDING_APPROVAL` được quyết định. Quyết định cập nhật mọi ngày, cập nhật tuần và ghi một `MenuReviewRecord` có `menuDayId = null` trong cùng transaction. API từ chối `menuDayId` trong body; bản ghi cấp ngày cũ vẫn được giữ làm lịch sử. Số suất hiển thị lấy từ nhu cầu lớp đã `FINALIZED`, không lấy từ kích thước khẩu phần của món.

## Danh sách API

Tất cả đường dẫn bên dưới dùng phương thức **GET**.

| Module                        | Đường dẫn                            | Prisma model chính                     | Models chi tiết thuộc module                                                         |
| ----------------------------- | ------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `auth`                        | `/api/auth/roles`                    | `Role`                                 | —                                                                                    |
| `user`                        | `/api/users`                         | `User`                                 | —                                                                                    |
| `organization`                | `/api/schools`                       | `School`                               | —                                                                                    |
| `ingredient`                  | `/api/ingredients`                   | `Ingredient`                           | —                                                                                    |
| `menu`                        | `/api/menus`                         | `WeeklyMenu`                           | MenuDay, MenuDayDish                                                                 |
| `supply-order`                | `/api/supply-requests`               | `SupplyRequest`                        | SupplyRequestItem                                                                    |
| `warehouse`                   | `/api/ingredient-lots`               | `IngredientLot`                        | —                                                                                    |
| `kitchen`                     | `/api/cooking-batches`               | `CookingBatch`                         | CookingBatchLot                                                                      |
| `meal-attendance`             | `/api/meal-portions`                 | `DailyMealPortion`                     | DailyAllergyPortion                                                                  |
| `feedback`                    | `/api/meal-complaints`               | `MealComplaint`                        | —                                                                                    |
| `inspection`                  | `/api/food-safety-incidents`         | `FoodSafetyIncident`                   | FoodSafetyIncidentAllocation                                                         |
| `supplier`                    | `/api/suppliers`                     | `Supplier`                             | —                                                                                    |
| `supplier-school`             | `/api/supplier-schools`              | `School`, `SchoolSupplierRelationship` | `SupplierContract`, `SupplierContractItem`, `SupplierContractDocument`, `Ingredient` |
| `supplier-staff`              | `/api/supplier-staff`                | `User`, `UserPermissionDenial`         | —                                                                                    |
| `authority`                   | `/api/commune-food-safety-units`     | `CommuneFoodSafetyUnit`                | —                                                                                    |
| `class`                       | `/api/classes`                       | `Class`                                | —                                                                                    |
| `source-facility`             | `/api/source-facilities`             | `SourceFacility`                       | —                                                                                    |
| `supplier-certification`      | `/api/supplier-certifications`       | `SupplierCertification`                | —                                                                                    |
| `registration`                | `/api/registration-requests`         | `RegistrationRequest`                  | —                                                                                    |
| `school-supplier`             | `/api/school-supplier-relationships` | `SchoolSupplierRelationship`           | —                                                                                    |
| `ingredient-entry`            | `/api/ingredient-entries`            | `IngredientEntry`                      | —                                                                                    |
| `allergy`                     | `/api/class-allergies`               | `ClassAllergy`                         | —                                                                                    |
| `supplier-order`              | `/api/deliveries/management`         | `Delivery`                             | DeliveryItem                                                                         |
| `delivery`                    | `/api/deliveries`                    | `Delivery`                             | DeliveryItem, DeliveryApproval                                                       |
| `delivery-trace`              | `/api/public/delivery-items`         | `DeliveryItem`                         | Delivery, Supplier                                                                   |
| `dish`                        | `/api/dishes`                        | `Dish`                                 | DishIngredientEntry                                                                  |
| `inventory`                   | `/api/inventory-transactions`        | `InventoryTransaction`                 | —                                                                                    |
| `retained-sample`             | `/api/retained-food-samples`         | `RetainedFoodSample`                   | —                                                                                    |
| `meal-allocation`             | `/api/meal-allocations`              | `MealAllocation`                       | MealAllocationBatch                                                                  |
| `ingredient-quality-feedback` | `/api/ingredient-quality-feedback`   | `IngredientQualityFeedback`            | —                                                                                    |
| `reporting`                   | `/api/food-safety-reports`           | `FoodSafetyReportForwarding`           | —                                                                                    |
| `food-analysis`               | `/api/food-analysis-results`         | `FoodAnalysisResult`                   | —                                                                                    |
| `school-alert`                | `/api/incident-school-alerts`        | `IncidentSchoolAlert`                  | —                                                                                    |
| `traceability`                | `/api/traceability-anchors`          | `TraceabilityAnchor`                   | —                                                                                    |
| `blockchain-proof`            | `/api/blockchain-proofs`             | `*Version` (4 bảng)                    | —                                                                                    |
| `menu-review`                 | `/api/menu-reviews`                  | `MenuReviewRecord`                     | —                                                                                    |

`auth` cung cấp signup, login, refresh, logout bằng cookie HttpOnly/phiên Redis, thông tin tài khoản/quyền hiện tại, cập nhật hồ sơ cá nhân bằng PATCH /auth/me (fullName/phone) và danh sách Role; xem [AUTH_SESSIONS.md](../../docs/AUTH_SESSIONS.md). Signup tạo tài khoản UNVERIFIED chưa có yêu cầu duyệt; người dùng xác minh email bằng mã Resend rồi đăng nhập để nộp/xem hồ sơ của mình, chưa được gọi API nghiệp vụ. `onboarding` trong auth xử lý nộp hồ sơ/tài liệu; registration gắn API chi tiết/duyệt/từ chối vào cùng service để giữ một luồng transaction; xem [ONBOARDING.md](../../docs/ONBOARDING.md). Hợp đồng API quản trị role/permission ở [docs/AUTHORIZATION.md](../../docs/AUTHORIZATION.md). `organization` hiện quản lý khung cho School và chế độ nấu của trường trong phiên (`GET|PATCH /api/schools/me/cooking-mode`, quyền `school_cooking_mode.manage`; mẻ đã lập giữ chế độ cũ); Supplier và CommuneFoodSafetyUnit có module riêng. API traceability chỉ đọc bản ghi, không gửi transaction blockchain. `blockchain-proof` tạo version bằng chứng (`DeliveryInspectionVersion`, `CookingBatchVersion`, `RetainedSampleVersion`) trong transaction của kiểm nhận, hoàn thành mẻ, lưu và tiêu huỷ mẫu, rồi gửi hash lên contract `FoodPrintHashRegistry` sau khi commit (tắt mặc định qua `BLOCKCHAIN_ENABLED`); xem `specs/blockchain-anchoring/spec.md`.

## Mã hồ sơ đăng ký

Các phản hồi chứa hồ sơ có thêm `registrationID` chỉ đọc dạng `FP-REG-00001`, tăng phần số chung cho SCHOOL/SUPPLIER và mở rộng sau 99999. UUID `id` tiếp tục dùng cho URL/FK; danh sách vẫn sắp theo UUID, không dùng mã làm số dòng hoặc tổng số hồ sơ.

Mã xuất hiện ở danh sách, chi tiết, own/submit/approve/reject và summary `registrationRequest` trong login/refresh/GET me/PATCH me. Khi chưa có hồ sơ, summary/own vẫn null. Chỉnh sửa, gửi lại và xét duyệt giữ nguyên mã. Request tự gán mã hoặc số nội bộ bị 400 qua validation strict; không thêm endpoint tìm kiếm theo mã hay mở rộng quyền.

Trong những luồng auth/registration được sửa, controller validate input, service consume Request/Response DTO và map allowlist, repository chứa truy vấn và dùng cùng transaction client. Formatter không phải khóa tra cứu hoặc cơ chế phân quyền. Xem [contract registrationID](../../specs/001-add-registration-id/contracts/registration-id.md) và [migration](../../database/SCHEMA_BASELINE.md#mã-hồ-sơ-đăng-ký) trước khi dùng backend mới.

## Quyền truy cập và phân trang

Các API yêu cầu JWT hợp lệ với UUID sub và sid của phiên Redis còn sống. Trình duyệt dùng cookie HttpOnly với credentials include; Bearer vẫn hỗ trợ token được cấp từ phiên hợp lệ. Middleware tải lại user ACTIVE và quyền hiện tại từ DB; service yêu cầu AuthPrincipal và thêm WHERE theo quan hệ sở hữu. Mỗi endpoint kiểm tra permission trong [ma trận phân quyền](../../docs/AUTHORIZATION.md). System Admin chỉ truy cập khi có quyền được gán, không có bypass. ID tổ chức từ query/body không được dùng để tự chọn phạm vi dữ liệu. Bộ lọc này theo tổ chức, không tự suy diễn giới hạn đến từng lớp khi chưa có quan hệ tài khoản-lớp.

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  'http://localhost:5000/api/ingredients?page=1&limit=20'
```

Dùng token do luồng xác thực tin cậy cấp; bootstrap không tạo tài khoản admin. Chạy server cần database local đúng thiết kế và Redis local như hướng dẫn ở README root.

- `page`: số nguyên dương, mặc định `1`.
- `limit`: số nguyên dương, mặc định `20`, tối đa `100`.
- Chỉ hỗ trợ `page` và `limit`; tham số khác, giá trị lặp, mảng/object hoặc offset vượt giới hạn bị trả `400`.
- Response giữ envelope `{ success, statusCode, message, data }`; `data` là `{ items, pagination: { page, limit, hasNext } }`. Đọc thêm một dòng để xác định `hasNext`, không giả lập `total` hay tải toàn bảng.
- Sắp xếp khóa chính tăng dần, bao gồm cả hai khóa của ClassAllergy. Đây là phân trang offset; thay đổi dữ liệu giữa hai request có thể làm dịch chuyển trang.
- Thiếu/sai token hoặc tài khoản không tồn tại trả `401`; thiếu quyền, sai scope hoặc user không ACTIVE trả `403`; lỗi đọc nguồn dữ liệu trả `503` với thông báo chung. Rate limiter hiện hữu vẫn có thể trả `429`/`503`.

Services dùng whitelist `select`, không trả `passwordHash`, hồ sơ JSON đăng ký, tài liệu đính kèm hoặc QR token của lô. Date được xuất JSON dạng ISO, Prisma Decimal dạng chuỗi; `blockNumber` BigInt được chuyển thành chuỗi hoặc null để không mất độ chính xác.

## Phần triển khai tiếp

Các API nghiệp vụ vẫn chủ yếu là khung đọc danh sách; auth có transaction tạo tài khoản UNVERIFIED, onboarding có upload/nộp hồ sơ và xét duyệt tạo tổ chức/chứng nhận, permission có transaction quản trị quyền. Các module danh sách khác chưa có CRUD/lifecycle nghiệp vụ đầy đủ, truy vấn chi tiết, filter nghiệp vụ, phê duyệt, tính suất ăn hoặc inventory posting. Bổ sung các phần này theo yêu cầu đã được xác nhận và các ràng buộc trong SQL/baseline. Email Resend đã dùng cho xác minh tài khoản; chưa tích hợp cache hoặc queue vào các API này vì chưa có hợp đồng xử lý tương ứng.

Không thay đổi Prisma models/SQL hoặc tự triển khai database chỉ để API chạy được. Nếu database local chưa có schema mới, cần task thiết lập database được cho phép riêng; `SELECT 1` không xác nhận các bảng đã khớp thiết kế.

## Kiểm tra

```bash
npm run test:modules
npm run test:rate-limit
npm run test:cache
npm exec -- tsx --test tests/role.middleware.test.ts
npm run validate
```

Test module dùng HTTP local và reader được inject để kiểm tra quyền, pagination, projection an toàn, JSON Date/Decimal/BigInt và lỗi; không thay thế kiểm thử tích hợp với PostgreSQL thật. `validate` hiện gồm lint, format:check, typecheck và build, không tự chạy các test trên.

### Danh bạ quản trị đơn vị (006)

`organization` sở hữu school list/summary/detail; `supplier` sở hữu supplier list/summary/detail. Các router con dưới `/schools/:schoolId` thuộc `class` (classes), `school-supplier` (suppliers), `user` (accounts), được nối tại routes/index.ts và giữ quyền riêng. `supplier-certification` sở hữu `/suppliers/:supplierId/certifications` và endpoint `/supplier-certifications/:id/documents/:documentId`.

Hai list đơn vị nhận search/status và trả contact/total; nhóm con phân trang riêng. Services dùng scope từ resource-access và helper read-transaction để count/items cùng snapshot; repositories nhận cùng transaction và áp scope vào WHERE. Metadata minh chứng được batch theo hồ sơ, không thêm schema. Xem [hợp đồng API](../../specs/006-school-supplier-admin/contracts/admin-directory.md).

### Quản lý lớp học (016)

`class` sở hữu thêm các thao tác ghi của Ban Giám hiệu: `POST /api/classes`, `POST /api/classes/copy`, `PATCH /api/classes/:classId` và `PATCH /api/classes/:classId/status`, đều yêu cầu `class.manage`. Không có xóa cứng; niên khóa phải được cấu hình qua `school-academic-year`. Xem [hợp đồng API](../../specs/016-school-class-management/contracts.md).

`POST /api/classes/import` (017) nhập tối đa 300 lớp từ dữ liệu Excel đã được frontend đọc: `dryRun` để xem trước trạng thái từng dòng (`CREATE` / `SKIP` / `ERROR`), lưu theo kiểu tất cả hoặc không. Yêu cầu `class.manage`, thêm `class_assignment.manage` khi có cột GVCN. Xem [hợp đồng API](../../specs/017-class-excel-import/contracts.md).

## Quản lý nguyên liệu nhà cung cấp

Module ingredient đã tách đầy đủ routes/controller/validation/service/repository và hai file Request/Response DTO theo AGENTS.md; phần mô tả bốn file ở trên áp dụng cho các module danh sách legacy chưa chuyển đổi. Controller validate qua Zod; service xác lập scope, transaction và map DTO; repository thực hiện mọi truy vấn/khóa với shared client.

Ngoài GET đọc nghiệp vụ `/api/ingredients`, module có nhóm `/api/ingredients/management` dành riêng cho Supplier Admin với permission ingredient.manage: GET danh sách, GET categories, GET :ingredientId, POST tạo, PATCH :ingredientId, PATCH :ingredientId/status và hai API upload ảnh. Chi tiết tại [AUTHORIZATION.md](../../docs/AUTHORIZATION.md#quản-trị-nguyên-liệu-nhà-cung-cấp).

IngredientCategory là danh mục dùng chung chỉ đọc trong module ingredient, không có chức năng quản trị danh mục. categoryId thay cột category; coverImage một ảnh và imageDescription nhiều ảnh là các tham chiếu có sẵn. Đổi trạng thái sang INACTIVE để ẩn hoặc ACTIVE để hiện lại, giữ dữ liệu và lịch sử; sửa thông tin không tự đổi trạng thái. Xem [contract](../../specs/ingredient-change-status/contracts/ingredient-status-api.md).

`permission.repository.ts` cung cấp version writes cho User/Role khi thay denial/grants trong transaction quản trị quyền hiện có. Intake/lifecycle dùng shared Role lock và recheck để không nhận công việc mới theo snapshot quyền đã bị thu hồi; không thêm API quản trị mới.

### Source facility: cơ sở cung cấp của từng nhà cung cấp

Module source-facility sở hữu cơ sở nguồn cung theo supplier, không phải danh mục dùng chung. Base /api/source-facilities gồm GET danh sách, GET /:sourceFacilityId, POST tạo, PATCH /:sourceFacilityId và POST /:sourceFacilityId/deactivate. Cả năm thao tác chỉ dành INGREDIENT_SUPPLIER_ADMIN với source_facility.manage và supplier ACTIVE; staff/SYSTEM không có ngoại lệ.

Controller chỉ validate/call service/sendSuccess; validation dùng Zod strict; hai file Request/Response DTO tách riêng chỉ được service dùng; repository chứa truy vấn/khóa. Cấp mã FP-SF theo supplier bằng numeric max, unique scoped và retry transaction, không thay schema hoặc mã legacy. Cơ sở dừng vẫn xem/sửa được; không xóa, kích hoạt lại hoặc đổi liên kết IngredientLot.

Xem [hợp đồng API](../../specs/027-source-facility-management/contracts/source-facility-api.md) và [kế hoạch](../../specs/027-source-facility-management/plan.md).

## Luồng tiếp nhận yêu cầu nguyên liệu

Module `supply-order` sở hữu GET `/api/supply-requests`, GET `/api/supply-requests/:id` và POST `/api/supply-requests/:id/accept`. Hai vai trò admin/staff nhà cung cấp sử dụng danh sách/chi tiết với `supply_request.view`, tiếp nhận với `supply_request.accept`; quyền đọc và ghi độc lập, scope lấy từ membership hiện hành.

Danh sách supplier ẩn DRAFT, hỗ trợ status và phân trang, bổ sung tên trường/ngày giao/thời điểm gửi và `orderProgress` (`ACCEPTED`/`IN_PROGRESS` chưa có `Delivery` -> `CONFIRMED` / `"Đã xác nhận"` / `nextAction = ADD_INGREDIENTS` hoặc `NONE`; có đúng 1 `Delivery` `REQUEST` -> phản ánh trạng thái thực tế của `Delivery`; nhiều đợt legacy không có `REQUEST` duy nhất -> `null`). Chi tiết có đủ dòng nguyên liệu, số lượng dạng chuỗi Decimal, đơn vị, ghi chú, receipt đầu tiên và `orderProgress`. GET phía SCHOOL/SYSTEM giữ hợp đồng cũ (không có `orderProgress`). Tiếp nhận kế thừa intake guard/transaction hiện có, nhận lại không ghi đè người hoặc thời điểm đầu tiên; đơn `STANDALONE` không dùng `CONFIRMED`.

POST tạo `/api/supply-requests`, POST gửi `/:id/send` và GET `/:id/contract-evidence` vẫn thuộc `supplier-onboarding` với mount trực tiếp dưới `/api`; không dùng tiền tố tên module trong URL. Xem [hợp đồng supplier intake](../../specs/supplier-order-intake/contracts/supply-requests.md).

## Luồng tạo, tem QR và kiểm nhận đơn giao phía nhà cung cấp

Module `supplier-order` tách đủ 7 file (`routes`, `controller`, `validation`, `request.dto`, `response.dto`, `service`, `repository`) và được mount tại `/api/deliveries/management` trước `/api/deliveries` trong `src/routes/index.ts`, phục vụ đủ **8 endpoint**: `GET /options/schools` (hỗ trợ `search` tùy chọn escape literal `\`, `%`, `_`, tìm `OR` trên `name`/`code` luôn `AND` với scope/eligibility và trả safe projection `{ id, code, name }`), `GET /options/ingredients`, `GET /options/source-facilities`, `POST /` (hoàn tất nguyên liệu/phân bổ nhiều nguồn, tạo đơn `workflowVersion = 2`, `status = PREPARING`, `expectedArrivalAt`/`vehiclePlate` đều `null`, không nhận metadata xe/giờ ở bước này), `POST /:id/dispatch` (gán `expectedArrivalAt` và `vehiclePlate`, chuyển `PREPARING -> IN_TRANSIT` một lần với replay chuẩn hóa `200`/`409`) — đều cần `delivery.manage` cho `INGREDIENT_SUPPLIER_ADMIN` và `INGREDIENT_SUPPLIER_STAFF` — cùng `GET /` (hỗ trợ lọc `status = PREPARING`), `GET /:id` (giữ nguyên từng dòng phân bổ UUID không collapse) và `GET /:id/labels` (`delivery.view` **hoặc** `delivery.manage` **hoặc** `delivery.receive`, dùng được từ `PREPARING` cho đơn `traceabilityVersion = 1`). Payload `REQUEST` dùng `sources` (`supplyRequestItemId`, `sourceFacilityId`, `actualQuantity`, tổng Decimal mỗi nguồn bằng `requestedQuantity`); payload `STANDALONE` dùng `items` cho phép lặp `ingredientId` khác `sourceFacilityId` (unique cặp `(ingredient_id, source_facility_id)`), không đi qua `CONFIRMED`; idempotency dùng hash canonical **v3**, response thống nhất `statusLabel`, `workflowVersion` và `nextAction` dùng chung (`src/utils/delivery-status.ts`) và giữ `null` hợp lệ cho bản ghi legacy.

Module `delivery` bổ sung `POST /api/deliveries/:id/arrival` dành riêng cho trường (`delivery.view` và `delivery.inspect`, bốn vai trò kiểm nhận) để chuyển `IN_TRANSIT -> ARRIVED` cho đơn `traceabilityVersion = 1` trước khi ký nhận (chặn `PREPARING` bằng `409`), đối chiếu đồng bộ nguồn lô ở chữ ký thứ 4 bằng gom nhóm theo `supplyRequestItemId` (với `workflowVersion = 2` kiểm đủ tập nguồn và `currentGroup == requested`; legacy giữ `previous + currentGroup <= requested`), và tính mọi đơn `REQUEST` (cả `v1` lẫn legacy) vào `cap3` (hủy cả `PREPARING`/`IN_TRANSIT`/pending ở lần `REJECT` thứ 3; chỉ `STANDALONE` không đếm). Module công khai `delivery-trace` mount tại `/api/public/delivery-items` (`GET`/`HEAD /:token`) là ngoại lệ không yêu cầu đăng nhập, đàm phán HTML/JSON allowlist 8 trường (phản ánh đúng `PREPARING`), che token trên log và gắn đầy đủ header `no-store`/`no-referrer`/`CSP`/`noindex` dựa trên URL cố định từ `PUBLIC_TRACE_ORIGIN`. Khi triển khai, luôn áp dụng xong tuần tự enum `PREPARING` rồi marker `workflow_version`/CHECK/3 partial unique indexes trước khi dừng writer cũ và bật app/client hai bước; rollback app sau khi đã có đơn nhiều nguồn cần compatibility review, không gộp QR hay khôi phục full unique index cũ, không cấp quyền hoặc seed ngầm.

Schema `Delivery.schoolId` (bắt buộc), `DeliveryItem.ingredientId` / `ingredientEntryId` (`supplyRequestId` và `supplyRequestItemId` nullable), `Delivery.traceabilityVersion`, `Delivery.workflowVersion` (`2` hoặc `null`), 3 partial unique indexes trên `delivery_items` (`uq_delivery_items_ingredient_source`, `uq_delivery_items_legacy_ingredient`, `uq_delivery_items_legacy_request_item`), dãy `FP-DE-00001` riêng mỗi supplier và `DeliveryItem.qrToken`/`qrUrl` cùng snapshot nguồn hỗ trợ thống nhất cả đơn `REQUEST`, đơn `STANDALONE` và dữ liệu legacy `creationMode = null`. Xem [hợp đồng supplier-orders](../../specs/supplier-order-creation/contracts/supplier-orders.md) và [hợp đồng public-trace](../../specs/supplier-order-creation/contracts/public-trace.md).

## Supplier staff management

`supplier-staff` sở hữu danh sách, chi tiết, tạo, khóa/mở khóa và quyền riêng của INGREDIENT_SUPPLIER_STAFF trong supplier của INGREDIENT_SUPPLIER_ADMIN. Bảy endpoint và scope `supplier_staff.manage` được mô tả tại [AUTHORIZATION.md](../../docs/AUTHORIZATION.md). Các file routes/controller/validation/service/repository cùng Request DTO (z.infer) và Response DTO tách riêng; controllers không import DTO, repositories không import DTO, service map allowlist và điều phối transaction. Không thêm model, role, grant hoặc seed.

`auth` tiếp tục sở hữu login/session/recovery; mọi role chỉ login bằng email. Username vẫn là dữ liệu quản lí với uniqueness đã chốt; `user` chỉ điều chỉnh duplicate predicate của school create, giữ validation/role/default password/response. Generic permission và account-lifecycle giữ ownership; staff mutations dùng cùng lock protocol với lifecycle, không gọi module cũ mở transaction độc lập.

## Trường đã liên kết và hợp đồng phía nhà cung cấp

Module `supplier-school` tách đủ bảy file (`routes`, `controller`, `validation`, `request.dto`, `response.dto`, `service`, `repository`), mount tại `/api/supplier-schools` với năm GET chỉ đọc dành riêng cho `INGREDIENT_SUPPLIER_ADMIN` thuộc `SUPPLIER` có `supplier_relationship.view` hoặc `supplier_relationship.manage`:

- `GET /api/supplier-schools`: danh sách mỗi trường một mục với cả `id` UUID và `code` hiển thị (`null` nếu chưa có), chọn quan hệ đại diện (`ACTIVE`/`SUSPENDED` trước `UNLINKED`, `linkedAt DESC`, `id ASC`) trước khi sắp trang (`linkedAt DESC`, `schoolId ASC`).
- `GET /api/supplier-schools/:schoolId`: chi tiết hồ sơ trường (gồm trường `INACTIVE`) và mốc/lý do quan hệ đại diện; không nhúng hợp đồng.
- `GET /api/supplier-schools/:schoolId/contracts` và `GET /api/supplier-schools/:schoolId/contracts/:contractId`: danh sách phân trang độc lập (`createdAt DESC`, `id ASC`) và chi tiết hợp đồng `ACTIVE`/`CLOSED` của đúng cặp (kể cả đợt cũ/hết hạn/chưa tới ngày bắt đầu), danh mục nguyên liệu và metadata tệp `SIGNED_CONTRACT`/`APPENDIX`.
- `GET /api/supplier-schools/:schoolId/contracts/:contractId/documents/:documentId`: mở (`disposition=inline` mặc định) hoặc tải về (`disposition=attachment`) bytes gốc của bản hợp đồng đã ký và phụ lục với `nosniff`, `CSP sandbox`, `private, no-store` và RFC 5987 `Content-Disposition`.

Ranh giới module: `supplier-school` không thay thế `school-supplier` (danh sách bản ghi quan hệ hiện có cho SCHOOL/SUPPLIER/SYSTEM) hay `supplier-onboarding` (luồng tạo, sửa, tải tệp, kích hoạt, đóng hợp đồng và chuyển trạng thái liên kết phía trường). Chi tiết hợp đồng và phạm vi xem tại [supplier-schools-api.md](../../specs/supplier-linked-schools/contracts/supplier-schools-api.md) và [AUTHORIZATION.md](../../docs/AUTHORIZATION.md).
