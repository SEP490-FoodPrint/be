# Implementation Plan: Nhà cung cấp xem và phản hồi khiếu nại nguyên liệu

**Branch**: `feat/supplier-complaint-response` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: `specs/supplier-complaint-response/spec.md`

## Summary

Mở rộng module ingredient-quality-feedback hiện có để admin/staff của nhà cung cấp xem danh sách, chi tiết và gửi một phản hồi chính thức cho khiếu nại chất lượng nguyên liệu của chuyến giao do đơn vị mình cung cấp. Giữ UUID làm định danh và tham số đường dẫn, thêm complaintCode bắt buộc dạng FP-CP-00001 được lưu trên cùng khiếu nại từ lúc Ban Giám hiệu tạo đơn. Supplier chỉ đọc mã gốc, không sinh mã khi GET/phản hồi. Giữ dữ liệu/phạm vi danh sách SCHOOL/SYSTEM hiện có, thêm chi tiết cho SCHOOL theo FR-011. FR-015 yêu cầu thiết kế cột mới, sequence và migration backfill; không thêm bảng nghiệp vụ, permission hoặc HTTP tạo đơn phía trường.

Phân quyền dùng trusted scope và đủ quyền hiệu lực; phản hồi ghi trong transaction Serializable, khóa actor/role/target theo thứ tự chung, kiểm tra lại quyền và update có điều kiện SUBMITTED. Hai phản hồi cạnh tranh cho cùng khiếu nại hợp lệ kết thúc một200 và một409, không ghi đè. Thiết kế chi tiết và các quyết định nằm ở [research.md](research.md), [data-model.md](data-model.md), [API contract](contracts/ingredient-quality-feedback-api.md).

## Technical Context

**Language/Version**: TypeScript strict 6.0.3; Node.js24.22.1 theo .nvmrc; CommonJS với Node16 resolution.

**Primary Dependencies**: Express4.21.2, Prisma/adapter-pg7.10.1, Zod4.6.7, pg và session/rate-limit Redis hiện có; dùng phiên bản khóa trong package-lock.json, không nâng/thêm dependency.

**Storage**: PostgreSQL schema foodprint; bổ sung IngredientQualityFeedback.complaintCode varchar(25) NOT NULL UNIQUE và BIGINT sequence toàn hệ thống; giữ PK/FK UUID. Một migration mới backfill dữ liệu cũ, không thay CHECK phản hồi hiện có. Redis chỉ qua middleware/session hiện có; không cache nội dung hay quyền.

**Testing**: Node test runner + tsx; unit/HTTP bằng injected factories; thêm unit formatter/parser và migration tests cho mã/backfill/sequence; integration trên DB tạm thuộc instance PostgreSQL local được chọn và Redis phục vụ session. Không thêm framework hoặc runner.

**Target Platform**: Backend Linux, runtime như repository hiện tại.

**Project Type**: Web service; không xây giao diện.

**Performance Goals**: Truy vấn list có filter supplier trước phân trang, lấy tối đa limit+1 (limit≤100); detail chỉ đọc một khiếu nại và tối đa một lô. Không tải toàn bộ danh sách, N+1 theo từng item hay total count không cần thiết. Spec chưa đặt SLO độ trễ nên không tự thêm cam kết thời gian phản hồi.

**Constraints**: Supplier phải ADMIN/STAFF và có view_details; ghi đồng thời có respond. Giữ trách nhiệm lịch sử sau UNLINKED/SUSPENDED. Một câu trả lời, tối đa5.000 Unicode code points sau trim. complaintCode bất biến, dùng sequence toàn hệ thống với tối thiểu5chữ số, tăng chiều dài sau99999, cho phép gaps. Không có code default/SQL function/trigger hoặc allocator trong GET/response. Giai đoạn plan không thực thi DDL/ghi DB; migration/backfill khi triển khai phải được review và áp dụng theo authorization đúng target. Không seed, upload, side effect email hoặc sửa middleware toàn cục.

**Scale/Scope**: Ba thao tác nghiệp vụ P1, cùng mount có sẵn; GET list hiện có, GET detail mới, POST response mới. SCHOOL detail là phần tối thiểu FR-011; SYSTEM chỉ giữ list hiện có. Có15 FR và6 SC; SC-006 đợi nghiệm thu luồng sử dụng đầy đủ. Producer HTTP Ban Giám hiệu chưa có trong repo, là phụ thuộc tích hợp ngoài phạm vi API supplier.

## Constitution Check

Đánh giá trước Phase0 và đối chiếu lại sau Phase1:

| Nguyên tắc                       | Thiết kế đáp ứng                                                                                                                                | Trước nghiên cứu | Sau thiết kế |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------ |
| I. Phân lớp                      | Hoàn thiện7 file module; query chỉ trong repository, DTO chỉ services dùng, Zod là nguồn Request DTO                                            | PASS             | PASS         |
| II. Quyền/tổ chức                | Helper resource-access typed scope; quyền đọc và phản hồi AND; scoped WHERE; actor recheck trong transaction; giữ SCHOOL/SYSTEM list            | PASS             | PASS         |
| III. An toàn DB                  | Chỉ thiết kế migration mới cho complaintCode; không sửa lịch sử applied, không thực thi DDL/ghi DB trong plan; test disposable có authorization | PASS             | PASS         |
| IV. Transaction/cache/rate limit | Cùng tx cho locks/recheck/update/readback; wrapper retry dùng chung; không thêm cache; giữ limiter fail closed                                  | PASS             | PASS         |
| V. HTTP/safe projection          | sendSuccess/sendError hiện có, allowlist mapping, timestamp ISO UTC, lỗi tiếng Việt, không lộ user contact/credential                           | PASS             | PASS         |
| VI. Spec-driven                  | Đúng nhánh/spec, thiết kế và50tasks đã cập nhật15FR theo lựa chọn B trước khi viết source                                                       | PASS             | PASS         |

Không có vi phạm hoặc điểm chờ làm rõ. Các default của spec được giữ; không thêm luồng tạo đơn, hội thoại, sửa/xóa phản hồi.

## Project Structure

### Documentation (this feature)

```text
specs/supplier-complaint-response/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/ingredient-quality-feedback-api.md
├── contracts/complaint-code-producer.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md  # đã cập nhật50tasks cho FR-015 và lựa chọn B
```

### Source Code (repository root)

```text
src/modules/ingredient-quality-feedback/
├── ingredient-quality-feedback.routes.ts
├── ingredient-quality-feedback.controller.ts
├── ingredient-quality-feedback.validation.ts
├── ingredient-quality-feedback.request.dto.ts   # mới
├── ingredient-quality-feedback.response.dto.ts  # mới
├── ingredient-quality-feedback.service.ts
└── ingredient-quality-feedback.repository.ts    # mới

src/utils/resource-access.ts
src/utils/complaint-code.ts                       # mới: formatter/parser thuần
src/routes/index.ts
src/modules/README.md
docs/AUTHORIZATION.md
tests/ingredient-quality-feedback.test.ts          # mới; đăng ký test:unit
tests/complaint-code.test.ts                       # mới; đăng ký test:unit
tests/migrations.test.ts                          # backfill/sequence/constraints
tests/authorization.test.ts
tests/modules.test.ts                              # giữ regression chung
tests/authorization.integration.test.ts
tests/supplier-onboarding.integration.test.ts
package.json
prisma/schema.prisma                              # thêm complaintCode; giữ UUID
prisma/migrations/20261120000300_ingredient_feedback_complaint_code/migration.sql
database/SCHEMA_BASELINE.md                        # ghi migration mới/chưa deploy
```

**Structure Decision**: Hoàn thiện module đã có, chuyển toàn bộ query/select khỏi service vào repository, giữ mount trong src/routes/index.ts và bổ sung injection nếu cần. Không thêm module supplier-complaint trùng chức năng; không sửa generated output hoặc scaffolding.

## Phase 0 — Research

Đã hoàn tất [research.md](research.md): giữ các quyết định auth/transaction/Unicode cũ và bổ sung R10–R12 cho cột mã, sequence toàn hệ thống, backfill và producer dependency. Các research agents chỉ đọc source; không thao tác DB. Nghiên cứu mới xác nhận creator BGH chưa có và không tự cấp grants cho BGH. Không cần tra cứu ngoài repository cho thiết kế dựa trên mã nguồn hiện hành.

## Phase 1 — Design

### 0. ComplaintCode, producer contract và dữ liệu cũ

