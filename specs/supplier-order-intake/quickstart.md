# Quickstart: Kiểm chứng supplier order intake

## Phạm vi và trạng thái

Tính năng đã được triển khai và kiểm chứng tự động trên nhánh `feat/supplier-order-intake`. Kết quả thực tế nằm ở cuối tài liệu; các lệnh HTTP dưới đây là hướng dẫn tái kiểm chứng trên dữ liệu thử được phép. Xem [hợp đồng](contracts/supply-requests.md), [mô hình](data-model.md) và [kế hoạch](plan.md).

## Prerequisites

- Node/npm đúng package.json và `.nvmrc`, dependencies đã được cài bằng npm ci khi cần.
- `.env` của thành viên đã được cấu hình, không in hoặc commit secret. Chạy ứng dụng thật cần PostgreSQL/Redis local theo README; unit/HTTP injection không cần hạ tầng.
- Với kiểm chứng thủ công: dữ liệu thử được cấp riêng và tài khoản supplier admin/staff thuộc đơn vị A, tài khoản supplier B, các quyền view/accept phù hợp, yêu cầu đã gửi/đã nhận/nháp/hủy/hoàn thành và nguyên liệu tương ứng. Không tự seed/import vào DB hiện có.
- Với integration: `MIGRATION_TEST_DATABASE_URL` phải trỏ instance PostgreSQL local disposable được chọn và cho phép rõ ràng; harness tạo database mới, áp migration hiện hành và dọn database của chính lần chạy. Không trỏ database thành viên hoặc Azure.

## Kiểm tra chất lượng sau triển khai

Chạy từ repository root:

```sh
npm run validate
npm run test:unit
```

Kỳ vọng lint, format, typecheck, Prisma generate/build và unit/HTTP tests đều pass. Các file unit đã có trong test:unit; nếu tách thêm file mới phải đăng ký script. Không ghi PASS khi chưa thực hiện.

## Kịch bản HTTP

Thiết lập `API_BASE` tới server thử nghiệm, `SUPPLIER_TOKEN` là token hợp lệ của admin hoặc staff A, `REQUEST_ID` là UUID đơn SENT của A. Không ghi token vào repo hoặc báo cáo.

```sh
curl -sS "$API_BASE/api/supply-requests?status=SENT&page=1&limit=20" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN"

curl -sS "$API_BASE/api/supply-requests/$REQUEST_ID" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN"

curl -sS -X POST "$API_BASE/api/supply-requests/$REQUEST_ID/accept" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" \
  -H 'Content-Type: application/json' -d '{}'
```

Lần POST này thay đổi đơn được chọn; chỉ chạy trên dữ liệu thử đã được cho phép. Lặp lại toàn bộ với role còn lại và một đơn SENT khác. Kỳ vọng list không có DRAFT; chi tiết có đủ dòng, lượng/đơn vị, trường và ngày giao; nhận thành công trả đúng bốn field receipt. POST lại phải giữ người/thời điểm, không đổi updatedAt; GET chi tiết thể hiện receipt đó.

## Ma trận xác nhận

| Kịch bản                                                 | Kỳ vọng                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| Admin và staff A, đủ quyền                               | Cùng thực hiện được list/detail/accept                              |
| View có, accept bị denial                                | Đọc được, nhận 403                                                  |
| Accept có, view bị denial                                | Đọc 403; nhận được đơn hợp lệ khi biết ID                           |
| Supplier B mở/nhận ID của A                              | 404, không lộ dữ liệu                                               |
| DRAFT                                                    | Không có trong supplier list; detail/accept 404                     |
| Sai role/org dù gán permission                           | Detail/accept bị từ chối; không ghi                                 |
| status DRAFT/lạ, extra field, UUID sai, limit 101/page 0 | 400 có field path tiếng Việt                                        |
| Trang rỗng hoặc filter không có kết quả                  | items [], hasNext false                                             |
| Ingredient/entry inactive, null date/note, lượng Decimal | Dòng không bị mất; null giữ null; số lượng chuỗi chính xác          |
| Supplier PAUSED nhận SENT                                | 409, không ghi                                                      |
| Admin một bên DEACTIVATED nhận SENT                      | 409, không ghi                                                      |
| School PAUSED, supplier vẫn ACTIVE, SENT hợp lệ          | Vẫn nhận được                                                       |
| Supplier pause sau ACCEPTED/IN_PROGRESS                  | Nhận lại trả receipt cũ, không ghi                                  |
| CANCELLED/COMPLETED                                      | Nhận 409, giữ nguyên dữ liệu                                        |
| SCHOOL/SYSTEM GET regression                             | Scope/projection/query cũ giữ nguyên; SCHOOL thấy DRAFT của mình    |
| Projection an toàn                                       | Không có secret, email/phone, contractSnapshot hoặc raw persistence |

## Đồng thời và phân quyền thật

Sau khi instance disposable đã được chọn và ủy quyền:

```sh
npm run test:authorization
npm run test:account-lifecycle:integration
```

Dùng harness hiện có, mở rộng trong bước implement. Kỳ vọng kiểm chứng hai người cùng nhận chỉ có một lần ghi; thử lại trả cùng receipt; thu quyền/đổi membership/pause/deactivate commit trước bước xác minh cuối chặn nhận mới, không cập nhật một phần. Kiểm tra thứ tự hủy và nhận bằng giao dịch fixture theo lock protocol; không cần endpoint hủy mới. Unit mock không thay thế được kết luận cạnh tranh trên PostgreSQL.

Nếu thiếu prerequisite, ghi chính xác integration chưa chạy và nguyên nhân; không dùng database khác để chạy thay. Không yêu cầu migration mới hoặc bootstrap quyền cho feature này.

## Ghi nhận kết quả

