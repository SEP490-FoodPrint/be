# Implementation Plan: Mã hồ sơ đăng ký dễ đọc

**Branch**: `feat/001-add-registration-id` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)

**Input**: `specs/001-add-registration-id/spec.md`

## Summary

Bổ sung mã public `registrationID` dạng `FP-REG-00001`, dùng chung một dãy số cho hồ sơ trường học và nhà cung cấp. Giữ UUID làm khóa chính và tham chiếu hiện có.

Lưu số nội bộ `registrationNumber` dưới dạng bigint có default PostgreSQL sequence; service định dạng thành mã khi ánh xạ response. Migration mới bổ sung số cho hồ sơ cũ theo `submitted_at, id`, giữ nguyên dữ liệu cũ và khởi tạo sequence nối tiếp. Cập nhật tất cả response có chứa hồ sơ, kể cả summary trong phiên đăng nhập. Không thay giao diện frontend, quyền, thứ tự danh sách hoặc nội dung email.

## Technical Context

**Language/Version**: Node.js 24.22.1 theo .nvmrc; TypeScript 6.0.3 strict; npm 11; CommonJS, Node16 module resolution.

**Primary Dependencies**: Express 4.x, Prisma CLI/Client 7.10.1, @prisma/adapter-pg, pg, Zod 4.x. Dùng dependencies hiện có; không thêm framework hoặc thư viện.

**Storage**: PostgreSQL, schema foodprint; CI dùng PostgreSQL 18. Bổ sung một cột bigint, unique index, CHECK dương và sequence; không thêm business model, custom function hoặc trigger.

**Testing**: Node test runner qua tsx; unit và HTTP tests hiện có; migration/authorization và kiểm thử cấp mã trên database local disposable. Không dùng mock để kết luận tính duy nhất khi ghi đồng thời.

**Target Platform**: Backend Node.js trên môi trường hiện có; phát triển/test trên local, triển khai migration theo workflow dev đã duyệt.

**Project Type**: Web service API; phần hiển thị mã trên ứng dụng quản trị là tích hợp ở kho mã frontend.

**Performance Goals**: Nghiệm thu 100 người nộp độc lập gửi hồ sơ đồng thời; không mã trùng hoặc hồ sơ thành công thiếu mã. Insert dùng default sequence, không thêm truy vấn MAX/count hay khóa counter toàn cục.

**Constraints**: UUID, FK, safe projection, envelope, phân trang, thứ tự UUID hiện tại và phân quyền không đổi. Mã bất biến qua chỉnh sửa/gửi lại/xét duyệt; không yêu cầu dãy số không có khoảng trống. Không chuyển bigint qua Number hoặc trả bigint trong JSON.

**Scale/Scope**: Cả hai loại hồ sơ và ba trạng thái hiện có, tất cả hồ sơ cũ và mới; số có tối thiểu 5 chữ số và mở rộng sau 99999. Dùng dải bigint dương. Không bổ sung tìm kiếm, sort/filter, lịch sử hay báo cáo công khai.

## Constitution Check

Gate được đánh giá trước nghiên cứu và đối chiếu lại sau thiết kế. PASS ở đây xác nhận thiết kế tuân thủ; chưa xác nhận implementation đã qua kiểm thử.

| Nguyên tắc            | Trước nghiên cứu | Sau thiết kế | Cách đáp ứng                                                                                                                                                          |
| --------------------- | ---------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Phân lớp           | PASS             | PASS         | Controller validate; Zod strict/safeParse; Request DTO z.infer và Response DTO riêng; service map allowlist; queries chuyển về repository trong các đường bị tác động |
| II. Phân quyền        | PASS             | PASS         | Giữ AuthPrincipal/SessionUser tin cậy, quyền registration riêng từng hành động, ownership filter; không dùng mã để cấp quyền hoặc tra cứu public                      |
| III. An toàn DB       | PASS             | PASS         | Chỉ thiết kế một migration mới; giữ migration cũ; không kết nối, migrate, seed, introspect hoặc thay dữ liệu trong giai đoạn này                                      |
| IV. Transaction/cache | PASS             | PASS         | Service giữ ranh giới transaction và retry hiện có; repository nhận cùng tx; không dùng Redis/cache để cấp số                                                         |
| V. Hợp đồng đầu ra    | PASS             | PASS         | Public registrationID là string; Date ISO; số nội bộ không lộ; giữ envelope/UUID/FK và trường cũ                                                                      |
| VI. Spec-driven       | PASS             | PASS         | Branch và thư mục 001 khớp; FR-001–FR-012 có thiết kế/kiểm thử; tasks.md được sinh ở bước speckit-tasks trước implementation                                          |

