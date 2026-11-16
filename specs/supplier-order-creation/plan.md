# Implementation Plan: Tạo đơn nhiều nguồn, chuẩn bị và giao hàng

**Branch**: `feat/supplier-order-creation-stages` | **Date**: 2026-11-15 | **Spec**: [spec.md](spec.md)

**Input**:35 FR/14 SC hiện hành, đã chốt cả hai mode được nhiều dòng cùng thực phẩm khác nguồn, REQUEST giữ đúng tổng mỗi dòng yêu cầu; STANDALONE không có Đã xác nhận; bổ sung tìm trường linked trong scope supplier.

**Status**: Phase0 nghiên cứu và Phase1 thiết kế đã cập nhật theo clarification. Chưa triển khai.57 task T100–T156 đã cập nhật theo thiết kế mới, giữ ID/checkbox pending; hai file history bất biến. Setup resolver chọn đúng thư mục, BRANCH trả slug supplier-order-creation; Git branch thực được kiểm riêng như trên.

## Summary

REQUEST: tiếp nhận yêu cầu → projection Đã xác nhận → lưu đầy đủ nguyên liệu/phân bổ nguồn thành PREPARING → lưu thời gian/biển số xe bằng dispatch thành IN_TRANSIT. STANDALONE: tìm/chọn trường linked → nhập nguyên liệu → lần lưu hợp lệ đầu tiên tạo PREPARING → dispatch IN_TRANSIT; không CONFIRMED/Đã xác nhận, không trường xác nhận trước lập đơn hoặc draft rỗng.

Mỗi nguồn của cùng nguyên liệu là một DeliveryItem UUID, lượng, QR và PLAN-01 riêng; cấm lặp cặp ingredient+facility trong một Delivery. REQUEST cho nhiều allocation cùng source item, nhưng tổng Decimal từng source item phải đúng lượng nguồn. Sửa receipt để kiểm tổng cả nhóm và previous RECEIVED, không kiểm budget từng sibling riêng gây vượt lượng.

Thêm PREPARING và nullable workflowVersion2, giữ traceabilityVersion1; hai migration mới tách enum commit khỏi marker/CHECK và thay child uniqueness. Mở rộng GET options/schools với search riêng theo tên/mã, giữ scope/eligibility/paging. Không thêm bảng allocation, package, timestamp dispatch, cache hoặc công cụ tìm kiếm ngoài hệ thống.

## Technical Context

**Language/Version**: Node24.22.1 theo `.nvmrc`, TypeScript6.0.3 strict, CommonJS/Node16 resolution, Prisma7.10.1 client cjs theo repository. Phiên bản là cấu hình đã đọc, không phải kết quả runtime check lần này.

**Primary Dependencies**: Express4.21.x, Zod4.6.7, Prisma/adapter-pg7.10.1, pg, node:crypto/qrcode hiện có. Reuse response/validation/authorization và Decimal; không thêm package/framework/Prisma8 API hoặc search extension.

**Storage**: PostgreSQL foodprint. Delivery thêm workflowVersion nullable, enum PREPARING; item bỏ hai unique toàn bộ, thay ba partial unique cho nguồn nonnull/null theo model. Giữ UUID/FK/nonunique indexes/source/QR metadata; header partial unique/idempotency và receipt-only unique không đổi. Không backfill, seed, trigger/function hoặc table mới. Redis chỉ giữ runtime rate limiter fail-closed, không cache auth/search/ghi.

**Testing**: Node test runner/tsx, existing unit/HTTP, migration/authorization/lifecycle/supplier-orders integration. Test trọng tâm split totals, partial predicates/null semantics, compound replay, aggregate receipt, search ownership/wildcard và absence CONFIRMED standalone. Chỉ chạy tests ghi trong disposable local instance đã chọn/ủy quyền sau implement, không chạy DB ở bước plan.

**Target Platform**: Backend Linux/Node, API cho client hiện có; mô tả bước/nextAction cho client nhưng không sửa repository frontend hoặc triển khai màn hình mới.

**Project Type**: Modular Express web service; mở rộng supply-order/supplier-order/account-lifecycle/delivery/delivery-trace.

