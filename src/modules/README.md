# Module nghiệp vụ FoodPrint

## Query cho nhân viên dinh dưỡng và bếp

Các API v1 của menu/kitchen/retained-sample lọc và phân trang tại DB với page mặc định 1, limit mặc định20/tối đa100. Menu nhận search tiêu đề/tên món cùng date/weekStartDate/status. Kitchen nhận ngày/khoảng ngày, trạng thái, ca, phương thức, món/ngày thực đơn và search mã mẻ/tên món/số suất; KPI dùng cùng điều kiện. Lưu mẫu nhận status và search tủ/mẻ/món, trả totalItems/hasNext và expiresAt ISO. Mọi điều kiện kết hợp school scope từ principal, không lấy scope từ query.

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
- `GET /api/v1/menus/approval-week?date=YYYY-MM-DD`: hồ sơ duyệt của mọi thực đơn đã gửi (khác `DRAFT`) trong tuần chứa `date` (ngày bất kỳ, quy về thứ Hai), mỗi thực đơn kèm `isSchoolWide` và `grades`. Bỏ `date` thì chọn tuần còn chờ duyệt mới nhất, không có thì tuần mới nhất. Trả thêm `weeks[]` (số thực đơn/chờ duyệt theo tuần) và `weekNumber`. Cùng điều kiện quyền với `approval-detail`.
- `POST /api/v1/menus/:menuId/reviews`: body `{ "decision": "APPROVED" | "REVISION_REQUESTED", "feedback": "..." }`. Phê duyệt cần `menu.approve`; yêu cầu chỉnh sửa cần `menu.review` và bắt buộc có `feedback`.

Chỉ tuần `PENDING_APPROVAL` được quyết định. Quyết định cập nhật mọi ngày, cập nhật tuần và ghi một `MenuReviewRecord` có `menuDayId = null` trong cùng transaction. API từ chối `menuDayId` trong body; bản ghi cấp ngày cũ vẫn được giữ làm lịch sử. Số suất hiển thị lấy từ nhu cầu lớp đã `FINALIZED`, không lấy từ kích thước khẩu phần của món.

## Danh sách API

Tất cả đường dẫn bên dưới dùng phương thức **GET**.

