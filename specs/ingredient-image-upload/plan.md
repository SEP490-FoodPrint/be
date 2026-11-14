# Implementation Plan: Upload ảnh nguyên liệu và helper ảnh/tài liệu

**Branch hiện tại**: `feat/ingredient-image-upload` | **Nhánh gốc**: `dev` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: `specs/ingredient-image-upload/spec.md`, gồm 20 FR và các quyết định trong Clarifications.

## Summary

Bổ sung hai endpoint upload ảnh nguyên liệu và bốn hàm dùng chung `uploadImage`, `uploadImages`, `uploadDocument`, `uploadDocuments`. Hàm một tệp nhận đúng một; hàm nhiều nhận 1–5 tệp. Mỗi tệp tối đa 5 MiB. Ảnh JPEG/PNG/WebP được lưu công khai; tài liệu PDF/PNG/JPEG được lưu raw/authenticated. Lượt nhiều tệp kiểm tra toàn bộ đầu vào trước khi upload, sau đó trả trạng thái riêng cho từng tệp theo thứ tự đầu vào; không xóa thành công khi tệp khác lỗi.

Upload chỉ trả kết quả tài nguyên. Luồng JSON tạo/sửa nguyên liệu hiện có lưu URL vào `coverImage`/`imageDescription`; không thay schema, không lưu metadata upload vào DB, không thêm API tài liệu hoặc chuyển đổi onboarding.

## Technical Context

**Language/Version**: Node.js 24.22.1 theo `.nvmrc`, npm 11, TypeScript 6.0.3 strict, CommonJS/Node16 resolution.

**Primary Dependencies**: Express 4.21.x, Zod 4.6.7, Cloudinary 2.11.0, Multer 2.5.0 đã có; dự kiến thêm `sharp` 0.35.5 làm decoder JPEG/PNG/WebP, khóa phiên bản trong package/lock khi triển khai. Không cài dependency ở bước plan.

**Storage**: Cloudinary lưu tệp; PostgreSQL chỉ đọc danh tính/quyền/supplier và tiếp tục lưu URL khi nghiệp vụ tạo/sửa được gọi riêng. Redis tiếp tục phục vụ session/rate limit hiện có; không thêm cache upload.

**Testing**: Node test runner với `tsx --test`, fake upload transport và fake timer; multipart HTTP thật trên server local. Kiểm thử tự động không gọi Cloudinary thật. Không thêm test framework.

**Target Platform**: Backend Node.js/Linux, giữ CommonJS; kiểm tra native dependency Sharp trong môi trường build/CI.

**Project Type**: Web service Express hiện có và thư viện helper nội bộ.

**Performance Goals**: Tối đa hai upload Cloudinary đang chạy mỗi lượt, deadline 30 giây mỗi tệp sau khi bắt đầu gửi; lượt năm tệp tối đa khoảng 90 giây ở pha gửi nếu cả ba đợt hết deadline. Đây không phải SLA cho thời gian nhận body/giải mã hoặc toàn request.

**Constraints**: Tối đa 25 MiB nội dung tệp encoded/lượt nhiều tệp, ngoài multipart overhead. Multer memoryStorage giữ buffer; Sharp/SDK cần thêm bộ nhớ, không cam kết tổng RAM chỉ 25 MiB. Xác minh ảnh tuần tự trước upload; giữ giới hạn an toàn có sẵn của decoder, không vô hiệu hóa hoặc tự thêm giới hạn pixel nghiệp vụ. Không giữ transaction/lock PostgreSQL khi gọi mạng; không auto retry upload.

**Scale/Scope**: Hai API ảnh, bốn hàm tái sử dụng, không thay schema hay số lượng ảnh tham chiếu đang lưu. Giới hạn đồng thời là mỗi lượt, không phải quota toàn hệ thống hoặc khóa phân tán. Giữ limiter Redis chung.

## Constitution Check

_GATE: đánh giá trước research và sau thiết kế._

