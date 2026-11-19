# Tasks: Phân Nhóm Bộ Phận Duyệt Nguyên Liệu Đầu Vào (Delivery Inspection Tiers)

**Input**: Design documents from `/specs/delivery-inspection-tiers/`

**Prerequisites**: `spec.md`, `plan.md`

## Phase 1: Database & Foundation

- [x] T001 Cập nhật `prisma/schema.prisma` với enum `DeliveryInspectionTier`, model `SchoolDeliveryInspectionRole`, `DeliveryInspectionRole` và relations.
- [x] T002 Tạo migration SQL `prisma/migrations/20261123000100_delivery_inspection_tiers/migration.sql`.
- [x] T003 Thêm permission `school_delivery_inspection.manage` và catalog constants vào `src/constants/permission-catalog.ts`.
- [x] T004 Tạo module constants `src/constants/delivery-inspection.ts` với `DEFAULT_INSPECTION_TIERS` (Bếp = PRIMARY, Kho & Dinh dưỡng = REQUIRED, Phụ huynh = OPTIONAL) và helper resolution.

## Phase 2: Organization Module (Config API)

- [x] T005 Tạo Zod validation `validateDeliveryInspectionRoles` trong `src/modules/organization/organization.validation.ts` và Request DTO trong `src/modules/organization/organization.request.dto.ts`.
- [x] T006 Tạo Response DTO `DeliveryInspectionRolesResponseDTO` trong `src/modules/organization/organization.response.dto.ts`.
- [x] T007 Cập nhật `src/modules/organization/organization.repository.ts` với các hàm `findDeliveryInspectionRoles`, `findRoleIdsByCodes`, `replaceDeliveryInspectionRoles`.
- [x] T008 Cập nhật `src/modules/organization/organization.service.ts` với logic `getDeliveryInspectionRoles`, `updateDeliveryInspectionRoles`, kiểm tra quyền BGH.
- [x] T009 Thêm controller handlers và routes `GET /api/schools/me/delivery-inspection-roles` và `PUT /api/schools/me/delivery-inspection-roles` trong `src/modules/organization/organization.controller.ts` và `src/modules/organization/organization.routes.ts`.

## Phase 3: Delivery Inspection Module (Arrival, Inspection, Snapshot)

- [x] T010 Cập nhật `src/modules/delivery/delivery.repository.ts` hỗ trợ select snapshot, tìm snapshot/cấu hình, tạo snapshot và sửa logic `status: "REJECTED"` cho cap3 / SupplyRequest.
- [x] T011 Cập nhật `src/modules/delivery/delivery.service.ts`:
  - `arrive`: Chỉ role PRIMARY được bấm xe đến, tạo snapshot `delivery_inspection_roles` 4 dòng.
  - `decide`: Hoàn tất khi PRIMARY + mọi REQUIRED duyệt APPROVE; REJECT của OPTIONAL không làm hỏng đợt và không tính cap3; fallback đợt legacy.
  - `inspectionDTO`: Thêm `tier`, `tierLabel`, `currentTier`, `canConfirmArrival`, `approvalSummary`.
- [x] T012 Cập nhật `src/modules/delivery/delivery.response.dto.ts` với các trường mới của `inspectionDTO`.

## Phase 4: Backend Testing & Documentation

- [x] T013 Tạo unit test `tests/delivery-inspection-tiers.test.ts` (kịch bản T1–T15) và cập nhật các unit test cũ phụ thuộc logic 4 role (`tests/delivery-inspections.test.ts`).
- [x] T014 Đăng ký `tests/delivery-inspection-tiers.test.ts` trong `package.json` (`test:unit`).
- [x] T015 Cập nhật tài liệu `docs/AUTHORIZATION.md` và `src/modules/README.md`.

## Phase 5: Frontend Implementation

- [x] T016 Cập nhật `src/services/SchoolService/urls.js` và `index.js`.
- [x] T017 Cập nhật `src/router/ROUTER.js`, `AppRouter.jsx`, và `MenuItem.jsx` (thêm mục BGH "Phân quyền duyệt nguyên liệu").
- [x] T018 Xây dựng trang mới `src/pages/SCHOOL/DeliveryInspectionRoles/` (`index.jsx`, `component/`, `.module.scss`).
- [x] T019 Cập nhật màn `IngredientInspect` (`DeliveryDetailView.jsx`, `index.jsx`, `deliveryGroups.js`, `DeliveryApprovalModal.jsx`, v.v.).

## Phase 6: Verification

- [x] T020 Chạy toàn bộ kiểm tra BE (`npm run prisma:validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run test:unit`, `npm run lint`, `npm run build`).
- [x] T021 Chạy `npm run build` trong `FoodPrintFE`.
- [x] T022 Chạy script `node .github/scripts/spec-gate.mjs` để đảm bảo spec gate PASS.
