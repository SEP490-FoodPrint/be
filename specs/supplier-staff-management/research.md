# Research: Quản lí nhân viên nhà cung cấp nguyên liệu

**Updated**: 2026-11-17, sau quyết định email-only cho toàn hệ thống. Thay thế thiết kế email-only riêng staff và giữ username-login cho non-staff. Hai nhánh nghiên cứu chỉ đọc đã kiểm schema/uniqueness và auth/session/fixtures; không truy cập DB hoặc chạy DDL. Không còn quyết định nghiệp vụ chưa chốt.

## R1 — Module và persistence

- **Decision**: Giữ module supplier-staff với bảy endpoint, permission supplier_staff.manage, User và UserPermissionDenial hiện có. Không thêm model, permission, seed hoặc cấu hình role tự động. Cần một migration mới thay uniqueness username; kết luận cũ không cần migration không còn áp dụng.
- **Rationale**: Generic user/permission API chưa lọc target staff và service permission cũ chứa query trực tiếp; module riêng bảo đảm staff-only và đúng phân lớp. Schema đủ field nhưng @@unique([username]) cản staff khác supplier trùng tên.
- **Alternatives considered**: Dùng nguyên generic APIs không đủ scope; bảng staff/field username thứ hai trùng dữ liệu; biến username thành chuỗi ẩn có tiền tố supplier làm lệch dữ liệu người dùng yêu cầu.
- **Evidence**: src/modules/user/user.service.ts, src/modules/permission/permission.service.ts, src/utils/resource-access.ts, prisma/schema.prisma.

## R2 — Hai namespace username và email toàn cục

- **Decision**: Bỏ global username constraint users_username_key bằng migration mới; thay bằng partial unique uq_users_non_staff_username trên username khi role_code khác INGREDIENT_SUPPLIER_STAFF và uq_users_supplier_username trên (supplier_id, username) khi supplier_id không null. Giữ nguyên email unique Citext, composite role FK, CHECK và các index một admin/officer.
- **Rationale**: Username vẫn là thuộc tính tài khoản với các ràng buộc nghiệp vụ đã chốt, độc lập với email là định danh đăng nhập. Index non-staff giữ username giữa các non-staff không trùng dù khác/chưa có tổ chức. Index supplier bao gồm admin/staff mọi status, không cho staff trùng admin cùng supplier; staff khác supplier hoặc non-staff ngoài supplier có thể trùng username.
- **Alternatives considered**: Chỉ thêm composite unique mà giữ global constraint không cho trùng cross-supplier; chỉ unique staff trong supplier bỏ sót admin cùng supplier; bỏ global constraint không có non-staff index làm hỏng tính duy nhất của tài khoản khác.
- **Compatibility detail**: Giữ uniqueness dữ liệu giữa non-staff, không tự bỏ username hoặc nới quy tắc lưu trữ khi chuyển mọi vai trò sang email-only. Staff ngoài supplier không chiếm tên trong nhóm dữ liệu non-staff; hai non-staff vẫn không được trùng username. Chính sách đăng nhập cũ bằng username được thay có chủ đích cho mọi vai trò theo clarify.
- **Evidence**: prisma/schema.prisma User; 0_init/migration.sql khai báo username varchar NOT NULL UNIQUE; tests/migrations.test.ts. Không sửa baseline/manifest hoặc migration đã applied.

## R3 — Migration và dữ liệu hiện có

- **Decision**: Migration supplier_staff_username_scope tạo hai index thay thế trước khi drop users_username_key trong cùng transaction với lock/statement timeout theo quy ước repo. Biểu diễn hai partial indexes trong Prisma với predicate PostgreSQL chuẩn hóa, không dùng partial key cho findUnique. Timestamp thư mục được chọn sau migration mới nhất khi triển khai; không tự backdate theo ngày lập plan.
- **Rationale**: Global unique hiện có bảo đảm dữ liệu cũ thỏa hai uniqueness mới. Không cần đổi username/email, backfill, reset password hoặc chuyển membership. Lỗi DDL/timeout phải rollback nguyên transaction; không tự xóa tài khoản để sửa dữ liệu.
- **Alternatives considered**: Sửa 0_init/checksum vi phạm migration bất biến; db push không có lịch sử; concurrent index ngoài transaction không cần cho phạm vi này và cần thiết kế triển khai riêng.
- **Deployment**: Kiểm thử fresh/upgrade/collision/preservation/catalog trên disposable local khi tác vụ cho phép ghi; tài liệu này không cho phép tự áp lên local member/Azure. Deploy code hỗ trợ email-only trước hoặc cùng đợt rollout có kiểm soát rồi mới cho phép tạo username trùng sau migration. Khi đã có tên trùng, không rollback code cũ/drop indexes mù quáng hoặc tự đổi tên.

