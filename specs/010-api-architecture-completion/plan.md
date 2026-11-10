# Implementation Plan: Menu, kitchen và retained-sample

**Branch**: `refactor/010-api-architecture-completion` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

## Summary and scope

Chỉ sửa `src/modules/menu/`, `src/modules/kitchen/`, `src/modules/retained-sample/`. User đã thu hẹp từ toàn BE sang phần hai role. Không sửa source module khác; các thay đổi agent ngoài scope đã hoàn tác. Dev8d1c000 và commit user57b83c1 giữ nguyên. Bổ sung retained status/search/expiresAt/totalItems và chuyển ba module sang Repository/Request DTO/Response DTO.

## Technical Context

### Performance review — 2026-11-10

Inspect the installed PrismaPg factory and official Prisma transaction documentation before changing connection behavior. Keep the current singleton/lazy client and transaction isolation unless an actual defect is demonstrated. No claim of one pool across processes, no latency claim without measurement. Kitchen week-schedule independent reads may overlap through the pool; kitchen list/stats inside the same transaction remain serialized at the connection.

Replace unscoped FE Map caches with scoped, bounded read stores for batches/stats/context. Use generation and entry-identity checks to prevent stale cache writes/cleanup, independent AbortSignal subscriptions with a shared transport controller, and an explicit refresh path. Add a revision counter to existing storage helpers for user/session mutations without changing auth flows. Test cross-user reuse, relogin, abort, invalidate/refresh races, TTL, bounds and error recovery with Axios fixtures; run FE build and the relevant regression suite. Preserve all pre-existing workspace changes and do not connect to Azure.

Results: reproduced four actual cache defects (cross-user reuse, owner-signal cancellation, stale repopulation after writes, refresh cleanup race). Also found the current KitchenService had removed planBatch/getBatchDetail while mounted screens still call them; restored compatible aliases and the three-field planning request, without creating backend endpoints. Added the empty-page stop to getAllBatches. FE cache is bounded to100entries/store, list/stats TTL20s and context TTL5min. Session revision changes through existing storage helpers prevent same-account relogin reuse. Responses superseded by invalidate/refresh or a session change are cancelled; only the last subscriber aborts transport. Callers receive cloned data.

Checks: kitchen/nutrition regression suite **24/24 PASS**, including14new cases; FE Vite build PASS, JS syntax checks PASS, BE typecheck PASS. In two isolated local processes (development/production),20concurrent getPrisma calls returned the same client in each process with a dummy localhost DSN; no connect/query was executed. Installed PrismaPg factory and official Prisma v7 docs confirm per-process/client pool behavior and serial SQL within interactive transactions. No Azure benchmark was performed, so neither a50% database latency reduction nor absolute cross-client cache synchronization is claimed.

The broader registration regression suite was attempted but blocked at Vite/esbuild setup by filesystem permissions (including parent-directory reads and the existing absolute /tmp cache path); no auth assertions ran. Temporary changes to that harness were reverted. Automatic approval review rejected cleanup of the generated node_modules/.vite-registration-tests cache because execution approval was unavailable; the ignored cache directory remains, with no source/Git artifact. Existing unrelated backend changes and README/.gitignore were preserved.

Separate contract findings left untouched: FE helpers getBatchPlan (GET /v1/kitchen/plan), updateCookingMode (PUT /v1/kitchen/cooking-mode), and updateBatchPortions (PUT /v1/kitchen/:id/portions) have no matching backend routes in the inspected kitchen router. They are not used by the inspected mounted kitchen screens; cache invalidation does not make those endpoints exist. Do not introduce editable teacher-finalized portions as part of this performance change.

