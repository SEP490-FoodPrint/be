# Quickstart Validation: Đổi trạng thái nguyên liệu

## Trạng thái tài liệu

Đây là hướng dẫn kiểm chứng sau khi triển khai theo [plan.md](plan.md), không phải báo cáo test đã chạy. Endpoint và kiểm thử mô tả dưới đây chưa được triển khai ở bước lập kế hoạch. Hợp đồng: [ingredient-status-api.md](contracts/ingredient-status-api.md); chuyển trạng thái và dữ liệu bất biến: [data-model.md](data-model.md).

## Điều kiện chuẩn bị

- Node.js theo .nvmrc, npm theo package.json, dependency và Prisma Client hiện có. Nếu chưa cài: npm ci; nếu thiếu client: npm run prisma:generate. Sinh client không thay database.
- Với unit/HTTP injection: không cần PostgreSQL hoặc Redis; giữ fixture cô lập hiện có.
- Với integration: dùng instance PostgreSQL local đã được người dùng lựa chọn, .env.test.local không commit và Redis local theo cấu hình test. Phải có ủy quyền riêng cho việc tạo/ghi/dọn các database tạm của lần chạy. Cấu hình hoặc tài khoản có quyền không tự cấp ủy quyền.
- Wrapper có thể tạo control database foodprint_migration_test nếu chưa có; việc này cũng phải nằm trong ủy quyền kiểm thử. Không dùng database thành viên hoặc Azure, không tạo container PostgreSQL mới.

## Kiểm chứng không cần hạ tầng

Từ root repository, sau implementation:

```bash
npm exec --no -- tsx --test tests/ingredient-management.test.ts
npm run validate
npm run test:unit
```

Kỳ vọng:

- Validator nhận đúng hai trạng thái, từ chối body thiếu/null/enum sai/thuộc tính thừa và UUID sai; trả lỗi tiếng Việt đúng paths.
- Service dùng cùng tx cho recheck, khóa, đọc và ghi. Cùng đích không gọi mutation; cả ACTIVE và INACTIVE đều được kiểm tra.
- Hai chiều trả đúng DTO và envelope; no-op vẫn từ chối quyền hoặc ownership không hợp lệ.
- Repository scope WHERE theo supplierId, guard status khác đích, data chỉ có status.
- PATCH thông tin giữ nguyên status; route hide không có mutation và trả 404 với danh tính hợp lệ qua app có notFoundHandler.
- validate bao gồm typecheck/build; test:unit đã có ingredient-management.test.ts trong script nên không cần thêm file test mới.

Ghi nhận kết quả thực tế từng lệnh. Nếu lỗi nền không liên quan, ghi rõ file/lỗi và kiểm tra trực tiếp phần thay đổi; không báo toàn bộ quality gate đã đạt.

## Kiểm chứng PostgreSQL local được quản lý

Chỉ chạy nhóm này khi đã có điều kiện và ủy quyền nêu trên:

```bash
npm run test:local:check
npm run test:local:authorization
```

Wrapper đọc .env.test.local, dùng instance đã chọn, tạo các DB tạm và chỉ dọn tên được ghi nhận sau CREATE thành công trong lần chạy. Suite authorization dùng login/permission thật; các scenario status/selection được mở rộng tại tests/authorization.integration.test.ts. Không chạy migrate deploy, db push hoặc bootstrap trực tiếp trên database ứng dụng.

Nếu Redis local chưa chạy và thao tác setup được phép:

```bash
docker compose up -d --no-recreate --wait redis
npm run redis:check
```

Không flush Redis, xóa wildcard, xóa volume hoặc dùng remove-orphans. Không tạo dữ liệu thử trên DB đang sử dụng.

## Ma trận scenario integration

