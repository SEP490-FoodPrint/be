# Implementation Plan: Tạo đơn giao hàng có nguồn cung và QR

**Branch**: `feat/supplier-order-creation-traceability` | **Date**: 2026-11-15 | **Spec**: [spec.md](spec.md)

**Input**: `specs/supplier-order-creation/spec.md`, bản sửa đổi đã xác nhận Q1=B, Q2=B, Q3=A.

**Status**: Phase0/Phase1 thiết kế hoàn tất; chưa triển khai bản sửa đổi. tasks.md đã sinh58 task amendment T041–T098, đều pending; lịch sử T001–T040 được giữ nguyên ở tasks-baseline.md, không tính là tiến độ mới.

## Summary

Mở rộng luồng Delivery hiện có, không tạo bảng đơn thương mại hoặc nguồn giả. Cả REQUEST/STANDALONE bắt buộc nguồn từng dòng, biển số xe/thời gian giao; tạo thành công ở IN_TRANSIT. Mã FP-DE tăng riêng supplier bằng khóa supplier và MAX canonical, chuyển global unique mã sang composite unique supplier+code. Giữ UUID làm khóa nội bộ, partial unique nguồn/idempotency và toàn bộ lịch sử.

Mỗi dòng mới có snapshot nguồn/tên nguyên liệu, token và URL QR ổn định, một lô dự kiến BLOCKED chưa tăng kho. Protected label endpoint trả PNG/text; public point lookup riêng trả HTML/JSON allowlist theo Q2. Trường xác nhận ARRIVED bằng bốn role kiểm nhận; receipt hiện hữu chỉ hoàn thành RECEIVED sau đủ4 đạt, source/lot/quantity/history hợp lệ. REJECTED hiển thị yêu cầu giao lại; standalone mới độc lập, cap3 nguồn giữ nguyên.

## Technical Context

**Language/Version**: Node24.22.1 (.nvmrc), TypeScript6.0.3 strict/CommonJS, Node16 resolution, Prisma client cjs.