- Thêm field complaintCode String @unique(map: "ingredient_quality_feedback_complaint_code_key") @map("complaint_code") @db.VarChar(25), không nullable, không default. Giữ id UUID và mọi quan hệ FK. SQL migration bổ sung CHECK canonical-positive/range, giữ chk_ingredient_feedback_response hiện có.
- Một sequence foodprint.ingredient_quality_feedback_complaint_code_seq, AS BIGINT, MINVALUE1, MAXVALUE9223372036854775807, START1, CACHE1, NO CYCLE, OWNED BY cột complaint_code. Chỉ producer tạo đơn lấy nextval qua repository method nextComplaintCodeSequence(tx); service producer dùng formatter thuần formatComplaintCode(bigint) rồi INSERT mã cùng tx. Không có counter model/table hoặc SQL function/trigger.
- Mã chuẩn uppercase FP-CP- + số dương pad tối thiểu5chữ số; 1→FP-CP-00001, 99999→FP-CP-99999, 100000→FP-CP-100000. Dùng BigInt, tối đa19chữ số tương ứng BIGINT; parser kiểm tra canonical/range, không chuyển qua Number. Gaps do rollback/retry được chấp nhận; sequence cạn báo503, không reset/quay vòng hoặc dùng lại số.
- Supplier list, detail supplier/school và response chọn complaintCode đã lưu và map string bắt buộc. Thiếu/sai mã trong dữ liệu được kỳ vọng đã nâng cấp:503 an toàn. Không trả null, format từ UUID, cấp số mới, lazy backfill hoặc gọi allocator trong GET/response. Body POST phản hồi vẫn chỉ supplierResponse; gửi complaintCode bị400.
- Migration mới dự kiến theo cây source; kiểm tra lại thứ tự/collision trước khi tạo, không đổi tên migration đã áp dụng. Trong một transaction khóa feedback ACCESS EXCLUSIVE, thêm cột nullable, cấp một lần cho lịch sử theo created_at ASC/id ASC, chỉ đổi cột mã và self-assign updated_at để giữ timestamp cũ, rồi áp NOT NULL/unique/CHECK. Định dạng SQL backfill không cắt số dài; sequence mới được setval duy nhất ở migration để empty→next1, nonempty N→nextN+1. UUID/status/response/ownership và toàn bộ nội dung cũ giữ nguyên.
- [Hợp đồng producer](contracts/complaint-code-producer.md) là giao diện nội bộ dùng chung, không phải API HTTP mới. Code hiện chưa có BGH creator hoặc default grants BGH tương ứng. Feature chuẩn bị storage/allocator/formatter và kiểm chứng contract bằng fixtures; không tự tạo route, seed hoặc grant. Nghiệm thu BGH tạo đơn thật→supplier đọc cần owner phía trường tích hợp riêng trước khi ghi nhận đạt.
- Trước rollout, xác định mọi writer ngoài repo, ngừng ghi khiếu nại trong cửa sổ được duyệt, áp migration và deploy producer tương thích trước khi mở ghi lại; không chạy old writer với cột NOT NULL/no default. Chỉ kiểm chứng fixtures không phải bằng chứng creator production đã có. Chi tiết quyền migration, runtime sequence usage và rollback ở producer contract/quickstart.

### 1. Authorization và validation

- Thêm trusted read scope union: SUPPLIER với supplierId; SCHOOL với schoolId và submittedByUserId tùy quyền; SYSTEM chỉ với thao tác list. Helper nhận mục đích list/detail để chặn SYSTEM ở detail.
- Helper supplier xác nhận ROLES.INGREDIENT_SUPPLIER_ADMIN hoặc STAFF, ORG_TYPES.SUPPLIER, supplierId duy nhất và view_details; response helper kiểm tra riêng respond để bảo đảm AND. Không dùng assertPermission(p, view_details, respond) vì helper đó là OR.
- Giữ RESOURCE_PERMISSIONS của list cho legacy; nhánh SUPPLIER trong listScopes gọi helper supplier mới để view_own-only bị403. SCHOOL/SYSTEM giữ filter hiện tại; không System bypass quyền.
- Router authenticate + scope/permission guard trước validation; service tự xác lập lại scope để direct call vẫn an toàn. CSRF/rate limiter/session toàn cục giữ nguyên.
- Validation schemas: list page/limit; strict feedbackId UUID; empty query cho detail/response; response body duy nhất supplierResponse. parseRequest; Request DTO dùng z.infer với type-only schema import. Không nhận complaintCode/schoolId/supplierId/actor/status/time từ client; đưa mã FP-CP vào đường dẫn UUID là400, không lookup code.
- Độ dài text đếm Array.from(value.trim()).length; không dùng requiredText(5000) mặc định UTF-16. Không chuẩn hóa Unicode hoặc thay nội dung bên trong.

### 2. Repository và đọc dữ liệu