**Performance Goals**: Paging1/20/max100, limit+1, id asc cho school search và order hiện có cho list. Search trim max100, không unaccent/full-text/trigram/index mới; AND scope trước OR name/code. STANDALONE max100allocation rows, REQUEST đủ tập source nhưng không tự áp trần100; body limit HTTP hiện có. Batch sources/facilities/previous receipt/entries, không N+1 theo allocation. Render QR tối đa4 trước tx, dispatch không render/mạng; giữ SC-00620create mỗi supplier. Không đặt SLA mới chưa được yêu cầu.

**Constraints**: ReadCommitted/maxWait20s/timeout30s, tối đa2retry lỗi khóa như source hiện tại. Shared parent locks → source nếu có → Delivery → lots khi nhận, same tx cho recheck/query/write. Decimal cho tổng, không Number; normalized tuple sort cho fingerprint/candidate mapping. Mọi query/where/select/lock ở repository, services chỉ policy/orchestration/DTO mapping. Dừng writer cũ trước rollout payload workflow2; không dùng v1/legacy replay để nâng cấp. Không tạo SQL hoặc thao tác DB từ plan.

**Scale/Scope**: Hai supplier roles, hai mode, một endpoint dispatch mới và school options endpoint mở rộng search. REQUEST có CONFIRMED projection, standalone không.35 FR/14 SC; thay uniquess/schema/validation/fingerprint/receipt aggregate cùng safe projection/search và hồi quy arrival/QR/cancellation. Không thêm split Delivery, draft persistence, chỉnh nội dung sau chuẩn bị, định danh bao bì hoặc payment.

## Constitution Check

Gate đối chiếu trước Phase0 và kiểm lại sau Phase1; PASS là thiết kế đáp ứng nguyên tắc, không là test phần mềm đã chạy.

| Nguyên tắc                  | Trước | Sau  | Thiết kế đáp ứng                                                                                                                                                                                                                                  |
| --------------------------- | ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I — Phân lớp                | PASS  | PASS | Module giữ7file; strict Zod/safeParse là nguồn z.infer Request DTO, chỉ service dùng DTO. Controller chỉ parse/gọi/send; repository nhận command nội bộ, giữ query/locks/Decimal persistence; service policy/tổng/transaction/map allowlist.      |
| II — Quyền/scope            | PASS  | PASS | Supplier từ live principal, search/target cùng trusted scope, AND eligibility OR term không mở scope. Manage khác view/accept; auth recheck cùng tx kể cả replay, không SYSTEM bypass/cache. QR public giữ ngoại lệ allowlist đã duyệt.           |
| III — DB an toàn            | PASS  | PASS | Hai migration mới, enum commit trước dùng; partial predicates và source-null cardinality rõ, không sửa SQL đã có/backfill. Preserve records, UUID/FK/QR/history. Chỉ disposable được chọn/ủy quyền mới chạy test ghi, không tự Azure deploy/seed. |
| IV — Transaction/rate/cache | PASS  | PASS | Create allocations/source progression và dispatch atomic; receipt nhóm current+previous dưới source lock, final decision/kho cùng tx, exactly-once lot. Giữ limiter Redis503/fail-closed, không thêm cache/flush/wildcard delete.                 |
| V — HTTP/DTO                | PASS  | PASS | Shared envelopes,400 nested paths tiếng Việt, quantity chuỗi/UTC/null explicit. Accept receipt4fields và raw status giữ nguyên; search chỉ id/code/name. Public không IDs/marker/action/xe/ETA; cờ created chỉ nội bộ service.                    |
| VI — Spec-driven            | PASS  | PASS | Dùng đúng nhánh/thư mục35FR/14SC, thay toàn bộ quyết định cũ mâu thuẫn. Tasks pending đã đồng bộ35FR/14SC, history bất biến; không sửa scaffold hoặc commit feature.json/generated output.                                                        |

Không có vi phạm cần miễn trừ. Những lựa chọn nhỏ về search bound/literal filtering và partial indexes là quyết định kỹ thuật để thực hiện yêu cầu đã xác nhận, không thêm nghiệp vụ hay tổ chức có quyền mới.

## Project Structure

### Documentation (this feature)

```text
specs/supplier-order-creation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
├── contracts/
│   ├── supplier-orders.md
│   └── public-trace.md
├── tasks.md                 # T100–T156 pending, đã đồng bộ theo plan mới
├── tasks-traceability.md    # nguyên văn lịch sử T041–T099
└── tasks-baseline.md        # lịch sử T001–T040
```

### Source Code (repository root)

