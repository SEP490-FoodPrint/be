# API audit và quyết định contract

## Rà soát hai role — 09/11/2026 (source và kiểm thử hợp đồng)

**Kết luận: chưa đủ điều kiện nghiệm thu toàn bộ hai role.** Có API/Prisma và các luồng đã gọi HTTP thật, nhưng một số màn còn dùng mock/localStorage hoặc có hợp đồng dữ liệu chưa khớp. Bảng dưới phân biệt đọc source, kiểm thử bằng fixture và kiểm thử DB thật. Các khẳng định cũ bên dưới về số endpoint có route không đồng nghĩa các màn FE đã tích hợp đầy đủ.

### Bằng chứng runtime và giới hạn

- GET `http://127.0.0.1:5000/api/health`: 200. Health chỉ chứng minh API đang chạy.
- GET `/api/schools/public?limit=1&page=1`: 200, success=true, items.length=1. Endpoint hiện đọc repository/Prisma, chứng minh instance BE đang đọc DB qua API. Không log nội dung bản ghi, tài khoản hay connection string.
- GET `/api/v1/menus`, `/api/v1/kitchen`, `/api/v1/retained-samples` khi không có cookie: 401 đúng ràng buộc. Chưa có browser/session hai role trong môi trường công cụ để kiểm tra các GET này bằng tài khoản thật.
- Người dùng xác nhận chưa có DB test local. Docker bị từ chối truy cập pipe; initdb bị Windows restricted-token/filesystem chặn. Không tái sử dụng DB trên localhost chỉ vì thấy port5432 đang mở, không có DSN test được chỉ định. Không kết nối trực tiếp Azure, không chạy migration/reset/import/seed hoặc ghi thử vào API đang dùng DB remote.
- Browser/native host không khả dụng. Kiểm thử FE dùng Vite SSR và Axios transport fixture; không coi đây là browser E2E hay PostgreSQL integration.

### Ma trận API đang hoạt động

