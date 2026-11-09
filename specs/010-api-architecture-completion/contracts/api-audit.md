# API audit và quyết định contract

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