| Module                        | Đường dẫn                            | Prisma model chính                     | Models chi tiết thuộc module                                                                    |
| ----------------------------- | ------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `auth`                        | `/api/auth/roles`                    | `Role`                                 | —                                                                                               |
| `user`                        | `/api/users`                         | `User`                                 | —                                                                                               |
| `organization`                | `/api/schools`                       | `School`                               | `SchoolDeliveryInspectionRole`                                                                  |
| `ingredient`                  | `/api/ingredients`                   | `Ingredient`                           | —                                                                                               |
| `menu`                        | `/api/menus`                         | `WeeklyMenu`                           | MenuDay, MenuDayDish                                                                            |
| `supply-order`                | `/api/supply-requests`               | `SupplyRequest`                        | SupplyRequestItem                                                                               |
| `warehouse`                   | `/api/ingredient-lots`               | `IngredientLot`                        | —                                                                                               |
| `kitchen`                     | `/api/cooking-batches`               | `CookingBatch`                         | CookingBatchLot                                                                                 |
| `meal-attendance`             | `/api/meal-portions`                 | `DailyMealPortion`                     | DailyAllergyPortion                                                                             |
| `feedback`                    | `/api/meal-complaints`               | `MealComplaint`                        | `Complaint`, `ComplaintComment`, `ComplaintStatusHistory`                                       |
| `system-complaint`            | `/api/system-complaints`             | `SystemComplaint`                      | `Complaint`, `ComplaintComment`, `ComplaintStatusHistory`                                       |
| `authority-complaint`         | `/api/authority-complaints`          | `AuthorityComplaint`                   | `Complaint`, `MealComplaint`, `School`, `CommuneFoodSafetyUnit`, `ComplaintComment`             |
| `food-safety-incident`        | `/api/food-safety-incidents`         | `FoodSafetyIncident`                   | `FoodSafetyIncidentAllocation`, `FoodSafetyIncidentStatusHistory`, `FoodSafetyReportForwarding` |
| `supplier`                    | `/api/suppliers`                     | `Supplier`                             | —                                                                                               |
| `supplier-school`             | `/api/supplier-schools`              | `School`, `SchoolSupplierRelationship` | `SupplierContract`, `SupplierContractItem`, `SupplierContractDocument`, `Ingredient`            |
| `supplier-staff`              | `/api/supplier-staff`                | `User`, `UserPermissionDenial`         | —                                                                                               |
| `authority`                   | `/api/commune-food-safety-units`     | `CommuneFoodSafetyUnit`                | `School`, `Supplier`, `SchoolSupplierRelationship`, `Location`                                  |
| `authority-officer`           | `/api/authority-officers`            | `User`                                 | `CommuneFoodSafetyUnit`, `Location`, `Role`                                                     |
| `class`                       | `/api/classes`                       | `Class`                                | —                                                                                               |
| `source-facility`             | `/api/source-facilities`             | `SourceFacility`                       | —                                                                                               |
| `supplier-certification`      | `/api/supplier-certifications`       | `SupplierCertification`                | —                                                                                               |
| `registration`                | `/api/registration-requests`         | `RegistrationRequest`                  | —                                                                                               |
| `school-supplier`             | `/api/school-supplier-relationships` | `SchoolSupplierRelationship`           | —                                                                                               |
| `ingredient-entry`            | `/api/ingredient-entries`            | `IngredientEntry`                      | —                                                                                               |
| `allergy`                     | `/api/class-allergies`               | `ClassAllergy`                         | —                                                                                               |
| `supplier-order`              | `/api/deliveries/management`         | `Delivery`                             | DeliveryItem                                                                                    |
| `delivery`                    | `/api/deliveries`                    | `Delivery`                             | DeliveryItem, DeliveryApproval, DeliveryInspectionRole                                          |
| `delivery-trace`              | `/api/public/delivery-items`         | `DeliveryItem`                         | Delivery, Supplier                                                                              |
| `dish`                        | `/api/dishes`                        | `Dish`                                 | DishIngredientEntry                                                                             |
| `inventory`                   | `/api/inventory-transactions`        | `InventoryTransaction`                 | —                                                                                               |
| `retained-sample`             | `/api/retained-food-samples`         | `RetainedFoodSample`                   | —                                                                                               |
| `meal-allocation`             | `/api/meal-allocations`              | `MealAllocation`                       | MealAllocationBatch                                                                             |
| `ingredient-quality-feedback` | `/api/ingredient-quality-feedback`   | `IngredientQualityFeedback`            | `Complaint`, `Delivery`, `School`, `IngredientLot`, `User`                                      |
| `reporting`                   | `/api/food-safety-reports`           | `FoodSafetyReportForwarding`           | —                                                                                               |
| `food-analysis`               | `/api/food-analysis-results`         | `FoodAnalysisResult`                   | —                                                                                               |
| `school-alert`                | `/api/incident-school-alerts`        | `IncidentSchoolAlert`                  | —                                                                                               |
| `blockchain-proof`            | `/api/blockchain-proofs`             | `BlockchainProof`                      | —                                                                                               |
| `menu-review`                 | `/api/menu-reviews`                  | `MenuReviewRecord`                     | —                                                                                               |

