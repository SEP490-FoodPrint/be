---
description: "Danh sách công việc triển khai tính năng nhà cung cấp tạo đơn từ yêu cầu hoặc tạo độc lập"
---

# Tasks: Nhà cung cấp tạo đơn từ yêu cầu hoặc tạo độc lập

**Input**: Các tài liệu thiết kế trong `specs/supplier-order-creation/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/supplier-orders.md`, `quickstart.md`).

**Prerequisites**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/supplier-orders.md](contracts/supplier-orders.md), [quickstart.md](quickstart.md).

**Tests**: Bao gồm các task kiểm thử đơn vị (unit/HTTP/repository) và tích hợp PostgreSQL (migration/authorization/lifecycle/concurrency) theo yêu cầu của `plan.md`, `quickstart.md` và quality gate trong `.specify/memory/constitution.md`. Sử dụng Node test runner (`tsx --test`) hiện có; không thêm framework mới.

**Organization**: Các task được tổ chức theo từng User Story của `spec.md` sau khi hoàn tất phần nền tảng bắt buộc (schema, migration backfill lịch sử, canonical fields `schoolId`/`ingredientId`/`ingredientEntryId`, guard tiếp nhận và an toàn nullability cho các module downstream).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Có thể thực hiện song song (khác file, không phụ thuộc vào task chưa hoàn tất trong cùng đợt).
- **[Story]**: Nhãn User Story (`[US1]`, `[US2]`, `[US3]`) chỉ dùng trong các Phase của User Story.
- Mọi task đều chỉ rõ đường dẫn file tương đối từ thư mục gốc của repository.

## Path Conventions

- **Backend**: `src/`, `prisma/`, `tests/`, `docs/` tại thư mục gốc repository.
- **Module mới**: `src/modules/supplier-order/` gồm đầy đủ 7 file theo chuẩn phân lớp trong `AGENTS.md`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Xác nhận phạm vi nhánh, tài liệu đặc tả và điều kiện tiên quyết trước khi sửa mã nguồn hoặc schema.

- [x] T001 Đọc `AGENTS.md`, `.specify/memory/constitution.md`, `specs/supplier-order-creation/spec.md`, `specs/supplier-order-creation/plan.md`, `specs/supplier-order-creation/data-model.md` và `specs/supplier-order-creation/contracts/supplier-orders.md`; kiểm tra nhánh `feat/supplier-order-creation` và ghi xác nhận baseline vào `specs/supplier-order-creation/quickstart.md`.
- [x] T002 Rà soát cấu hình scripts trong `package.json`, thứ tự đăng ký router trong `src/routes/index.ts`, quyền `delivery.manage`/`delivery.view`/`delivery.receive` trong `src/constants/permission-catalog.ts` và ghi rõ điều kiện tiên quyết kiểm thử PostgreSQL disposable vào `specs/supplier-order-creation/quickstart.md`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Hoàn tất mở rộng schema/migration, canonical fields (`schoolId`, `ingredientId`, `ingredientEntryId`), guard tạo đơn độc lập, phạm vi truy cập `resource-access` và an toàn nullability ở các module downstream trước khi mở endpoint tạo đơn.

**⚠️ CRITICAL**: Không bắt đầu triển khai các endpoint User Story trước khi hoàn thành Phase này.

