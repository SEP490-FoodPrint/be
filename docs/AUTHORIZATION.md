# Phân quyền FoodPrint

## Chính sách đã chốt

Định mức thực đơn dùng permission hiện có, không thêm role/grant:

| API dưới `/api/menus`                               | Quyền và phạm vi                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET `/ingredient-options/main`                      | `menu.view`, SCHOOL; Ingredient của Supplier ACTIVE có quan hệ ACTIVE với trường                          |
| GET `/ingredient-options/seasoning`                 | `menu.view`, SCHOOL; IngredientEntry ACTIVE, DRY_STOCK của trường, kể cả đang hết hàng                    |
| GET `/days/:menuDayId/meals/:mealType/ingredients`  | `menu.view`, SCHOOL sở hữu thực đơn; định mức và các lô gia vị đã giữ/tiêu hao                            |
| PUT cùng đường dẫn trên                             | `menu.update`, SCHOOL; xác minh lại actor trong transaction, chỉ sửa nháp/được yêu cầu sửa và chưa lập mẻ |
| GET `/days/:menuDayId/meals/:mealType/requirements` | `menu.view`, SCHOOL; nhu cầu theo số suất FINALIZED, tồn khả dụng và thiếu hụt, không tạo reservation     |

PUT thay thế toàn bộ định mức của bữa trong một transaction:

```json
{
  "dishes": [
    {
      "dishId": "<uuid>",
      "ingredients": [
        {
          "ingredientId": "<supplier-ingredient-uuid>",
          "quantityPerPortion": "80",
          "unit": "g"
        }
      ]
    }
  ],
  "seasonings": [
    {
      "ingredientEntryId": "<school-entry-uuid>",
      "quantityPerPortion": "1",
      "unit": "g"
    }
  ]
}
```

Phải khai báo đúng mọi món trong bữa. Nguyên liệu chính dùng Ingredient để chọn từ Supplier trước khi nhận hàng; lúc lập mẻ phải có IngredientEntry và lô khả dụng của trường. Gia vị chọn từ danh mục kho trường, không tự phân loại mọi DRY_STOCK thành gia vị. Định mức dương, tối đa ba chữ số thập phân; đơn vị phải quy đổi được. Không nhận số suất hay tiêu hao do bếp nhập.

CookingBatch đọc định mức riêng của lần lên thực đơn, không fallback sang công thức mẫu. Gia vị giữ một lần theo bữa, kiểm tra dị ứng và dùng chung phép tính tồn khả dụng với nguyên liệu chính. Chi tiết CookingBatch có `mealSeasonings` để truy xuất lô gia vị chung. Khi mọi món đủ số suất và tất cả mẻ hoàn thành, transaction của mẻ cuối trừ gia vị, tạo COOKING_USAGE/MENU_MEAL_SEASONING và đánh dấu used_at. Unique index chống ghi trùng khi retry.

Mỗi tài khoản có một role. Quyền hiệu lực là permission active được gán cho role trừ denial của tài khoản trong tổ chức hiện tại. JWT chỉ xác định tài khoản bằng UUID sub; API nghiệp vụ đọc lại user ACTIVE, role, tổ chức và quyền mỗi request. Không cache quyền và không có System Admin bypass. Riêng API thông tin phiên cho phép tài khoản UNVERIFIED của hai loại đăng ký truy cập giới hạn để tiếp tục hoàn thiện hồ sơ; chưa có quyền nghiệp vụ.

System Admin được thêm permission và sửa bộ quyền mọi role khác, áp dụng toàn hệ thống cho tài khoản mang role đó. Role SYSTEM_ADMIN chỉ đọc qua API; mọi yêu cầu sửa trả 403. Quyền gán mới vẫn chịu ràng buộc phạm vi tài nguyên, không tự cấp quyền truy cập khác tổ chức.

Mỗi trường có tối đa một SCHOOL_ADMINISTRATION, mỗi supplier có tối đa một INGREDIENT_SUPPLIER_ADMIN, tính cả tài khoản inactive. Các role nhân viên có thể có nhiều tài khoản. ATTP xã dùng COMMUNE_FOOD_SAFETY_OFFICER, không có chức năng quản trị quyền, kể cả khi được gán permission quản trị.