| Nguyên tắc                    | Trước research    | Sau thiết kế / bằng chứng                                                                                                                                  |
| ----------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Phân lớp                   | PASS              | Controller gọi validation/service; Request DTO `z.infer` và Response DTO tách file; helper không import DTO/Express; repository giữ truy vấn.              |
| II. Phân quyền/tổ chức        | PASS              | Dùng `ingredientManagementScope`; supplier ACTIVE trước multipart; kiểm tra lại actor/supplier sau đọc body và trước upload; không nhận supplierId client. |
| III. An toàn DB               | PASS              | Không model/migration/seed/DDL; không chạy DB hoặc upload thật trong bước plan.                                                                            |
| IV. Transaction/cache/limiter | PASS              | Không đưa upload vào callback Serializable có retry; không lock DB trong network; giữ rate limit và cache hiện tại.                                        |
| V. HTTP/safe projection       | PASS              | Envelope hiện có; allowlist kết quả ảnh/tài liệu; lỗi tiếng Việt; không trả credential/raw SDK response.                                                   |
| VI. Spec-driven               | PASS cho thiết kế | Dùng spec đã clarify; tạo tasks ở bước tiếp theo và chuyển sang nhánh triển khai từ dev trước khi sửa code. Không cần số thứ tự.                           |

Không có ngoại lệ hiến chương. Không có hook before/after plan vì `.specify/extensions.yml` không tồn tại tại lần kiểm tra này.

## Project Structure

### Documentation (this feature)

```text
specs/ingredient-image-upload/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ingredient-upload-api.md
│   └── upload-helper.md
├── checklists/requirements.md
└── tasks.md                  # Tạo bằng speckit-tasks, chưa tạo ở bước plan
```

### Source Code (repository root)

```text
src/utils/
├── cloudinary-upload.ts             # Mới: factory/facade bốn hàm
├── cloudinary-upload.types.ts       # Mới: cấu trúc tệp/scope/asset/result nội bộ
├── cloudinary-client.ts             # Mới: SDK adapter, config, deadline, response guard
└── upload-file-validation.ts        # Mới: MIME/signature/decoder/preflight toàn lượt
src/middlewares/
└── ingredient-upload.middleware.ts  # Mới: multipart single/array, map lỗi
src/modules/ingredient/
├── ingredient.routes.ts             # Hai route và guard trước multipart
├── ingredient.controller.ts         # authorizeUpload + hai action upload
├── ingredient.validation.ts         # Strict body/query + cấu trúc tệp chuẩn hóa
├── ingredient.request.dto.ts        # z.infer cho hai input upload
├── ingredient.response.dto.ts       # Single image + batch result contracts
├── ingredient.service.ts            # Scope/recheck/upload/allowlist mapping
└── ingredient.repository.ts         # actor đọc không bắt buộc transaction
tests/
├── cloudinary-upload.test.ts        # Mới: helper/content/SDK contracts
├── ingredient-upload.test.ts        # Mới: multipart/authorization/service
├── ingredient-management.test.ts    # Regression/typed fixtures
└── authorization.integration.test.ts # Mở rộng khi kiểm thử DB local disposable
```

**Structure Decision**: Mở rộng module ingredient đã đăng ký ở `src/routes/index.ts`; không tạo module upload độc lập. Helper tách validation/transport khỏi nghiệp vụ; không tạo repository giả cho Cloudinary. Thêm hai file test mới vào `package.json::test:unit`; cập nhật package/lock cho Sharp. Khi implement, cập nhật `docs/AUTHORIZATION.md`, `src/modules/README.md` và mô tả cấu hình Cloudinary trong `.env.example` nếu cần, chỉ dùng placeholder.

## Phase 0 — Research

Đã hoàn thành trong [research.md](research.md): phiên bản runtime thật, lựa chọn decoder, Cloudinary image/raw/authenticated, per-call credentials không ảnh hưởng onboarding, timeout, partial success, HTTP envelope và ranh giới phân quyền.

## Phase 1 — Design

### Pipeline và trách nhiệm