- [x] T003 Cập nhật model `Delivery`, `DeliveryItem` và thêm enum `DeliveryCreationMode` (`REQUEST`, `STANDALONE`) trong `prisma/schema.prisma` theo `specs/supplier-order-creation/data-model.md`: thêm `schoolId`, `creationMode`, `creationKey`, `creationFingerprint` vào `Delivery` và chuyển `supplyRequestId` sang nullable; thêm `ingredientId`, `ingredientEntryId` vào `DeliveryItem` và chuyển `supplyRequestItemId` sang nullable; khai báo đầy đủ indexes và `partialIndexes` khớp vị từ SQL.
- [x] T004 Tạo migration SQL được review tại `prisma/migrations/20261116000200_supplier_order_creation/migration.sql` và cập nhật `database/SCHEMA_BASELINE.md`: thêm enum/cột nullable, kiểm tra preflight dữ liệu lịch sử (dừng nếu thiếu/mâu thuẫn mapping hoặc trùng `(delivery_id, ingredient_id)`), backfill xác định `school_id`, `ingredient_id`, `ingredient_entry_id` từ nguồn hiện có mà không đổi `updated_at`, đặt `NOT NULL`, chuyển FK nguồn sang nullable, thêm FK/index/partial unique index và CHECK constraints, sau đó chạy `npm run prisma:validate` và `npm run prisma:generate` để cập nhật `src/generated/prisma/`.
- [x] T005 [P] Mở rộng kiểm thử migration trong `tests/migrations.test.ts` cho `prisma/migrations/20261116000200_supplier_order_creation/migration.sql`: xác minh áp dụng trên DB mới và DB có dữ liệu lịch sử (nhiều `Delivery` cho cùng một `SupplyRequest`), backfill chính xác `school_id`/`ingredient_id`/`ingredient_entry_id`, bảo toàn mã/số lượng/trạng thái/timestamps và kiểm tra các CHECK constraint cùng partial unique indexes.
- [x] T006 Cập nhật `src/utils/resource-access.ts`: chuyển toàn bộ school scope đang đi qua `SupplyRequest.schoolId` ở `warehouse`, `delivery`, `inventory`, `ingredient-quality-feedback` và `traceability` sang lọc trực tiếp `Delivery.schoolId`; bổ sung helper kiểm tra quyền và phạm vi cho `supplier-order` (chỉ cho phép `INGREDIENT_SUPPLIER_ADMIN` và `INGREDIENT_SUPPLIER_STAFF` thuộc `ORG_TYPES.SUPPLIER`, yêu cầu `delivery.manage` khi tạo/lấy options và dùng `listScopes["delivery"]` cho danh sách/chi tiết).
- [x] T007 [P] Mở rộng `src/modules/account-lifecycle/intake-access.repository.ts` và `src/modules/account-lifecycle/intake-access.service.ts`: hỗ trợ đọc/khóa `SchoolSupplierRelationship` và `Ingredient` theo thứ tự khóa chuẩn, kiểm tra đúng hai role nhà cung cấp cho `START_ORDER_PROCESSING` phía supplier và bổ sung operation `SUPPLIER_CREATE_STANDALONE_DELIVERY` (khóa `School -> Supplier -> User -> Role FOR SHARE -> advisory pair lock -> SchoolSupplierRelationship -> Ingredient`, nạp lại actor/quyền `delivery.manage`, xác minh `School`/`Supplier`/hai admin `ACTIVE`, `intakeState = ACTIVE` của cả hai đơn vị và quan hệ `ACTIVE`).
- [x] T008 [P] Bổ sung unit tests cho nhánh supplier của `START_ORDER_PROCESSING` và operation `SUPPLIER_CREATE_STANDALONE_DELIVERY` (kiểm tra 2 role, quyền `delivery.manage`, trạng thái `PAUSED`/`DEACTIVATED` của trường/nhà cung cấp/admin, quan hệ `ACTIVE` và thứ tự khóa) trong `tests/intake-access.test.ts`.
- [x] T009 Cập nhật `src/modules/delivery/delivery.repository.ts`, `src/modules/delivery/delivery.service.ts` và `src/modules/delivery/delivery.response.dto.ts`: chuyển `select` và truy vấn Prisma của `GET /api/deliveries` từ service về `src/modules/delivery/delivery.repository.ts`, loại bỏ import Request DTO trong repository inspection, đọc trực tiếp `schoolId`/`ingredientId`/`ingredientEntryId` và hỗ trợ `SupplyRequest`/`SupplyRequestItem` nullable; giữ nguyên logic kiểm nhận đơn có nguồn (budget nhận, `rejectedCount`, `cancelRemainder`) và xử lý an toàn phiếu `STANDALONE` (yêu cầu đủ 4 chữ ký, tra cứu và gắn `IngredientEntry` của trường trong cùng transaction trước khi `RECEIVED` hoặc trả 409 nếu chưa cấu hình, `REJECT` chỉ đóng phiếu hiện tại và không gọi `rejectedCount`/`cancelRemainder` với `null`).
- [x] T010 [P] Cập nhật `src/modules/warehouse/warehouse.repository.ts`, `src/modules/warehouse/warehouse.service.ts`, `src/modules/kitchen/kitchen.repository.ts`, `src/modules/kitchen/kitchen.service.ts`, `src/modules/menu/menu.repository.ts` và `src/modules/menu/menu.service.ts` để sử dụng trực tiếp `Delivery.schoolId`, `DeliveryItem.ingredientId` và `DeliveryItem.ingredientEntryId` thay vì phụ thuộc bắt buộc vào `SupplyRequest`/`SupplyRequestItem`.
- [x] T011 [P] Cập nhật test fixtures/fakes theo canonical fields mới và bổ sung unit tests cho đọc/kiểm nhận phiếu `STANDALONE` cùng regression phiếu có nguồn trong `tests/delivery-inspections.test.ts`, `tests/modules.test.ts`, `tests/authorization.test.ts` và `tests/kitchen-nutrition-lists.test.ts`.
- [x] T012 Khởi tạo hợp đồng dùng chung cho module `src/modules/supplier-order/`: định nghĩa khung validation trong `src/modules/supplier-order/supplier-order.validation.ts`, kiểu suy diễn trong `src/modules/supplier-order/supplier-order.request.dto.ts`, toàn bộ kiểu đầu ra (`SupplierOrderDetailDTO`, `SupplierOrderSummaryDTO`, `SupplierOrderListResponseDTO`, `SupplierSchoolOptionListResponseDTO`, `SupplierIngredientOptionListResponseDTO`) trong `src/modules/supplier-order/supplier-order.response.dto.ts`, giao diện repository trong `src/modules/supplier-order/supplier-order.repository.ts` và đăng ký `tests/supplier-order-creation.test.ts` vào script `test:unit` trong `package.json`.

