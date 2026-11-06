# Module nghiệp vụ FoodPrint

## Cấu trúc và phạm vi

31 module bao phủ 41 models trong Prisma: 31 models chính có API GET danh sách; 10 bảng chi tiết/liên kết thuộc module cha, chưa mở endpoint riêng. Tên và field lấy từ `prisma/schema.prisma`, nguồn thiết kế được ghi tại [SCHEMA_BASELINE.md](../../database/SCHEMA_BASELINE.md).

Mỗi thư mục có bốn file:

- `<module>.routes.ts`: khai báo route và middleware xác thực/phân quyền.
- `<module>.controller.ts`: validate query, gọi service, dùng `sendSuccess`; lỗi được chuyển tới `next(error)` qua `asyncHandler`.
- `<module>.service.ts`: truy vấn `findMany` qua Prisma client dùng chung, chọn trường trả về và thứ tự cố định theo khóa chính. Factory nhận reader để test mà không mở kết nối DB.
- `<module>.validation.ts`: parser phân trang; bổ sung filter đã được thống nhất tại đây khi phát triển tiếp.

Các router được đăng ký tại [routes/index.ts](../routes/index.ts). Client được lấy khi service thực sự đọc dữ liệu, nên import app để test HTTP không mở kết nối DB.

Module auth còn hỗ trợ đổi mật khẩu bằng mật khẩu cũ và khôi phục qua mã email 6 chữ số; xem [PASSWORD_RECOVERY.md](../../docs/PASSWORD_RECOVERY.md) cho API và luồng frontend.

## Danh sách API

Tất cả đường dẫn bên dưới dùng phương thức **GET**.

| Module                        | Đường dẫn                            | Prisma model chính           | Models chi tiết thuộc module   |
| ----------------------------- | ------------------------------------ | ---------------------------- | ------------------------------ |
| `auth`                        | `/api/auth/roles`                    | `Role`                       | —                              |
| `user`                        | `/api/users`                         | `User`                       | —                              |
| `organization`                | `/api/schools`                       | `School`                     | —                              |
| `ingredient`                  | `/api/ingredients`                   | `Ingredient`                 | —                              |
| `menu`                        | `/api/menus`                         | `WeeklyMenu`                 | MenuDay, MenuDayDish           |
| `supply-order`                | `/api/supply-requests`               | `SupplyRequest`              | SupplyRequestItem              |
| `warehouse`                   | `/api/ingredient-lots`               | `IngredientLot`              | —                              |
| `kitchen`                     | `/api/cooking-batches`               | `CookingBatch`               | CookingBatchLot                |
| `meal-attendance`             | `/api/meal-portions`                 | `DailyMealPortion`           | DailyAllergyPortion            |
| `feedback`                    | `/api/meal-complaints`               | `MealComplaint`              | —                              |
| `inspection`                  | `/api/food-safety-incidents`         | `FoodSafetyIncident`         | FoodSafetyIncidentAllocation   |
| `supplier`                    | `/api/suppliers`                     | `Supplier`                   | —                              |
| `authority`                   | `/api/commune-food-safety-units`     | `CommuneFoodSafetyUnit`      | —                              |
| `class`                       | `/api/classes`                       | `Class`                      | —                              |
| `source-facility`             | `/api/source-facilities`             | `SourceFacility`             | —                              |
| `supplier-certification`      | `/api/supplier-certifications`       | `SupplierCertification`      | —                              |
| `registration`                | `/api/registration-requests`         | `RegistrationRequest`        | —                              |
| `school-supplier`             | `/api/school-supplier-relationships` | `SchoolSupplierRelationship` | —                              |
| `ingredient-entry`            | `/api/ingredient-entries`            | `IngredientEntry`            | —                              |
| `allergy`                     | `/api/class-allergies`               | `ClassAllergy`               | —                              |
| `delivery`                    | `/api/deliveries`                    | `Delivery`                   | DeliveryItem, DeliveryApproval |
| `dish`                        | `/api/dishes`                        | `Dish`                       | DishIngredientEntry            |
| `inventory`                   | `/api/inventory-transactions`        | `InventoryTransaction`       | —                              |
| `retained-sample`             | `/api/retained-food-samples`         | `RetainedFoodSample`         | —                              |
| `meal-allocation`             | `/api/meal-allocations`              | `MealAllocation`             | MealAllocationBatch            |
| `ingredient-quality-feedback` | `/api/ingredient-quality-feedback`   | `IngredientQualityFeedback`  | —                              |
| `reporting`                   | `/api/food-safety-reports`           | `FoodSafetyReportForwarding` | —                              |
| `food-analysis`               | `/api/food-analysis-results`         | `FoodAnalysisResult`         | —                              |
| `school-alert`                | `/api/incident-school-alerts`        | `IncidentSchoolAlert`        | —                              |
| `traceability`                | `/api/traceability-anchors`          | `TraceabilityAnchor`         | —                              |
| `menu-review`                 | `/api/menu-reviews`                  | `MenuReviewRecord`           | —                              |

## Phân công giáo viên chủ nhiệm

Bảng `class_homeroom_assignments` lưu GVCN của từng lớp. Mỗi dòng `classes` đã thuộc một niên khóa, nên phân công đi theo năm học; đổi GVCN đóng dòng hiện tại (`ended_at`) và giữ làm lịch sử.

- `GET /api/classes?academicYear=2026-2027`: danh sách lớp kèm `homeroomTeacher` hiện tại và `canAssign` (`class.view`).
- `GET /api/classes/academic-years`: niên khóa có lớp trong trường và niên khóa hiện tại (`class.view`).
- `GET /api/classes/eligible-teachers?academicYear=`: tài khoản `HOMEROOM_TEACHER` ACTIVE cùng trường, kèm lớp đang chủ nhiệm trong năm (`class_assignment.manage`).
- `PUT /api/classes/:classId/homeroom-teacher` body `{ "teacherUserId": "..." }`: gán hoặc đổi GVCN (`class_assignment.manage`).
- `DELETE /api/classes/:classId/homeroom-teacher`: bỏ GVCN hiện tại (`class_assignment.manage`).

Quy tắc trong transaction: một lớp một GVCN; một GVCN chỉ chủ nhiệm một lớp mỗi niên khóa; chỉ lớp ACTIVE ở niên khóa hiện tại hoặc sắp tới (năm học từ tháng 9, giờ Việt Nam) được thay đổi; trường lấy từ principal. GVCN cũ mất phân công ngay khi bị thay.

`auth` cung cấp signup, login, refresh, logout bằng cookie HttpOnly/phiên Redis, thông tin tài khoản/quyền hiện tại, cập nhật hồ sơ cá nhân bằng PATCH /auth/me (fullName/phone) và danh sách Role; xem [AUTH_SESSIONS.md](../../docs/AUTH_SESSIONS.md). Signup tạo tài khoản UNVERIFIED chưa có yêu cầu duyệt; người dùng xác minh email bằng mã Resend rồi đăng nhập để nộp/xem hồ sơ của mình, chưa được gọi API nghiệp vụ. `onboarding` trong auth xử lý nộp hồ sơ/tài liệu; registration gắn API chi tiết/duyệt/từ chối vào cùng service để giữ một luồng transaction; xem [ONBOARDING.md](../../docs/ONBOARDING.md). Hợp đồng API quản trị role/permission ở [docs/AUTHORIZATION.md](../../docs/AUTHORIZATION.md). `organization` hiện quản lý khung cho School; Supplier và CommuneFoodSafetyUnit có module riêng. API traceability chỉ đọc bản ghi, không gửi transaction blockchain.

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
