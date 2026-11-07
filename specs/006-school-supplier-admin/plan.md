# Implementation Plan: Tra cứu và xem chi tiết trường học, nhà cung cấp

**Branch**: `feat/006-school-list` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-school-supplier-admin/spec.md`

## Summary

Mở rộng hai danh sách hiện có bằng tìm kiếm, lọc trạng thái, thông tin liên hệ và tổng sau lọc. Thêm tổng quan, chi tiết theo định danh, ba nhóm dữ liệu trường và chứng nhận nhà cung cấp kèm nhiều tệp minh chứng. Dùng module hiện có, tách quyền từng nhóm; repository truy vấn có scope, service ánh xạ DTO. Không thay schema, migration hoặc catalog quyền.

## Technical Context

**Language/Version**: TypeScript strict 6.0.3, Node.js theo .nvmrc và engines >=24.22.1 <25; CommonJS, Node16 resolution.

**Primary Dependencies**: Express, Zod, Prisma 7.10.1/PostgreSQL adapter theo lockfile, DocumentStorage/Cloudinary hiện có. Không thêm hoặc nâng thư viện.

**Storage**: PostgreSQL schema foodprint; metadata JSON RegistrationRequest và authenticated assets hiện có. Redis tiếp tục phục vụ phiên/rate limit; không thêm cache.

**Testing**: Node test runner qua tsx; unit/HTTP dependency injection; integration dùng harness PostgreSQL local tạm và storage giả lập.

**Target Platform**: Backend Linux, HTTP dưới /api.

**Project Type**: Web service.

**Performance Goals**: Tối đa 100 dòng/trang; lọc/count tại DB, batch metadata một trang thay vì N+1. Bộ kiểm chứng ít nhất 100 đơn vị mỗi loại. Spec không đặt SLA độ trễ/tải đồng thời, không tự thêm cam kết.

**Constraints**: Giữ envelope, scope và endpoint cũ; strict validation; thiếu quyền 403, ngoài phạm vi 404; count/items cùng snapshot; không gọi provider trong DB transaction.

**Scale/Scope**: Hai list mở rộng, hai summary, hai detail, ba nhóm trường, một nhóm chứng nhận và một thao tác mở tệp. Không frontend, CRUD, sắp xếp tùy chọn hoặc chỉ số hoạt động SA-08.

## Constitution Check

Gate trước Phase 0 và kiểm tra lại sau Phase 1:

| Nguyên tắc                       | Thiết kế đáp ứng                                                                                                                                 | Trước nghiên cứu | Sau thiết kế |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ------------ |
| I. Phân lớp                      | Controller → validation/service; Zod strictObject/safeParse; Request DTO z.infer tách Response DTO; repository sở hữu query; mapping tại service | PASS             | PASS         |
| II. Quyền/tenant                 | Service lấy trusted scope từ resource-access; repository AND scope với selector; summary SYSTEM_ADMIN + quyền; nhóm con giữ quyền riêng          | PASS             | PASS         |
| III. DB an toàn                  | Chỉ dùng model/cột/metadata hiện có; không migration, seed, introspection, DDL hay thao tác Azure                                                | PASS             | PASS         |
| IV. Transaction/cache/rate limit | Service mở read transaction RepeatableRead, truyền cùng tx cho repository; không thêm cache hoặc sửa limiter/session                             | PASS             | PASS         |
| V. Đầu ra                        | sendSuccess/sendError, allowlist, ISO dates; minh chứng riêng tư, URL 60 giây/no-store                                                           | PASS             | PASS         |
| VI. Spec-driven                  | Feature 006 cùng số branch; FR-001–023 được truy vết; sinh tasks trước code                                                                      | PASS             | PASS         |

Setup-plan trả nhãn feature `006-school-supplier-admin` ở BRANCH; Git thực tế là `feat/006-school-list`. Spec gate đối chiếu số 006, không yêu cầu slug trùng nhau. Không có ngoại lệ cần phê duyệt.

## Project Structure

### Documentation (this feature)

```text
specs/006-school-supplier-admin/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/admin-directory.md
└── checklists/requirements.md
```

tasks.md thuộc bước speckit-tasks tiếp theo.

### Source Code (repository root)

```text
src/modules/organization/            # School list/summary/detail, router trường
src/modules/supplier/                # Supplier list/summary/detail, router supplier
src/modules/class/                   # Lớp theo trường
src/modules/school-supplier/         # Liên kết theo trường
src/modules/user/                    # Tài khoản theo trường
src/modules/supplier-certification/  # Chứng nhận, metadata và mở tệp
src/utils/resource-access.ts         # Chính sách scope hiện có
src/utils/read-transaction.ts        # Helper dùng shared client/RepeatableRead (mới)
src/utils/onboarding-documents.ts    # Parse metadata và storage adapter
src/routes/index.ts
tests/school-supplier-admin.test.ts  # Mới, không hạ tầng
tests/authorization.integration.test.ts
tests/modules.test.ts
tests/onboarding.test.ts
```

**Structure Decision**: Dùng module sở hữu dữ liệu, không tạo service quản trị tổng hợp. Các module được sửa phải đủ routes/controller/validation/service/repository/request.dto/response.dto theo AGENTS.md. organization đã có repository/DTO; các module còn lại bổ sung phần thiếu trong đường đọc được chạm tới. Giữ factory/injection và tương thích router/test cũ.

## Phase 0 — Research

Đã giải quyết các quyết định về scope, endpoint con, count snapshot, search literal và ownership nhiều tệp trong [research.md](research.md).

## Phase 1 — Design

### Validation và hợp đồng

- Hai list dùng strict query page/limit/search/status, trim trước max 255, blank thành undefined. Nhóm con chỉ page/limit; detail/summary/document query rỗng.
- Params strict object UUID; validation gom lỗi với field path, message tiếng Việt cố định, không nội suy giá trị hoặc tên query lạ. Không mở rộng parser mọi list không liên quan.
- Request DTO mỗi module dùng z.infer với type-only schema import, chỉ service tiêu thụ. Controller không import DTO.
- Hợp đồng và projection đầy đủ: [contracts/admin-directory.md](contracts/admin-directory.md).

### Quyền, scope và routes

- Service gọi listScopes từ resource-access trước I/O, truyền trusted scope sang repository; repository AND scope với target/filter. Service không dựng where/select/include.
- Summary kiểm tra role/org bằng ROLES/ORG_TYPES và quyền loại đơn vị; không bypass SYSTEM.
- Nhóm con kiểm tra chính quyền nhóm; không đặt school.manage/supplier.view bao trùm routes con. Parent existence được kiểm tra trong scope nhóm: SYSTEM toàn bộ, SCHOOL own, SUPPLIER theo ownership/quan hệ được phép.
- Với nhóm quan hệ, SUPPLIER chỉ thấy parent trường có ít nhất một quan hệ của supplier hiện tại, gồm mọi trạng thái theo policy school-supplier. SUPPLIER không có scope lớp hoặc tài khoản trường. Parent ngoài scope/không tồn tại → 404; parent hợp lệ nhưng nhóm trống → 200.
- Route tĩnh public/me/summary đứng trước /:id. Router trường/supplier mount handler từ module con; không sao chép nghiệp vụ vào service parent.

### Truy vấn và mapping

- Predicate dùng chung cho count/items: scope AND status AND (name OR code/taxCode); contains insensitive, escape backslash rồi % và _. Integration PostgreSQL chứng minh literal/case/dấu.
- Service dùng helper withReadTransaction trong src/utils/read-transaction.ts để mở read transaction RepeatableRead trên shared client, chuẩn hóa lỗi hạ tầng mà giữ HttpError. Helper chỉ quản lý transaction, không chứa query nghiệp vụ. Parent/count/items/batch metadata trong cùng response dùng cùng tx; repository không mở transaction riêng.
- take=limit, skip=(page-1)*limit, orderBy id asc; hasNext = skip + items.length < total. Summary count total/ACTIVE cùng snapshot.
- Service ánh xạ allowlist; Date → toISOString, null giữ null; Role.code/name cho nhãn vai trò; không trả raw DB records.
- Generic classes/users/relationships/certifications giữ query page/limit và trường cũ; logic nhóm con mới không tự mở query generic.

### Minh chứng

- Batch đọc hồ sơ APPROVED/SUPPLIER theo anchor documentUrl của trang chứng nhận.
- Chỉ nhận anchor nội bộ đúng mẫu; readDocuments xác thực metadata; certificate_N phải trỏ phần tử certifications hiện hữu. Nhóm chứa anchor xác định các sibling file; kiểm tra ID không trùng, bytes safe integer dương và format pdf/png/jpg trước khi xuất metadata. Không dùng applicant.supplierId hiện tại làm quyền.
- Anchor/metadata thiếu, sai hoặc không rõ ràng → documents=[]; mở tệp không thuộc nhóm → 404. Hạ tầng DB/storage lỗi → 503.
- Kiểm tra chứng nhận theo scope và tệp trước khi gọi DocumentStorage.download ngoài transaction; URL 60 giây, Cache-Control no-store. Endpoint review hồ sơ cũ giữ quyền riêng.
- Không fetch URL tùy ý, không trả publicId/profileData hoặc metadata nội bộ.

### Thứ tự triển khai và kiểm chứng

1. Validation/DTO/repository cho các luồng được sửa; giữ factory injection và API cũ.
2. Hai list/summary/detail, kiểm chứng search/count/null/snapshot.
3. Ba nhóm trường với quyền riêng và parent scope.
4. Certification list, batch metadata và file access.
5. Unit/HTTP mới vào test:unit; mở rộng authorization integration; cập nhật docs/AUTHORIZATION.md, src/modules/README.md và hướng dẫn API.

FR-001–006 → bước 1–2; FR-007–010 → bước 2; FR-011–014 → bước 3; FR-015–018 → bước 4; FR-019–023 → mọi bước. SC-001–006 đối chiếu [quickstart.md](quickstart.md).

## Complexity Tracking

Không có vi phạm hiến chương cần biện minh.