**Checkpoint**: Schema, client Prisma, phạm vi `resource-access`, guard tiếp nhận, khả năng xử lý `SupplyRequest = null` ở các module downstream và hợp đồng module `supplier-order` đã sẵn sàng.

---

## Phase 3: User Story 1 - Tạo đơn từ yêu cầu đã tiếp nhận (Priority: P1) 🎯 MVP

**Goal**: Admin hoặc staff nhà cung cấp có quyền `delivery.manage` tạo được một đơn giao hàng (`CREATED`, `sourceType = REQUEST`) sao chép nguyên vẹn toàn bộ nguyên liệu, số lượng và đơn vị từ yêu cầu đã tiếp nhận (`ACCEPTED` hoặc `IN_PROGRESS` chưa có `Delivery`), đồng thời chuyển yêu cầu từ `ACCEPTED` sang `IN_PROGRESS` trong cùng giao dịch và chặn tạo đơn thứ hai từ cùng yêu cầu.

**Independent Test**: Dùng tài khoản admin và staff nhà cung cấp gọi `POST /api/deliveries/management` với `sourceType: "REQUEST"` cho các yêu cầu đã tiếp nhận; kiểm tra đơn sinh mã `DG-<UUID>`, trạng thái `CREATED`, kế thừa đúng trường nhận và toàn bộ dòng/số lượng/đơn vị, yêu cầu nguồn chuyển sang `IN_PROGRESS`, từ chối mọi trường override (`schoolId`, `items`) và chặn tạo đơn thứ hai cho cùng yêu cầu.

### Tests for User Story 1

- [x] T013 [P] [US1] Viết unit/HTTP và repository tests cho nhánh tạo đơn từ yêu cầu (`POST /api/deliveries/management` với `sourceType: "REQUEST"`) trong `tests/supplier-order-creation.test.ts`: kiểm tra 2 role nhà cung cấp, quyền `delivery.manage`, bắt buộc header `Idempotency-Key` UUID, strict body từ chối `schoolId`/`items`/field lạ, nguồn ngoài scope hoặc `DRAFT` trả 404, nguồn `SENT`/`COMPLETED`/`CANCELLED`/rỗng dòng hoặc đã có `Delivery` (kể cả legacy) trả 409, copy đủ dòng/Decimal/unit/note, chuyển `ACCEPTED -> IN_PROGRESS` trong cùng transaction và rollback khi có lỗi giữa chừng.

### Implementation for User Story 1

- [x] T014 [US1] Triển khai validation cho header `Idempotency-Key` (UUID đơn trị, chuẩn hóa lowercase), strict empty query và body nhánh `sourceType: "REQUEST"` (`supplyRequestId`, `expectedArrivalAt`, `vehiclePlate`, `note`) bằng `z.strictObject()` trong `src/modules/supplier-order/supplier-order.validation.ts` và xuất kiểu Request DTO bằng `z.infer` tại `src/modules/supplier-order/supplier-order.request.dto.ts`.
- [x] T015 [US1] Triển khai các phương thức repository phục vụ tạo đơn `REQUEST` trong `src/modules/supplier-order/supplier-order.repository.ts`: đọc và khóa `SupplyRequest` kèm toàn bộ `supplyRequestItems` (và `IngredientEntry` -> `Ingredient`), kiểm tra sự tồn tại của bất kỳ `Delivery` nào gắn với `supplyRequestId`, tra cứu bản ghi theo `(supplierId, createdByUserId, creationKey)` và tạo `Delivery` + `DeliveryItem` đồng thời cập nhật `SupplyRequest.status = "IN_PROGRESS"` trong cùng `Prisma.TransactionClient`.
- [x] T016 [US1] Triển khai luồng `createFromRequest` và hàm băm `creationFingerprint` (SHA-256 trên payload đã chuẩn hóa) trong `src/modules/supplier-order/supplier-order.service.ts`: thực thi trong `authorizationTransaction` kết hợp guard `START_ORDER_PROCESSING` (`requiredPermission: "delivery.manage"`), xác minh nguồn chưa có `Delivery` và có ít nhất một dòng, sinh mã `DG-<UUID>`, ghi đơn ở trạng thái `CREATED` và ánh xạ tường minh sang `SupplierOrderDetailDTO`.
- [x] T017 [US1] Triển khai handler `create` trong `src/modules/supplier-order/supplier-order.controller.ts`, khai báo route `POST /` trong `src/modules/supplier-order/supplier-order.routes.ts` và mount `/api/deliveries/management` trước `/api/deliveries` tại `src/routes/index.ts`.
- [x] T018 [US1] Chạy unit tests cho User Story 1 trong `tests/supplier-order-creation.test.ts` và `tests/delivery-inspections.test.ts`, sửa lỗi phát sinh và cập nhật kết quả kiểm chứng vào `specs/supplier-order-creation/quickstart.md`.