- Tạo các method operation-specific: listSupplier, listLegacy, findDetail, findLotInDelivery, findResponseMetadata, readActor, lockResponseContext, respondIfSubmitted. Input là trusted scope/internal types, không import DTO.
- listSupplier filter Delivery.supplierId, select id UUID và complaintCode cùng list allowlist, order createdAt DESC/id ASC, skip/take limit+1; school join chỉ lấy id/name/code, delivery id/deliveryNo. Không include người/lô cho list, không cấp mã và không sắp theo mã.
- listLegacy nhận SCHOOL hoặc SYSTEM scope; giữ fields và order id ASC hiện có. Service map từng field và Date tường minh, envelope/pagination không đổi. Không đưa supplierResponse vào list legacy.
- findDetail dùng id UUID + trusted scope, select complaintCode đã lưu; school view_own thêm submittedByUserId. Dùng withReadTransaction cho detail + lot để cùng snapshot. Không bọc not-found/lot business check bằng readListPage vốn catch-all. Kiểm tra mã canonical bằng parser thuần trước map, không lấy số từ sequence.
- Nếu ingredientLotId khác null, findLotInDelivery bắt buộc id + DeliveryItem.deliveryId của feedback + DeliveryItem.Delivery scope. Có id nhưng không có lô hợp lệ:503 an toàn, không map dữ liệu foreign.
- Không lọc tác giả/người phản hồi theo membership hiện tại, không trả email/phone/role/status của user. Giá trị SUBMITTED phản hồi/người/thời điểm null; RESPONDED phải có đầy đủ, nếu dữ liệu vi phạm bất biến thì503. Các identity bắt buộc không được bịa fallback.
- READ không thay timestamp hoặc business data. Không cache; không khóa write khi list/detail thông thường.

### 3. Gửi phản hồi và quyền tại điểm ghi

Service xác lập original supplier scope và kiểm tra đủ quyền trước khi vào authorizationTransaction. Mỗi attempt:

1. Repository đọc actor trực tiếp với tx.user.findUnique(identitySelect) rồi principalFromIdentity; scoped metadata complaint chứa id/deliveryId/schoolId để lấy lock IDs. Không gọi loadPrincipal trong callback, không sanitize retryable errors trong repository.
2. Khóa school → supplier → actor user → actor role theo lockParents hiện có; role FOR SHARE, user FOR UPDATE. Khóa FOR SHARE hai permission rows theo ID tăng dần, sau role và trước delivery; không khóa permissions của toàn catalog.
3. Khóa delivery theo id+trusted supplierId; khóa complaint qua join delivery supplierId. Không dùng intakeAccess assertAccess hoặc current relationship/contract guard.
4. Đọc lại actor và scoped target cùng tx. Actor phải ACTIVE, đúng roleId/role/org/supplierId ban đầu và có đủ hai quyền. Metadata delivery/school dùng khóa phải vẫn khớp; nếu cấu trúc giao dịch thay đổi trong lúc thao tác thì từ chối an toàn503 để đọc lại, không áp dụng scope cũ.
5. Scoped target không có:404. Đã RESPONDED:409. SUBMITTED: repository updateMany theo id+Delivery.supplierId+SUBMITTED, đặt cả supplierResponse/respondedByUserId/respondedAt/status; Prisma cập nhật updatedAt. Count0 sau target lookup là409. Không đưa complaintCode vào data update và không gọi nextComplaintCodeSequence ở bất kỳ attempt nào.
6. Đọc lại detail và lô đã scoped trong cùng tx; mapper tạo DTO. Kết quả HTTP200 chỉ sau wrapper commit; lỗi readback làm rollback ghi.
7. Retry tối đa3 attempts theo wrapper hiện có, gồm actor-query conflicts và direct COMMIT adapter error. Không phát mail/notification hoặc side effect ngoài DB trong callback. Hết retry lỗi hạ tầng503, không expose SQL.

Thứ tự khóa xác lập điểm chấp nhận quyền. Nếu thu hồi quyền/khóa user/thay role hoàn tất trước thì snapshot cũ phải retry và bị403; nếu phản hồi đã được chấp nhận trước thì thao tác quản trị chờ và có hiệu lực với thao tác kế tiếp. Không hứa đảo ngược phản hồi đã commit. Test barrier phải kiểm chứng cả thứ tự thay vì dựa vào thời gian sleep.

### 4. HTTP và compatibility

Hợp đồng đầy đủ ở [contracts/ingredient-quality-feedback-api.md](contracts/ingredient-quality-feedback-api.md), gồm complaintCode string bắt buộc bên cạnh id UUID và UUID paths không đổi. Thành công200; lỗi400/401/403/404/409/429/503 theo shared envelope. Detail/readback mới và supplier list dùng Cache-Control private, no-store. Không sửa global response helpers, auth hoặc rate limiter; thay schema chỉ giới hạn cột mã và migration đã thiết kế.

Phần SCHOOL detail mới chỉ đọc bản ghi có cùng trường và quyền hiện có, phục vụ FR-011. SCHOOL không được POST response; SYSTEM không được mở detail/response dù có permission code. Không thay nghiệp vụ meal complaints.