```text
prisma/schema.prisma
prisma/migrations/20261118000200_delivery_preparing_status/migration.sql  # dự kiến mới
prisma/migrations/20261118000300_supplier_order_stages/migration.sql     # dự kiến mới
src/modules/supply-order/          # supplier progress, accept receipt giữ nguyên
src/modules/supplier-order/        # allocations/create/search/dispatch/list/labels
src/modules/account-lifecycle/     # Delivery continuation/parent locks
src/modules/delivery/              # source batch/budget aggregate/receipt/cancellation
src/modules/delivery-trace/        # lookup từng QR, không collapse item
src/utils/delivery-status.ts
src/utils/resource-access.ts
src/routes/index.ts
src/modules/README.md
docs/AUTHORIZATION.md
database/SCHEMA_BASELINE.md
tests/supplier-order-creation.test.ts
tests/supplier-order-creation.integration.test.ts
tests/supply-order-intake.test.ts
tests/intake-access.test.ts
tests/delivery-inspections.test.ts
tests/delivery-status.test.ts
tests/delivery-trace.test.ts
tests/migrations.test.ts
tests/authorization.integration.test.ts
tests/account-lifecycle.integration.test.ts
tests/modules.test.ts
tests/kitchen-nutrition-lists.test.ts
```

**Structure Decision**: Không thêm module thương mại hoặc allocation table. Source item relation vốn là list, item UUID/lot/QR giữ được từng nguồn. Các layer mới dùng đúng file module hiện hữu; search có schema/DTO riêng trong validation/request.dto thay vì sửa query schema dùng chung cho mọi options/labels.

## Phase0 — Nghiên cứu hoàn tất

[research.md](research.md) chốt9 nhóm quyết định: luồng từng mode, marker/version, migration, replay, guard/locks, projection, receipt policy, allocations/partial unique/aggregate budget, linked-school search. Hai research agents chỉ đọc source và đối chiếu mô hình/receipt/downstream cùng search/contract. Phát hiện Map một nguồn và kiểm budget từng dòng đang không đủ khi split; đã có thiết kế thay thế. Tài liệu PostgreSQL/Prisma v7 chính thức dẫn tại research; không suy API8 từ docs hiện hành hoặc truy cập DB để đoán schema.

## Phase1 — Model và contracts

- [data-model.md](data-model.md): fields/CHECK, ba partial indexes thay hai unique, phân bổ exact totals, batch source read, receipt aggregate, canonical/replay, transaction và hai state flows.
- [contracts/supplier-orders.md](contracts/supplier-orders.md): REQUEST sources có actualQuantity, STANDALONE repeated ingredient khác source, status/nextAction, search query riêng, dispatch immutable, safe errors và client compatibility.
- [contracts/public-trace.md](contracts/public-trace.md): hai dòng cùng thực phẩm có QR/nguồn/lượng riêng; public allowlist giữ nguyên, PREPARING không cần dispatch mới quét.
- [quickstart.md](quickstart.md): lệnh/scenario kiểm chứng sau implement, source6+4=10, duplicate-pair, search literal/scope, receipt aggregate/race và history preservation. Evidence cũ giữ nguyên riêng, không dùng làm pass mới.

### Quyết định tích hợp bắt buộc