**Checkpoint**: User Story 1 hoàn tất và có thể kiểm thử độc lập như bản MVP tạo đơn từ yêu cầu đã tiếp nhận.

---

## Phase 4: User Story 2 - Tạo đơn độc lập cho trường đã liên kết (Priority: P1)

**Goal**: Admin hoặc staff nhà cung cấp có quyền `delivery.manage` lấy được danh sách trường liên kết `ACTIVE` và nguyên liệu `ACTIVE` thuộc nhà cung cấp mình, sau đó tạo đơn giao hàng độc lập (`sourceType = STANDALONE`) mà không cần yêu cầu nguyên liệu hay phiếu giao bị từ chối làm nguồn, không sinh `SupplyRequest` hoặc `IngredientEntry` giả.

**Independent Test**: Khi không có yêu cầu nguyên liệu hoặc lịch sử từ chối, dùng cả hai vai trò gọi `GET /api/deliveries/management/options/schools`, `GET /api/deliveries/management/options/ingredients` và `POST /api/deliveries/management` (`sourceType: "STANDALONE"`); xác nhận tạo thành công cho trường liên kết `ACTIVE`, cho phép tạo nhiều đơn độc lập có cùng trường/nguyên liệu với `Idempotency-Key` khác nhau, và chặn mọi trường hợp thiếu trường nhận, trường chưa liên kết/tạm dừng, nguyên liệu của nhà cung cấp khác, đơn vị lệch `defaultUnit`, trùng nguyên liệu hoặc số lượng không dương.

### Tests for User Story 2

- [x] T019 [P] [US2] Bổ sung unit/HTTP và repository tests cho `GET /api/deliveries/management/options/schools`, `GET /api/deliveries/management/options/ingredients` và `POST /api/deliveries/management` (`sourceType: "STANDALONE"`) trong `tests/supplier-order-creation.test.ts`: kiểm tra 2 role và quyền `delivery.manage`, phân trang options, lọc trường liên kết `ACTIVE` đủ điều kiện cung ứng mới (không trùng trường), lọc nguyên liệu `ACTIVE` thuộc supplier hiện hành, kiểm tra strict body `STANDALONE` (1..100 dòng, không trùng `ingredientId`, Decimal dương tối đa 11 chữ số nguyên và 3 chữ số lẻ, chuẩn hóa `12.0`/`12.000`, `unit` khớp `defaultUnit`), tạo nhiều đơn độc lập với `Idempotency-Key` khác nhau và không tạo `SupplyRequest`/`IngredientEntry` giả.

### Implementation for User Story 2

- [x] T020 [US2] Mở rộng `src/modules/supplier-order/supplier-order.validation.ts` và `src/modules/supplier-order/supplier-order.request.dto.ts` cho nhánh body `sourceType: "STANDALONE"` (`schoolId`, mảng `items` 1..100 dòng không trùng `ingredientId`, `quantity` thập phân dương chuẩn hóa, `unit`, `note`) và query phân trang (`page`, `limit`) cho hai endpoint options.
- [x] T021 [US2] Triển khai các phương thức repository cho User Story 2 trong `src/modules/supplier-order/supplier-order.repository.ts`: `listSchoolOptions` (trường `ACTIVE`, `intakeState = ACTIVE`, admin trường không `DEACTIVATED`, có `SchoolSupplierRelationship` `ACTIVE` với `supplierId`, chống trùng trường, sắp xếp `id asc`, `limit+1`), `listIngredientOptions` (nguyên liệu `ACTIVE` thuộc `supplierId`, sắp xếp `id asc`, `limit+1`), đọc và khóa danh sách `Ingredient` theo ID tăng dần, tra cứu `IngredientEntry` hiện có của cặp `(schoolId, ingredientId)` và tạo `Delivery` (`creationMode = STANDALONE`, `supplyRequestId = null`) cùng `DeliveryItem` (`supplyRequestItemId = null`) trong transaction.
- [x] T022 [US2] Triển khai `listSchoolOptions`, `listIngredientOptions` và nhánh `createStandalone` trong `src/modules/supplier-order/supplier-order.service.ts`: gọi guard `SUPPLIER_CREATE_STANDALONE_DELIVERY` trong `authorizationTransaction`, xác minh từng nguyên liệu thuộc `supplierId`, đang `ACTIVE` và có `unit === defaultUnit`, gắn `ingredientEntryId` nếu trường đã có sẵn entry (giữ `null` nếu chưa có, tuyệt đối không tự tạo `IngredientEntry`) và map sang Response DTO.
- [x] T023 [US2] Bổ sung handlers `listSchoolOptions` và `listIngredientOptions` trong `src/modules/supplier-order/supplier-order.controller.ts` và đăng ký routes `GET /options/schools`, `GET /options/ingredients` trong `src/modules/supplier-order/supplier-order.routes.ts`.
- [x] T024 [US2] Chạy unit tests cho User Story 2 trong `tests/supplier-order-creation.test.ts` và `tests/intake-access.test.ts`, sửa lỗi phát sinh và ghi kết quả vào `specs/supplier-order-creation/quickstart.md`.