### 5. Phân rã triển khai và kiểm chứng

1. Foundation: schema/migration/backfill/sequence và formatter/parser, shared producer allocation contract, migration tests; sau đó scoped helpers, schemas/DTO, repository extraction, fixtures/injection và legacy list regression.
2. US1: supplier list có id+complaintCode và metadata trường/chuyến, pagination/stable order, guards, safe mapping và chứng minh GET không cấp số.
3. US2: scoped detail + lot guard + school readback để FR-011 không bị bỏ sót.
4. US3: transaction/locks/recheck/conditional update, response controller, conflict/retry/rollback.
5. Integration: auth thật, denial/status/role races, school visibility, mã chung bất biến, allocator concurrency/rollback gaps, dữ liệu lịch sử, invariants và endpoint matrix. Creator HTTP BGH được ghi riêng trạng thái chưa tích hợp, không tuyên bố fixture là endpoint thật.
6. Quality: npm run validate, npm run test:unit, authorized npm run test:local:migrations và npm run test:local:authorization; ghi bằng chứng theo quickstart. Kiểm tra spec gate với đúng feature diff; không báo pass nếu HEAD chưa có thay đổi để gate kiểm tra.

[tasks.md](tasks.md) đã cập nhật50tasks, gồm16task [P] trong6wave độc lập về file; bao phủ schema/migration/allocator/backfill/complaintCode và15FR. Tất cả còn chưa thực hiện; chỉ các tài liệu được cập nhật, chưa viết source, tạo migration thật hoặc ghi DB.

## Validation Coverage

| Yêu cầu       | Kiểm chứng dự kiến                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001/002    | Unit scope cho admin/staff, AND quyền, view_own-only403; login thật, quyền inactive/denied/revoked, session cũ                                                                                                    |
| FR-003/004    | Hai suppliers cùng một trường, nhiều trường, foreign404; SUSPENDED/UNLINKED, trường inactive, hợp đồng hết hạn vẫn xử lý lịch sử                                                                                  |
| FR-005/006    | Nhiều trang/timestamp bằng nhau, null/trùng code trường, empty/last/beyond page, đúng list allowlist                                                                                                              |
| FR-007        | Detail nội dung đầy đủ, lot null/đúng/khác delivery, tác giả chuyển org, timestamps/null và user projection                                                                                                       |
| FR-008/009    | Text trim/Unicode/1/5.000/5.001, nested/unknown fields400, actor recheck và atomic tuple/readback rollback                                                                                                        |
| FR-010        | Hai responders admin/staff, một200 một409, repeated POST409, không ghi đè, actor-query/COMMIT retry                                                                                                               |
| FR-011        | POST thành công rồi SCHOOL GET detail (own/detail permissions đúng phạm vi) đọc cùng response, cùng complaintId                                                                                                   |
| FR-012/013    | 400/401/403/404/409/429/503, safe errors không lộ foreign IDs/raw SQL/input, exact allowlist                                                                                                                      |
| FR-014        | Snapshot dữ liệu/timestamps ngoài complaint không đổi; legacy SCHOOL/SYSTEM list và meal-complaint regressions                                                                                                    |
| FR-015        | Migration deterministic/unique/NOT NULL/CHECK/sequence continuation, producer contract concurrency, UUID paths giữ nguyên, mã gốc đồng nhất list/detail/response và SCHOOL; GET/response không cấp số hoặc sửa mã |
| SC-001–SC-005 | Tổng hợp unit/HTTP + integration, chỉ ghi đạt sau kết quả thực tế                                                                                                                                                 |
| SC-006        | Nghiệm thu với giao diện đầy đủ; chưa đo, không thay bằng test backend                                                                                                                                            |

## Complexity Tracking

Không có vi phạm Constitution Check cần ngoại lệ. FR-015 cần một cột, unique/CHECK và một sequence trong migration mới; không thêm framework, counter table, cache hoặc service hạ tầng. Các khóa dùng chung phạm vi school/supplier có thể làm các ghi cùng đơn vị chờ nhau; không cam kết thông lượng mới. Các lần cấp số thuộc producer creation, không thêm contention/side effect sequence vào supplier read/response.

## Post-design Gate

PASS thiết kế cả nguyên tắc I–VI; storage/format/backfill/producer contract và tasks đã cập nhật. Source, migration thật, kiểm thử nghiệp vụ và DB chưa thay đổi. Producer HTTP BGH là phụ thuộc bàn giao chưa có bằng chứng tích hợp. Bước tiếp theo là speckit-analyze đối chiếu bộ tài liệu trước implement theo tasks mới.