Không cần ngoại lệ hiến chương. Những service hiện còn query/spread sẽ được điều chỉnh trong phạm vi bắt buộc để đưa mã vào các response; không mở rộng sang toàn bộ module auth.

## Project Structure

### Documentation (this feature)

```text
specs/001-add-registration-id/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── registration-id.md
├── tasks.md
└── checklists/
    └── requirements.md
```

`tasks.md` theo dõi các đầu việc triển khai và kết quả kiểm chứng.

### Source Code (repository root)

Các đường dẫn sau là phạm vi thay đổi dự kiến, chưa được sửa trong giai đoạn lập kế hoạch:

```text
prisma/
├── schema.prisma
└── migrations/20261106000100_registration_number/migration.sql
src/
├── modules/
│   ├── registration/
│   │   ├── registration.select.ts
│   │   ├── registration.service.ts
│   │   └── registration.response.dto.ts
│   └── auth/
│       ├── auth.request.dto.ts
│       ├── auth.response.dto.ts
│       ├── onboarding.repository.ts
│       ├── onboarding.service.ts
│       ├── onboarding.validation.ts
│       ├── onboarding-submission.ts
│       ├── onboarding.controller.ts
│       ├── registration-review.ts
│       ├── session.repository.ts
│       ├── session.service.ts
│       ├── session.validation.ts
│       ├── session.controller.ts
│       ├── profile.repository.ts
│       ├── profile.service.ts
│       └── profile.validation.ts
├── middlewares/error.middleware.ts
├── types/session-user.ts
└── utils/
    ├── registration-id.ts
    ├── request-validation.ts
    └── session-identity.ts
tests/
├── registration-id.test.ts
├── registration-id.integration.test.ts
├── modules.test.ts
├── onboarding.test.ts
├── registration-review.test.ts
├── auth-session.test.ts
├── authorization.integration.test.ts
└── migrations.test.ts
```

**Structure Decision**: Giữ cấu trúc module hiện tại. Hai file auth DTO phục vụ những luồng auth bị tác động; chỉ service consume DTO. Formatter dùng chung chỉ chuyển một scalar bigint thành mã, không chứa mapping DTO. Repository mới gom các truy vấn đang nằm trong onboarding/session/profile service; dùng Prisma client dùng chung và tx được truyền vào. Cập nhật package.json, CI và database/SCHEMA_BASELINE.md khi triển khai để đăng ký kiểm thử và ghi trạng thái migration trung thực.

## Phase 0 — Research (completed)

Các quyết định và phương án đã loại nằm trong [research.md](research.md):

1. Bigint sequence nội bộ; registrationID public được định dạng trong service.
2. Sequence CACHE 1, NO CYCLE; không dùng MAX+1, Redis hoặc bộ đếm ứng dụng.
3. Migration khóa bảng, đánh số có thứ tự, khởi tạo đúng cho bảng rỗng/không rỗng.
4. Bao phủ nested registrationRequest trong session; tách dữ liệu nội bộ khỏi response.
5. Giữ projection hash reviewVersion cũ để bigint không gây lỗi và mã mới không làm thay đổi phiên bản hồ sơ không đổi nội dung.
6. Refactor tối thiểu các đường bị tác động theo quy tắc repository/validation/DTO.