## R4 — Email-only login cho toàn hệ thống

- **Decision**: Giữ POST /api/auth/login và strict body identifier/password để không đổi tên trường giao tiếp. Mọi role gửi email vào identifier; validation giữ requiredText(320), trim/lowercase, password nguyên văn với giới hạn login hiện hành. Không thêm email-format rejection trong lần này: username hoặc chuỗi non-email không rỗng vẫn nhận 401 chung, lỗi thiếu/rỗng/quá dài/trường lạ vẫn 400.
- **Lookup**: Thay findCandidates/OR/take:2 bằng operation repository findByEmail trả một candidate hoặc null qua unique email Citext. Không nhánh username, lọc role, ưu tiên hay fallback username cho bất kỳ vai trò nào. Email khớp username người khác chỉ chọn chủ email; không lỗi nhiều account và không thử nhiều mật khẩu.
- **Transaction**: Sau bcrypt/dummy compare, khóa User bằng id rồi repository đọc lại cùng id + email trong transaction; dùng so sánh Citext tại DB, không query từ service. Nếu email đã đổi hoặc hash không còn giống lúc lookup thì từ chối 401 trước cấp phiên; sau đó loadSessionUser đọc trạng thái, role/membership/onboarding hiện hành. Không còn điều kiện chọn account dựa role staff/non-staff.
- **Rationale**: Email unique toàn cục xác định đúng account cho tất cả role, giải quyết trực tiếp I1 khi email A trùng username B. Giữ dummy bcrypt và thông báo 401 chung “Email hoặc mật khẩu không đúng”, không tiết lộ username/email tồn tại hay không.
- **Alternatives considered**: Chỉ email-only cho staff nhưng giữ OR cho non-staff còn I1; ưu tiên email trong một OR vẫn để username-login ngoài lựa chọn mới; trường email thay identifier hoặc login endpoint mới không cần thiết; kiểm định dạng email trả 400 cho username làm đổi contract lỗi không cần thiết.
- **Evidence**: src/modules/auth/session.validation.ts, session.repository.ts, session.service.ts, src/utils/session-identity.ts, tests/auth-session.test.ts.

## R5 — Các luồng tạo và recovery liên quan

- **Decision**: Staff duplicate check gồm email toàn hệ thống hoặc username trong trusted supplier (cả admin/staff). School create repository điều chỉnh riêng nhánh username để chỉ so với non-staff; email luôn kiểm toàn cục. Signup tiếp tục dựa unique non-staff và P2002→409, không đổi flow/field. Sửa lookup test findUniqueOrThrow({username}) thành id/email sau regenerate.
- **Rationale**: user.repository.findUserByEmailOrUsername hiện OR toàn cục; giữ nguyên sẽ vô tình chặn namespace staff trong school flow dù signup và DB đã tách. Không thêm query vào service cũ. Không thay validation, role, default password, envelope hoặc endpoint của tài khoản trường/admin.
- **Recovery**: password.service repository đã tìm bằng unique email, mã/grant gắn userId/email/password fingerprint. Không đổi contract/reset namespace; thêm regression reset email A không ảnh hưởng staff B trùng username. Existing sessions gắn userId, không cần đổi JWT/cookie/Redis keys.
- **Alternatives considered**: Hạn chế username staff toàn hệ thống để né thay auth mâu thuẫn FR-008; giữ username login ở bất kỳ role nào trái FR-009 mới; sửa recovery sang supplier scope không cần vì email vẫn unique.
- **Evidence**: signup.service.ts, user.repository.ts.findUserByEmailOrUsername, password.service.ts, tests/authorization.integration.test.ts và helper passwordLogin dùng username.

## R6 — Transaction và lifecycle

- **Decision**: Một authorizationTransaction Serializable cho mỗi staff mutation. Khóa Supplier → User IDs tăng dần → Role IDs tăng dần FOR SHARE, recheck actor/target sau khóa. Repository target lock/read có supplier + staff role/type filter. Hash bcrypt cost 12 trước transaction. Cùng tx cho mọi repository operation, không nested tx hoặc scope từ body/query.
- **Rationale**: Khóa chung với account-lifecycle ngăn create/unlock còn ACTIVE sau cascade; User/Role MVCC phối hợp touchUser/touchRole buộc request dùng quyền cũ retry. Cần integration barrier chứng minh hai thứ tự, không coi suy luận là đã chạy test.
- **Alternatives considered**: Chỉ khóa target hoặc chỉ recheck ngoài tx không chặn cascade/revocation; wrapper source-facility chỉ khóa supplier không đủ cho actor permission race.
- **Evidence**: src/utils/authorization.ts, src/modules/account-lifecycle/intake-access.repository.ts, account-lifecycle.service.ts, src/modules/permission/permission.repository.ts.

