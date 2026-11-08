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

GET food-samples và retained-samples nhận page/limit hiện có, status theo enum mẫu hiện hành và search trim giới hạn độ dài. Search mã mẻ/tên món case-insensitive; mọi điều kiện kết hợp trusted school scope. Output giữ các field cũ, thêm expiresAt ISO = sampledAt +24h; pagination giữ hasNext và thêm totalItems. Date/Decimal được serialize rõ, không spread persistence record. Count và list dùng cùng WHERE. Sample disposal vẫn dùng thời gian server và hold sự cố, không phụ thuộc expiresAt client.

## Mâu thuẫn được giải quyết

- Giữ duyệt nguyên tuần, menuDayId bị 400 theo spec004; không dùng mô tả duyệt từng ngày trong MD tổng hợp.
- Quyền chính xác: cooking_batch.view, retained_sample.view và menu.view theo catalog; không tạo kitchen.view/retained-sample.view/dish.view chỉ từ ví dụ.
- Role chính xác dùng constants hiện tại, không tạo SCHOOL_ADMIN/CHEF. Không tự bỏ menu.view khỏi bếp để khớp mô tả UI.
- Reservation hiện có từ UNCONFIRMED và confirm tái kiểm tra; giữ để tránh overbooking.
- REVISION_REQUESTED là decision; trạng thái database REVISION_REQUIRED giữ nguyên. ID ví dụ không thay UUID.
- Complete có thể nhận preparedPortions compatibility, nhưng phải hợp lệ và không là nguồn quyết định trừ kho; dùng nhu cầu/kế hoạch server đã chốt.
