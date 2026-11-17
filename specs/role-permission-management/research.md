# Research: quản lý quyền và bộ quyền vai trò

**Ngày**: 2026-11-17  
**Phạm vi**: [spec.md](spec.md), nhánh `feat/role-permission-management`.

## Gate trước nghiên cứu

Đã đọc hiến chương và đặc tả đã được người dùng chốt. Thiết kế dùng module hiện có, không thay đổi schema/dữ liệu, không sửa bộ quyền SYSTEM_ADMIN, không có bypass/cache phân quyền. Không có vi phạm cần ngoại lệ. Complaint giữ nguyên trên nhánh riêng và tạm dừng.

## R1 — Dùng mô hình dữ liệu hiện hữu

- **Decision**: Giữ Permission, Role, RolePermission và UserPermissionDenial; đổi trạng thái qua Permission.isActive. Không thêm model, migration, trường version hoặc bảng lịch sử.
- **Rationale**: `prisma/schema.prisma` đã có đầy đủ các trường và khóa; `principalFromIdentity` đã tính quyền hiệu lực từ isActive và denial đúng tổ chức. FR-004–012 không đòi cấu trúc mới.
- **Alternatives considered**: Xóa quyền để “ẩn” làm mất cấu hình; trạng thái theo vai trò không đúng quyết định toàn cục; version phục vụ optimistic concurrency chưa thuộc yêu cầu.

## R2 — Endpoint và guard không cần quyền mới

- **Decision**: Thêm GET /api/roles trong module permission, yêu cầu SYSTEM_ADMIN thuộc SYSTEM và `role.view`; giữ nguyên GET /api/auth/roles. Giữ permission.view cho danh mục, permission.create cho tạo, role_permission.manage cho xem/sửa bộ quyền. Hai thao tác mới PATCH thông tin và PATCH trạng thái cùng yêu cầu `role_permission.manage` và System Admin.
- **Rationale**: `src/constants/permission-catalog.ts` đã có đủ các mã này; quản trị thông tin/trạng thái là phần quản trị cấu hình quyền. Không thêm grant hay chạy bootstrap. `src/routes/index.ts` đã mount permission router ở gốc /api; /api/roles không trùng /api/auth/roles.
- **Alternatives considered**: Thêm permission.update/permission.activate tạo nhu cầu provisioning và sửa grant SYSTEM_ADMIN; không cần thiết cho yêu cầu hiện tại. Đổi hợp đồng /api/auth/roles ảnh hưởng client cũ và module auth không cần sửa.
- **Operational consequence**: Bootstrap hiện tại chỉ do operator chạy; code kế hoạch này không gọi bootstrap, thay catalog hoặc tự cấp quyền cho tài khoản đang thiếu guard.

## R3 — Scope tin cậy và phân lớp module

- **Decision**: Thêm helper scope cho danh mục permission và quản trị role trong `src/utils/resource-access.ts`, trả scope toàn cục tường minh chỉ sau kiểm tra đúng role/org/permission. Service truyền scope và dữ liệu chuẩn hóa; repository chuyển scope hợp lệ thành WHERE (toàn cục là bộ lọc rỗng có chủ đích), giữ select/order/pagination trong repository.
- **Rationale**: AGENTS yêu cầu kiểm tra permission và scope cho mọi list. Permission/Role là catalog toàn hệ thống, không có schoolId/supplierId để nhận từ request. Scope tổ chức hiện có cho user denials phải giữ nguyên.
- **Alternatives considered**: Chỉ gọi assertSystemManager nhưng bỏ scope ở repository không đáp ứng quy tắc list; nhận organizationId từ client phá ranh giới tin cậy.
- **Migration of legacy code**: Module permission hiện truy vấn trong service, dùng ReturnType validator và trả persistence record. Refactor toàn bộ các thao tác trong module sang repository + hai DTO riêng là phần cần thiết để mở rộng đúng kiến trúc; giữ HTTP contract cũ của user permissions/denials.

## R4 — Validation và output giữ tương thích

- **Decision**: Zod strictObject + parseRequest/safeParse cho body, query và params; Request DTO dùng type-only z.infer. Migrate cả validators cũ của permission, bảo toàn giới hạn, trim, null/default và UUID lowercase. PATCH thông tin chỉ nhận name/description, ít nhất một trường; PATCH trạng thái chỉ nhận boolean isActive.
- **Rationale**: `src/utils/request-validation.ts` và `directory-validation.ts` đã có helper lỗi tiếng Việt và pagination mặc định 1/20, limit tối đa 100. Response DTO map allowlist trong service, không trả record thô; envelope giữ `sendSuccess/sendError`.
- **Alternatives considered**: Validator thủ công dừng ở lỗi đầu làm mất khả năng báo nhiều trường; một PATCH nhận code/module/action/isActive trộn hai thao tác và cho phép thay ý nghĩa quyền.
- **Text compatibility**: Mô tả tạo mới bỏ qua/null thành null; nếu cung cấp chuỗi phải trim và không rỗng, tối đa 2.000; PATCH dùng null để xóa, trường bỏ qua giữ nguyên. Giữ cách tính độ dài hiện hành của helper, không tự đổi chuẩn đếm ký tự trong lần migrate này.

## R5 — Lưu bộ quyền bằng chênh lệch