Không còn quyết định kỹ thuật chưa giải quyết.

## Phase 1 — Design & Contracts (completed)

### Persistence và migration

Thiết kế trường, sequence, constraints và lifecycle nằm trong [data-model.md](data-model.md). Một migration mới có transaction tường minh; khóa registration_requests trước backfill và giữ đến commit. Thêm cột chưa có default, gán row_number theo submitted_at/id, sau đó gắn default và constraints. Không cập nhật timestamp hoặc JSON.

Đồng bộ sequence theo max số đã gán, có nhánh riêng cho bảng rỗng. Kiểm tra migration không thay đổi UUID, FK, partial indexes, timestamps và bất kỳ cột cũ nào. Không cấp mã ở startup. Migration thực tế cần được review và áp dụng qua quy trình được phép; việc lập plan không thực hiện thay đổi DB.

### Luồng tạo, chỉnh sửa và xét duyệt

- Controller chuẩn hóa request trước khi gọi service; service nhận Request DTO.
- Giữ hai transaction submission hiện có bao quanh bước upload: kiểm tra snapshot trước upload, recheck người nộp và hồ sơ trong transaction ghi; giữ cleanup sau commit và bù upload mới khi ghi thất bại.
- Khi chưa có hồ sơ, repository insert không truyền registrationNumber; default cấp số. Khi cập nhật/gửi lại, update không ghi trường này.
- Giữ thứ tự khóa applicant trước hồ sơ, optimistic version và retry giới hạn của authorizationTransaction.
- Approve/reject giữ một transaction cho reload actor/target, tổ chức/chứng nhận, tài khoản, quyết định và outbox. Mọi thao tác repository tham gia dùng cùng tx; không có transaction ghi riêng bên trong repository.
- Giữ kiểm tra quyền trong service, scope tin cậy truyền vào repository và áp vào WHERE. Giữ đường đọc tài liệu của supplier được duyệt và kiểm tra ownership chứng nhận.
- Các mapper trong onboarding.service trả trường tường minh, thêm registrationID, chuyển Date ISO và chỉ trả metadata tài liệu đã duyệt.

### Session và dữ liệu public

Chọn thêm số vào summary nội bộ trong session-identity; SessionUser nội bộ giữ bigint. Mapper public toSessionUserResponseDTO nằm trong session.service, dùng cho login, refresh, method trả hồ sơ cho GET me và kết quả profile.update. currentUser dùng cho middleware vẫn trả kiểu nội bộ; GET me controller gọi method mapping thay gửi thẳng req.sessionUser.

Giữ trạng thái ACTIVE/UNVERIFIED, quyền của ACTIVE và việc UNVERIFIED không có permissions. Không đổi JWT, cookie, Redis session record hoặc cơ chế nạp lại quyền. Null summary vẫn là null.

### Validation và hợp đồng

Chi tiết response, endpoint và lỗi nằm trong [contracts/registration-id.md](contracts/registration-id.md).

Dùng Zod strictObject và safeParse cho input bị tác động; Request DTO lấy z.infer bằng type-only schema imports trong auth.request.dto.ts. Di chuyển parsing HTTP khỏi service; không thêm field nghiệp vụ. Giữ normalization, giới hạn, default, nullable, dates, uniqueness certificates và expectedUpdatedAt đang được chấp nhận. Login/profile được đổi biểu diễn schema để service dùng Request DTO nhưng không đổi giá trị hợp lệ.

Helper request-validation tổng hợp lỗi tiếng Việt với field path, không chứa input thô. Error middleware chỉ thêm xử lý typed validation error qua sendError; giữ hành vi các lỗi hiện có. Không import DTO ở controller, validator hoặc repository.

## Implementation Sequence (next phase)