1. **Luồng**: CONFIRMED chỉ projection của request ACCEPTED/IN_PROGRESS chưa delivery; STANDALONE chọn trường/thêm nguyên liệu không có trạng thái trước lưu. Cả hai lần lưu nguyên liệu tạo PREPARING/workflow2/traceability1/metadata null; dispatch mới IN_TRANSIT. Không tạo request giả hoặc sửa accept receipt4trường.
2. **Schema**: giữ DeliveryItem UUID, bỏ full uniques delivery+ingredient và delivery+requestItem; thêm pair unique nguồn nonnull và hai legacy uniques nguồn null. Giữ mọi quan hệ list/nonunique/FK/QR/receipt predicates; dùng map/where partialIndexes theo model, không dùng partial composite key thay PK. Hai migration dự kiến chưa được viết/applied; kiểm history khi implement, nếu tên đã có thì tạo phiên bản mới chứ không sửa applied SQL.
3. **Allocations**: validator REQUEST sources nhận actualQuantity chuẩn hóa, cho repeated source item nhưng không repeated pair; service resolve ingredient từ source và kiểm pair ingredient+facility trên toàn đơn, đủ group và exact Decimal total. Bỏ Map sourceItem→single facility. Mỗi allocation một item/QR/PLAN-01, không collapse response theo ingredient/source item; standalone giới hạn100rows và vẫn không cần source request.
4. **Receipt**: repository batch đủ source items/identity và previous RECEIVED trong cùng tx; service group current theo source item. Workflow2 recheck exact coverage/total/identity; mọi source delivery kiểm previous+currentGroup<=requested. Không áp exact equality/full coverage hồi tố legacy, không recheck facility ACTIVE. Khóa source→Delivery→lots/reload trước final approval; lỗi rollback quyết định cuối và toàn bộ kho.
5. **Fingerprint**: canonical v3 REQUEST sort sourceItem+facility và quantity; standalone sort ingredient+facility và quantity/unit. Canonical row order dùng từ trước QR candidates/persist; same-key reorder200, đổi split/nguồn dù tổng bằng nhau409. Các marker null/hash v2 cũ không nâng cấp. Replay live auth/scope trước render/origin/cấp số, không sửa timestamp/status khi trả record đã commit.
6. **Search**: mở rộng GET options/schools bằng search trim<=100, default blank và partial name/code insensitive/literal; tách school-specific schema/DTO/controller parse, chỉ service dùng DTO. Repo plain command/trusted supplierId và paging/search, giữ AND eligibility với OR name/code, escape LIKE chars. Không nới schema query của ingredient/source/labels, không thêm supplierId override/route search thứ hai hoặc full-text/index mới.
7. **Dispatch**: guard continuation cho Delivery giữ parent→source→Delivery, live role/membership/quyền ở mọi lần; first policy source chưa terminal/admin không DEACTIVATED, không cung ứng-mới flags. Cặp metadata immutable chứng minh replay, CAS PREPARING/cả-null/marker2 đúng UUID+supplier. Không QR/lot/kho write ở dispatch, không key/timestamp thêm.
8. **Consumer/rights**: supply-order progress source-only, manager list/detail/filter/nextAction map đúng mode, null legacy. Labels theo read OR trong matrix (source hiện manage-only cần đồng bộ); options/create/dispatch vẫn manage. Public8fields giữ riêng từng dòng. cancelRemainder thêm PREPARING; source cap3 giữ runtime/spec, chỉnh câu docs loại v1 đang lệch. Audit warehouse/kitchen/menu theo lot UUID/entry, không gộp mất source/QR hoặc viết lại nghiệp vụ không liên quan.
9. **Rollout**: schema/partial constraints trước app/client; dừng writer cũ direct transit, REQUEST mới bắt buộc lượng từng allocation. Preserve QR host/history/metadata; không tự seed/deploy/reset, không rollback bằng xóa/gộp dòng hoặc restore unique cũ khi data đa nguồn đã có.

## Thứ tự triển khai để cập nhật tasks

1. Foundation schema/two migrations/partial-index preservation tests, generate client local sau schema; source guards/status và signatures query/DTO dùng chung.
2. REQUEST allocation validation/canonical/repository/service/create DTO + intake source progress; STANDALONE cùng ingredient khác source và bỏ mọi synthetic CONFIRMED.
3. School-only search validator/DTO/controller/service/repo và tests eligible scope/paging/wildcard; recheck POST khi lựa chọn cũ không còn hợp lệ.
4. Dispatch separate và replay/rollback/live auth/CAS; labels/public/source snapshots; không nhận shipping tại create.
5. Receipt grouped budget/source-coverage queries, cancellation và downstream lot projections; legacy receipt không bị equality hồi tố.
6. New tests/migration/concurrency/auth/lifecycle/QR walkthrough, update docs/CI harness nếu thực sự thiếu; record kết quả thật. Checklist T100–T156 đã cập nhật theo thiết kế này; triển khai code theo tasks hiện hành và ghi kết quả thực, không dùng nội dung task trước clarification.

Đây là thứ tự kỹ thuật để bước tasks phân theo các user story hiện hành (P1 US1/US2/US4/US5/US6, P2 US3). File dùng chung có một owner tại mỗi thời điểm; research agents lần này không sửa artifact/runtime hoặc phân công implementation.

## Verification and Requirement Coverage