Admin tổ chức chỉ bật/tắt quyền role đã có cho tài khoản ACTIVE cùng tổ chức. Tắt tạo denial, bật lại xóa denial; không có bảng lịch sử. Nếu role mất một permission, admin tổ chức không thể cấp lại ngoài role. Denial riêng không bị xóa khi System Admin sửa bộ quyền role.

## HTTP API

Dùng envelope hiện có. Thiếu/sai token: 401; không ACTIVE khi gọi API nghiệp vụ hoặc thiếu quyền: 403; tài khoản đích ngoài phạm vi: 404; DTO sai: 400; permission trùng: 409; DB không sẵn sàng: 503.

| API                                                        | Điều kiện/nội dung                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /api/auth/signup                                      | Tạo user UNVERIFIED, chưa tạo hồ sơ PENDING; Resend gửi mã sau commit; JSON báo verificationEmailSent, không cấp token                      |
| POST /api/auth/email-verification/request                  | Body email; gửi/gửi lại mã 6 số qua Resend; giới hạn theo email/IP, thông báo chung                                                         |
| POST /api/auth/email-verification/verify                   | Body email/code; cập nhật emailVerifiedAt, giữ UNVERIFIED; không cấp cookie hoặc quyền                                                      |
| POST /api/auth/login                                       | Body identifier/password; cho phép ACTIVE hợp lệ hoặc UNVERIFIED đã xác minh email; đặt cookie HttpOnly, JSON trả user và expiresIn         |
| POST /api/auth/refresh                                     | Đọc refresh cookie, kiểm tra hash/TTL và trạng thái user từ DB, đổi refresh token; không tự kích hoạt tài khoản                             |
| POST /api/auth/logout                                      | Thu hồi phiên Redis và xóa cookie                                                                                                           |
| GET /api/auth/me                                           | Thông tin tài khoản, status/onboardingRequired và trạng thái hồ sơ; UNVERIFIED không có permissions                                         |
| PATCH /api/auth/me                                         | Sửa fullName/phone của chính tài khoản ACTIVE hoặc UNVERIFIED đã xác minh email; không cần user.manage, không sửa email/role/status/tổ chức |
| GET /api/auth/me/permissions                               | Danh sách mã quyền hiệu lực khi ACTIVE; UNVERIFIED nhận mảng rỗng                                                                           |
| GET /api/auth/roles                                        | System, role.view; giữ nguyên đường dẫn cũ                                                                                                  |
| GET /api/permissions                                       | System, permission.view; page/limit                                                                                                         |
| POST /api/permissions                                      | System, permission.create; body code, name, module, action, description tùy chọn                                                            |
| GET /api/roles/:roleId/permissions                         | System, role_permission.manage; SYSTEM_ADMIN có editable=false                                                                              |
| PUT /api/roles/:roleId/permissions                         | System, role_permission.manage; body permissionIds là mảng UUID không trùng, chỉ permission active; role SYSTEM_ADMIN luôn bị chặn          |
| GET /api/users/:userId/permissions                         | System có user.manage hoặc admin cùng tổ chức có quyền quản lý tương ứng                                                                    |
| PUT /api/users/:userId/permission-denials/:permissionId    | Tắt; school admin có school_user.manage hoặc supplier admin có supplier_staff.manage                                                        |
| DELETE /api/users/:userId/permission-denials/:permissionId | Bật lại quyền kế thừa; cùng điều kiện và phạm vi như PUT                                                                                    |

Các thao tác ghi xác minh lại actor và target trong transaction Serializable, có retry giới hạn cho serialization conflict. PUT/DELETE denial lặp lại an toàn; partial unique index và transaction ngăn tạo bản ghi trùng. Thêm permission vào catalog chưa tự tạo chức năng/API: endpoint phải kiểm tra mã quyền đó.