## R7 — Trạng thái và denial

- **Decision**: ACTIVE ↔ LOCKED, same-state no-op; trạng thái khác 409. Permission target phải ACTIVE; ngoài scope 404 trước status check; grant active thuộc role mới bật/tắt. Scoped denial createMany skipDuplicates/deleteMany, touchUser chỉ khi count > 0. Giữ denial qua unlock và role grant removal/re-add, không cache.
- **Rationale**: Login/refresh/authenticate hiện đã tải status từ DB, staff ACTIVE không cần emailVerifiedAt hoặc registration mới. Khóa không cần revoke toàn bộ Redis; unlock bảo đảm login mới. Tạm dừng intake không tự khóa/quản lí staff.
- **Alternatives considered**: Cho mở DEACTIVATED vượt vòng đời tổ chức; chỉnh RolePermission nâng quyền toàn role; xóa denial lúc unlock làm mất quyền đã thu hồi.
- **Evidence**: src/utils/session-identity.ts, src/middlewares/auth.middleware.ts, src/modules/permission/permission.service.ts, account-lifecycle module.

## R8 — Kiểm chứng toàn bộ vai trò và chuyển đổi client

- **Decision**: Giữ Zod strictObject/safeParse và hai DTO file; service map allowlist, repository không DTO. Unit/HTTP mới vào test:unit; auth/recovery unit và migration/authorization/lifecycle integration được cập nhật cho email-only mọi role. Các positive login helper của mọi vai trò dùng email; giữ username coverage ở create/uniqueness/DTO và chuyển username-login thành negative test.
- **Regression**: Kiểm từng role trong ROLES (SYSTEM, SCHOOL, SUPPLIER, AUTHORITY); email normalized thành công khi đủ điều kiện, username không khớp email nào trả 401. Email A trùng username B phải chọn A; fixture dùng mật khẩu khác nhau để chứng minh password chỉ đúng với B không mở được A; mixed-case/whitespace email; email/password đổi giữa lookup và lock; các status/onboarding/permissions/cookie/CSRF không đổi. Đây là SC-007, thay kỳ vọng ambiguity 401 cũ.
- **Fixtures**: Rà tests/auth-session.test.ts, tests/authorization.integration.test.ts, tests/account-lifecycle.integration.test.ts và tests/supplier-onboarding.integration.test.ts. Không để các test LOCKED/onboarding vô tình đổi 403 thành 401 vì vẫn gửi username. Fake Prisma phải phân biệt lookup email, reread sau lock và full identity select, không stub một findUnique response cho mọi truy vấn.
- **Runner**: Suite supplier-onboarding hiện có helper username và CREATE DATABASE chưa đăng ký manifest. Để chạy hồi quy dưới cùng policy local, đưa suite vào nhóm authorization hiện có theo các child process tuần tự; đăng ký đúng tên DB sau CREATE thành công bằng recordLocalTestDatabase. Wrapper cleanup giữ đúng manifest/owner của invocation, không quét prefix hoặc tạo group/container mới. Chỉ sửa tích hợp suite cần cho auth regression; không refactor toàn bộ harness.
- **Rationale**: Global email-only là thay đổi chủ đích cho mọi client/role; cần kiểm toàn hệ thống thay vì chỉ staff. Migration tests vẫn phải phân biệt scoped username và global email như R2/R3. Dữ liệu và session userId không đổi nên không reset/gộp/đổi tên hoặc tự revoke toàn bộ phiên khi rollout.
- **Alternatives considered**: Chỉ đổi test staff bỏ sót non-staff login; giữ expectation nhiều account 401 mâu thuẫn SC-007; chạy standalone suite ngoài cleanup policy không đáp ứng hướng dẫn repository; fake tests không thay migration/concurrency thật.
- **Evidence**: tests/helpers/run-local-tests.ts, tests/helpers/local-test-database.ts, tests/local-test-database.test.ts, các suite nêu trên, docs/AUTH_SESSIONS.md. Không thực thi suite, đổi source hay DDL trong bước plan.
