# Research: Mã hồ sơ đăng ký dễ đọc

**Date**: 2026-11-06  
**Spec**: [spec.md](spec.md)

Nghiên cứu dựa trên mã hiện có và tài liệu chính thức. Chưa sửa code, chạy SQL hoặc kết nối cơ sở dữ liệu trong giai đoạn lập kế hoạch.

## 1. Lưu số nội bộ, xuất mã dạng chuỗi

**Decision**: Thêm `RegistrationRequest.registrationNumber` kiểu Prisma `BigInt`, ánh xạ cột `registration_number`, bắt buộc, unique và có default `autoincrement()`. Giữ UUID `id` làm khóa chính. Response xuất đúng tên `registrationID: string`, được định dạng bằng phần thập phân của số nội bộ, thêm số 0 bên trái đến tối thiểu 5 chữ số và tiền tố `FP-REG-`.

**Rationale**: Một nguồn dữ liệu cho số thứ tự, không lưu trùng chuỗi định dạng. Formatter dùng bigint trực tiếp qua `toString().padStart(5, "0")`, không chuyển qua Number, nên không làm mất độ chính xác và không cắt `100000`. Đây là lựa chọn thiết kế; validation schema và kiểm tra drift trên Prisma đã khóa phiên bản vẫn là bước triển khai bắt buộc.

**Alternatives considered**: Lưu chuỗi với SQL default làm phức tạp kiểm tra định dạng và schema drift; lưu cả số lẫn chuỗi tạo dữ liệu trùng lặp. UUID rút gọn không đáp ứng đánh số tăng.

**Evidence**: [schema hiện tại](../../prisma/schema.prisma), [Prisma schema reference v7](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference).

## 2. Cấp số đồng thời bằng sequence PostgreSQL

**Decision**: Default cột dùng sequence bigint do PostgreSQL quản lý, thuộc schema `foodprint`, tên `registration_requests_registration_number_seq`, gắn ownership vào cột; cấu hình tăng 1, bắt đầu 1, minimum 1, `CACHE 1`, `NO CYCLE`. Repository tạo hồ sơ bằng cách bỏ qua trường số để default cấp số; không gọi allocator khi cập nhật hồ sơ.