- **Decision**: Sau khóa role, đọc tập đã gán C và tập yêu cầu R. Chỉ tạo R−C nếu quyền tồn tại và active; xóa C−R; giữ nguyên C∩R kể cả permission inactive. Giữ assignedAt của các grant không đổi. Không chạm denials. Tối đa 1.000 UUID, không trùng; tập rỗng hợp lệ.
- **Rationale**: replaceRole hiện kiểm mọi quyền active rồi deleteMany toàn bộ, nên không giữ được grant tạm ngừng như US2. Chênh lệch thực hiện đúng FR-011 và tránh gán lại grant không đổi.
- **Alternatives considered**: Xóa rồi tạo lại toàn bộ làm mất thời điểm gán và cần nới kiểm active sai cách; bỏ mọi kiểm active sẽ cho gán mới inactive.
- **Concurrent outcome**: PUT thay thế toàn bộ, kết quả là lần lưu đầy đủ được chấp nhận sau cùng; không có ETag/version/cảnh báo dữ liệu cũ trong phạm vi này.

## R6 — Khóa và retry cho mọi ghi quản trị

- **Decision**: Dùng `authorizationTransaction` hiện hữu (Serializable; tối đa 3 attempts; backoff 20/40 ms). Repository đọc actor bằng identitySelect + principalFromIdentity trực tiếp trong tx, không bọc lỗi truy vấn bên trong bằng databaseOperation/loadPrincipal.
- **Rationale**: `src/utils/authorization.ts` có classifier conflict tại query/COMMIT; `loadPrincipal` bọc databaseOperation có thể đổi conflict thành HttpError 503 trước khi retry. Pattern đọc actor thô đã dùng trong supplier-staff và ingredient-quality-feedback.
- **Lock order**: System writes khóa actor user FOR UPDATE → union actor/target roles theo UUID (actor SHARE, target role của PUT UPDATE) → union guard/target permissions theo UUID (guard SHARE, target của PATCH UPDATE). Chọn mode mạnh nhất một lần cho từng row; không khóa SHARE rồi nâng cấp khi guard trùng target. Đọc lại actor sau khóa; xác nhận cùng role/org và guard vẫn hiệu lực trước khi ghi.
- **PUT details**: Khóa target role trước khi đọc grants; union permission lock gồm guard và quyền liên quan C∪R; touchRole khi grants thực sự thay đổi để giữ tín hiệu MVCC cho waiter. Sau khóa đọc lại actor, grants và trạng thái permission bằng cùng tx. Lỗi serialization/deadlock đi nguyên dạng về wrapper để thử lại toàn bộ.
- **PATCH details**: Chỉ cập nhật cột được yêu cầu. Không khóa tất cả role được gán khi đổi isActive (tránh đảo permissions→roles); permission row là điểm tuần tự hóa trạng thái. Khi tự tắt role_permission.manage, actor được kiểm trước ghi, request hiện tại có thể thành công; request sau bị từ chối.
- **Existing tenant writes**: Giữ thứ tự chung school/supplier parent → actor/target users sorted → roles sorted → guard/target permission sorted khi refactor denial toggle; scope và quyền tổ chức giữ nguyên. Không thay cơ chế ghi của module nghiệp vụ khác.
- **Alternatives considered**: Chỉ đọc actor đầu transaction không có điểm khóa rõ ràng cho FR-013; mutex trong tiến trình không bảo vệ nhiều process; khóa global tất cả quyền/role tăng tranh chấp không cần thiết.
- **Boundary**: Đảm bảo thứ tự tại điểm chấp nhận thao tác quản trị này; request nghiệp vụ mới sau commit dùng quyền mới. Không hứa hủy các thao tác nghiệp vụ đã được chấp nhận trước khi tạm ngừng quyền.

## R7 — Lỗi và kiểm chứng

- **Decision**: Giữ 400 validation/business-invalid grant; 401 thiếu phiên; 403 thiếu quyền/SYSTEM_ADMIN target; 404 đối tượng không tồn tại; 409 trùng permission.code; 503 lỗi DB/conflict hết retry. Unique-code classifier chỉ chuyển đúng ràng buộc code thành 409, không nuốt serialization errors.
- **Rationale**: Controller/helpers hiện có đã dùng các envelope/status này. PostgreSQL thực cần kiểm race bằng barrier, không suy tính nguyên tử từ mocks.
- **Tests planned**: Unit/HTTP mới `tests/permission-management.test.ts`, thêm vào test:unit; mở rộng `tests/authorization.integration.test.ts` thuộc runner local hiện hành. Giữ regression auth/session, organization denials, supplier-staff và bootstrap.
- **Alternatives considered**: Framework test mới không cần thiết; PostgreSQL container mới hoặc test trên DB thành viên trái quy trình; chỉ dùng sleep để tạo race dễ thiếu ổn định.

## Kết quả Phase 0

Các quyết định trên dựa trên schema, module và helper trong repository; không đổi công nghệ hoặc cần nghiên cứu thư viện ngoài. Đã giao hai nhánh nghiên cứu chỉ đọc về concurrency và contracts/catalog theo workflow skill. Không còn câu hỏi kỹ thuật chưa giải quyết để chuyển sang Phase 1. Chưa chạy test, bootstrap hoặc thao tác DB; đây là kết quả thiết kế, chưa là bằng chứng triển khai.

## R8 — Amendment tìm tên quyền

- **Decision**: GET /permissions nhận search optional, trim, tối đa 150 ký tự, rỗng thành không lọc. Query roles vẫn chỉ page/limit. Dùng safeExtend của pagination schema hiện có để giữ validation offset và tách RoleQuery DTO khỏi PermissionQuery DTO.
- **Rationale**: Tìm substring name insensitive trong repository trước limit+1/offset, escape %, _ và backslash như search Supplier hiện tại. Giữ guard/scope và không thêm cache/index/schema. Truyền riêng page/limit vào readListPage để helper không spread search ra metadata response.
- **Alternatives considered**: Endpoint search riêng trùng danh sách và pagination; tìm cả code/description vượt yêu cầu chỉ theo tên; dùng cùng role query sẽ nhận search rồi bỏ qua sai hợp đồng.