`auth` cung cấp signup, login, refresh, logout bằng cookie HttpOnly/phiên Redis, thông tin tài khoản/quyền hiện tại, cập nhật hồ sơ cá nhân bằng PATCH /auth/me (fullName/phone) và danh sách Role; xem [AUTH_SESSIONS.md](../../docs/AUTH_SESSIONS.md). Signup tạo tài khoản UNVERIFIED chưa có yêu cầu duyệt; người dùng xác minh email bằng mã Resend rồi đăng nhập để nộp/xem hồ sơ của mình, chưa được gọi API nghiệp vụ. `onboarding` trong auth xử lý nộp hồ sơ/tài liệu; registration gắn API chi tiết/duyệt/từ chối vào cùng service để giữ một luồng transaction; xem [ONBOARDING.md](../../docs/ONBOARDING.md). Hợp đồng API quản trị role/permission ở [docs/AUTHORIZATION.md](../../docs/AUTHORIZATION.md). `organization` hiện quản lý khung cho School và chế độ nấu của trường trong phiên (`GET|PATCH /api/schools/me/cooking-mode`, quyền `school_cooking_mode.manage`; mẻ đã lập giữ chế độ cũ); Supplier và CommuneFoodSafetyUnit có module riêng. `blockchain-proof` ghi mọi bằng chứng vào một bảng `BlockchainProof` (mỗi loại một cột khóa ngoại, CHECK đúng một liên kết) trong transaction của đăng ký/duyệt hồ sơ, NCC bắt đầu giao, kiểm nhận, hoàn thành mẻ, lưu và tiêu huỷ mẫu, xác nhận phân phối suất ăn, rồi gửi hash lên contract `FoodPrintHashRegistry` sau khi commit (tắt mặc định qua `BLOCKCHAIN_ENABLED`); xem `specs/unified-blockchain-proofs/spec.md`. Module này cũng cung cấp truy xuất nguồn gốc theo khối cho trang nội bộ và trang công khai của từng trường (`/public/schools/:schoolCode/...`, không cần đăng nhập, ẩn thông tin vận hành, kiểm chứng không lưu); xem `specs/traceability-chain-view/spec.md`.

## Mã hồ sơ đăng ký

Các phản hồi chứa hồ sơ có thêm `registrationID` chỉ đọc, lấy từ cột `registration_requests.code`. Hồ sơ cũ giữ mã tuần tự `FP-REG-00001` đã phát hành. Hồ sơ mới nhận `FP-RG-NNNNN`, trong đó 5 chữ số là hoán vị Feistel có khóa của số thứ tự, nên không suy ra được thứ tự hay số lượng hồ sơ (xem [contract mã nghiệp vụ](../../specs/feistel-business-codes/contracts/business-code.md)). Tìm kiếm danh sách nhận cả hai dạng mã, không phân biệt hoa thường. UUID `id` tiếp tục dùng cho URL/FK; danh sách vẫn sắp theo UUID, không dùng mã làm số dòng hoặc tổng số hồ sơ.

Khiếu nại bữa ăn (`feedback`) có trường `code` dạng `FP-MC-NNNNN`, cấp trong transaction tạo khiếu nại; khiếu nại cũ chưa backfill trả `code: null`. Chuyến giao mới (`FP-DE-`) và khiếu nại nguyên liệu mới (`FP-CP-`) dùng cùng allocator `src/utils/business-code.ts`; mã cũ tuần tự vẫn hợp lệ.

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

## Đơn khiếu nại dạng ticket (`complaint-ticket`, `feedback`, `ingredient-quality-feedback`, `system-complaint`, `authority-complaint`)

Theo [specs/complaint-supertype](../../specs/complaint-supertype/spec.md), khiếu nại suất ăn và phản ánh chất lượng nguyên liệu dùng chung bảng cha `complaints` (mã `code`, tiêu đề, mô tả, người gửi, trạng thái) cùng hai bảng con `meal_complaints` / `ingredient_quality_feedback` nối bằng FK `(id, kind)`, bảng `complaint_comments` (trao đổi) và `complaint_status_histories` (mọi lần đổi trạng thái).