**Primary Dependencies**: Express4.21.2, Zod4.6.7, Prisma7.10.1/pg adapter hiện có, node:crypto. Thêm `qrcode`1.5.4 cùng TypeScript definitions khi implement; dùng PNG renderer nội bộ. Không framework mới, không Cloudinary cho QR, không dịch vụ QR bên ngoài. Tài liệu upstream được kiểm tra tại [research R4](research.md#r4-qr-dòng-nhãn-và-truy-xuất-công-khai); chưa cài package hoặc đo runtime ở bước plan.

**Storage**: PostgreSQL schema foodprint; thêm nullable version/snapshot/source/token/URL và composite unique. Không bảng counter, trigger/function hoặc backfill giả. Lô và inventory dùng model hiện có. Redis giữ auth/rate-limit, không dùng cấp số/idempotency/QR storage.

**Testing**: Node test runner/tsx hiện có; unit/HTTP và PostgreSQL disposable tests cho migration/tenant/concurrency/receipt. Camera/QR reader độc lập để kiểm tra scan nhãn. Các test mới phải đăng ký test:unit nếu infrastructure-free. Không chạy test/DDL ở bước lập plan.

**Target Platform**: Backend Linux/Node; public HTML tối thiểu do backend trả, không xây thêm frontend app hoặc giao diện quản trị. In nhãn cung cấp PNG/text, chưa tích hợp printer/PDF.

**Project Type**: Modular Express web service.

**Performance Goals**: List/options/labels page1/limit20, max100, limit+1; query batch source/ingredients/facilities, không N+1. Standalone max100 items; REQUEST exact set nguồn, không tự áp trần100 cho dữ liệu nguồn cũ. Render QR concurrency tối đa4, URL ngắn và PNG384px; không render ảnh trong mọi list/detail. Đo create nhiều dòng trong timeout thực tế trước release; không tự đổi SLA hoặc bỏ atomicity nếu chậm.

**Constraints**: PUBLIC_TRACE_ORIGIN tuyệt đối/HTTPS production; token opaque không từ deliveryNo; public allowlist và log redaction. Cùng transaction cho reload quyền, locks, source validation, cấp mã, header/items/lots/request update. Render candidates trước transaction, không side effects mạng trong callback retry. Quy tắc nguồn mới không hồi tố phá lịch sử. Không tự xóa/seed/reset/deploy từ việc tạo plan.

**Scale/Scope**: Hai role supplier tạo đơn, bốn role trường arrival/inspection; bảy management endpoints gồm baseline và source option/labels bổ sung, một arrival, một public lookup HTML/JSON. Hai cách tạo, QR theo dòng (không theo từng gói), một lô dự kiến/dòng mới, giữ nhiều lô legacy và ba lần từ chối theo yêu cầu gốc.

## Constitution Check

Đánh giá trước Phase0 và sau Phase1; không có vi phạm cần miễn trừ.

| Nguyên tắc                   | Trước | Sau  | Thiết kế đáp ứng                                                                                                                                                                                                          |
| ---------------------------- | ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I — Phân lớp                 | PASS  | PASS | supplier-order/delivery/delivery-trace đủ routes/controller/validation/service/repository/request.dto/response.dto; DTO chỉ service dùng; HTML helper không query, controllers không import DTO.                          |
| II — Quyền/scope             | PASS  | PASS | Reload principal và quyền mỗi thao tác; mọi protected list dùng scope rõ, query supplier/school trong repository. Public chỉ point lookup allowlist được spec Q2 cho phép; không mở list/inspection hoặc bypass hệ thống. |
| III — DB an toàn             | PASS  | PASS | Migration mới, giữ applied SQL/predicates; nullable marker giữ legacy, không đoán snapshot/nguồn, không kết nối DB trong plan; thử DDL chỉ trên disposable đã chọn và có ủy quyền.                                        |
| IV — Transaction/cache/limit | PASS  | PASS | Reuse Serializable/retry và parent locks; exactly-once receipt. QR không side effect ngoài DB; public thuộc API Redis limiter fail-closed, no-store, không thêm cache.                                                    |
| V — HTTP/safe DTO            | PASS  | PASS | Zod strict/safeParse + lỗi paths tiếng Việt; JSON envelopes cũ, Decimal/Date serialize; public allowlist riêng, ngoại lệ biểu diễn HTML ghi rõ contract.                                                                  |
| VI — Theo spec               | PASS  | PASS | Dùng lại spec trên nhánh tiếp nối; 24 FR và quyết định Q1/B,Q2/B,Q3/A làm nguồn; thiết kế cũ được thay đồng bộ, task baseline không coi là bằng chứng cho bản sửa đổi.                                                    |

Public anonymous access là nội dung đã được user xác nhận, không là ngoại lệ tùy ý khỏi auth của các resource protected. Có thể chọn cơ sở chưa có facilityCode, giữ null thật và tên, không tự tạo mã.

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
├── tasks-baseline.md  # giữ nguyên lịch sử T001–T040
└── tasks.md           # T041–T098 amendment, pending
```

### Source Code (repository root, mục tiêu khi implement)

```text
prisma/schema.prisma
prisma/migrations/<new-reviewed-migration>/migration.sql
src/config/env.ts
src/server.ts
src/routes/index.ts
src/utils/{resource-access,delivery-code,qr-code,public-trace-html}.ts
src/modules/supplier-order/supplier-order.{routes,controller,validation,service,repository,request.dto,response.dto}.ts
src/modules/delivery/delivery.{routes,controller,validation,service,repository,request.dto,response.dto}.ts
src/modules/delivery-trace/delivery-trace.{routes,controller,validation,service,repository,request.dto,response.dto}.ts
src/modules/account-lifecycle/intake-access.{service,repository}.ts
src/modules/{warehouse,kitchen,menu}/  # audit projections/nullable legacy, chỉ sửa nơi bị ảnh hưởng
src/app.ts  # public URL log redaction / wiring test injection nếu cần
src/modules/README.md
docs/AUTHORIZATION.md
.env.example
README.md
package.json / package-lock.json
tests/{supplier-order-creation,delivery-inspections,modules}.test.ts
tests/{delivery-code,qr-code,delivery-trace}.test.ts  # thêm mới
tests/{authorization.integration,migrations}.test.ts
```

**Structure Decision**: Bổ sung module public độc lập thay vì làm traceability-anchor authenticated thành anonymous. Rendering HTML dùng dữ liệu allowlist từ service, không import DTO ở controller. Helper QR thuần không có DB; repository quản lý MAX SQL/WHERE/select/locking/persistence. Chỉ refactor chỗ delivery service bị chạm để đưa Prisma arguments về repository, không reformat toàn repo.

## Phase 0 — Research

Hoàn tất [research.md](research.md), R1–R8: quyền hiện hành, dãy riêng theo supplier, snapshot/legacy facilityCode null, QR dòng khác QR lô, fingerprint v2, lấp gap arrival/lot, receipt/cap3 và rollout. Hai research agent chỉ đọc, không sửa trùng file. Đã tham khảo primary docs của thư viện QR và PostgreSQL, không lấy một lời hứa thư viện làm bằng chứng runtime của repo. Các unknown kỹ thuật đã có quyết định; không có câu hỏi nghiệp vụ tồn đọng.

## Phase 1 — Design

1. [Data model](data-model.md): nullable traceabilityVersion/snapshots để tách baseline, unique composite, một QR và một lô dự kiến mỗi dòng mới, constraints/locks/state machine và rollout.
2. [Supplier contract](contracts/supplier-orders.md): REQUEST sources exact set; standalone source per item; plate/ETA required; options nguồn, labels, arrival trường; giữ raw states, add statusLabel.
3. [Public contract](contracts/public-trace.md): point lookup không login, HTML/JSON cùng allowlist, origin/QR URL ổn định, CSP/log/rate-limit/error policy.
4. [Quickstart](quickstart.md): các bước validate sau implement, migration legacy, 20 concurrent creates mỗi supplier, QR scan/no leak, đủ4 receipt/reject/cap3.

### Quyết định tích hợp bắt buộc

- Create v1 tạo N dòng/N token/N URL và N lô dự kiến BLOCKED, không receipt. Lô dự kiến lấy quantity/unit/source từ dữ liệu nhập, không giả ngày SX/HSD. Việc nhập nhiều lô sản xuất thực tế hoặc sửa quantity sau tạo không được thêm lén.
- Arrival do người trường thuộc bốn role + view/inspect xác nhận, không do supplier/public QR. Đây là dependency cần thêm vì source chưa có endpoint đến nơi. Không tự nhận hàng lúc create; kiểm nhận độc lập xác nhận thực tế trước APPROVE.
- Complete là RECEIVED sau4 đồng ý và receipt thành công; REJECTED là yêu cầu giao lại. Giữ photos/immutable signatures/source budget/cap3. Standalone missing entry vẫn create được nhưng không receipt nếu trường chưa cấu hình; không tự tạo entry/handlingType.
- QR render trước write transaction để lỗi render không commit đơn thiếu nhãn; reprint/replay từ token+URL lưu, không cấp mới. Detail chứa traceUrl, không nhân payload PNG vào list; labels phân trang. HTML đọc được bằng browser camera, không chỉ API JSON.
- Facility status recheck ở create, source equality recheck receipt; dừng/rename sau tạo giữ lịch sử qua snapshots. SourceCode null hợp lệ, không dùng nó làm public unique key.

## Execution Order and File Ownership

Đây là thứ tự thiết kế để sinh tasks, chưa phải task list đã triển khai:

1. Nền tảng: schema/migration/legacy fixtures, helpers mã/QR và public origin config. Quyết định khóa/schema phải xong trước service queries mới.
2. Producer: supplier-order validation/DTO/repository/service, recheck guards, atomic code/source/QR/lots, options và labels. Unit mô phỏng rollback/race và lỗi render.
3. Consumers độc lập sau schema: module delivery-trace + HTML/log wiring; module delivery arrival/inspection source equality/statusLabel. Mỗi người phụ trách toàn bộ file được giao, không sửa chung routes/index/resource-access/package/test integration trong cùng đợt.
4. Integrator: routes/wiring, docs authorization, package/test scripts, audit downstream, migration/auth/receipt/QR E2E. Schema/models đã chốt trước sửa fixtures.
5. Sau quality checks mới review migration rollout theo CD; bước plan không cấp phép deployment hoặc seed.

Các file chia sẻ (`prisma/schema.prisma`, `src/routes/index.ts`, `resource-access.ts`, `package.json`, `tests/authorization.integration.test.ts`, `tests/migrations.test.ts`) mỗi file một owner. Phân công subagents cụ thể thuộc bước implement theo yêu cầu user, không mặc định chạy code song song ở plan.

## Verification and Requirement Coverage

| FR                | Thiết kế/kiểm chứng                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 001–003, 010–013  | Actor live/role/denial/supplier scope; request source/linked school; giữ standalone độc lập và policies intake.                            |
| 004, 007, 015     | UUID PK + supplier code composite; source quota; replay; hai supplier cùng00001, ít nhất20 creates mỗi bên,99999 boundary và legacy codes. |
| 005–006, 009, 014 | Exact source set, Decimal/unit/active ingredient/facility; plate/ETA required; source lock race; atomic items/QR/lots/source update.       |
| 008, 023          | Protected options/list/detail/labels, raw status/statusLabel, không lộ ngoài scope; null legacy; pagination stable.                        |
| 016–018           | N line QR khác lot QR; decode/scan đúng URL, reprint same, snapshot rename/deactivate, public HTML/JSON allowlist/XSS/token errors.        |
| 019–022           | Arrival school-only, đủ4 final receipt exactly once; fail rollback, REJECT reason/lock; cap3 legacy và standalone counters null.           |
| 024               | Migration giữ IDs/codes/status/updated_at/approvals/lots/history và predicates; không guessed backfill; old API GET không mất dữ liệu.     |

Khi implement chạy Prisma validate/generate, lint/format, typecheck/build, test:unit; migration/auth/receipt integration chỉ trên disposable PostgreSQL local đã chỉ định/ủy quyền, Redis test prefix riêng. Ghi check thực tế và prerequisite bị chặn. Không dùng pass của baseline làm pass amendment. Xem [quickstart](quickstart.md) cho lệnh và expected outcomes.

## Complexity Tracking

Không có vi phạm Constitution cần miễn trừ. Thêm version/snapshots và module public là cần thiết để không sửa lịch sử hoặc lộ DTO protected. Không thêm bảng counter, framework, QR hosting hoặc đối tượng đơn thương mại. Số thứ tự branch/spec không bắt buộc.

## Phase 1 completion

Đã cập nhật plan/research/data-model/contracts/quickstart và đánh giá gate sau thiết kế. Setup resolver trả FEATURE_SPEC/IMPL_PLAN/SPECS_DIR đúng thư mục đang chọn; trường BRANCH của resolver theo active feature slug, còn Git branch thực được đối chiếu là `feat/supplier-order-creation-traceability`. Không sửa scaffold `.specify/`; feature pointer giữ đúng thư mục và không commit. Không có extension hook trước/sau plan. Tasks cho amendment đã được sinh theo plan; bước tiếp theo là implement theo tasks.md, chưa có task mới được thực hiện.

## Local testing setup — theo yêu cầu bổ sung 2026-11-15

User xác nhận dùng PostgreSQL đang có trong DataGrip: 127.0.0.1:5433, user foodprint_admin; chỉ các database thử mới do từng lần chạy tạo được ghi/xóa. Instance được giữ cố định; không tạo container mới, không tác động database nghiệp vụ của user. `.env.test.local` chứa credential local và bị gitignore; `.env.test.example` là mẫu không có secret.

Các lệnh `npm run test:local` / `test:local:<group>` dùng `tests/helpers/run-local-tests.ts` và `tests/helpers/local-test-database.ts` để chọn local target, tạo base database mới và ghi manifest tên database đã CREATE thành công. Migration/auth/lifecycle harness ghi thêm tên DB con vào manifest khi wrapper đang bật; ngoài wrapper là no-op, giữ CI cũ. Cleanup chỉ theo tên đã ghi, guard identifier và đúng owner, không scan prefix hoặc reset database có sẵn. Tên ASCII dài của fixture được chuẩn hóa theo giới hạn63 byte PostgreSQL để cleanup đúng DB đã được server tạo.

Đây là setup hỗ trợ kiểm chứng được user yêu cầu riêng; không phải triển khai US1–US5 hoặc thay đổi schema feature. Migration SQL vẫn cần replay trong mỗi bài test dùng DB trống; setup không loại bỏ kiểm thử schema hoặc dùng lại dữ liệu member để tăng tốc. Bằng chứng thực tế của setup được ghi trong quickstart, không tính là pass của bản sửa đổi QR/nguồn cung chưa implement.
