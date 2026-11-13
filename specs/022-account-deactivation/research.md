# Research: Vô hiệu hóa và tạm dừng tiếp nhận

**Ngày**: 2026-11-12. Nguồn nghiên cứu là repository hiện tại; không truy vấn database, không chạy migration và không thay đổi mã nguồn. Hai nhánh nghiên cứu đã đối chiếu mô hình dữ liệu và runtime riêng; các quyết định dưới đây là thiết kế hợp nhất.

## R1 — Tạm dừng là trạng thái nghiệp vụ riêng

**Decision**: Giữ `User.status=DEACTIVATED` cho vô hiệu hóa. Bổ sung trạng thái tiếp nhận riêng trên School, Supplier và User cán bộ. Không thay enum EntityStatus hoặc dùng SchoolSupplierRelationship.SUSPENDED cho tạm dừng toàn nhà cung cấp.

**Rationale**: `src/utils/authorization.ts` và `src/utils/session-identity.ts` đã chặn tài khoản không ACTIVE; thay account status để tạm dừng sẽ ngăn cả đăng nhập. Quan hệ SUSPENDED chỉ tác động một cặp, trong khi yêu cầu áp dụng mọi tài khoản của tổ chức. Cần tiếp tục xử lý công việc đã nhận.

**Alternatives considered**: Thêm PAUSED vào AccountStatus; dùng EntityStatus.INACTIVE; tạm dừng từng quan hệ. Cả ba làm sai phạm vi hoặc ảnh hưởng đọc/xử lý hiện có.

## R2 — Một cán bộ mỗi xã và người nhận yêu cầu

**Decision**: Giữ CommuneFoodSafetyUnit như định danh kỹ thuật phục vụ FK và phạm vi phân quyền, không tạo tổ chức admin/thành viên trong sản phẩm. Thêm partial unique theo communeFoodSafetyUnitId cho role COMMUNE_FOOD_SAFETY_OFFICER, tính cả tài khoản inactive/deactivated. Thêm recipientUserId và receivedAt nullable vào FoodSafetyReportForwarding.

**Rationale**: `prisma/schema.prisma` hiện gắn User và forwarding qua đơn vị xã, chưa có uniqueness cán bộ. Người nhận cụ thể cần được lưu ổn định; receivedAt phân biệt công việc đã nhận và chưa nhận. NotificationStatus.PENDING/SENT/FAILED biểu diễn gửi thông báo, không phải nhận nghiệp vụ.

**Alternatives considered**: Xóa bảng đơn vị xã phá FK và lịch sử; suy ra người nhận động mãi từ membership làm lịch sử đổi khi tài khoản chuyển xã; dùng forwardedAt/SENT/INVESTIGATING để suy diễn receipt tạo dữ liệu chưa được chứng minh.

**Migration compatibility**: Chỉ ánh xạ người phụ trách hiện tại khi một đơn vị có đúng một cán bộ, gồm cả inactive. Dữ liệu có nhiều cán bộ, người nhận nội bộ không xác định hoặc mâu thuẫn membership phải khiến kiểm tra tiền triển khai dừng; không tự xóa/gộp/tạo tài khoản. Báo cáo external có recipientCommuneFoodSafetyUnitId=null tiếp tục null. Không suy diễn receivedAt từ forwardedAt. Các bản ghi cũ không có bằng chứng nhận giữ null và được coi là chưa có bằng chứng tiếp nhận; nếu vận hành cần công nhận đã nhận thì phải có ánh xạ bằng chứng được operator duyệt riêng, không có backfill tự động trong feature. Guard vô hiệu hóa kiểm tra cả legacy forwarding theo đơn vị khi recipientUserId còn null, tránh tạo cán bộ sau đó làm bỏ sót yêu cầu chưa CLOSED.

## R3 — Các write path thực tế và giới hạn triển khai

**Decision**: Tích hợp guard vào `createOrderDraft` và `sendOrder` trong `src/modules/supplier-onboarding/supplier-onboarding.service.ts`. Giữ URL, body, kiểm tra hợp đồng và output hiện có. Refactor riêng phần được sửa sang repository, Zod và hai file DTO theo AGENTS.md, không chỉnh cả module.

**Rationale**: `supplier-onboarding.routes.ts` đã mở POST `/api/supply-requests` và POST `/:id/send`. Module `supply-order` riêng chỉ GET. Pair advisory lock của luồng hiện tại không thay thế khóa cấp trường/nhà cung cấp.