- `complaint-ticket` không có route; nó chứa phần dùng chung: bảng chuyển trạng thái `NEW → IN_PROGRESS → RESOLVED → CLOSED` (kèm `REOPENED`), hạn đánh giá 48h, trạng thái hiển thị, nhãn `hasNewMessage` (tính khi đọc, không lưu), tiêu đề tự sinh, validation nội dung (1–5.000 ký tự sau trim), repository chuyển trạng thái có điều kiện (0 dòng cập nhật → `409`) và job tự đóng `src/utils/complaint-auto-close.ts`.
- `feedback` (`/api/meal-complaints`, mã `FP-MC-NNNNN`) và `ingredient-quality-feedback` (`/api/ingredient-quality-feedback`, mã `FP-CP-NNNNN`) đều có `GET /`, `GET /:id` và các thao tác `POST /:id/accept`, `/:id/comments` (`{content}`), `/:id/resolve` (`{content}`), `/:id/satisfy`, `/:id/reopen` (`{reason?}`). Bên xử lý (BGH với `meal_complaint.respond`; NCC `ADMIN`/`STAFF` có đồng thời `view_details` và `respond`) phải nhận đơn trước khi trao đổi hoặc giải quyết. Người gửi đánh giá hài lòng hoặc mở lại trong 48h sau lần giải quyết gần nhất; quá hạn hệ thống tự đóng.
- Gửi C02 ([specs/ingredient-feedback-submission](../../specs/ingredient-feedback-submission/spec.md)): `POST /api/ingredient-quality-feedback` (`{deliveryId, ingredientLotId?, description}`, mô tả 10–2000 ký tự) cho tài khoản trường có `ingredient_quality_feedback.submit` (mặc định BGH, bếp, dinh dưỡng). Chuyến giao phải thuộc trường của người gửi và ở `RECEIVED`/`REJECTED`; lô (nếu có) phải thuộc chuyến giao đó. Không giới hạn số đơn trên một chuyến giao; BGH xem toàn trường, bếp/dinh dưỡng chỉ xem đơn mình gửi.
- `system-complaint` (`/api/system-complaints`, mã `FP-SC-NNNNN`, [specs/system-complaint-management](../../specs/system-complaint-management/spec.md)): khiếu nại gửi System Admin, bảng con `system_complaints` giữ `category` (`ACCOUNT`/`PERMISSION`/`DATA`/`TECHNICAL`/`OTHER`, tiêu đề tự sinh theo phân loại). `POST /` (`{category, description}`) cho mọi vai trò ngoài System Admin có `system_complaint.submit`; snapshot vai trò và tổ chức người gửi. Cùng bộ thao tác ticket như trên; bên xử lý là System Admin có đồng thời `system_complaint.view` và `system_complaint.respond`.
- `authority-complaint` (`/api/authority-complaints`, mã `FP-AC-NNNNN`, [specs/authority-complaints](../../specs/authority-complaints/spec.md)): C05, khiếu nại phụ huynh leo thang từ C03 lên đơn vị ATTP phụ trách phường/xã của trường. `POST /` (`{mealComplaintId, reason?}`) là nút "Chuyển ATTP": trong một transaction đóng C03 (`CLOSED`/`ESCALATED`, ghi chú `ESCALATION_NOTE` nếu có lý do) và tạo C05 lưu cứng trường, đơn vị nhận (`schools.location_id` → `commune_food_safety_units.location_id`, đơn vị `ACTIVE`) và C03 gốc (mỗi C03 tối đa một C05). C03 trả `ESCALATE` trong `allowedActions` cho phụ huynh trong 48h sau "Đã xử lý" và `escalatedAuthorityComplaint {id, code}` sau khi chuyển. Bên xử lý là cán bộ ATTP của đơn vị nhận; BGH chỉ xem; chi tiết C05 kèm C03 gốc (`escalatedFrom`, gồm bình luận) chỉ đọc.
- `authority` (`/api/commune-food-safety-units`): thêm `PUT /:id/location` (`{locationId}`, `authority.manage`, System Admin) gắn đơn vị ATTP với phường/xã (`Location.level = 2`, đang hoạt động; mỗi phường/xã một đơn vị, trùng → `409`); danh sách trả thêm `locationId`.
  - [specs/authority-officer-accounts](../../specs/authority-officer-accounts/spec.md): `GET /me/schools` (`authority_school.view`, resource `authority-school`) liệt kê trường cùng phường/xã với đơn vị của cán bộ (`page, limit, search, status`); `GET /me/schools/:schoolId` trả chi tiết trường kèm `suppliers[]` là NCC `ACTIVE` có quan hệ `ACTIVE`/`SUSPENDED` (ẩn `UNLINKED` và NCC ngừng hoạt động), ngoài địa bàn `404`. Module cũng cung cấp `PUT /api/schools/:schoolId/location` và `PUT /api/suppliers/:supplierId/location` (`authority.manage`, System Admin, khóa dòng tổ chức) để gắn/đổi phường/xã của trường/NCC (`createOrganizationLocationRouter`, mount trước router `organization`/`supplier`). Danh sách/chi tiết trường và NCC trả thêm `location`; hai danh sách nhận `hasLocation=true|false` (FR-012).
