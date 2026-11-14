# Research: Quản lý cơ sở cung cấp nguyên liệu

**Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

## R01 — Phạm vi quản trị

**Decision**: Hoàn thiện trực tiếp module source-facility tại /api/source-facilities: GET danh sách, GET chi tiết bằng UUID, POST thêm, PATCH sửa và POST /:sourceFacilityId/deactivate. Cả năm thao tác yêu cầu đúng supplier admin, quyền source_facility.manage hiệu lực và supplier ACTIVE.

**Rationale**: Router đã đăng ký ở src/routes/index.ts. Người dùng xác nhận cả năm thao tác chỉ dành admin, cơ sở thuộc riêng từng supplier. Nhánh SYSTEM toàn cục trong listScopes hiện tại phải được siết lại.

**Alternatives considered**: Thêm /management và giữ danh sách mở như ingredient trái phạm vi đã xác nhận. Mã cơ sở không thay UUID vì có thể trùng giữa hai supplier.

## R02 — Phân lớp và tái sử dụng

**Decision**: Giữ bảy file module chuẩn; thêm repository, Request DTO và Response DTO đang thiếu. Chuyển Prisma select/where/order/pagination khỏi service sang repository. Chỉ service dùng DTO và ánh xạ allowlist, ngày giờ sang ISO.

**Rationale**: source-facility.service.ts hiện vừa dựng query vừa trả persistence rows. Module ingredient cung cấp mẫu transaction, dependency injection và quản trị supplier gần nhất.

**Alternatives considered**: Mở rộng service với truy vấn trực tiếp hoặc viết mapper riêng vi phạm kiến trúc. Không thêm dependency hay client DB.

## R03 — Dãy mã riêng, giữ nguyên schema

**Decision**: Dùng số lớn nhất trong các mã chuẩn đã lưu của chính supplier cộng một trong transaction tạo cơ sở. Khóa hàng supplier bằng FOR UPDATE. Tính max trên cả ACTIVE/INACTIVE và mọi giá trị isVisible. Giữ unique (supplierId, facilityCode) với predicate facility_code IS NOT NULL. Không thêm counter, schema hoặc migration.

**Rationale**: SourceFacility đã có trường mã và unique scoped; không có xóa và mã bất biến nên các hàng được giữ lại biểu diễn mức số cao nhất. Không sử dụng dãy số hồ sơ đăng ký.

**Alternatives considered**: Counter trên Supplier hoặc bảng riêng cho allocation O(1) nhưng cần migration/backfill chưa cần cho phạm vi này. Global sequence không đạt phương án A. count()+1, sort chuỗi, Redis hoặc mutex tiến trình không bảo đảm đúng khi có lịch sử/nhiều process.

## R04 — Chính xác số và tương thích dữ liệu cũ

**Decision**: Repository tính numeric MAX hậu tố canonical, trả scalar text/bigint. Formatter thuần dùng bigint và padStart tối thiểu năm chữ số; không ép Number hoặc giới hạn signed 64-bit. Canonical có tiền tố viết hoa FP-SF-, đúng năm chữ số với giá trị dương hoặc từ sáu chữ số trở lên với chữ số đầu khác 0. Hậu tố tối đa 74 chữ số theo varchar(80); nếu mã tiếp theo vượt giới hạn thì trả 503 an toàn, rollback toàn vẹn.

**Rationale**: Numeric MAX xử lý đúng 99999 sang 100000 và các số vượt Number.MAX_SAFE_INTEGER. Giữ nguyên mã cũ null/không chuẩn/viết thường và không tính chúng vào dãy canonical; mã canonical cũ, kể cả INACTIVE/isVisible=false, vẫn tham gia. Không backfill hoặc đánh lại mã.

**Alternatives considered**: Sort chuỗi hoặc cast suffix về PostgreSQL bigint có thể sai/lỗi trên mã lớn. Ép mọi dữ liệu cũ theo format mới là thay đổi dữ liệu chưa được yêu cầu.