JWT access dùng HS256, issuer foodprint, audience foodprint-api; JWT_SECRET là bắt buộc. Token mang UUID sub và sid của phiên Redis còn sống; token cũ thiếu sid cần đăng nhập lại. Không đưa role/permissions vào JWT làm nguồn quyết định quyền. Mỗi request kiểm tra phiên Redis rồi tải trạng thái tài khoản và quyền hiện tại từ DB. Redis chứa metadata phiên và hash refresh token, không cache quyền. Xem [cookie, CSRF, TTL, rotation và hợp đồng đăng ký](AUTH_SESSIONS.md). [API hồ sơ theo Figma](ONBOARDING.md) gồm nộp/xem hồ sơ, tài liệu riêng và System Admin duyệt/từ chối. Sau khi nộp vẫn UNVERIFIED; chỉ duyệt thành công mới tạo tổ chức và chuyển ACTIVE. Chưa bổ sung User CRUD tổng quát.

[Xác minh email](EMAIL_VERIFICATION.md) dùng challenge Redis riêng, HMAC-SHA256, hạn 10 phút, tối đa 5 lần thử, tiêu thụ mã nguyên tử. Đây là bằng chứng sở hữu email, không phải trạng thái ACTIVE hay permission. UNVERIFIED chưa xác minh email bị chặn login/refresh/hồ sơ; tài khoản ACTIVE cũ không bị khóa tự động do emailVerifiedAt=null.

Xét duyệt yêu cầu SYSTEM_ADMIN cùng permission được gán: registration.view để xem chi tiết, registration.approve để duyệt, registration.reject để từ chối. Không dùng quyền xem để thay quyền ghi. Các thao tác kiểm tra lại actor/target trong transaction; xung đột serialization PostgreSQL qua Prisma P2034 hoặc P2010/SQLSTATE 40001 được retry giới hạn. Catalog/bootstrap được cập nhật trong code; database đang dùng cần operator bootstrap riêng theo chính sách, không tự thay đổi khi khởi động hay CD.

## Ma trận API danh sách

Cooking Batch Phương án A bổ sung GET `/api/cooking-batches/:id` với `cooking_batch.view`, giữ scope đọc như danh sách; POST `/api/cooking-batches` dùng `cooking_batch.create`, POST `/:id/confirm` dùng `cooking_batch.confirm`, POST `/:id/complete` dùng `cooking_batch.complete`. Thao tác ghi yêu cầu SCHOOL có schoolId tin cậy, xác minh lại actor/quyền trong transaction; SYSTEM không có bypass. Không thêm role/grant/permission. Plan chỉ nhận menuDayId/dishId/mealType; confirm/complete không nhận số suất hoặc lượng nguyên liệu.

Mọi dòng đều yêu cầu một trong các permission liệt kê. SYSTEM có phạm vi toàn hệ thống **khi được gán quyền**, còn tổ chức khác theo quan hệ sở hữu trong resource-access.ts. Phạm vi dưới đây là org-level, không tự suy diễn lớp được giao cho giáo viên.

| Module                        | Permission (OR)                                                                    | Tổ chức ngoài SYSTEM được mở |
| ----------------------------- | ---------------------------------------------------------------------------------- | ---------------------------- |
| `auth`                        | `role.view`                                                                        | Không                        |
| `user`                        | `user.manage`, `school_user.manage`, `supplier_staff.manage`                       | SCHOOL, SUPPLIER             |
| `organization`                | `school.manage`                                                                    | SCHOOL                       |
| `ingredient`                  | `ingredient.view`, `ingredient.manage`                                             | SCHOOL, SUPPLIER             |
| `menu`                        | `menu.view`                                                                        | SCHOOL                       |
| `supply-order`                | `supply_request.view`                                                              | SCHOOL, SUPPLIER             |
| `warehouse`                   | `inventory.view`                                                                   | SCHOOL, SUPPLIER             |
| `kitchen`                     | `cooking_batch.view`                                                               | SCHOOL                       |
| `meal-attendance`             | `daily_meal_portion.view`                                                          | SCHOOL                       |
| `feedback`                    | `meal_complaint.view`                                                              | SCHOOL                       |
| `inspection`                  | `food_safety_incident.view`                                                        | SCHOOL, AUTHORITY            |
| `supplier`                    | `supplier.view`, `supplier.manage`                                                 | SUPPLIER, SCHOOL             |
| `authority`                   | `authority.view`, `food_safety_report.view`                                        | AUTHORITY                    |
| `class`                       | `class.view`                                                                       | SCHOOL                       |
| `source-facility`             | `source_facility.manage`                                                           | SUPPLIER                     |
| `supplier-certification`      | `supplier_certification.view`                                                      | SUPPLIER                     |
| `registration`                | `registration.view`                                                                | Không                        |
| `school-supplier`             | `supplier_relationship.view`, `supplier_relationship.manage`                       | SCHOOL, SUPPLIER             |
| `ingredient-entry`            | `ingredient.view`, `ingredient.manage`                                             | SCHOOL                       |
| `allergy`                     | `class_allergy.view`                                                               | SCHOOL                       |
| `delivery`                    | `delivery.view`, `delivery.manage`, `delivery.receive`                             | SCHOOL, SUPPLIER             |
| `dish`                        | `menu.view`                                                                        | SCHOOL                       |
| `inventory`                   | `inventory.view`                                                                   | SCHOOL, SUPPLIER             |
| `retained-sample`             | `retained_sample.view`                                                             | SCHOOL                       |
| `meal-allocation`             | `meal_allocation.view`                                                             | SCHOOL                       |
| `ingredient-quality-feedback` | `ingredient_quality_feedback.view_own`, `ingredient_quality_feedback.view_details` | SCHOOL, SUPPLIER             |
| `reporting`                   | `food_safety_report.view`                                                          | SCHOOL, AUTHORITY            |
| `food-analysis`               | `food_analysis_result.view`                                                        | SCHOOL, AUTHORITY            |
| `school-alert`                | `school_alert.view`                                                                | SCHOOL                       |
| `menu-review`                 | `menu.view`, `menu.review`, `menu.approve`                                         | SCHOOL                       |
| `traceability`                | `traceability.view`                                                                | SCHOOL, SUPPLIER, AUTHORITY  |