Sources: [Prisma connections](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections), [Prisma transaction concurrency](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#using-transaction-within-promiseall).

TypeScript strict/CommonJS, Express, Prisma7, Zod4 và Node test runner hiện có; không dependency mới. Local Windows/Node22.15, chuẩn CI theo .nvmrc. Không schema/migration/DB deploy. Chỉ tests/scripts/docs tích hợp ba module được thay đổi khi cần.

## Constitution Check

| Nguyên tắc            | Trước nghiên cứu | Sau thiết kế                                                                   |
| --------------------- | ---------------- | ------------------------------------------------------------------------------ |
| I. Phân lớp           | PASS             | Chỉ 3 module: repo operation-specific, Request z.infer, Response map ở service |
| II. Quyền/tenant      | PASS             | Giữ catalog, trusted scope và recheck cùng tx                                  |
| III. Database         | PASS             | Không schema/migration/deploy/seed/reset                                       |
| IV. Transaction/cache | PASS             | Service giữ boundary, mọi repo cùng tx và isolation                            |
| V. HTTP/JSON          | PASS             | Preserve contract, bổ sung lưu mẫu, serialize rõ                               |
| VI. Spec-driven       | PASS             | Spec010 cập nhật phạm vi trước source tiếp theo                                |

## Project structure

Ba module mục tiêu có routes/controller/validation/service/repository/request.dto/response.dto. Giữ surface helper kitchen mà menu/meal modules đang dùng, phần đọc DB trong helper chuyển repo. Không tạo file giả hoặc query facade generic. Shared helpers hiện có paginationSchema/request-validation dùng nguyên trạng; không refactor utils nếu không cần.

## Research decisions

Ma trận27routes trong contracts/api-audit.md. Gap thực là GET lưu mẫu. Giữ duyệt tuần/spec004, catalog, UUID và reservation từ UNCONFIRMED. Không sửa module BGH/meal/catalog dù MD mô tả khác. Không có extension hooks. Audit rộng ban đầu chỉ là nguồn đọc; implementation ngoài scope đã hủy.

## Design

- Menu/kitchen: repo chứa queries/select/include/where/SQL locks và operation-specific persistence inputs. Service giữ tính toán, domain checks, scope và transaction, gọi repo cùng tx.
- Request DTO: z.infer từ strict schemas/type-only import; chỉ service consume. Validate giữ normalization/default/null/limits, gom lỗi tiếng Việt theo path.
- Response DTO: explicit allowlist tại service cho cả nested records; Date/Decimal/BigInt thành JSON theo hợp đồng. Không spread Prisma row, không mapper riêng.
- Retained: status enum hiện hành, search trim có giới hạn/match batchCode hoặc tên món case-insensitive. Count/list cùng WHERE/school scope; expiresAt sampledAt+24h ISO. Giữ hasNext, thêm totalItems; aliases parity.
- Complete: body empty/null giữ nguyên. preparedPortions positive integer hợp lệ nếu gửi, không quyết định trừ kho. inspectionData là JSON object legacy được tests xác nhận chấp nhận rồi bỏ qua; không suy diễn nested fields hoặc phục hồi kiểm thực bắt buộc. Top-level strict.
- Giữ các DI factories/reader/helper mà tests dùng, lỗi503 và transaction isolation. Không thay hành vi module ngoài phạm vi.

## Validation Strategy

Architecture AST test chỉ kiểm tra ba module và DTO boundary. Contract tests lưu mẫu/filter/scope/count/expiresAt/aliases; hồi quy menu/kitchen/sample/kho/approval hiện có. Lint/format file đổi, typecheck/build, test:unit. Không format toàn repo. Nếu integration cần, chỉ PostgreSQL18 disposable local; không Azure/DB thành viên. Spec gate/diff check và scope audit cuối.

## Complexity Tracking

Không ngoại lệ thiết kế. Service có thể lấy client để đặt transaction, không query trong callback. Repository chỉ query, không chứa quyết định nghiệp vụ.

## Verification results

Trước merge dev: typecheck và217unit tests PASS. Generate client sau merge PASS. Chưa kết luận baseline mới/typecheck đang chạy trong lúc source chuyển dở. Kết quả source mới cập nhật sau khi hoàn tất.

## Review filtering and excluded functions — 09/11/2026

- Phạm vi nguồn BE vẫn chỉ menu/kitchen/retained-sample. User xác nhận thêm gỡ phần in/xuất FE hai role; giữ MenuApproval của BGH nguyên trạng.
- Hiện tại menu có date/weekStartDate/status và paging nhưng thiếu search; kitchen đã có đầy đủ filter/search/paging và KPI cùng filter, nhưng không kiểm tra startDate>endDate. Retained service có search tủ/mẻ/món nhưng không dùng repo/count/mapper để trả expiresAt/totalItems; repo chưa tìm tủ và thứ tự không trùng service. Sửa các gap thực này, không dựa vào khẳng định mọi thứ đã đủ trong MD v3.4.
- Chuyển kitchen filter builder sang repository và truyền normalized query/trusted scope; service không dựng where cho list/stats. Chuyển schema kitchen sang Zod strict, Request DTO z.infer; giữ body complete legacy và các helper khác. Không refactor toàn bộ lifecycle ở tác vụ review này.
- Menu thêm search title hoặc nested Dish.name qua cùng builder list/count; không đổi nghiệp vụ menu hoặc BGH. Giữ defaults20/max100 thay vì đổi theo ví dụ tài liệu50.
- Retained dùng repo list/count với cùng bộ lọc tủ/mẻ/món, sampledAt desc +id asc và RepeatableRead; service map allowlist/ISO/Decimal/expiresAt, giữ DI reader factory và adapter khi cần.
- Gỡ kitchen update handler/service/validator/DTO vì routePUT đã bỏ. Không xóa cooking_batch.update permission vì delete vẫn cần quyền này.
- FE chỉ gỡ MenuPlanning/MenuDetail nút, state, import, handler, modal và SCSS riêng; KitchenCooking audit xuất/in và chỉ gỡ nếu thật sự còn. Không sửa AppShell, globals, API adapter, MenuApproval hoặc màn khác.
- Thêm tests phân trang/bộ lọc cùng scope, query lỗi, KPI parity và routes xuất/in/PUT không có; đăng ký test mới vào test:unit. Kiểm tra BE lint/format/typecheck/build/unit và FE build; không cần schema/migration/DB changes.

### Kết quả kiểm chứng lượt review

- BE: ESLint toàn repo PASS, typecheck PASS, build PASS. Prettier trên các file thay đổi PASS; không format toàn repo.
- Test mục tiêu cùng modules: 37/37 PASS. Toàn bộ test:unit sau chỉnh sửa: 247/247 PASS, gồm 7 test mới về query/pagination/scope/alias/JSON và route đã bỏ.
- FE: build PASS (44.14s); diff đúng4file MenuPlanning/MenuDetail, gồm xóa modal JSX/SCSS và gỡ import/state/prop/button. Rà MenuPlanning/KitchenCooking không còn print/export handlers. MenuApproval của BGH không thay đổi.
- Spec gate trên working-tree candidate PASS; đây chưa phải lượt CI mới. Diff check và scope audit chỉ3module BE/4file FE PASS.
- Không chạy PostgreSQL/Redis integration trong lượt này; assertion mẫu trong authorization integration được cập nhật sang ISO DTO và đã typecheck. Không thay đổi schema/migration hoặc chạy thao tác database.
- Chạy local Node22.15.0; chuẩn CI theo .nvmrc. Thay đổi lượt review chưa commit/push trong cả hai repo.

## Academic week numbering (2026-11-09)

- Read `school_academic_years` through menu repository with trusted school scope. Add read-only GET `/api/v1/menus/academic-calendar` and explicit response DTOs. BE calculates Monday-based weeks from the configured start date, including cross-year weeks; holidays do not renumber weeks.
- Replace ISO numbering in menu week-schedule with configured academic week metadata (null outside configured years). Keep `week_start_date`, all existing migration files, and approval rules unchanged; there is no numeric week column in Prisma/bootstrap to remove.
- FE loads year/week options from this API, filters requests by `weekStartDate`, and renders `Thực đơn tuần N` using the API number. Empty/error configuration is visible; no mock or hardcoded academic year fallback.
- Verify boundary dates, timezone, school scope, no configuration, route validation, FE API contract and build. Do not connect to Azure or modify README/.gitignore.

Verification: Prisma validate/generate, BE typecheck/build, ESLint and Prettier for the changed menu/tests files PASS; full infrastructure-free suite 250/250 PASS. Three calendar regression tests cover midweek school start, week 9 versus ISO week 45, cross-year numbering, UTC+07 midnight, school scope, missing configuration and strict HTTP input validation. FE Vite build PASS; inline Vite SSR/transport checks PASS for real calendar endpoint, empty/invalid responses, unchanged server week numbers, cached weekday personalization and date-keyed filter rendering. Working-tree spec gate PASS. No test-only files were created. No live database connection, migration, Azure write, README/.gitignore change, commit or push. Browser/live database persistence was not tested.

## Real API integration and mock removal

### Full audit requested 2026-11-09

Complete matrix and evidence are in `contracts/api-audit.md`. Live read-only API probes: health200, public school list200 with one DB-backed record, protected menu/kitchen/sample lists401 without a session. No direct remote DB connection or write probes. User confirmed no disposable local DB configured; Docker/initdb and browser hosts are unavailable, so real role-session browser E2E and PostgreSQL write/concurrency tests remain unverified.

Fixed the proven contract/data-loss defects in the current screens/services: remove unknown displayOrder from create; retain per-ingredient decimal standards and fresh full-week snapshots on edit; bind context to menu.view; hydrate week meal content through existing detail API; expose finalized demand by dish for the cooking picker; transmit hasSample; preserve nullable sample response; read all sample pages before current client filters; match READY option; interpret plan response batches; stop sending prepared totals; use explicitly assigned dishes instead of fabricated substitutes. Added FE `test:kitchen-nutrition` regression command (10 fixture tests), extended an existing BE unit file (251 full unit tests pass), BE types/build pass. No schema/migration/role/auth, README/.gitignore, commit or push changes. T024–T029 stay pending where the audit proves remaining runtime mock/integration gaps; this is not a declaration that both roles are production-ready.

- Audit xác minh shared Axios base URL/cookie/CSRF đúng; GET health200, chưa cookie trả401, CORS204. BE5000 đang dùng PostgreSQL remote nên chỉ probe read; write E2E phải chạy instance riêng.
- FE đang nuốt lỗi bằng mock/fake success kể cả create/delete/confirm/complete/sample. CreateMenu và CreateBatch có nút chỉ toast/state, chưa gọi API; list/detail/edit seed mock và mất dữ liệu khi PUT một bữa thay cả tuần. Sửa source thực, không chỉ tắt VITE_USE_MOCK.
- Research agents chia audit Nutrition UI, Kitchen UI và transport/schema. Implementation FE qua Temp overlays và reviewed hash manifest; root áp vào FE bằng quyền workspace phù hợp, giữ bốn thay đổi gỡ print đã có. Ownership Nutrition: MenuPlanning/MenuService (và catalog món liên quan nếu cần); Kitchen: KitchenCooking/KitchenService. Root giữ BE/tests/shared manifest. Không sửa auth/AppShell hoặc màn BGH.
- Context GET /api/v1/menus/context và /api/v1/kitchen/context trả cùng {id,name,cookingMode,lunchTime,afternoonMealTime,academicYears:[{id,academicYear,startDate,endDate,holidays}]}; các ngày ISO, giờ HH:mm hoặc null. Scope lấy principal, permission menu.view/cooking_batch.view. Không mở school.manage.
- Samples query thêm mealType, date YYYY-MM-DD (sampledAt theo UTC+07), readyToDispose true/false. Kết hợp ready flag với status DISPOSED là400. Cutoff +24h được chụp một lần/request. GET /api/v1/retained-samples/stats (alias food-samples/stats) trả {total,stored,ready,disposed}, stored là STORED chưa đủ24h; cùng filter/scope với list.
- Kitchen query thêm hasSample true/false cho picker mẻ chưa lấy mẫu; getStats cùng builder. Lot response thêm lotCode/ingredientName/expiryDate từ projection quan hệ thật; không sửa dữ liệu kho.
- Menu ingredient-options thêm search và kind avoidance để trả Entry IDs thực phục vụ nhóm suất; validation/controller/DTO/service/repo cập nhật đồng bộ. GET /api/dishes giữ API existing, FE không giả CRUD catalog chưa có.
- Adapters không tự điền số suất, tên actor, BGH feedback, nguyên liệu, lot code/hạn dùng. Calendar/week computations thuần từ ngày/context được phép; empty configuration không đồng nghĩa mock. Request giữ status REVISION_REQUIRED đúng enum BE và scope không gửi schoolId.
- Create/Edit giữ full raw week snapshot và per-meal seasonings/ingredients/groups. Lỗi sau bước lưu menu nhưng groups chưa lưu phải được báo rõ partial completion, không báo mọi thứ thành công.
- Kiểm chứng: FE service tests dùng Vite SSR + transport adapter fixtures, source audit chống runtime fallback, BE schema/type/build/unit và integration DB disposable. Browser/UI smoke nếu môi trường cho phép; ghi rõ giới hạn thực, không kết luận persistence chỉ từ build.