| API                                                       | BE/DB theo source                                                                                                         | FE/hợp đồng và kết quả audit                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/v1/menus`                                       | Repo list/count cùng school scope; date/weekStartDate/status/search; page/limit                                           | Danh sách gọi API thật. Sửa enum REVISION_REQUESTED của UI thành REVISION_REQUIRED khi gửi query, chuyển date/search và thêm scope tài khoản vào cache.                                                                                                           |
| GET `/api/v1/menus/:id`                                   | Đọc tuần, ngày, món, nguyên liệu, gia vị và nhóm suất thật                                                                | Detail/Edit gọi thật. Đã giữ nguyên số thập phân và ID nguyên liệu từ API thay vì suy đoán theo tên/default mock.                                                                                                                                                 |
| POST `/api/v1/menus`                                      | Transaction; trusted school, nguồn nguyên liệu, ngày/ca/định mức, trạng thái tuần                                         | Weekly create gọi HTTP thật; đã gỡ displayOrder bị Zod strict từ chối và không báo gửi duyệt thành công nếu thiếu menuId. **Chưa đạt**: CreateMenuDayModal còn chọn món/gia vị từ catalog mock/localStorage, không phải UUID kho thật.                            |
| PUT `/api/v1/menus/:id`                                   | Thay snapshot cả tuần; DRAFT/REVISION_REQUIRED; không đổi tuần; không sửa ngày đã dùng                                    | **Đã sửa lỗi mất dữ liệu**: FE đọc snapshot mới rồi merge đúng bữa, giữ các ngày/bữa/gia vị còn lại. Chặn đổi nhầm ngày/tuần và ghi khi snapshot lỗi/APPROVED. Chưa có optimistic concurrency token giữa GET và PUT; hai editor đồng thời vẫn cần thiết kế riêng. |
| DELETE `/api/v1/menus/:id`                                | Transaction; kiểm tra trạng thái và lịch sử sử dụng                                                                       | Service có HTTP thật. Không tìm thấy thao tác xóa trên màn danh sách hiện hành; không tạo nút mới trong đợt audit.                                                                                                                                                |
| POST `/api/v1/menus/:id/submit`                           | Kiểm tra đầy đủ T2–T6 và định mức, chuyển trạng thái trong transaction                                                    | Có gọi thật. FE còn tự yêu cầu đủ cả hai ca dù BE cho phép theo ca đã cấu hình; cần thống nhất trước khi thay quy tắc.                                                                                                                                            |
| GET `/api/v1/menus/:id/reviews`, POST `/:id/reviews`      | Repo/transaction, quyền duyệt và scope; giữ module menu-approval của BGH                                                  | Endpoint có. BGH là module của thành viên khác, không sửa nghiệp vụ duyệt ở đợt này.                                                                                                                                                                              |
| GET `/api/v1/menus/academic-calendar`                     | Đọc SchoolAcademicYear trong scope trường, tính số tuần ở BE                                                              | MenuPlanning đã dùng API thật. KitchenMenu vẫn dùng MOCK_SCHOOL_ACADEMIC_YEARS/ISO; **chưa đạt** bộ lọc năm học của màn bếp.                                                                                                                                      |
| GET `/api/v1/menus/context`                               | Bổ sung alias read-only của cấu hình trường qua quyền menu.view                                                           | BasicInfo đọc giờ ăn qua API này, không gọi endpoint quản trị trường cần quyền của BGH. Nullable/missing giữ nguyên, không giả lập giờ ăn.                                                                                                                        |
| GET `/api/v1/menus/week-schedule`                         | Lịch/trạng thái ngày và metadata tuần; query date strict                                                                  | **Đã sửa hợp đồng FE**: lấy thêm detail tuần từ API hiện có để hydrate món và gia vị từng bữa, cache theo tuần/tài khoản. Lỗi detail không bị biến thành thực đơn trống giả.                                                                                      |
| GET `/api/v1/menus/ingredient-options/:kind`              | main từ Supplier liên kết ACTIVE; seasoning từ IngredientEntry DRY_STOCK của trường; paging                               | MenuSeasoningCard gọi thật; IngredientPickerModal đã đổi sang API thật. Chưa có search server và chưa có kind avoidance (đang chỉ main/seasoning).                                                                                                                |
| GET/PUT `/days/:menuDayId/meals/:mealType/ingredients`    | Định mức trong scope, nguồn hợp lệ và khóa sau sử dụng                                                                    | Có BE/DB. Service FE chưa expose đủ và weekly day editor chưa dùng để ghi per-meal standards đầy đủ. Không coi dữ liệu mock đã lưu DB.                                                                                                                            |
| GET/PUT `/days/:menuDayId/meals/:mealType/portion-groups` | Nhóm suất thường/riêng do người dùng chọn, guard số lượng và tránh nguyên liệu                                            | Có BE. Form FE món thay thế vẫn chưa gửi đủ nhóm riêng/avoidances; không có suy đoán món thay thế được bổ sung.                                                                                                                                                   |
| POST `/api/v1/menus/allergy-check`                        | Dữ liệu ClassAllergy theo lớp/nguyên liệu; có bounds khi không đếm được học sinh duy nhất                                 | Service FE có HTTP, Edit/UI vẫn có logic dị ứng từ mock và số12; **chưa đạt** hiển thị/khóa gửi duyệt theo kết quả thực. Không thêm Student/allergen hoặc suy đoán món.                                                                                           |
| GET `/days/:menuDayId/meals/:mealType/requirements`       | Định mức × nhu cầu đã FINALIZED; tồn/giữ/đã dùng/thiếu; thêm dishPortions từ cùng demand                                  | CreateBatch và CreateBatchSeparate lấy số suất từng món thật, bỏ fallback400 và không lấy thực đơn Thứ Hai khi hôm nay không có thực đơn.                                                                                                                         |
| GET `/api/dishes`                                         | Chỉ GET, menu.view, scope trường; paging                                                                                  | DishCatalog và day modal vẫn localStorage/mock. Không có POST/PUT/DELETE để CRUD món trên DB; không tự tạo thêm nghiệp vụ trong audit.                                                                                                                            |
| GET `/api/v1/kitchen`, GET `/stats`                       | Cùng filter/search/scope; list/count và KPI, transaction đọc                                                              | FE gọi thật. Query hasSample đã được chuyển đúng thay vì bị adapter làm mất.                                                                                                                                                                                      |
| GET `/api/v1/kitchen/context`                             | Scope trường, cookingMode/giờ/năm học thật                                                                                | FE CookingBatches dùng API thật.                                                                                                                                                                                                                                  |
| GET `/api/v1/kitchen/:id`                                 | Batch, lot, nguyên liệu, gia vị dùng chung thật                                                                           | FE detail gọi thật; Date/Decimal serialization theo contract.                                                                                                                                                                                                     |
| POST `/api/v1/kitchen`                                    | Backend tự tính suất, phân bổ lot, giữ lượng; mode từ trường; transaction                                                 | FE gọi thật; đã đọc đúng response `{created,batches}` để dùng mã batch thật. Vẫn cần thống nhất màn nấu chung/riêng với cookingMode từ cấu hình trường, không để tiêu đề UI trái mode server.                                                                     |
| POST `/api/v1/kitchen/:id/confirm`                        | Khóa school/batch/lots, kiểm tra giữ kho, chuyển UNCONFIRMED→CONFIRMED                                                    | Gọi HTTP thật. Kiểm thử lặp request bằng fixture không thay thế PostgreSQL concurrency test.                                                                                                                                                                      |
| POST `/api/v1/kitchen/:id/complete`                       | Dùng kế hoạch đã chốt; trừ kho + inventory transaction + trạng thái trong cùng transaction; COMPLETED retry không trừ lại | FE đã bỏ preparedPortions khỏi request. Cần chạy test DB thật cho tranh chấp/rollback.                                                                                                                                                                            |
| DELETE `/api/v1/kitchen/:id`                              | Chỉ UNCONFIRMED chưa có lịch sử; giải phóng giữ lot/gia vị khi phù hợp                                                    | FE gọi thật. PUT sửa mẻ không có route; EditBatch legacy không được mount.                                                                                                                                                                                        |
| GET/POST `/api/v1/kitchen/:id/food-samples`               | Một mẫu/batch COMPLETED; thời điểm lấy từ completedAt đến hiện tại; retry không ghi đè                                    | FE gọi thật. **Đã sửa** data:null trả null, không biến thành envelope khiến UI nghĩ đã có mẫu.                                                                                                                                                                    |
| GET `/api/v1/retained-samples` và `/food-samples`         | status/search/paging, same school scope và expiresAt +24h                                                                 | FE đã đọc hết các page trước khi lọc/KPI; không chỉ lọc20bản ghi đầu. READY_TO_DISPOSE đã khớp giá trị option. Hiện mealType/date/ready chỉ lọc ở FE, BE chưa có các query này hoặc endpoint stats riêng; dữ liệu nhiều sẽ cần phân trang/filter server đầy đủ.   |
| POST `/retained-samples/:sampleId/dispose` và alias       | Server kiểm tra đủ24h, thời điểm hợp lệ, hold sự cố, scope; retry không sửa lịch sử                                       | Gọi thật; không có API sửa mẫu. Không thử tiêu hủy trên DB dùng chung.                                                                                                                                                                                            |

### Các màn ngoài luồng thực đơn/mẻ/lưu mẫu

| Màn/luồng                               | Phát hiện                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HealthOverview                          | HealthKPICards/HealthPendingTasksTable/HealthAllergyByClass dùng số liệu và mảng tĩnh; chưa nối API thật.                                                                                                                                                                                                                                                |
| HealthAllergy                           | import mockAllergyData; không gọi ClassAllergy API để đọc dữ liệu trường.                                                                                                                                                                                                                                                                                |
| API dị ứng/giao hàng/đánh giá/truy xuất | Đã đối chiếu route thực tế: GET `/api/class-allergies`, `/api/deliveries`, `/api/ingredient-quality-feedback`, `/api/traceability-anchors` có auth/resource scope. Các module này hiện chỉ GET; không có CRUD hồ sơ dị ứng cá nhân hoặc POST đánh giá giao hàng trong các router tương ứng. Không gán quyền có sẵn đồng nghĩa write endpoint đã tồn tại. |
| DishCatalog                             | CRUD lưu FOODPRINT_DISH_CATALOG_V2 trong localStorage; không ghi DB.                                                                                                                                                                                                                                                                                     |
| IngredientInspect (cả hai role)         | INITIAL_DELIVERIES và thao tác state/timer; chưa đánh giá giao hàng qua API/DB thật.                                                                                                                                                                                                                                                                     |
| KitchenMenu                             | Gọi API thật nhưng lịch năm học vẫn mock; trước audit response lịch thiếu dishes, đã sửa hydrate dữ liệu qua detail. Cần lọc trạng thái APPROVED và đồng bộ calendar API cho màn bếp.                                                                                                                                                                    |
| Kitchen home                            | RecentCookingBatches/PendingTasksSection gọi KitchenService; số đếm mới chỉ từ trang dữ liệu lấy về, không đảm bảo thống kê toàn trường.                                                                                                                                                                                                                 |
| Phân bổ/bàn giao/truy xuất của bếp      | Route hiện trỏ về KitchenCooking; phân bổ ghi rõ tạm hoãn trong API FINAL, chưa phải màn chức năng hoàn chỉnh. Không tự triển khai lại phần đã tạm hoãn.                                                                                                                                                                                                 |

### Ràng buộc kiểm tra từ source (chưa có bằng chứng DB runtime)

- Tách scope trường từ principal, không tin schoolId của client; quyền menu và kitchen/sample theo catalog hiện hành. Không sửa role/permission/auth.
- Menu: date thật YYYY-MM-DD, T2–T6, ca enum, không trùng ngày/ca/món/nguyên liệu, định mức dương ≤3 chữ số thập phân, nguồn NCC/kho trong scope; khóa menu/ngày đã duyệt/sử dụng.
- Batch: plannedPortions từ nhu cầu giáo viên đã chốt và nhóm suất; reserve UNCONFIRMED/CONFIRMED; lot/expiry/quantity/unit hợp lệ; khóa giao dịch; xóa chỉ trước confirm; complete retry không double consumption; gia vị dùng chung tiêu hao một lần khi cả bữa hoàn tất.
- Sample: chỉ COMPLETED; quantity/unit/storage/time validated; một mẫu/batch; đủ24h bằng đồng hồ server, không tiêu hủy mẫu bị hold; không ghi đè lịch sử khi retry.
- Test DB integration hiện có trong authorization.integration.test.ts bao phủ reserve, concurrent complete, retry, xóa và sample/hold; chưa chạy tại máy trong đợt này. kitchen-nutrition-wire.integration.test.ts là test chuẩn bị cho FR017–FR024 nhưng chưa được đăng ký CI và đang đòi các endpoint/filter chưa triển khai; không tuyên bố pass test này.

### Thứ tự xử lý phần còn thiếu

1. Đổi CreateMenuDayModal/DishCatalog sang catalog thật, nhập định mức riêng cho từng nguyên liệu và gia vị từng bữa; không dùng UUID/tên/suất/nhà cung cấp/certification mock.
2. Nối đối soát dị ứng và nhóm suất riêng theo ClassAllergy/portion groups hiện hành, hiển thị khoảng khi không đếm được học sinh duy nhất; không suy đoán món thay thế.
3. Đồng bộ KitchenMenu calendar và trạng thái APPROVED; nối đầy đủ mode trường, dữ liệu kế hoạch lot từ response BE và bộ chọn ngày khi chế biến.
4. Đưa sample filter/KPI lên server và phân trang UI khi dữ liệu lớn; loại bỏ thao tác sửa mẫu không có endpoint.
5. Nối HealthOverview/HealthAllergy/IngredientInspect với các module tương ứng sau khi chốt API với người phụ trách; giữ phân bổ đã tạm hoãn.
6. Cấp DB local test riêng và chạy authorization/migration/wire tests, sau đó browser E2E bằng hai tài khoản. Đây là phần còn thiếu để xác nhận toàn bộ luồng và ràng buộc trên DB thật.

### Kiểm thử đợt audit

- BE: full infrastructure-free test:unit **251/251 pass**; typecheck/build pass. Không chạy authorization.integration/migrations/wire vì chưa có test DSN local riêng.
- FE: `node --test tests/kitchen-nutrition-api.test.mjs`: **10/10 pass**, dùng fixture/Axios transport/Vite SSR. Bao phủ query enum/search/date/cache scope; hydrate tuần với gia vị hai bữa; merge snapshot giữ ngày/bữa/định mức phân số; không PUT khi snapshot lỗi/đã duyệt/chuyển nhầm ngày; hasSample=false; sample null; đọc hơn100mẫu; request plan/confirm/complete/delete; lỗi ghi không thành công giả; món riêng lấy đúng dish đã gán, không tự sinh món thay thế.
- Nối getContext/menu requirements/helper tuần và response tạo batch không thay schema/migration/role. Những phần còn mock trong bảng trên được giữ là **chưa đạt**, không bị đánh dấu hoàn thành chỉ vì các test fixture pass.

Nguồn: FoodPrint_Menu_CookingBatch_API_FINAL.md, AGENTS.md, docs/AUTHORIZATION.md và spec004. Đối chiếu source sau merge dev ngày 08/11/2026. 27 endpoint hiện hành có route.

## Menu/dish: 16 endpoint

| Method         | Path                                                         | Trạng thái                              |
| -------------- | ------------------------------------------------------------ | --------------------------------------- |
| GET/POST       | /api/v1/menus                                                | Có danh sách/tạo nháp                   |
| GET/PUT/DELETE | /api/v1/menus/:id                                            | Có chi tiết/cập nhật/xóa nháp           |
| POST           | /api/v1/menus/:id/submit                                     | Có gửi duyệt                            |
| POST           | /api/v1/menus/allergy-check                                  | Có, yêu cầu cả hai quyền                |
| GET            | /api/v1/menus/ingredient-options/:kind                       | Có, giữ NCC/ingredient ACTIVE từ dev    |
| GET/PUT        | /api/v1/menus/days/:menuDayId/meals/:mealType/ingredients    | Có                                      |
| GET/PUT        | /api/v1/menus/days/:menuDayId/meals/:mealType/portion-groups | Có                                      |
| GET            | /api/v1/menus/:id/approval-detail                            | Có, BGH trong trường                    |
| POST/GET       | /api/v1/menus/:id/reviews                                    | Có, quyết định nguyên tuần theo spec004 |
| GET            | /api/dishes                                                  | Có                                      |

Routes: src/modules/menu/menu.routes.ts, src/modules/dish/dish.routes.ts; approval handler thuộc menu-approval.

## Kitchen/sample: 11 endpoint

| Method     | Path                                   | Trạng thái                                           |
| ---------- | -------------------------------------- | ---------------------------------------------------- |
| GET/POST   | /api/v1/kitchen                        | Có danh sách/lập phương án                           |
| GET        | /api/v1/kitchen/stats                  | Có                                                   |
| GET/DELETE | /api/v1/kitchen/:id                    | Có, chỉ xóa UNCONFIRMED                              |
| POST       | /api/v1/kitchen/:id/confirm            | Có, recheck reservation                              |
| POST       | /api/v1/kitchen/:id/complete           | Có, chống trừ kho hai lần                            |
| GET/POST   | /api/v1/kitchen/:id/food-samples       | Có                                                   |
| GET        | /api/v1/retained-samples               | Có route, bổ sung status/search/expiresAt/totalItems |
| POST       | /api/v1/food-samples/:sampleId/dispose | Có; alias retained-samples cũng có                   |

PUT kitchen đã gỡ có chủ đích. Meal-allocation ở MD đang hoãn; không bổ sung nghiệp vụ mới.

## Retained sample contract bổ sung

GET food-samples và retained-samples nhận page/limit hiện có, status theo enum mẫu hiện hành và search trim giới hạn độ dài. Search tủ lưu/mã mẻ/tên món case-insensitive; mọi điều kiện kết hợp trusted school scope. Output giữ các field cũ, thêm expiresAt ISO = sampledAt +24h; pagination giữ hasNext và thêm totalItems. Date/Decimal được serialize rõ, không spread persistence record. Count và list dùng cùng WHERE. Sample disposal vẫn dùng thời gian server và hold sự cố, không phụ thuộc expiresAt client.

## Query đã kiểm chứng — 09/11/2026

Mặc định page=1, limit=20; limit tối đa100. Search được trim, rỗng tương đương không tìm và tối đa100ký tự; so sánh không phân biệt hoa thường. Không nhận organizationId/schoolId từ query để tự cấp quyền.

| Endpoint                                               | Bộ lọc và tìm kiếm                                                                                                 | Metadata                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| GET /api/v1/menus                                      | status, weekStartDate, date, search tiêu đề tuần/tên món                                                           | page, limit, totalItems                                    |
| GET /api/v1/kitchen                                    | status, mealType, cookingModeApplied, menuDayId, dishId, date hoặc startDate/endDate; search mã mẻ/tên món/số suất | page, limit, totalItems                                    |
| GET /api/v1/kitchen/stats                              | Cùng bộ lọc danh sách, không phân trang số đếm                                                                     | total và các KPI trạng thái/mẫu                            |
| GET /api/v1/food-samples hoặc /api/v1/retained-samples | status, search tủ lưu/mã mẻ/tên món                                                                                | page, limit, totalItems, hasNext; mỗi mẫu có expiresAt ISO |
| GET /api/v1/menus/ingredient-options/:kind             | kind main/seasoning, page/limit, điều kiện ACTIVE và school scope hiện có                                          | page, limit, totalItems                                    |
| GET /api/dishes                                        | Phân trang/school scope hiện có; không sửa module danh mục dùng chung                                              | page, limit, hasNext                                       |

Khoảng ngày của kitchen có hai đầu inclusive, ưu tiên khoảng so với date; hỗ trợ chỉ một đầu và từ chối endDate trước startDate. Sort thực đơn weekStartDate desc/id asc, mẻ createdAt desc/id asc, mẫu sampledAt desc/id asc để phân trang ổn định.

## Chức năng loại khỏi hai role

- BE không có endpoint xuất CSV/Excel/PDF/in trong ba module. Gỡ cả controller/service/validator/Request DTO của edit mẻ đã bỏ routePUT; giữ delete và complete.
- FE MenuPlanning/MenuDetail gỡ nút/prop/state/modal/handler window.print và SCSS riêng. KitchenCooking đã không còn chức năng xuất/in. Giữ MenuApproval của BGH và reporting dùng chung.
- Không sửa schema/migration/catalog hoặc dữ liệu database. Thay đổi FE nằm trong repo riêng và chưa commit/push cùng BE.

## Mâu thuẫn được giải quyết

- Giữ duyệt nguyên tuần, menuDayId bị 400 theo spec004; không dùng mô tả duyệt từng ngày trong MD tổng hợp.
- Quyền chính xác: cooking_batch.view, retained_sample.view và menu.view theo catalog; không tạo kitchen.view/retained-sample.view/dish.view chỉ từ ví dụ.
- Role chính xác dùng constants hiện tại, không tạo SCHOOL_ADMIN/CHEF. Không tự bỏ menu.view khỏi bếp để khớp mô tả UI.
- Reservation hiện có từ UNCONFIRMED và confirm tái kiểm tra; giữ để tránh overbooking.
- REVISION_REQUESTED là decision; trạng thái database REVISION_REQUIRED giữ nguyên. ID ví dụ không thay UUID.
- Complete có thể nhận preparedPortions compatibility, nhưng phải hợp lệ và không là nguồn quyết định trừ kho; dùng nhu cầu/kế hoạch server đã chốt.