School xem supplier qua quan hệ ACTIVE/SUSPENDED; ingredient qua IngredientEntry của trường. Supplier xem tài nguyên supplier-owned hoặc delivery của supplier khi có permission phù hợp. ATTP xã chỉ thấy incident/report chuyển tới đơn vị mình; traceability chỉ mở phần liên quan trực tiếp. Với ingredient_quality_feedback.view_own, thêm điều kiện submittedByUserId; view_details vẫn giới hạn tổ chức. Các API cũ giữ phân trang, safe select và serialization Date/Decimal/BigInt.

## API Menu và CookingBatch v1

Các route `/api/v1/menus`, `/api/v1/kitchen`, `/api/v1/daily-meal-portions` và `/api/v1/food-samples` dùng cùng session cookie, CSRF header, permission runtime và phạm vi trường của API hiện tại. Request ghi cần `X-CSRF-Protection: 1`; trình duyệt gửi cookie với credentials. Không dùng tên role `SCHOOL_ADMIN`/`CHEF` trong tài liệu giao diện để tạo thêm role: mã thực tế là `SCHOOL_ADMINISTRATION` và `SCHOOL_KITCHEN_STAFF`.

| Thao tác                                   | Permission                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Xem thực đơn, định mức, nhu cầu kho        | `menu.view`                                                                                       |
| Đối soát dị ứng theo lớp                   | Cả `menu.view` và `class_allergy.view` để giữ hiệu lực denial trên dữ liệu dị ứng                 |
| Tạo thực đơn                               | `menu.create`                                                                                     |
| Sửa, xóa bản nháp, lưu định mức, gửi duyệt | `menu.update`                                                                                     |
| Duyệt chấp thuận                           | `menu.approve`                                                                                    |
| Yêu cầu chỉnh sửa                          | `menu.review`                                                                                     |
| Xem mẻ, thống kê, dữ liệu in kiểm thực     | `cooking_batch.view`                                                                              |
| Lập, xác nhận, hoàn thành mẻ               | `cooking_batch.create`, `cooking_batch.confirm`, `cooking_batch.complete` tương ứng               |
| Xem, tạo, tiêu hủy mẫu                     | `retained_sample.view`, `retained_sample.create`, `retained_sample.dispose` tương ứng             |
| Tổng hợp số suất đã chốt                   | Một trong `daily_meal_portion.view`, `cooking_batch.view`, `menu.view`; chỉ tổng hợp trong trường |