| Requirements / outcomes                                  | Thiết kế và kiểm chứng sau implement                                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001–FR-004/FR-010–FR-013; SC-001/SC-004/SC-005        | Actor live/role/denial/scope, source quota/linked school/intake continuation; hai mode không nguồn giả, key scope supplier+actor; POST recheck sau search.                                                                                     |
| FR-005/FR-007/FR-009/FR-014/FR-032; SC-002/SC-003/SC-013 | REQUEST10kg→6A+4B đủ groups/exact sums,9/11/6+6 hoặc missing/extra source/ingredient-unit mismatch fail; A+A bị chặn, ingredient khác cùngA được phép; atomic N item/QR/lot/source update, quantity Decimal.                                   |
| FR-006/FR-023/FR-025/FR-026/FR-028; SC-008/SC-012        | CONFIRMED chỉ REQUEST, standalone chọn trường→nhập→PREPARING, không trạng thái/draft trước lưu; shipping strict step, failed write không nhảy/lùi.                                                                                             |
| FR-008/FR-030/FR-033; SC-011/SC-012                      | Reopen đúng bước; response mỗi allocation UUID/quantity/source/QR riêng, nullable legacy, quyền đọc/nextAction, stable paging và không collapse theo ingredient.                                                                               |
| FR-015–FR-018; SC-006/SC-007                             | 20creates/supplier, code boundary/idempotency; same ingredient2sources→2 QR đúng lượng, reprint unchanged, source rename/deactivate, public allowlist/headers/labels OR safe.                                                                  |
| FR-019–FR-022/FR-024/FR-031; SC-009/SC-010               | No arrival/inspect PREPARING; đủ4+aggregate source budget/coverage/identity mới receipt, previous+siblings không vượt; race exactly-once lots, REJECT/cap3 hủy preparing, legacy partial/multi-lot/null-source giữ hợp lệ.                     |
| FR-027/FR-029; SC-003/SC-004/SC-008                      | Dispatch ETA/plate UTC/trim, no skip, first/terminal replay samebody200/different409, hủy-before409, denial403, source/arrival/cancel races and one-tx rollback.                                                                               |
| FR-034/FR-035; SC-014                                    | Search name/code partial/insensitive,code null,blank/no match/paging,literal wildcard,max100/repeated/unknown query400; AND eligible trusted supplier, foreign/paused filtered, role deny, other options reject search.                        |
| DB/history/quality                                       | Fresh deploy+upgrade via enum commit, null CHECK combinations, pair duplicate blocked/other source allowed/two legacy partials retained, old IDs/code/QR/decisions/lots/stock unchanged; layering/types/build/unit and real DB harness checks. |

Quality sau implement: prisma validate/generate, npm run validate, npm run test:unit; focused suites để khoanh vùng meaningful failures. DB groups local migrations/authorization/lifecycle/supplier-orders bằng harness và instance hiện có được chọn/ủy quyền cho tác vụ, không tạo container mới hoặc dùng Azure/member DB. New unit files nếu có phải đăng ký test:unit, không thêm framework hoặc viết test sao chép implementation. DB/Redis connection checks thêm khi đổi kết nối và có hạ tầng; thiết kế này không đổi kết nối.

## Complexity Tracking

Không có vi phạm Constitution cần miễn trừ. Một enum/cột kỹ thuật và ba partial indexes thay hai full uniques cần cho workflow/đa nguồn và legacy cardinality; không business entity hoặc child-version mới. Hai migration là ranh giới enum commit. Search reuse route/stack và không thêm engine/index extension.

## Kết quả và giới hạn

Đã cập nhật Phase0/Phase1 artifacts theo35 FR/14 SC và đánh giá gate trước/sau thiết kế. Không có extension config/hook trước hoặc sau plan. Chỉ kiểm tài liệu, không sửa src/prisma, viết/applied migration SQL, sinh client, chạy phần mềm/test DB/seed/deploy. Bằng chứng cũ ở quickstart và hai history task files giữ nguyên.

**Bước tiếp**:57 task T100–T156 trong [tasks.md](tasks.md) đã đồng bộ theo plan, giữ ID/checkbox/history; có thể dùng `$speckit-analyze` để kiểm tra chéo hoặc `$speckit-implement` để triển khai theo phạm vi được cấp. Tasks có kiểm chứng search, multi-source/compound replay/aggregate receipt và standalone không CONFIRMED; chưa task nào được thực hiện.