**Alternatives considered**: Chỉ chặn ở GET, chỉ ẩn nút, hoặc sửa module supply-order mà bỏ qua supplier-onboarding đều không bảo vệ write đang hoạt động.

**Decision bổ sung**: Bổ sung đúng hai action HTTP tối thiểu: nhận đơn SENT → ACCEPTED và xác nhận cán bộ tiếp nhận forwarding. Đây là hai điểm ghi trực tiếp thuộc FR-015/FR-017/FR-018, giúp kiểm chứng hành vi ngoài test adapter. Không thêm CRUD đơn, gửi báo cáo, chuyển IN_PROGRESS, hoàn tất giao hàng hoặc đóng sự cố trong feature này. Thiết kế guard dùng được cho các writer đó khi chúng được triển khai theo spec riêng. Không tuyên bố đã có đầy đủ vòng đời từ đặt hàng đến hoàn tất.

**Alternatives considered**: Chỉ viết guard để chờ API nhận trong tương lai là chưa đủ để bàn giao hành vi tiếp nhận có thể sử dụng. Mở toàn bộ vòng đời làm vượt phạm vi. Chọn hai action nhận tối thiểu có đầu vào chỉ là ID và body rỗng, không phát minh trường nghiệp vụ mới.

## R4 — Quyền tiếp nhận

**Decision**: Quản trị dùng SYSTEM_ADMIN + SYSTEM + user.manage. Nhận đơn dùng permission hiện có supply_request.accept và scope SUPPLIER; không role bypass. Nhận yêu cầu kiểm tra dùng permission hẹp mới food_safety_report.receive, grant mặc định chỉ COMMUNE_FOOD_SAFETY_OFFICER. Catalog/bootstrap được cập nhật trong code, không chạy bootstrap trong tác vụ plan/implement nếu không có ủy quyền vận hành.

**Rationale**: Catalog hiện có quyền nhận đơn nhưng cán bộ chỉ có quyền đọc. Không dùng food_safety_report.view để cấp quyền ghi; không cấp food_safety_incident.manage rộng hơn hành vi đã xác nhận. Quyền mới chỉ cho phép đặt receivedAt của đúng người nhận, không cho đóng/đổi tiến độ sự cố.

**Alternatives considered**: Dùng quyền đọc để ghi vi phạm hợp đồng quyền; cấp quyền manage toàn sự cố là quá rộng; mặc định cho phép theo role bỏ qua effective permissions. Nguồn: `src/constants/permission-catalog.ts`, `src/utils/resource-access.ts`.

## R5 — Transaction và cạnh tranh

**Decision**: Dùng `authorizationTransaction` Serializable, tối đa ba lượt theo helper hiện có. Service xác định transaction, repository chứa tất cả SQL/Prisma args, kể cả SELECT FOR UPDATE. Một thứ tự khóa chung: School → Supplier → User → Role actor; ID tăng dần trong mỗi loại; khóa resource đích sau các khóa này. Nạp lại actor/quyền và target trong cùng transaction, kiểm tra membership trước/sau khóa. Pair advisory lock hiện có chỉ lấy sau parent locks trong các luồng được sửa.

**Rationale**: Thao tác quản trị, create/send/accept/receive và mọi writer làm đơn thành IN_PROGRESS phải cùng giao thức khóa. Đọc điều kiện trước transaction hoặc chỉ lock cặp không ngăn phantom account mới, thay đổi trạng thái hay đơn của cặp khác. Khóa parent + Serializable và kiểm tra lại ngăn kết quả cuối trái quy tắc. Đọc role grants/denials trong transaction phát hiện thay đổi quyền đồng thời qua retry.

**Alternatives considered**: Memory/distributed lock qua Redis không atomic với PostgreSQL; trigger trái hướng kiến trúc; chỉ updateMany không phối hợp writer khác. `withSchoolTransaction` chỉ kiểm tra trạng thái tổ chức ACTIVE, không thêm chặn tạm dừng vào helper chung vì sẽ chặn cả hoàn tất công việc đã nhận.

**Giới hạn**: Bảo đảm cho writer backend tuân thủ giao thức. SQL trực tiếp ngoài Prisma không được xem là luồng nghiệp vụ của backend. Writer tương lai tạo/chuyển tài khoản, thay membership cán bộ, forward request hoặc chuyển IN_PROGRESS bắt buộc dùng guard trước khi được phát hành.