- Email cho người gửi (PR-E, [specs/complaint-email-notifications](../../specs/complaint-email-notifications/spec.md)): mọi loại đơn ghi một dòng `email_outbox` (`complaint_id`, `complaint_event`) trong cùng transaction khi tạo đơn (`CREATED`, kể cả C05 tạo khi "Chuyển ATTP"), khi bên xử lý bình luận (`HANDLER_COMMENT`) và khi "Đã xử lý" (`RESOLVED`, kèm nội dung xử lý và nhắc đơn tự đóng sau 48 giờ). Helper `queueRequesterEmail` trong `complaint-ticket.service.ts`, nội dung ở `src/utils/complaint-email.ts`. Không gửi khi Tiếp nhận, khi người gửi bình luận/đánh giá hay khi đóng; người gửi không `ACTIVE` thì bỏ qua.
- Đã bỏ `PATCH /api/meal-complaints/:id` và `POST /api/ingredient-quality-feedback/:feedbackId/response`; trường `complaintCode`/`supplierResponse` được thay bằng `code` và danh sách `comments` (bình luận `RESOLUTION` là câu trả lời giải quyết).
- Phía NCC giữ thứ tự khóa và kiểm lại actor trong transaction `Serializable` như trước; danh sách sắp `submittedAt DESC, id ASC`, phạm vi theo `Delivery.supplierId` / `Delivery.schoolId`, `404` thống nhất cho ngoài phạm vi và `Cache-Control: private, no-store`. Mã được cấp bằng `allocateBusinessCode` (Feistel, [contract mã nghiệp vụ](../../specs/feistel-business-codes/contracts/business-code.md)) trong cùng transaction tạo đơn.

## Luồng báo cáo sự cố ATTP (`food-safety-incident`, `reporting`)

Theo [specs/food-safety-incident-workflow](../../specs/food-safety-incident-workflow/spec.md) (luồng B, Q19/Q20). Module `food-safety-incident` thay module `inspection` cũ tại cùng mount `/api/food-safety-incidents` (resource đổi tên `inspection` → `food-safety-incident`); tên `inspection` để dành cho đợt kiểm tra ở PR6.