Sau implement, ghi phiên bản code, từng lệnh đã chạy, số test pass/fail, kịch bản thủ công đã thực hiện và prerequisite còn thiếu. Lịch sử bước plan chỉ rà soát thiết kế; kết quả implementation bên dưới ghi rõ các lần kiểm chứng đã thực hiện.

## Implementation baseline

- Nhánh feat/supplier-order-intake, pointer/spec/plan/tasks khớp; checklist 16/16 PASS. Không có extension hooks.
- Ignore hiện có đủ node_modules/dist/build/generated/.env/log/lockfile theo công cụ tương ứng; không cần sửa cấu hình. Không có Dockerfile/build mới hoặc nhu cầu publish npm.
- GET list và POST accept đã mount đúng /api/supply-requests. Grants view/accept đã có cho cả hai role. Không cần dependency/bootstrap/migration mới.
- T003–T005 đã chốt tại mục Implementation handoff trong plan. Ban đầu chưa chọn instance disposable; sau đó người dùng đã cho phép tạo PostgreSQL tạm riêng và cả hai suite integration đã chạy thành công trên instance đó. Không chạy kiểm thử ghi vào DB thành viên hoặc Azure.

## Kết quả implementation — 2026-11-14

**Trạng thái**: Hoàn thành 40/40 task, ba subagent được chia độc quyền theo file, agent chính tích hợp regression và PostgreSQL tests. Không có thay đổi schema/migration/dependency hoặc cấu hình kết nối runtime.

| Kiểm tra đã thực hiện                                           | Kết quả                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| Unit/HTTP riêng supply-order, gồm repository/validation/receipt | PASS 21/21                                                      |
| Unit intake-access guard                                        | PASS 31/31                                                      |
| npm run validate                                                | PASS lint + format:check + typecheck + Prisma generate/build    |
| npm run test:unit                                               | PASS 511/511, gồm legacy SCHOOL/SYSTEM và các module regression |
| npm run test:authorization                                      | PASS 46/46 trên PostgreSQL 18 tạm và Redis local                |
| npm run test:account-lifecycle:integration                      | PASS 25/25 trên database mới trong cùng PostgreSQL tạm          |
| Rà soát kiến trúc, safe projection, role/scope và diff          | Không phát hiện sai lệch còn mở; git diff --check PASS          |

### Bằng chứng theo luồng

- US1: hai role đọc list đúng scope, năm trạng thái ngoài DRAFT, status filter/phân trang, legacy SCHOOL/SYSTEM giữ scope/projection/query; unit/HTTP và PostgreSQL đều kiểm chứng. Bản ghi lịch sử sentAt null không bị ẩn.
- US2: hai role đọc chi tiết đủ hai dòng, một ingredient/entry INACTIVE; số lượng 12345678901.123 không mất chính xác, unit lấy từ dòng, ngày/null và receipt đúng hợp đồng. DRAFT/ngoài scope/không tồn tại bị che; không lộ contractSnapshot hoặc hồ sơ tài khoản.
- US3: admin và staff đều nhận được đơn; quyền accept vẫn hoạt động khi view bị tắt và ngược lại. Hai actor tiếp nhận đồng thời nhận cùng receipt đầu tiên trên PostgreSQL; thử lại không đổi actor/time/updatedAt. Gây lỗi sau update thực chứng minh rollback về SENT và metadata trống. Hủy thắng thứ tự khóa khiến nhận bị từ chối, không ghi dở dang.
- Lifecycle thật: kiểm tra tạm dừng, thu permission/role grant, trạng thái tài khoản, chuyển membership và đổi role trong lúc nhận; vô hiệu hóa admin trường với hai thứ tự giao dịch; trường PAUSED vẫn cho nhận SENT; nhận lại ACCEPTED/IN_PROGRESS giữ receipt sau supplier pause và admin trường DEACTIVATED.
- SC-001–005 và FR-001–015 được đối chiếu qua các kiểm thử trên; không dùng mock để thay kết luận cạnh tranh PostgreSQL.

### Môi trường và các lần sửa kiểm chứng

Người dùng đã ủy quyền tạo container riêng `foodprint-supplier-intake-test`, image PostgreSQL 18, bind 127.0.0.1:55432. Hai harness tự tạo database mới bên trong instance này; không dùng PostgreSQL thành viên ở cổng 5433 hoặc Azure. Redis local đang chạy được dùng theo namespace/session thử và chỉ dọn dữ liệu của chính fixture. Container PostgreSQL tạm đã dừng và tự xóa bằng --rm sau các kiểm thử; các container có sẵn được giữ lại.

Lần chạy authorization đầu thiếu tham số schema=foodprint nên migration fixture thất bại ở bảng không định danh schema. Đã dùng URL đúng hướng dẫn README, tạo database mới qua harness và chạy lại PASS; không sửa migration đã có. Lần chạy lifecycle đầu phát hiện fixture mới dùng PAUSED cho nhà cung cấp, đã sửa sang PAUSED_FOR_FOOD_SAFETY_INSPECTION rồi chạy lại toàn suite PASS.

Log của lần chạy cuối nằm ngoài repository: `/tmp/foodprint-intake-validate.log`, `/tmp/foodprint-intake-unit.log`, `/tmp/foodprint-intake-authorization.log`, `/tmp/foodprint-intake-lifecycle.log`. Không đưa token, credential hoặc log vào commit.

Không thực hiện kiểm chứng thủ công trên tài khoản/dữ liệu thành viên. Các hành trình list/detail/accept/retry được kiểm chứng qua HTTP tự động và giao dịch PostgreSQL thật. Chưa commit, push hoặc deploy. Không có prerequisite kiểm chứng còn thiếu trong phạm vi các task.