Phép cast từng hậu tố phải được bảo vệ bằng CASE bên trong MAX, bảo đảm chỉ cast mã canonical; không dựa vào thứ tự đánh giá regex AND cast trong WHERE hoặc đặt CASE bên ngoài aggregate. Legacy không chuẩn phải luôn được bỏ qua an toàn. Xem [PostgreSQL Expression Evaluation Rules](https://www.postgresql.org/docs/18/sql-expressions.html#SYNTAX-EXPRESS-EVAL).

## R05 — Đồng thời và retry

**Decision**: Service dùng authorizationTransaction hiện có cho toàn bộ thao tác ghi: Serializable, tối đa ba attempts, maxWait 10 giây, timeout 20 giây mỗi attempt. Mỗi attempt kiểm tra lại actor/scope/supplier, đọc max và tạo bằng cùng tx. Trùng tên chuyển 409; unique conflict mã giữ lỗi cho shared retry. Hết lượt trả 503, không trả kết quả transaction rollback.

**Rationale**: Helper ở src/utils/authorization.ts nhận diện P2034/P2002, 40001/40P01 và adapter 23505. Không copy ingredientWriteError vì nó chuyển mọi P2002 thành trùng tên. Unique scoped là lớp bảo vệ cuối.

**Evidence**: Serializable giữ snapshot; chờ khóa không làm mới snapshot. Các transaction chồng lấn vẫn có thể gặp unique violation, cần thử lại toàn bộ thao tác. Xem [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html) và [Explicit Locking](https://www.postgresql.org/docs/18/explicit-locking.html). Khóa supplier + numeric max + retry là thiết kế suy ra cho repository này, phải được chứng minh bằng test PostgreSQL thực.

**Alternatives considered**: Chỉ khóa rồi dùng snapshot cũ, chỉ retry insert trong transaction đã lỗi, hoặc chuyển lỗi mã thành 409 không bảo đảm đúng. Không tăng retry toàn dự án hoặc hứa mọi request dưới tải tùy ý đều thành công.

## R06 — Phân quyền và transaction

**Decision**: Thêm SourceFacilityManagementScope/helper trong resource-access.ts; đồng bộ listScopes để chỉ supplier admin có membership và permission hợp lệ. Read kiểm tra supplier ACTIVE. Write nạp actor/quyền trong tx, so scope ban đầu, khóa supplier rồi target theo cùng thứ tự, kiểm tra supplier/target và ghi scoped.

**Rationale**: Theo constitution và mẫu ingredient. Repository nhận trusted scope; target read/update/lock có supplierId trong WHERE. Staff/SYSTEM có permission vẫn bị chặn; target chéo supplier và không tồn tại cùng trả 404.

**Alternatives considered**: Chỉ role middleware, tin supplierId người dùng gửi hoặc chỉ kiểm tra trước transaction không đủ. Không cache phân quyền.

## R07 — Validation, output và vòng đời

**Decision**: Zod strict cho create/update/query/params/action. Create nhận năm trường, optional missing/empty/null thành null. PATCH giữ omitted và cấm body rỗng. Deactivate nhận absent body hoặc {}. List giữ projection/envelope/pagination; detail thêm địa chỉ/liên hệ. Read DTO cho facilityCode string|null để giữ legacy; create mới bảo đảm string. Dừng lặp trả trạng thái hiện tại, không đổi audit lần nữa.

**Rationale**: Dùng parseRequest/requestUuidSchema và response helpers. Validation errors ở error.fields; không thêm root code riêng cho đường dẫn /api hiện hành. Dừng lần thật chỉ đổi status, updatedByUserId và updatedAt, giữ isVisible/lịch sử.

**Alternatives considered**: DELETE, kích hoạt lại, sửa mã, filter/search mới, cache hoặc upload ngoài phạm vi.

## R08 — Kiểm chứng

**Decision**: Thêm tests/source-facility-management.test.ts vào test:unit; mở rộng tests/authorization.integration.test.ts đang được CI chạy để chứng minh auth/tenant/concurrency trên database local mới tạo. Không thêm framework, workflow hoặc script integration trùng lặp.

**Rationale**: Mock không chứng minh lock/snapshot/unique/retry. Suite có MIGRATION_TEST_DATABASE_URL, guard local, database tạm và Redis cho phiên đăng nhập. Planning không chạy suite hạ tầng hoặc thay đổi database.

**Alternatives considered**: Standalone suite cần wiring CI riêng; kiểm tra cấp số chỉ bằng mock chưa đủ.

## Kết quả Phase 0

Đã giải quyết các quyết định kỹ thuật từ đặc tả, mã nguồn và tài liệu PostgreSQL; không còn câu hỏi chặn Phase 1. Chi phí cấp mã tăng theo số cơ sở của supplier; kiểm chứng trên fixture đủ lớn, chỉ tối ưu sang counter bền vững ở thay đổi sau nếu số liệu yêu cầu. Các nguồn cục bộ chính: prisma/schema.prisma; src/modules/source-facility/; src/modules/ingredient/; src/utils/authorization.ts; src/utils/resource-access.ts; src/utils/registration-id.ts; tests/authorization.integration.test.ts.