`POST /api/v1/menus` và `PUT /api/v1/menus/:menuId` nhận cùng cấu trúc dưới đây. `dishId` chọn món của trường; `name` thay thế `dishId` khi nhập tên món. Tên đã tồn tại trong trường dùng lại món đó. Không nhận `schoolId`, trạng thái hoặc tổng số suất từ client. Bản nháp được phép chưa có định mức; gửi duyệt yêu cầu đầy đủ định mức hợp lệ.

```json
{
  "weekStartDate": "2030-01-07",
  "title": "Thực đơn tuần",
  "days": [
    {
      "menuDate": "2030-01-07",
      "note": null,
      "meals": [
        {
          "mealType": "LUNCH",
          "dishes": [
            {
              "name": "Cơm trắng",
              "ingredients": [
                {
                  "ingredientId": "11111111-1111-4111-8111-111111111111",
                  "quantityPerPortion": "80",
                  "unit": "g"
                }
              ]
            }
          ],
          "seasonings": [
            {
              "ingredientEntryId": "22222222-2222-4222-8222-222222222222",
              "quantityPerPortion": "1",
              "unit": "g"
            }
          ]
        }
      ]
    }
  ]
}
```

Ngày phải nằm trong 7 ngày từ `weekStartDate`; tối đa 7 ngày và hai ca `LUNCH`/`AFTERNOON` trong mỗi ngày. PUT gửi đầy đủ các ngày, bữa, món và định mức. Không đổi tuần sau khi tạo. Chỉ ngày nháp chưa từng gửi duyệt mới được bỏ khỏi payload; ngày có lịch sử duyệt phải giữ lại. Khi tuần cần chỉnh sửa, những ngày đã duyệt hoặc đang chờ duyệt phải giữ nguyên, dùng `dishId` từ GET chi tiết. Gửi duyệt lại giữ nguyên các ngày đã duyệt. Yêu cầu chỉnh sửa một ngày không ngăn BGH xử lý các ngày khác còn chờ duyệt. Quyết định `REVISION_REQUESTED` ghi nhật ký duyệt và chuyển trạng thái thực đơn/ngày tương ứng sang `REVISION_REQUIRED`.

GET danh sách menus hỗ trợ `page`, `limit`, `date`, `weekStartDate`, `status`. GET kitchen và kitchen/stats hỗ trợ `date`, `mealType`, `status`, `menuDayId`, `dishId` và phân trang; stats đếm toàn bộ phạm vi bộ lọc. GET daily-meal-portions yêu cầu `date=YYYY-MM-DD` và `mealType`, chỉ cộng bản ghi `FINALIZED`. Danh mục nguyên liệu có `pagination.totalItems`; gia vị dùng IngredientEntry ID, nguyên liệu chính dùng Ingredient ID. UUID trong ví dụ phải thay bằng ID thực lấy từ API danh mục.

POST kitchen trả `batches` đầy đủ; nếu chỉ có một mẻ, trả thêm các trường mẻ ở cấp data để khớp màn hình tạo mẻ. `SEPARATE_BY_LOT` có thể sinh nhiều mẻ; client phải dùng toàn bộ mảng. Gia vị cấp bữa được giữ một lần và tiêu hao khi mọi món/mẻ trong bữa hoàn tất.

Hoàn thành mẻ yêu cầu `inspectionData.step2_Cooking` và `step3_Serving` theo API FINAL. Backend kiểm tra nhiệt độ thực tế tối thiểu 65°C theo yêu cầu ứng dụng và mọi cờ đạt trước khi ghi. Biên bản, trạng thái, tồn kho và inventory transaction commit cùng nhau. Gọi lại cùng biên bản không trừ kho thêm; không cho ghi đè biên bản đã hoàn thành. Body rỗng chỉ dùng để retry mẻ đã COMPLETED, gồm cả lịch sử cũ có inspectionData NULL; không cho hoàn thành lần đầu thiếu kiểm thực qua route cũ.

Mỗi mẻ COMPLETED có tối đa một mẫu. Tạo lại cùng thông tin trả mẫu đã có, không tạo trùng; thông tin khác trả 409. Thời điểm lấy mẫu phải từ lúc hoàn thành mẻ đến hiện tại. `expiresAt` tính từ `sampledAt + 24h`, không phải cột mới. Hủy mẫu yêu cầu cả thời gian server và `disposedAt` đã đủ 24h, không cho thời điểm tương lai; mẫu liên quan sự cố OPEN/INVESTIGATING qua kết quả phân tích hoặc phân phối bữa ăn phải giữ lại. Không tự động hủy khi đủ 48h. Thống kê `pendingSamples` cho biết mẻ hoàn thành chưa lưu mẫu.

