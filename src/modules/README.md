# Module nghiệp vụ FoodPrint

## Cấu trúc và phạm vi

31 module bao phủ 41 models trong Prisma: 31 models chính có API GET danh sách; 10 bảng chi tiết/liên kết thuộc module cha, chưa mở endpoint riêng. Tên và field lấy từ `prisma/schema.prisma`, nguồn thiết kế được ghi tại [SCHEMA_BASELINE.md](../../database/SCHEMA_BASELINE.md).

Mỗi thư mục có bốn file:

- `<module>.routes.ts`: khai báo route và middleware xác thực/phân quyền.
- `<module>.controller.ts`: validate query, gọi service, dùng `sendSuccess`; lỗi được chuyển tới `next(error)` qua `asyncHandler`.
- `<module>.service.ts`: truy vấn `findMany` qua Prisma client dùng chung, chọn trường trả về và thứ tự cố định theo khóa chính. Factory nhận reader để test mà không mở kết nối DB.
- `<module>.validation.ts`: parser phân trang; bổ sung filter đã được thống nhất tại đây khi phát triển tiếp.

Các router được đăng ký tại [routes/index.ts](../routes/index.ts). Client được lấy khi service thực sự đọc dữ liệu, nên import app để test HTTP không mở kết nối DB.

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

## API duyệt thực đơn mẫu

Module `menu` giữ API danh sách chuẩn của `main` và bổ sung ba endpoint phục vụ màn hình duyệt thực đơn:

- `GET /api/menus/:menuId/approval-detail`: đọc hồ sơ thực đơn, món ăn, nhà cung cấp và lần thẩm định gần nhất.
- `POST /api/menus/:menuId/approve`: phê duyệt thực đơn; body tùy chọn `{ "notes": "..." }`.
- `POST /api/menus/:menuId/request-revision`: yêu cầu chỉnh sửa; body bắt buộc `{ "reason": "..." }`.

Ba endpoint yêu cầu JWT hợp lệ. Endpoint đọc yêu cầu quyền `menu.view`, phê duyệt yêu cầu `menu.approve`, và yêu cầu chỉnh sửa cần `menu.review`. Dữ liệu được giới hạn theo trường của tài khoản; người duyệt phải là tài khoản `SCHOOL_MANAGEMENT_BOARD` đang hoạt động thuộc cùng trường.

`auth` cung cấp login, thông tin tài khoản/quyền hiện tại và danh sách Role; chưa có đăng ký tài khoản hoặc refresh token. Hợp đồng API quản trị role/permission ở [docs/AUTHORIZATION.md](../../docs/AUTHORIZATION.md). `organization` hiện quản lý khung cho School; Supplier và CommuneFoodSafetyUnit có module riêng. API traceability chỉ đọc bản ghi, không gửi transaction blockchain.

## Quyền truy cập và phân trang

Các API yêu cầu JWT hợp lệ với UUID sub. Middleware tải lại user ACTIVE và quyền hiện tại từ DB; service yêu cầu AuthPrincipal và thêm WHERE theo quan hệ sở hữu. Mỗi endpoint kiểm tra permission trong [ma trận phân quyền](../../docs/AUTHORIZATION.md). System Admin chỉ truy cập khi có quyền được gán, không có bypass. ID tổ chức từ query/body không được dùng để tự chọn phạm vi dữ liệu. Bộ lọc này theo tổ chức, không tự suy diễn giới hạn đến từng lớp khi chưa có quan hệ tài khoản-lớp.

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

Các API nghiệp vụ vẫn chủ yếu là khung đọc danh sách; module auth/permission có các thao tác đăng nhập và quản trị đã mô tả riêng. Chưa phải nghiệp vụ hoàn chỉnh. Chưa có tạo/sửa/xóa, truy vấn chi tiết, filter nghiệp vụ, chuyển trạng thái, phê duyệt, tính suất ăn, inventory posting hoặc transaction ghi. Bổ sung các phần này theo yêu cầu đã được xác nhận và các ràng buộc trong SQL/baseline. Chưa tích hợp cache, upload, email hoặc queue vào các API này vì chưa có hợp đồng xử lý tương ứng.

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