## R6 — Hiệu lực khóa và Redis

**Decision**: Dựa vào đọc trạng thái DB mỗi request/login/refresh để từ chối DEACTIVATED. Không bắt buộc xóa session Redis hàng loạt; không đổi namespace hoặc dùng wildcard. Không cache trạng thái tiếp nhận hoặc quyền cho quyết định ghi.

**Rationale**: `auth.middleware.ts`, `session.service.ts` và `session-identity.ts` đã đọc identity hiện hành. Không cần transaction xuyên PostgreSQL/Redis để đáp ứng FR-009. Tránh lỗi sau commit khiến người quản trị hiểu nhầm khóa chưa thành công.

**Alternatives considered**: Chỉ revoke Redis không bảo vệ đăng nhập lại; chờ access token hết hạn không đáp ứng lần yêu cầu tiếp theo; thêm claims tạm dừng vào JWT làm quyết định bị cũ.

## R7 — Kiểm thử và hiệu năng

**Decision**: Unit/HTTP injection dùng Node test runner; integration thật cho cascade atomicity, migration và race trên PostgreSQL disposable. EXISTS theo schoolId/supplierId+IN_PROGRESS và index người nhận; updateMany theo phạm vi, không N+1 session revocation. Không tự đặt SLA mới khi spec chưa yêu cầu tải/số lượng.

**Rationale**: Mock không chứng minh Serializable, unique index hay phantom. Bộ test local đã có harness trong `tests/authorization.integration.test.ts`, `tests/migrations.test.ts` và `tests/helpers/authorization.ts`.

**Alternatives considered**: Framework test mới, chạy trên Azure hoặc chạy test phá dữ liệu member đều không phù hợp quy định. Không thực thi kiểm thử hạ tầng trong bước lập kế hoạch.

## Kết luận nghiên cứu

Các quyết định thiết kế đã đủ để lập mô hình và hợp đồng. Kiểm tra dữ liệu cũ, quyền bootstrap và migration deploy là điều kiện vận hành có kiểm chứng, không phải cho phép ngầm thay đổi DB. Những luồng hoàn tất đơn/điều tra chưa tồn tại được giữ ngoài phạm vi; tính năng này cung cấp chính sách để chúng tích hợp sau.

## Lưu ý bootstrap quyền nhận báo cáo

Bootstrap hiện bảo toàn grants của role non-System đã tồn tại: tạo permission `food_safety_report.receive` trong catalog không tự gán quyền đó cho role cán bộ cũ. Sau bootstrap được phép, System Admin phải chủ động cấp quyền mới cho role qua chức năng quản trị; role cán bộ được tạo mới nhận grant mặc định. Không tự chạy bootstrap hoặc tự bật permission inactive trong ứng dụng hay CD.

## Audit writer khi triển khai

`auth/signup.service.ts` tạo applicant chưa gắn tổ chức; `auth/onboarding.service.ts` và `onboarding.repository.ts` tạo trường hoặc nhà cung cấp mới rồi mới gắn applicant trong cùng transaction, không chuyển thành viên vào tổ chức đã có. `auth/profile.repository.ts` và `auth/password.service.ts` chỉ cập nhật hồ sơ cá nhân hoặc mật khẩu. Chưa có writer production chuyển membership thông thường hay chuyển xã/role cán bộ, hoặc tạo forwarding yêu cầu kiểm tra; các writer tương lai phải gọi guard tương ứng trong cùng transaction. Các write đơn đang hoạt động gồm tạo/gửi tại supplier-onboarding và nhận tại supply-order; thao tác nhận report ghi tại reporting. Audit này không thay thế kiểm thử cạnh tranh trên PostgreSQL.

## Regression thu hồi quyền trong transaction đang chạy

Đã tái hiện bằng PostgreSQL tạm: thao tác nhận đơn tạm dừng sau loadPrincipal trước parent locks; toggle denial hoặc replaceRole commit trong khoảng đó; thao tác vẫn thành công theo snapshot cũ. Chọn version barrier trên User/Role và khóa Role actor sau User để retry đọc quyền mới. Giữ một shared TransactionClient, không đọc quyền ngoài transaction. Tránh thêm cột revision khi các row hiện có đã đủ phối hợp MVCC; no-op update Role không thay code/name hay createdAt. T052 bao gồm sửa tối thiểu permission.service và repository tương ứng do regression này.