Schema hiện tại không có Student, student_allergies hoặc bảng allergens. Allergy-check dùng ClassAllergy/IngredientEntry/Class, trả số lượng theo từng nguyên liệu và lớp; chỉ kết luận có/không có xung đột trong dữ liệu đã ghi nhận. Khi nhiều nguyên liệu có thể trùng học sinh, `totalAffectedStudents` là null và trả `totalAffectedStudentsBounds`, `requiresIndividualDeduplication`. Trường `allergen` null kèm `allergenDataAvailable: false` nghĩa là chưa có dữ liệu phân loại, không xác nhận nguyên liệu an toàn. Không có chức năng gợi ý hoặc suy đoán món/nguyên liệu thay thế. Khi có xung đột, API trả `requiresMenuAdjustment: true`; nhân viên y tế tự quyết định điều chỉnh thực đơn. Chưa triển khai chia suất/mẻ cho món thay thế vì schema chưa có quan hệ phân bổ nhóm dị ứng; planner tiếp tục chặn nhu cầu có dị ứng liên quan để tránh nấu/trừ kho sai.

Phản hồi lỗi v1 bổ sung `code` theo API FINAL; envelope và các route cũ được giữ. Phần API này không thêm migration, seed hay thay đổi role/permission. Backend triển khai phải có migration inspection_data và menu standards đã áp dụng; không chạy SQL bootstrap trên Azure.

## Bootstrap và triển khai

```bash
# Chọn DATABASE_URL local riêng trước khi chạy:
npm run db:migrate:deploy
npm run auth:bootstrap
```

Bootstrap tạo catalog/role còn thiếu, gán defaults cho role mới và quyền khởi tạo của SYSTEM_ADMIN; không tạo tài khoản hoặc mock data. Với role ngoài SYSTEM_ADMIN đã tồn tại, bootstrap không tự gán lại default để giữ những thay đổi runtime. Permission đang inactive không tự bật lại. Catalog ban đầu có thể được System Admin gán tiếp bằng API sau đó.

Azure: review/merge migration và đợi CD PASS trước. Khi được phép thực hiện bước seed riêng, chạy từ commit đã merge:

```bash
AZURE_DATABASE_HOST=foodprint-pg-dev-2026-hm01.postgres.database.azure.com npm run auth:bootstrap -- --azure
```

DATABASE_URL phải là URL Azure đúng foodprint_db/schema foodprint và có SSL. Script mặc định từ chối remote; --azure yêu cầu đúng host và lịch sử migration đã đồng bộ. Không chạy lại SQL nguồn chứa mock data. CD chỉ migrate, không bootstrap.

Migration một admin thêm role_code được FK ghép đối chiếu với roles; ghi SQL ngoài Prisma phải cung cấp role_id/role_code nhất quán và cập nhật timestamp. Tài khoản đăng ký pending có thể tạm chưa có tổ chức; admin ACTIVE phải gắn đúng loại tổ chức. Unique vẫn tính mọi tài khoản đã gắn tổ chức, kể cả inactive. Không sửa migration đã applied. Nếu dữ liệu admin trùng, migration dừng; cần xem xét dữ liệu riêng, không tự reset/xóa/chọn tài khoản.

## Kiểm chứng

```bash
npm run prisma:validate
npm run validate
npm run test:unit
MIGRATION_TEST_DATABASE_URL='<disposable-local-test-url>' npm run test:migrations
MIGRATION_TEST_DATABASE_URL='<disposable-local-test-url>' npm run test:authorization
```

Integration test tạo database mới trong PostgreSQL local test đã chọn; không drop/reset database hiện có hoặc chạy trên Azure. CI chạy cả migration và authorization integration trước khi Backend quality PASS và gọi CD. Test bao gồm JWT role giả, System không có quyền, role SYSTEM_ADMIN bị bảo vệ, role thay đổi trên hai trường, denial riêng, supplier isolation, ATTP, user/permission inactive và ghi admin đồng thời.