- Trạng thái (`food_safety_incident_status`): `PENDING_SCHOOL_REVIEW` → `SUBMITTED_TO_AUTHORITY` → `AUTHORITY_ACKNOWLEDGED` (→ `UNDER_INSPECTION` → `INSPECTION_COMPLETED` → `CLOSED` ở PR6), nhánh `CANCELLED_BY_SCHOOL` chỉ khi trùng/nhập sai. Mọi chuyển trạng thái ghi `food_safety_incident_status_histories`. Dữ liệu cũ ánh xạ theo §6.3, `source = LEGACY_IMPORT`.
- `POST /` (`food_safety_incident.report`): phụ huynh (`PARENT_REPORT`) hoặc GVCN (`TEACHER_REPORT`, bắt buộc lớp đang chủ nhiệm) báo cáo `{title, description, reportedSymptomaticCount, symptomDescription?, occurredAt?, classId?}`; mã `FP-IC-NNNNN`.
- `POST /direct` (BGH, `.create` + `.forward`): hồ sơ `SCHOOL_DIRECT` vào thẳng `SUBMITTED_TO_AUTHORITY` kèm nhận định sơ bộ.
- `POST /:id/forward` (BGH, `.forward`): `{preliminaryAssessment, preliminaryNote?}`; `OUTSIDE_MEAL` vẫn phải chuyển (Q4); không cần allocation. `POST /:id/cancel` (BGH, `.manage`): `{reason: DUPLICATE_REPORT|DATA_ENTRY_ERROR, note}`. Cả hai chỉ từ `PENDING_SCHOOL_REVIEW`, khóa dòng, thua đồng thời → `409`.
- Đơn vị nhận suy ra như C05: `schools.location_id` → đơn vị ATTP `ACTIVE` của phường/xã → cán bộ `ACTIVE` của đơn vị (người nhận bản chuyển `food_safety_report_forwardings`, `SENT`, kênh `IN_APP`); thiếu → `409`.
- `POST /:id/allocations` (BGH, `.manage`): gắn `{mealAllocationIds}` (1–50) đã `DISTRIBUTED`/`FINALIZED` của trường, chỉ thêm, khi hồ sơ chưa đóng/hủy.
- `GET /:id`: projection theo người xem — `view: "REPORTER"` cho phụ huynh/GVCN (nội dung đã gửi, trạng thái, mốc lịch sử, lý do hủy) và `view: "FULL"` cho BGH, ATTP nhận hồ sơ, System Admin (nhận định, đơn vị nhận, bản chuyển, allocation, lịch sử kèm người thao tác, `allowedActions`). Danh sách lọc tùy chọn `status`.
- `reporting` (`POST /api/food-safety-reports/:id/receive`): tiếp nhận còn chuyển hồ sơ `SUBMITTED_TO_AUTHORITY` → `AUTHORITY_ACKNOWLEDGED` (có điều kiện, kể cả khi gọi lại bản chuyển đã tiếp nhận từ trước).
- Snapshot truy xuất (PR5b, [specs/food-safety-incident-trace-snapshots](../../specs/food-safety-incident-trace-snapshots/spec.md)): `forward`/`direct` tạo `food_safety_incident_trace_snapshots` v1 (bản chuyển mang `trace_snapshot_id`); `allocations` sau khi đã gửi ATTP và có suất ăn mới tạo phiên bản kế tiếp + bản chuyển bổ sung. Payload chuẩn hóa (suất ăn → mẻ nấu/món → lô → NCC/cơ sở nguồn → mẫu lưu, `potentialExposedPortionCount`) hash `KECCAK-256`; `trace_completeness` `MISSING`/`PARTIAL`/`COMPLETE` kèm `missing_reasons`. `GET /:id/trace-snapshots/:version` cho BGH/ATTP/System (PH/GVCN `403`) trả payload + `hashMatches`. Snapshot không sửa/xóa; neo blockchain chưa làm.
- Đợt kiểm tra (PR6a, module `food-safety-inspection` gắn cùng mount, [specs/food-safety-inspections](../../specs/food-safety-inspections/spec.md)): cán bộ ATTP đơn vị nhận (`food_safety_inspection.manage`) lập đợt (`POST /:id/inspections`, `AUTHORITY_ACKNOWLEDGED` → `UNDER_INSPECTION`), ghi kết quả một lần kèm kết luận từng NCC (`POST /:id/inspections/:inspectionId/result`; NCC lấy từ snapshot truy xuất, không có thì NCC có quan hệ với trường — `GET /:id/inspection-suppliers`; hết đợt `PLANNED` → `INSPECTION_COMPLETED`, sau đó không lập thêm đợt) và đóng hồ sơ (`POST /:id/close` → `CLOSED`, không gỡ hạn chế NCC). Chế tài NCC thuộc PR6b.
- Chế tài NCC (PR6b, module `supplier-enforcement`, [specs/supplier-enforcement](../../specs/supplier-enforcement/spec.md)): cán bộ ATTP đơn vị nhận (`supplier_enforcement.request`) đề nghị `PAUSE_INTAKE`/`LOCK_ACCOUNT`/`RESTORE` qua `POST /api/food-safety-incidents/:id/enforcement-actions`; System Admin (`supplier_enforcement.decide`) xem/duyệt/từ chối/chạy lại tại `/api/supplier-enforcement-actions` (`GET /`, `GET /:actionId`, `POST /:actionId/approve|reject|retry`). Duyệt = thực thi: hạn chế `supplier_restrictions`, `intakeState = PAUSED_FOR_FOOD_SAFETY_INSPECTION`, khóa tài khoản `ACTIVE` (`LOCKED`, lịch sử `account_status_histories`, thu hồi phiên sau commit); `RESTORE` không vượt hạn chế của sự cố khác. `supplier-staff` và `account-lifecycle` chặn `409` tạo/mở khóa tài khoản, mở tiếp nhận khi NCC còn hạn chế.
- Mẫu lưu coi hồ sơ còn hiệu lực là mọi trạng thái khác `CLOSED`/`CANCELLED_BY_SCHOOL`; tổng quan trường (`/api/school-overview`) dùng cùng phạm vi đọc.