1. Global rate limit + CSRF hiện có chạy trước router. Giữ JSON limit, không tăng limit toàn ứng dụng cho multipart.
2. Router management xác thực danh tính và `ingredientManagementScope`. Guard upload gọi service xác minh supplier ACTIVE trước Multer.
3. Middleware chỉ nhận multipart đúng field (`image` hoặc `images`), không text field; giới hạn 1/5 tệp, 5 MiB mỗi tệp ở validator; parser đặt fileSize=MAX_BYTES+1 và parts=maxFiles+1 để không loại nhầm đúng ngưỡng do Busboy, files/fields vẫn giới hạn cứng. Controller gọi strict validator cho body/query và cấu trúc tệp; không import DTO.
4. Service nạp lại actor hiện tại qua repository, so supplierId với principal ban đầu, kiểm role/quyền/supplier ACTIVE. Mở `repo.actor(id, tx?)` để đọc qua client chung khi không có tx; lời gọi ghi hiện có vẫn truyền tx. Chỉ thêm tham số uploader cuối cùng với default vào factory service để giữ cách gọi cũ; điều chỉnh fixture có kiểu `IngredientService` nếu cần.
5. Helper preflight toàn lượt: count, buffer/size, MIME + chữ ký, ảnh giải mã thực tế và context. Đọc/kiểm cấu hình trước lần gửi đầu tiên. Trước mỗi lần khởi tạo lượt upload không có truy vấn/ghi DB trong helper.
6. Adapter dùng `upload_stream`, UUID theo trusted namespace/owner. Bốn helper chia sẻ core. Hai worker/lượt; catch riêng từng tệp, lưu kết quả theo index; tệp lỗi không chặn tệp còn lại.
7. Service map allowlist sang DTO; controller `sendSuccess`. Single thành công HTTP 201; single lỗi upload HTTP 503. Batch xử lý xong HTTP 200 kể cả mọi tệp thất bại; xem `data.results[].status`, không suy luận từ envelope `success`.

Kiểm tra quyền phản ánh trạng thái tại các lần đọc, không hứa thu hồi nguyên tử với dịch vụ bên ngoài nếu quyền đổi sau kiểm tra cuối. Không thêm external upload vào `write()` hoặc retry transaction, không thêm ghi audit DB riêng ngoài phạm vi.

### Quy tắc nội dung và lưu trữ

- Ảnh dùng Sharp đọc metadata và thao tác pixel `stats()` với lỗi decode nghiêm ngặt; metadata/signature đơn thuần không đủ. Với ảnh nhiều frame được hỗ trợ, cấu hình đọc toàn frame và kiểm thử frame sau bị hỏng; không âm thầm xác minh chỉ frame đầu. Upload giữ bytes gốc, không resize/encode lại.
- PNG/JPEG ở nhóm tài liệu cũng qua decoder ảnh. PDF xác minh định dạng bằng MIME và chữ ký `%PDF-`; đây là nhận diện định dạng, không cam kết parse toàn tài liệu. Không bổ sung PDF parser vào phạm vi hiện tại.
- Ảnh: `resource_type=image`, `type=upload`, public_id không đuôi. Tài liệu: `resource_type=raw`, `type=authenticated`, public_id có đuôi pdf/png/jpg. Chặn `existing:true` hoặc response sai identity/type/metadata, không coi asset có sẵn là upload mới thành công.
- Credentials truyền riêng theo operation; không gọi lại `cloudinary.config` từ adapter mới, không chỉnh helper onboarding đang dùng singleton.
- Deadline 30 giây/tệp, settle một lần, dọn timer và bỏ late callback; đóng stream best effort. Không cam kết remote asset không tồn tại sau timeout, không tự retry hoặc xóa.
- Không log buffer, raw SDK error/response, URL ký hoặc secret. Lỗi batch là mã allowlist + thông báo an toàn; giữ error handler chung.

### Validation và thứ tự dependency

1. Xây kiểu nội bộ, validator, adapter, bốn helper và unit tests.
2. Tích hợp middleware + validation/DTO + service/repository/controller/routes.
3. Kiểm thử HTTP, quyền, tương thích create/update và onboarding; cập nhật docs/test registration.
4. Chạy quality gates và ghi kết quả thực tế trong quickstart/tasks khi implement.

Không tạo task checklist ở bước này; phân rã task cụ thể bằng `$speckit-tasks`.

## Complexity Tracking

Không có vi phạm cần xin ngoại lệ. Sharp là dependency giải mã cần để đáp ứng FR-005/FR-017; không thêm DB model, framework test hay dịch vụ nền.