**Checkpoint**: User Story 1 và User Story 2 đều hoạt động độc lập; nhà cung cấp tạo được đơn theo cả hai cách (`REQUEST` và `STANDALONE`).

---

## Phase 5: User Story 3 - Xem lại kết quả và tránh tạo trùng (Priority: P2)

**Goal**: Admin hoặc staff nhà cung cấp có quyền xem (`delivery.view | delivery.manage | delivery.receive`) xem được danh sách phân trang và chi tiết các đơn đã tạo (nhận diện rõ `sourceType`, trường nhận, dòng nguyên liệu và nguồn nếu có), đồng thời đảm bảo gửi lại cùng thao tác (`Idempotency-Key`) trả về đúng đơn đã tạo (HTTP 200) mà không sinh bản sao và xử lý an toàn khi nhiều người cùng thao tác.

**Independent Test**: Tạo đơn bằng cả hai cách rồi dùng hai vai trò gọi `GET /api/deliveries/management` và `GET /api/deliveries/management/:id`; thử gửi lại cùng `Idempotency-Key` và cùng nội dung nhận HTTP 200 (không đổi `updatedAt`), gửi cùng `Idempotency-Key` nhưng khác nội dung nhận HTTP 409, và hai người cùng tạo từ một yêu cầu chỉ tạo ra một đơn duy nhất.

### Tests for User Story 3

- [x] T025 [P] [US3] Bổ sung unit/HTTP và repository tests trong `tests/supplier-order-creation.test.ts` cho `GET /api/deliveries/management`, `GET /api/deliveries/management/:id` và idempotency/concurrency: kiểm tra quyền đọc OR (`delivery.view | delivery.manage | delivery.receive`) cho 2 role supplier, lọc `sourceType` (`REQUEST` gồm cả bản ghi legacy `creationMode = null` có nguồn, `STANDALONE`) và `status`, phân trang `limit+1` (`createdAt desc, id asc`), che đơn của nhà cung cấp khác (404 ở chi tiết), replay cùng `(supplierId, createdByUserId, creationKey)` + cùng fingerprint trả HTTP 200 không đổi `updatedAt`, khác fingerprint trả 409, và không lộ `creationKey`/`creationFingerprint`/thông tin nhạy cảm.

### Implementation for User Story 3

- [x] T026 [US3] Hoàn thiện schema validation cho query danh sách (`page`, `limit`, `sourceType`, `status` với `z.strictObject()`) và params/query chi tiết (`id` UUID, strict empty query) trong `src/modules/supplier-order/supplier-order.validation.ts` cùng kiểu Request DTO trong `src/modules/supplier-order/supplier-order.request.dto.ts`.
- [x] T027 [US3] Triển khai `listManagementDeliveries` (áp dụng `supplierId` từ `listScopes["delivery"]`, lọc `sourceType` với `REQUEST` khớp `creationMode = REQUEST` hoặc `creationMode = null` có `supplyRequestId`, lọc `status`, sắp xếp `createdAt desc, id asc`, `limit+1`) và `findManagementDeliveryById` (lọc `id` + `supplierId`, select `School`, `SupplyRequest` và `deliveryItems -> Ingredient` theo `id asc`) trong `src/modules/supplier-order/supplier-order.repository.ts`.
- [x] T028 [US3] Triển khai `list`, `detail` và hoàn thiện cơ chế idempotency bền vững trong `src/modules/supplier-order/supplier-order.service.ts`: kiểm tra lại quyền/scope của actor hiện tại trước khi trả kết quả replay (`created: false`), so khớp `creationFingerprint` (trả 409 nếu lệch), bắt lỗi unique/serialization khi đua đồng thời để đọc lại bản ghi thắng cuộc và map bản ghi legacy (`creationMode = null`) sang `sourceType: "REQUEST"`.
- [x] T029 [US3] Bổ sung handlers `list`, `detail` và trả đúng mã HTTP 201 (`created: true`) hoặc HTTP 200 (`created: false` khi replay) trong `src/modules/supplier-order/supplier-order.controller.ts`, đồng thời đăng ký `GET /` và `GET /:id` trong `src/modules/supplier-order/supplier-order.routes.ts`.
- [x] T030 [US3] Tạo file kiểm thử tích hợp PostgreSQL `tests/supplier-order-creation.integration.test.ts` (sử dụng harness tạo database tạm độc lập): kiểm chứng đầy đủ hành trình 2 role tạo `REQUEST` và `STANDALONE`, idempotency replay/conflict bền vững, race 2 actor cùng tạo từ một yêu cầu chỉ sinh 1 `Delivery`, race đổi trạng thái quan hệ/pause/thu quyền trong lúc tạo, kiểm nhận 4 bên cho phiếu `STANDALONE` (chặn 409 khi thiếu `IngredientEntry`, cho phép `RECEIVED` khi đã có `IngredientEntry`, `REJECT` không hủy hoặc tăng bộ đếm yêu cầu khác) và kho/bếp/menu sử dụng lô từ phiếu `STANDALONE`.
- [x] T031 [P] [US3] Cập nhật fixtures cho các trường canonical mới (`schoolId`, `ingredientId`, `ingredientEntryId`) và bổ sung kịch bản kiểm chứng liên quan trong `tests/authorization.integration.test.ts`, `tests/account-lifecycle.integration.test.ts` và `tests/kitchen-nutrition-wire.integration.test.ts`.
- [x] T032 [US3] Chạy toàn bộ unit tests trong `tests/supplier-order-creation.test.ts`, sửa lỗi phát sinh và cập nhật kết quả vào `specs/supplier-order-creation/quickstart.md`.
- [ ] T033 [US3] Khi biến môi trường `MIGRATION_TEST_DATABASE_URL` đã trỏ tới PostgreSQL disposable local được ủy quyền, chạy `npm run test:migrations`, `npm run test:authorization`, `npm run test:account-lifecycle:integration` và `npm exec --no -- tsx --test tests/supplier-order-creation.integration.test.ts`, sửa lỗi nếu có và ghi kết quả thực tế vào `specs/supplier-order-creation/quickstart.md` (nếu chưa có DB tạm được ủy quyền thì giữ task chưa hoàn tất và ghi rõ lý do chặn).