**Rationale**: Sequence cấp giá trị khác nhau giữa các phiên đồng thời và không thu hồi số khi transaction thất bại. `CACHE 1` giữ thứ tự tăng theo lần cấp toàn hệ thống; chấp nhận khoảng trống và không suy ra thứ tự commit. Chỉ đưa mã ra phản hồi sau khi transaction lưu hồ sơ thành công. [PostgreSQL sequence functions](https://www.postgresql.org/docs/18/functions-sequence.html), [CREATE SEQUENCE](https://www.postgresql.org/docs/18/sql-createsequence.html).

**Alternatives considered**: `MAX + 1` và đếm bản ghi có race condition; bộ đếm trong tiến trình không bảo đảm nhiều instance; Redis counter thêm phụ thuộc và cơ chế phục hồi; counter table làm các lần nộp phải chờ cùng một khóa. Không cần function hoặc trigger do dự án tự định nghĩa.

## 3. Bổ sung mã cho hồ sơ cũ trong một migration

**Decision**: Migration mới dùng transaction tường minh và khóa bảng xuyên suốt. Thêm cột nullable chưa có default, gán số bằng `row_number()` theo `submitted_at ASC, id ASC`, sau đó hoàn thiện sequence/default, NOT NULL, unique và CHECK dương. Chỉ cập nhật cột mới.

**Rationale**: Default auto-increment gắn ngay khi thêm cột có thể đánh số theo thứ tự vật lý; không đáp ứng thứ tự nghiệm thu. Khóa bảng ngăn insert xen giữa bổ sung số và khởi tạo sequence. SQL cập nhật riêng cột mới giữ nguyên timestamps vì không đi qua Prisma `@updatedAt`. Bảng không rỗng khởi tạo sequence tại số lớn nhất với `is_called = true`; bảng rỗng khởi tạo tại 1 với `is_called = false`. [Window functions](https://www.postgresql.org/docs/18/functions-window.html), [ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html).

**Alternatives considered**: Cấp mã khi đọc hoặc khi khởi động ứng dụng làm hồ sơ cũ thiếu mã trong giai đoạn chuyển tiếp; script riêng không nằm trong lịch sử migration khó kiểm soát thứ tự triển khai. Không sửa migration đã áp dụng.

## 4. Phạm vi response rộng hơn danh sách

**Decision**: Cập nhật danh sách, chi tiết, own/submit/approve/reject và summary `registrationRequest` trong login, refresh, GET/PATCH me. Kết quả tài liệu vẫn chỉ có URL và thời hạn.

**Rationale**: [onboarding.service.ts](../../src/modules/auth/onboarding.service.ts) đang phục vụ toàn bộ vòng đời, còn [session-identity.ts](../../src/utils/session-identity.ts) chọn summary hồ sơ được trả cùng SessionUser. Chỉ thêm ở registration list sẽ bỏ sót FR-007.

**Alternatives considered**: Chỉ sửa danh sách không bảo đảm cùng mã khi mở chi tiết hoặc xem hồ sơ cá nhân. Không mở thêm endpoint tra cứu theo mã.

## 5. Kiểm soát bigint và reviewVersion

**Decision**: Mọi response dùng allowlist trong service và chuyển ngày sang ISO; không trả số bigint nội bộ. Formatter scalar dùng chung ở `src/utils/registration-id.ts`, không phải mapper DTO. `reviewVersion()` dùng projection tường minh của đúng các trường đã tham gia hash trước tính năng, không thêm `registrationNumber` bất biến.

**Rationale**: `view()` hiện spread persistence fields; thêm bigint mà giữ cách này sẽ gây lỗi JSON. Hash hiện cũng JSON.stringify toàn projection. Loại trường mới khỏi hash giữ phiên bản cho hồ sơ không đổi nội dung sau migration, đồng thời vẫn phát hiện thay đổi liên hệ, nội dung và tài liệu. [Prisma BigInt serialization](https://www.prisma.io/docs/orm/v7/prisma-client/special-fields-and-types#working-with-bigint), [registration-review.ts](../../src/modules/auth/registration-review.ts).

**Alternatives considered**: Chuyển bigint sang Number mất độ chính xác; monkey-patch BigInt hoặc JSON toàn cục ảnh hưởng ngoài phạm vi; thay đổi hash bằng trường bất biến không đem lại bảo vệ bổ sung.

## 6. Tách lớp trong những luồng bị tác động

**Decision**: Bổ sung repository cho onboarding, session và profile để đưa các truy vấn đang nằm trong những service bị sửa về đúng lớp. Dùng `auth.request.dto.ts` và `auth.response.dto.ts` tách biệt cho hợp đồng auth bị tác động; request types suy ra từ Zod schemas. Mapping session public nằm trong session service và được profile service tái sử dụng. `currentUser()` dùng cho middleware tiếp tục trả SessionUser nội bộ.

**Rationale**: [AGENTS.md](../../AGENTS.md) yêu cầu service không chứa truy vấn, chỉ service consume DTO và ánh xạ kết quả tường minh. Refactor giới hạn vào những đường phải bổ sung mã, không thay đổi nghiệp vụ login, profile, upload, phê duyệt hoặc email.

**Alternatives considered**: Giữ spread và thêm field tại controller vi phạm nguyên tắc phân lớp; refactor toàn bộ auth sẽ mở rộng phạm vi không cần thiết.

## 7. Validation giữ hợp đồng hiện tại

**Decision**: Controller parse input với Zod strict và safeParse trước khi gọi service. Giữ nguyên dạng JSON phẳng và multipart có một trường `profile` chứa JSON; loại hồ sơ lấy từ SessionUser tin cậy. Giữ strict ở root, wrapper, certification và retained document. Không nhận `registrationID` hoặc `registrationNumber` do client gửi.

**Rationale**: Các validator hiện tại đã từ chối trường lạ nhưng phần lớn còn chạy trong service. Chuyển vị trí và biểu diễn validation phải giữ normalization, null handling, giới hạn, ngày lịch và kiểm tra trùng hiện có; lỗi tổng hợp có tiếng Việt và đường dẫn trường, không kèm giá trị thô. Ownership phụ thuộc dữ liệu vẫn kiểm tra trong service.

**Alternatives considered**: Chỉ xóa trường do client gửi sẽ âm thầm chấp nhận thao tác tự gán mã; nhận thêm requestType/profileData làm thay đổi hợp đồng chưa được yêu cầu.

## 8. Kiểm thử và triển khai

**Decision**: Unit kiểm tra định dạng, mapping, validation và hash; PostgreSQL disposable kiểm tra migration, tính duy nhất, rollback và 100 người nộp đồng thời. Migration/backfill chạy trước backend mới; frontend dùng trường mới sau khi backend sẵn sàng.

**Rationale**: Mock không chứng minh được concurrency hoặc sequence. Default ở database vẫn cấp số cho backend cũ đang bỏ qua cột mới trong giai đoạn chuyển tiếp. Cần dự kiến khoảng khóa bảng, kiểm tra quyền USAGE sequence của runtime nếu khác migration owner và giữ mã khi rollback ứng dụng. Dùng harness [migrations.test.ts](../../tests/migrations.test.ts), [authorization.integration.test.ts](../../tests/authorization.integration.test.ts) và PostgreSQL 18 trong CI.

**Alternatives considered**: Đưa backend mới lên trước migration gây lỗi thiếu cột; reset hoặc rollback schema làm mất mã đã cấp. Không sử dụng cơ sở dữ liệu thành viên hoặc Azure để thử nghiệm.

## Research Outcome

Đã giải quyết các quyết định kỹ thuật cần thiết. Không còn câu hỏi chặn thiết kế. Tính tương thích schema, drift và hành vi runtime phải được kiểm chứng ở giai đoạn triển khai; tài liệu này không xác nhận đã chạy các kiểm thử đó.