| Scenario             | Thực hiện trong DB tạm                                                                         | Kết quả cần chứng minh                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Hai chiều            | ACTIVE → INACTIVE → ACTIVE bằng cùng PATCH status                                              | 200, GET quản trị đọc đúng status và DTO                                                                                           |
| Legacy               | Fixture tạo INACTIVE trước lần gọi đổi trạng thái đầu tiên                                     | Mở lại được trên cùng id                                                                                                           |
| No-op hai trạng thái | Đọc updatedAt, gửi trạng thái hiện tại nhiều lần, đọc lại                                      | 200, updatedAt thực trong PostgreSQL không đổi                                                                                     |
| Bảo toàn             | Gắn danh mục/ảnh và IngredientEntry/lịch sử, làm ít nhất ba chu kỳ                             | Nội dung/createdAt/owner/id và các liên kết giữ nguyên; chỉ status/updatedAt đổi                                                   |
| Quyền                | Staff dù có manage, System Admin, thiếu quyền, tài khoản/supplier không ACTIVE                 | Bị từ chối, không mutation                                                                                                         |
| Principal cũ         | Thu hồi quyền hoặc đổi membership sau khi lấy principal, gọi changeStatus qua service          | Recheck trong tx từ chối cả chuyển thật và no-op                                                                                   |
| Cô lập               | Admin A gửi id của B và UUID không tồn tại                                                     | Cùng 404 và message, không lộ B                                                                                                    |
| Input                | Các body sai và UUID sai                                                                       | 400, paths tiếng Việt, không chứa giá trị nhạy cảm, DB không đổi                                                                   |
| Sửa thông tin        | Sửa mô tả lúc INACTIVE; gửi status trong PATCH thông tin                                       | Sửa mô tả không bật lại; status trong PATCH thông tin bị 400                                                                       |
| Lựa chọn             | Fixture supplier/quan hệ/entry đều ACTIVE, kiểm tra SCHOOL list và menu options main/seasoning | INACTIVE biến mất khỏi lựa chọn mới, ACTIVE xuất hiện lại khi đủ điều kiện; quản trị vẫn thấy cả hai                               |
| Điều kiện liên quan  | Entry hoặc quan hệ không ACTIVE rồi hiện lại ingredient                                        | Không tự bật entry/quan hệ, lựa chọn vẫn áp điều kiện hiện có                                                                      |
| Cùng đích đồng thời  | Hai yêu cầu INACTIVE cho ACTIVE, rồi hai yêu cầu ACTIVE cho INACTIVE                           | Cùng về đúng đích, không bản sao; yêu cầu sau trở thành no-op sau recheck/retry                                                    |
| Khác đích đồng thời  | Hai trạng thái khác nhau với barrier của fixture                                               | Thứ tự ghi được kiểm soát/quan sát bằng test; trạng thái cuối đúng lần ghi nhận sau, không dùng thứ tự HTTP response để suy commit |
| Status và edit       | Đổi status song song PATCH mô tả                                                               | Giữ status đã đặt và mô tả đã sửa; lỗi retry nếu có không tạo thay đổi một phần                                                    |
| Rollback             | Tiêm lỗi repository bên trong tx trước commit                                                  | Không trả thành công, status và dữ liệu khác vẫn như trước; lỗi không lộ driver                                                    |
| Route cũ             | POST hide với admin hợp lệ                                                                     | 404, status và timestamp không đổi                                                                                                 |

Với race, dùng barrier/helper hiện có và thứ tự transaction quan sát được; không dựa vào sleep hoặc tốc độ mạng để khẳng định thứ tự. Kiểm tra retry có giới hạn và lỗi 503 an toàn nếu retry hết, không cam kết mọi yêu cầu dưới contention bất kỳ luôn thành công.

## Cập nhật suite legacy và bên sử dụng

Chuyển caller /hide trong tests/supplier-onboarding.integration.test.ts sang PATCH status INACTIVE. Suite này hiện tự tạo database nhưng không ghi manifest/dọn bằng wrapper local; không đưa npm run test:supplier-onboarding vào chuỗi chạy local mặc định. Coverage ẩn/hiện và lựa chọn phục vụ tính năng phải chạy được bằng suite authorization được quản lý. Nếu suite legacy cần chạy riêng, phải có instance tạm và cách quản lý/dọn DB đã được chấp thuận.

Client ngoài repository đổi thao tác ẩn sang PATCH status INACTIVE, thao tác hiện dùng cùng route với ACTIVE. Phối hợp phát hành vì route hide cũ bị loại bỏ.

## Kiểm tra tài liệu và báo cáo

- Ma trận endpoint trong docs/AUTHORIZATION.md và src/modules/README.md dẫn contract mới, ghi cả hai chiều và no-op.
- Rà soát runtime/tests không còn gọi route hide; tài liệu spec cũ có thể giữ nội dung lịch sử.
- Ghi kết quả actual/passed/failed/blocked cho từng nhóm; nêu rõ integration chưa chạy nếu chưa có ủy quyền hoặc hạ tầng.
- Bước plan chỉ rà soát và định dạng tài liệu; không dùng kết quả đó để khẳng định API đã hoạt động.

## Kết quả triển khai

- Node.js 24.22.1, npm 11.19.1 và Prisma Client hiện có.
- `npm exec --no -- tsx --test tests/ingredient-management.test.ts`: 13/13 đạt. Sandbox từ chối socket IPC của tsx; chạy lại ngoài sandbox được cho phép và thành công.
- `npm run test:unit`: 601/601 đạt, chạy ngoài sandbox sau khi được cho phép.
- `npm run validate`: đạt lint, kiểm tra định dạng, typecheck và build.
- Integration PostgreSQL: chưa chạy, đang chờ lựa chọn instance local và ủy quyền ghi database tạm. Không chạy suite supplier onboarding legacy trực tiếp.
- `npm run spec:check`: chưa chạy được ngoài CI vì thiếu `SPEC_GATE_BASE_SHA`; cần base/head commit để gate đánh giá. Các thay đổi hiện chưa được commit.
- Client dùng endpoint cũ cần đổi sang `PATCH /api/ingredients/management/:ingredientId/status` với body `status: "INACTIVE"` để ẩn hoặc `status: "ACTIVE"` để hiện lại.