**Checkpoint**: Cả 3 User Story (`REQUEST`, `STANDALONE`, danh sách/chi tiết và chống trùng bền vững) đều hoàn chỉnh và có thể kiểm chứng độc lập.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cập nhật tài liệu kiến trúc/phân quyền, rà soát tuân thủ hiến chương và chạy bộ kiểm tra chất lượng toàn diện.

- [x] T034 [P] Cập nhật ma trận quyền và quy tắc cho 5 endpoint `/api/deliveries/management` (2 role nhà cung cấp, `delivery.manage` cho tạo/options, `delivery.view | delivery.manage | delivery.receive` cho đọc, idempotency và phạm vi `Delivery.schoolId` trực tiếp) trong `docs/AUTHORIZATION.md`.
- [x] T035 [P] Cập nhật quyền sở hữu module `supplier-order` và bảng ánh xạ 5 endpoint `/api/deliveries/management` trong `src/modules/README.md`.
- [x] T036 Rà soát toàn bộ file đã sửa trong `src/modules/supplier-order/`, `src/modules/delivery/`, `src/modules/account-lifecycle/`, `src/modules/warehouse/`, `src/modules/kitchen/`, `src/modules/menu/`, `src/utils/resource-access.ts` và `prisma/` theo `AGENTS.md`: đảm bảo controller và repository không import DTO, service không dựng Prisma query args, serialize tường minh `Date`/`Decimal`/`null` và không lộ `creationKey`/`creationFingerprint`.
- [x] T037 Chạy `npm run prisma:validate`, `npm run prisma:generate`, `npm run validate` và `npm run test:unit` từ thư mục gốc repository, sửa mọi lỗi lint/format/typecheck/build/unit test và ghi kết quả thực tế vào `specs/supplier-order-creation/quickstart.md`.
- [x] T038 Đối chiếu `specs/supplier-order-creation/spec.md`, `specs/supplier-order-creation/plan.md`, `specs/supplier-order-creation/data-model.md`, `specs/supplier-order-creation/contracts/supplier-orders.md` và `specs/supplier-order-creation/tasks.md` để xác nhận bao phủ đầy đủ `FR-001`–`FR-013` và `SC-001`–`SC-005`, kiểm tra không lọt `.specify/feature.json`/credentials/generated files vào git status và hoàn thiện báo cáo tại `specs/supplier-order-creation/quickstart.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1 — T001–T002)**: Không có dependency, bắt đầu ngay.
- **Foundational (Phase 2 — T003–T012)**: Phụ thuộc Phase 1; **CHẶN** toàn bộ việc triển khai các User Story vì cần schema/client Prisma mới, canonical fields, guard tiếp nhận và an toàn nullability cho các module hiện có.
- **User Story 1 (Phase 3 — T013–T018)**: Phụ thuộc Phase 2; cung cấp MVP tạo đơn từ yêu cầu đã tiếp nhận (`REQUEST`).
- **User Story 2 (Phase 4 — T019–T024)**: Phụ thuộc Phase 2 về mặt nghiệp vụ; thực hiện nối tiếp sau US1 trên các file chung của `src/modules/supplier-order/` để tránh xung đột sửa cùng file.
- **User Story 3 (Phase 5 — T025–T033)**: Phụ thuộc Phase 2 và hoàn thiện sau US1/US2 để kiểm chứng đầy đủ danh sách, chi tiết và idempotency/concurrency cho cả hai cách tạo.
- **Polish (Phase 6 — T034–T038)**: Phụ thuộc các phase triển khai code đã hoàn tất.

### User Story Dependencies

- **User Story 1 (P1)**: Bắt đầu ngay sau khi hoàn tất Phase 2; độc lập hoàn toàn với US2.
- **User Story 2 (P1)**: Độc lập nghiệp vụ với US1 (không cần yêu cầu nguồn hoặc đơn `REQUEST`); xếp sau US1 theo thứ tự chỉnh sửa file trong `src/modules/supplier-order/`.
- **User Story 3 (P2)**: Bổ sung danh sách/chi tiết quản trị và hoàn thiện kiểm thử replay/race cho cả `REQUEST` (US1) và `STANDALONE` (US2).

### Task Dependencies

| Nhóm task                                      | Thứ tự / Phụ thuộc bắt buộc                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `T001 -> T002`                                 | Kiểm tra đặc tả và cấu hình trước khi chạm vào schema/code.                                                                    |
| `T003 -> T004`                                 | Cập nhật `prisma/schema.prisma` trước khi viết SQL migration và chạy `prisma:generate`.                                        |
| `T005`, `T006`, `T007`, `T010`                 | Thực hiện sau `T004` (khi client Prisma đã có trường mới); các task khác file có thể chạy song song.                           |
| `T007 -> T008`                                 | Viết/cập nhật guard `SUPPLIER_CREATE_STANDALONE_DELIVERY` cùng unit tests trong `tests/intake-access.test.ts`.                 |
| `T006 -> T009 -> T011`                         | Cập nhật `resource-access.ts` và `delivery`/`warehouse`/`kitchen`/`menu` trước khi chốt regression unit tests ở `T011`.        |
| `T012`                                         | Chốt khung DTO/validation/repository của `src/modules/supplier-order/` trước khi vào US1.                                      |
| `T013 -> T014 -> T015 -> T016 -> T017 -> T018` | Luồng triển khai tuần tự US1 trên module `src/modules/supplier-order/`.                                                        |
| `T019 -> T020 -> T021 -> T022 -> T023 -> T024` | Luồng triển khai tuần tự US2 trên module `src/modules/supplier-order/` sau khi US1 bàn giao file.                              |
| `T025 -> T026 -> T027 -> T028 -> T029`         | Luồng triển khai đọc danh sách/chi tiết và replay idempotency của US3.                                                         |
| `T030`, `T031`, `T032`                         | Sau `T029`; `T030` (`tests/supplier-order-creation.integration.test.ts`) và `T031` (các file integration khác) chạy song song. |
| `T033`                                         | Chạy sau `T005`, `T030`, `T031` khi có PostgreSQL disposable local được ủy quyền.                                              |
| `T034`, `T035` -> `T036 -> T037 -> T038`       | Cập nhật tài liệu song song, sau đó rà soát kiến trúc, chạy `npm run validate` + `npm run test:unit` và chốt báo cáo.          |

### File Ownership When Parallelizing

| Nhóm phụ trách               | File sở hữu độc quyền tại một thời điểm                                                                                                                                                                                          | Quy tắc bàn giao                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Lane A — Schema & Data**   | `prisma/schema.prisma`, `prisma/migrations/20261116000200_supplier_order_creation/migration.sql`, `database/SCHEMA_BASELINE.md`, `src/modules/supplier-order/supplier-order.{validation,request.dto,response.dto,repository}.ts` | Hoàn thành `T003–T004` và `T012` trước khi các lane khác biên dịch theo client/DTO mới.                  |
| **Lane B — Intake Guard**    | `src/modules/account-lifecycle/intake-access.repository.ts`, `src/modules/account-lifecycle/intake-access.service.ts`, `tests/intake-access.test.ts`                                                                             | Hoàn thành `T007–T008` trước khi Lane C nối `createFromRequest` (`T016`) và `createStandalone` (`T022`). |
| **Lane C — Supplier Order**  | `src/modules/supplier-order/supplier-order.{service,controller,routes}.ts`, `tests/supplier-order-creation.test.ts`, `tests/supplier-order-creation.integration.test.ts`                                                         | Nhận hợp đồng từ Lane A và guard từ Lane B; thực hiện lần lượt US1 -> US2 -> US3 để không đụng file.     |
| **Lane D — Downstream/Core** | `src/utils/resource-access.ts`, `src/modules/delivery/*`, `src/modules/warehouse/*`, `src/modules/kitchen/*`, `src/modules/menu/*`, `src/routes/index.ts`, các file test hồi quy và `docs/*`                                     | Cập nhật canonical fields và nullability ở Phase 2 (`T006`, `T009–T011`) và chốt tích hợp ở Phase 6.     |

---

## Parallel Example: Foundational Phase (Phase 2)

```bash
# Sau khi T003 và T004 (schema + migration + prisma:generate) hoàn tất, có thể chạy song song trên các file độc lập:
Task T005: "Mở rộng kiểm thử migration trong tests/migrations.test.ts"
Task T007: "Mở rộng intake guard trong src/modules/account-lifecycle/intake-access.repository.ts và intake-access.service.ts"
Task T010: "Cập nhật nullability nguồn cho warehouse/kitchen/menu trong src/modules/{warehouse,kitchen,menu}/"
```

## Parallel Example: User Story 1

```bash
# Khi bắt đầu Phase 3 (sau T012):
Task T013: "Viết unit/HTTP và repository tests cho nhánh REQUEST trong tests/supplier-order-creation.test.ts"
Task T014: "Triển khai validation và Request DTO cho nhánh REQUEST trong src/modules/supplier-order/supplier-order.validation.ts và supplier-order.request.dto.ts"
```

## Parallel Example: User Story 2

```bash
# Khi bắt đầu Phase 4 (sau T018):
Task T019: "Bổ sung unit/HTTP và repository tests cho options và nhánh STANDALONE trong tests/supplier-order-creation.test.ts"
Task T020: "Mở rộng validation và Request DTO cho nhánh STANDALONE và options trong src/modules/supplier-order/supplier-order.validation.ts và supplier-order.request.dto.ts"
```

## Parallel Example: User Story 3

```bash
# Sau khi hoàn tất code đọc/idempotency (T029), có thể viết kiểm thử tích hợp song song trên các file tách biệt:
Task T030: "Tạo kiểm thử tích hợp PostgreSQL trong tests/supplier-order-creation.integration.test.ts"
Task T031: "Cập nhật fixtures và kịch bản kiểm chứng liên quan trong tests/authorization.integration.test.ts, tests/account-lifecycle.integration.test.ts và tests/kitchen-nutrition-wire.integration.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Hoàn thành Phase 1: Setup (`T001–T002`).
2. Hoàn thành Phase 2: Foundational (`T003–T012`) — bắt buộc để có schema canonical fields và không làm gãy các module hiện có.
3. Hoàn thành Phase 3: User Story 1 (`T013–T018`).
4. **DỪNG VÀ KIỂM CHỨNG**: Chạy unit tests xác nhận tạo đơn từ yêu cầu đã tiếp nhận (`REQUEST`) hoạt động đúng cho cả 2 role nhà cung cấp.

### Incremental Delivery

1. Hoàn tất Setup + Foundational -> Nền tảng dữ liệu và downstream an toàn với `SupplyRequest = null`.
2. Thêm User Story 1 (`REQUEST`) -> Kiểm thử độc lập luồng tạo đơn từ yêu cầu đã tiếp nhận.
3. Thêm User Story 2 (`STANDALONE` + options) -> Kiểm thử độc lập luồng tạo đơn chủ động cho trường liên kết `ACTIVE`.
4. Thêm User Story 3 (Danh sách, chi tiết, idempotency replay & concurrency) -> Kiểm thử toàn diện chống trùng và tra cứu.
5. Hoàn tất Phase 6 (Docs, `npm run validate`, `npm run test:unit`).

---

## Requirement Coverage

| Yêu cầu             | Tasks bao phủ chính                                        |
| ------------------- | ---------------------------------------------------------- |
| `FR-001` – `FR-003` | `T006–T008`, `T013–T017`, `T019–T023`, `T030–T031`         |
| `FR-004` – `FR-007` | `T003–T005`, `T013–T018`, `T019–T024`, `T030`              |
| `FR-008`            | `T006`, `T009–T011`, `T025–T029`, `T034–T035`              |
| `FR-009` – `FR-010` | `T007–T008`, `T015–T016`, `T021–T022`, `T025`, `T028–T033` |
| `FR-011` – `FR-013` | `T006–T011`, `T013–T016`, `T019–T022`, `T025`, `T030–T033` |
| `SC-001` – `SC-005` | `T005`, `T011`, `T018`, `T024`, `T030–T033`, `T037–T038`   |

## Notes

- Tổng số task: **38 tasks** (Phase 1: 2, Phase 2: 10, Phase 3 / US1: 6, Phase 4 / US2: 6, Phase 5 / US3: 9, Phase 6: 5).
- Không có `.specify/extensions.yml` trong repository nên không có pre-hook hoặc post-hook cần kích hoạt.
- Không tự ý chạy migration hoặc kiểm thử tích hợp trên database thành viên hay Azure; các task PostgreSQL (`T005`, `T030`, `T031`, `T033`) chỉ được thực thi khi có PostgreSQL disposable local được ủy quyền qua `MIGRATION_TEST_DATABASE_URL`.

## Regression fix — migration test merge

- [x] T039 Khôi phục hai test migration độc lập bị trộn conflict trong `tests/migrations.test.ts`, giữ coverage single-dish và supplier-order, đặt search_path đúng cho fixture source migration và dọn database con; chạy suite trên PostgreSQL disposable riêng, ghi kết quả trong `specs/supplier-order-creation/quickstart.md`.

## Regression fix — authorization fixtures

- [x] T040 Sửa ba fixture Delivery lịch sử trong `tests/authorization.integration.test.ts` dùng creationMode null thay vì REQUEST thiếu key/hash, giữ kịch bản nhiều phiếu lịch sử trên cùng yêu cầu; chạy lại suite authorization trên PostgreSQL disposable và ghi kết quả tại `specs/supplier-order-creation/quickstart.md`.