## Quản trị quyền toàn hệ thống

Module permission sở hữu GET /api/roles, GET/POST /api/permissions, PATCH /api/permissions/:permissionId (name/description), PATCH /api/permissions/:permissionId/state (isActive) và GET/PUT /api/roles/:roleId/permissions. GET /api/auth/roles vẫn thuộc auth và giữ hợp đồng cũ. Catalog/role routes yêu cầu SYSTEM_ADMIN thuộc SYSTEM cùng role.view/permission.view/permission.create/role_permission.manage theo [ma trận](../../docs/AUTHORIZATION.md); hai PATCH dùng role_permission.manage, không thêm quyền hoặc bootstrap.

Validation Zod là nguồn Request DTO trong permission.request.dto.ts; Response DTO tách tại permission.response.dto.ts. Controller chỉ validate/gọi service; service xác lập scope, transaction và ánh xạ allowlist; repository chứa toàn bộ Prisma queries và khóa. SYSTEM_ADMIN grant list chỉ đọc, nhưng trạng thái permission toàn cục vẫn áp dụng cho System Admin; off/on không sửa grants/denials. PUT bộ quyền giữ inactive đã có, chỉ cho thêm mới active, giữ assignedAt của grants không đổi. Không cache phân quyền.

permissionConcurrencyRepository.touchUser/touchRole vẫn được export để phối hợp MVCC với intake/lifecycle/supplier-staff. Mọi write recheck actor/target sau khóa trong cùng Serializable transaction, retry raw query/COMMIT conflicts theo wrapper chung. API user permissions/denials giữ guard, ownership và điều kiện target ACTIVE hiện hành; không mở thêm quyền quản trị cho authority hoặc System Admin ghi denial toàn cục.

GET /api/permissions hỗ trợ search optional theo một phần tên, không phân biệt hoa/thường, trim/max150, literal wildcard và lọc trước page/limit; GET /api/roles vẫn chỉ nhận pagination. DTO/validator query được tách riêng để giữ hợp đồng này.

GET /api/permissions/inactive yêu cầu SYSTEM_ADMIN/SYSTEM + permission.view, chỉ trả isActive=false với tối đa 5 mục/trang; query chỉ page, mặc định 1. Schema chuẩn hóa limit=5, repository lọc trước pagination; không dùng để liệt kê grant chưa gán theo role.

### measurement-unit

/api/measurement-units: danh mục đơn vị dùng chung, mọi tài khoản đã đăng nhập đọc; System Admin + measurement_unit.manage ghi. Mã/ký hiệu/nhóm bất biến, không xóa. Resolve alias khi ghi nguyên liệu/công thức, giữ chuỗi trên lịch sử. Bước số lượng chỉ khuyến nghị, không chặn yêu cầu nhập hàng. Xem specs/measurement-units/contracts.md.