1. Sinh tasks.md từ bộ thiết kế; cập nhật đúng dependency và đối chiếu spec trước khi viết code.
2. Thêm schema/migration và kiểm thử migration trên DB disposable được chọn rõ ràng; xác minh Prisma drift/constraints.
3. Thêm formatter, DTO và repository; refactor những đường onboarding/session/profile bị tác động, giữ hành vi và transaction.
4. Bổ sung field ở mọi response và strict validation; kiểm tra reviewVersion tương thích.
5. Chạy các kiểm thử unit, migration, authorization, concurrency và quality gate; hoàn thiện tài liệu rollout.
6. Review migration/PR vào dev; migration/backfill trước backend mới, sau đó frontend dùng registrationID.

## Verification Strategy

| Yêu cầu        | Bằng chứng nghiệm thu dự kiến                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| FR-001–FR-003  | Formatter cho 1/9/10/99999/100000 và bigint vượt Number.MAX_SAFE_INTEGER; hai loại hồ sơ dùng chung dãy                    |
| FR-004         | JSON/multipart/nested injection bị 400 trước upload cloud hoặc ghi DB; không cấp số khi validation thất bại                |
| FR-005, FR-012 | PostgreSQL thật: 100 người nộp độc lập đồng thời, constraints, rollback không tái dùng số và không báo thành công thiếu mã |
| FR-006         | Edit/reject/resubmit/approve giữ mã và không gọi insert/allocator cho update                                               |
| FR-007         | Danh sách, chi tiết, own/submit/review và nested summary login/refresh/me/PATCH me; JSON không có bigint/số nội bộ         |
| FR-008–FR-009  | Upgrade DB cũ, trùng submitted_at, đủ loại/trạng thái; so sánh mọi cột cũ và số kế tiếp; database rỗng                     |
| FR-010         | UUID/FK/document paths/orderBy id/pagination/envelope giữ nguyên; hash reviewVersion không đổi khi chỉ thêm số             |
| FR-011         | Quyền view/approve/reject độc lập, reload actor/target trong tx, own/foreign scope và thiếu quyền giữ nguyên               |

Dùng tests/migrations.test.ts cho backfill/constraints/drift; bổ sung fixture ở trạng thái ngay trước migration mới trong database riêng, không cố mô phỏng upgrade trên schema đã có cột. tests/registration-id.integration.test.ts dùng harness tạo database con ngẫu nhiên trong instance local được chọn rõ ràng, storage test và người nộp độc lập để kiểm chứng cấp số thật. Không dùng database thành viên, Azure hoặc cloud storage thật.

Đăng ký test unit mới vào test:unit, test integration mới vào script test:registration-id và job PostgreSQL trong CI. Giữ các bộ test hiện có. [quickstart.md](quickstart.md) là hướng dẫn chạy và đối chiếu kết quả; không ghi PASS cho kiểm thử chưa thực hiện.

## Rollout & Recovery

- Review migration và diễn tập trên disposable PostgreSQL; kiểm tra thời gian backfill và khoảng khóa bảng theo dữ liệu thực tế trước rollout.
- Kiểm tra quyền runtime trên sequence nếu dùng DB role khác migration owner.
- Áp migration/backfill theo quy trình đã duyệt trước backend mới. Backend cũ bỏ qua cột mới vẫn được database cấp số khi insert.
- Sau đó đưa backend mới trả registrationID và tích hợp ứng dụng quản trị; frontend tiếp tục dùng id UUID khi điều hướng/gọi thao tác.
- Nếu cần rollback ứng dụng, giữ cột, sequence và mã đã cấp; không xóa, reset hoặc đánh số lại. Xử lý migration lỗi theo quy trình hiện có, không tự sửa lịch sử applied.
- Chỉ cập nhật trạng thái triển khai trong SCHEMA_BASELINE.md sau khi có bằng chứng thực tế. Giai đoạn hiện tại chỉ tạo tài liệu thiết kế.

## Complexity Tracking

Không có ngoại lệ hiến chương. Bigint và mapping session cần thiết để đáp ứng độ dài mở rộng, tính duy nhất và FR-007; không thêm framework, business model, cache, endpoint hoặc luồng nghiệp vụ mới.
