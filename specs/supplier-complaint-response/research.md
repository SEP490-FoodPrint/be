# Research: Nhà cung cấp xem và phản hồi khiếu nại

**Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

Nghiên cứu dựa trên mã nguồn và schema đang có trong repository, không sử dụng thông tin phiên bản thư viện bên ngoài. Các lượt nghiên cứu chỉ đọc về auth/transaction, luồng đọc và bổ sung complaintCode đã được tổng hợp dưới đây. Quyết định B trong spec là nguồn sự thật: giữ UUID, thêm mã lưu chung từ phía tạo khiếu nại. Các câu hỏi thiết kế đã có quyết định; khả năng tạo đơn của Ban Giám hiệu là phụ thuộc tích hợp được nêu riêng, không được nhận là đã triển khai.

## R1. Chọn đúng nghiệp vụ và giữ một bản ghi khiếu nại

- **Decision**: Mở rộng module `src/modules/ingredient-quality-feedback/`; dùng IngredientQualityFeedback hiện có, thêm complaintCode và một migration có sequence/backfill để đáp ứng FR-015. Không dùng MealComplaint, không tạo bảng nghiệp vụ, enum hoặc module trùng chức năng.
- **Rationale**: `prisma/schema.prisma` mô tả rõ phản hồi chất lượng nguyên liệu theo delivery/lot, chỉ nhà cung cấp chuyến giao được trả lời. Hai trạng thái `SUBMITTED/RESPONDED` và bốn trường phản hồi đã có. `prisma/migrations/0_init/migration.sql` có CHECK buộc các trường phản hồi cùng có hoặc cùng không có.
- **Alternatives considered**: Mở rộng khiếu nại suất ăn sẽ trộn trách nhiệm Ban Giám hiệu với nhà cung cấp; bảng hội thoại mới vượt phạm vi một phản hồi chính thức.

## R2. Đường dẫn và tương thích luồng đọc hiện có

- **Decision**: Giữ mount `/api/ingredient-quality-feedback`, mở rộng GET danh sách cho SUPPLIER; thêm GET `/:feedbackId` và POST `/:feedbackId/response`. SCHOOL/SYSTEM tiếp tục nhận danh sách cũ với cùng phạm vi, projection và thứ tự; SCHOOL có thể đọc endpoint chi tiết mới theo quyền hiện có. SYSTEM không được mở chi tiết mới hoặc phản hồi.
- **Rationale**: Module hiện chỉ có GET danh sách; select trong `ingredient-quality-feedback.service.ts` không có `supplierResponse` hay người phản hồi. FR-011 cần một cách để trường đọc câu trả lời. Chi tiết cho trường là bổ sung tối thiểu, không thay output danh sách cũ hoặc cấp thêm quyền.
- **Alternatives considered**: Chỉ làm endpoint cho supplier không đáp ứng trường đọc lại. Thêm phản hồi vào mọi item list cũ sẽ thay projection của khách hàng SCHOOL/SYSTEM. Tạo route supplier riêng làm trùng một nghiệp vụ đã có.

## R3. Trusted scope và kiểm tra đủ hai quyền

- **Decision**: Thêm helper typed scope trong `src/utils/resource-access.ts`: read scope phân biệt list/detail, response scope riêng supplier. Supplier chỉ nhận ADMIN/STAFF thuộc SUPPLIER, có supplierId và không có membership khác; đọc bắt buộc `ingredient_quality_feedback.view_details`. Ghi kiểm tra riêng cả quyền đó và `ingredient_quality_feedback.respond`. Nhánh SUPPLIER của listScopes dùng cùng quy tắc; nhánh SCHOOL/SYSTEM giữ quy tắc cũ.
- **Rationale**: `assertPermission(p, ...codes)` dùng OR; truyền cả hai code vào một lần không bảo đảm FR-002. `permission-catalog.ts` đã khai báo cả hai quyền cho hai role supplier; không cần thay catalog hay bootstrap. Chỉ có `view_own` không cho supplier đọc đơn do trường gửi.
- **Alternatives considered**: Chỉ kiểm tra role, dùng quyền OR cho ghi hoặc nhận supplierId từ request đều không đáp ứng quyền hiệu lực và cô lập tổ chức.

## R4. Trách nhiệm theo delivery, giữ khiếu nại lịch sử

- **Decision**: Mọi truy vấn supplier gắn `Delivery.supplierId` từ trusted scope. SCHOOL gắn `Delivery.schoolId`; chỉ có view_own thì thêm submittedByUserId. Không dùng membership hiện tại của tác giả/người phản hồi hay relationship/contract/status hiện tại để xác định sở hữu.
- **Rationale**: FR-003/004 giữ trách nhiệm giao dịch cũ sau ngừng liên kết. Các intake/continuation guards đang có kiểm tra trạng thái hiện tại, nên không phù hợp nghiệp vụ này.
- **Alternatives considered**: Chỉ lọc theo trường liên kết sẽ lộ giao dịch của nhà cung cấp khác; buộc liên kết ACTIVE sẽ ngăn xử lý khiếu nại tồn đọng.

## R5. Projection và lô nguyên liệu được kiểm chứng cùng chuyến

- **Decision**: Repository chỉ select allowlist. Service map danh sách mới và detail tường minh; user chỉ `{id, fullName}`, school chỉ `{id, name, code}`; code chưa có trả null. Chi tiết đọc lô bằng lotId nội bộ + deliveryId của khiếu nại + phạm vi supplier/school. Có lotId nhưng không tìm được lô hợp lệ thì báo503, không xuất id/mã lô ngoài phạm vi.
- **Rationale**: FK `ingredientLotId` chỉ bảo đảm lô tồn tại, không bảo đảm lô thuộc delivery của khiếu nại. Mở nested relation không kiểm chứng có thể làm lộ lô khác. Người gửi/người phản hồi có thể đã chuyển tổ chức nhưng danh tính đã ghi vẫn phải được giữ.
- **Alternatives considered**: Spread bản ghi hoặc nested include toàn bộ làm lộ trường ngoài allowlist; âm thầm trả null cho lô sai sẽ che dữ liệu không nhất quán.

## R6. Transaction và thứ tự khóa tương thích writer hiện có

- **Decision**: Service dùng `authorizationTransaction` trong `src/utils/authorization.ts`, mọi repository call dùng cùng tx. Đọc metadata actor/target scoped để lấy lock IDs; khóa theo thứ tự school → supplier → actor user → actor role → hai permission rows → delivery → complaint. Dùng `createIntakeAccessRepository().lockParents` cho parents và `lockDelivery`; SQL khóa complaint/permissions nằm trong repository, tham số hóa. Sau khóa đọc lại actor và target, kiểm tra roleId/role/org/supplierId không đổi và đủ hai quyền.
- **Rationale**: Staff denial/status writer khóa supplier/user/role; generic denial writer touchUser; role grant replacement khóa role FOR UPDATE và touchRole để snapshot cũ phải retry. User FOR UPDATE và role FOR SHARE của parent lock phối hợp với các writer đó. Permission rows FOR SHARE (sắp ID) bảo vệ hai isActive flags tại điểm quyết định ghi. Khóa school trước supplier giữ thứ tự chung với lifecycle/delivery writers; không kiểm tra trạng thái school/relationship trong thao tác lịch sử.
- **Alternatives considered**: Recheck actor trước transaction, khóa complaint trước parents, hoặc tái sử dụng intake guard không bảo đảm quyền tại lúc ghi hoặc dễ đảo thứ tự khóa. Không mở transaction độc lập trong repository.

## R7. Một câu trả lời chính thức, retry không che lỗi quá sớm

- **Decision**: Sau khi có khóa và recheck, repository update có điều kiện id + scoped Delivery + status SUBMITTED, đặt một lần supplierResponse/respondedByUserId/respondedAt/status. Count0 sau khi xác nhận scoped target tồn tại hoặc target RESPONDED trả409. Đọc lại detail trong cùng tx, map và chỉ trả200 sau commit.
- **Rationale**: Wrapper hiện dùng Serializable, tối đa3 attempts, nghỉ20/40ms; nhận conflict Prisma, SQLSTATE và direct DriverAdapterError tại COMMIT. Repository actor query phải dùng identitySelect + principalFromIdentity trực tiếp, không gọi loadPrincipal/databaseOperation để tránh biến conflict thành503 trước wrapper. Callback không có side effect bên ngoài DB.
- **Alternatives considered**: Read rồi update vô điều kiện ghi đè câu trả lời khác; upsert tạo reply mới sai vòng đời; retry trong repository tạo nhiều transaction; nuốt lỗi trong read helper làm hỏng phân loại409/503.
- **Concurrency boundary**: Khi phản hồi và thu hồi quyền cạnh tranh, kết quả theo thứ tự khóa/commit: thu hồi hoàn tất trước điểm chấp nhận thì phản hồi bị từ chối sau recheck/retry; phản hồi được chấp nhận trước thì thu hồi chờ và áp dụng cho thao tác kế tiếp. Không hứa hủy ngược một phản hồi đã commit.

## R8. Validation, serialization và lỗi

- **Decision**: Zod strictObject cho query/params/body, parseRequest tổng hợp lỗi tiếng Việt. Dùng paginationSchema và requestUuidSchema. Body duy nhất supplierResponse; trim hai đầu rồi đếm Unicode code points, 1–5.000; giữ newline và không normalize nội dung. Mốc thời gian ISO UTC, giá trị chưa có null. POST dùng cùng CSRF/session/rate limiter đang có.
- **Rationale**: requiredText(5000) hiện đếm UTF-16 units; refine theo Array.from(text).length diễn đạt rõ giới hạn ký tự, kể cả emoji. Quy tắc hợp lệ không yêu cầu client gửi actor/time/status.
- **Alternatives considered**: Schema lỏng cho phép overposting; dùng độ dài byte hoặc UTF-16 cho giới hạn đã chọn gây khác nhau với Unicode. Không thêm dependency hoặc cache quyền.

## R9. Kiểm chứng không tạo runner/hạ tầng mới

- **Decision**: Thêm tests/ingredient-quality-feedback.test.ts vào test:unit; scope regression trong authorization.test.ts; giữ modules.test.ts. Auth động/concurrency dùng authorization.integration.test.ts; dữ liệu/SQL/history/school readback dùng supplier-onboarding.integration.test.ts. Nhóm test:local:authorization đã được cấu hình chạy hai file này tuần tự, CI có cả hai nhóm; không khẳng định test feature đã chạy.
- **Rationale**: Tận dụng harness DB dùng một instance local được chọn, DB tạm có manifest cleanup; không tạo container/runner riêng. Sau FR-015 phải bổ sung tests/migrations.test.ts và chạy cả nhóm test:local:migrations; thêm tests/complaint-code.test.ts vào test:unit cho formatter/parser.
- **Alternatives considered**: Mock concurrency không chứng minh locking thật; test mới không được runner gọi không tạo được bằng chứng CI.
- **Current evidence**: Giai đoạn plan chỉ đọc source và tạo tài liệu; chưa triển khai source, chưa chạy test nghiệp vụ hoặc ghi DB. SC-006 cần nghiệm thu giao diện đầy đủ sau này.

## R10. Hai định danh và một nguồn cấp mã toàn hệ thống

- **Decision**: Giữ id UUID làm PK/FK và tham số đường dẫn. Thêm complaintCode String bắt buộc, unique toàn hệ thống, map complaint_code, varchar(25). Một PostgreSQL BIGINT sequence foodprint.ingredient_quality_feedback_complaint_code_seq cấp số1–9223372036854775807, CACHE1, NO CYCLE; không reset theo trường, supplier hoặc năm. Producer repository lấy nextval cùng transaction tạo đơn; producer service dùng formatter thuần để lưu mã FP-CP- cùng số có tối thiểu5chữ số. Sau99999 là FP-CP-100000, không cắt hoặc quay vòng.
- **Rationale**: Cột UUID hiện tại phải giữ nguyên; schema chưa có mã và src chưa có creator. Sequence có precedent ở prisma/migrations/20261106000100_registration_number/migration.sql; pure formatting theo src/utils/registration-id.ts và src/utils/delivery-code.ts. Một cột chuỗi lưu sẵn bảo đảm supplier chỉ get đúng mã do producer lưu. Cấp số theo sequence hỗ trợ nhiều producer và không dùng MAX+1; rollback/retry có thể bỏ số, không hứa dãy liên tục.
- **Alternatives considered**: Đổi PK sang mã phá FK/đường dẫn. Tính mã từ UUID hoặc format từ số khi GET không đáp ứng mã đã lưu. Counter model/table cần thêm đối tượng và hàng khởi tạo không cần thiết. DB default định dạng mã hoặc custom function/trigger che trách nhiệm producer, không chọn.
- **Validation**: Formatter/parser dùng BigInt, canonical uppercase; số0/âm/vượt BIGINT bị từ chối. CHECK canonical-positive và numeric range trong migration, dùng nhánh CASE để không cast chuỗi sai định dạng. Supplier list/detail/response chọn complaintCode đã lưu, không gọi nextval/setval/formatter để cấp mã. Thiếu hoặc sai mã trả503 an toàn, không null/fallback hoặc lazy backfill.

## R11. Backfill dữ liệu cũ và cửa sổ triển khai

- **Decision**: Migration mới dự kiến prisma/migrations/20261120000300_ingredient_feedback_complaint_code/migration.sql, kiểm tra lại collision/thứ tự trước khi tạo. Transaction khóa bảng ingredient_quality_feedback ACCESS EXCLUSIVE, thêm cột nullable rồi gán mã theo row_number(created_at ASC,id ASC), không sửa UUID, ownership, nội dung hoặc phản hồi. Giữ timestamps chính xác, SQL set updated_at bằng chính giá trị cũ. Sau đó áp NOT NULL, unique và CHECK; tạo sequence mới và setval theo số lượng N: N>0 thì lần tới N+1, N=0 thì lần tới1. Mỗi bản ghi cũ chỉ được cấp mã trong migration đã review này, không cấp lại ở request.
- **Rationale**: Mã lịch sử chưa tồn tại nên phải được cấp một lần trước khi API yêu cầu string bắt buộc. Backfill riêng trong migration khác với supplier sinh mã lúc đọc. Không dùng lpad với độ dài5 cố định vì PostgreSQL có thể cắt số dài; dùng width max(5,length(numberText)) hoặc cách padding không cắt.
- **Alternatives considered**: Trả null cho dữ liệu cũ trái hợp đồng mã bắt buộc; endpoint GET ghi mã là side effect không được phép; sửa baseline hoặc dữ liệu/timestamp lịch sử không chấp nhận. Không chạy lại setval ở startup hoặc reconcile tự động để tái sử dụng số.
- **Rollout**: Tạm dừng mọi producer ghi khiếu nại trong cửa sổ bảo trì được duyệt, áp migration mới, xác minh backfill/sequence và triển khai producer biết cấp/lưu mã trước khi mở ghi lại. Không rolling writer cũ vì cột NOT NULL không có default; writer thiếu mã phải fail. Migration và thao tác DB thực chỉ chạy khi đã có authorization cho đúng target; plan không thực thi DDL. Không sửa migration đã áp dụng hoặc khẳng định Azure đã deploy.

## R12. Producer Ban Giám hiệu là phụ thuộc tích hợp rõ ràng

- **Decision**: Chốt [hợp đồng producer](contracts/complaint-code-producer.md) gồm shared allocator, pure formatter và insert cùng transaction, không thêm HTTP tạo đơn trong feature supplier. Source hiện chỉ có GET list cho ingredient-quality-feedback, chưa có ingredientQualityFeedback.create/createMany hoặc API tạo đơn BGH. Role SCHOOL_MANAGEMENT_BOARD hiện chưa có default submit/view_details tương ứng; không tự cấp thêm quyền trong feature này.
- **Rationale**: User yêu cầu dùng cùng id/mã của đơn trường tạo, không yêu cầu nhà cung cấp tạo bản sao hoặc xây toàn bộ producer. Chuẩn bị storage/allocator/contract cho producer là công việc dùng chung cần có để FR-015 có thể tích hợp; owner luồng tạo phía trường phải thực hiện authorization nghiệp vụ của mình và trả UUID cùng mã đã commit.
- **Alternatives considered**: Tuyên bố endpoint BGH đã tồn tại, tự mở route/grant, hoặc dùng fixture như bằng chứng producer production đã hoàn tất đều vượt phạm vi/thiếu bằng chứng. Test fixture có thể mô phỏng hợp đồng để kiểm chứng shared data và supplier readback nhưng phải ghi đúng giới hạn.
- **Readiness**: Gate thiết kế hoàn tất khi storage/producer contract/backfill đã chốt. Supplier có thể kiểm chứng trên dữ liệu đã backfill và fixtures; nghiệm thu hành trình BGH tạo đơn thật → supplier đọc chỉ được ghi đạt sau khi producer phía trường được tích hợp và kiểm chứng trên môi trường được phép. Đây là phụ thuộc bàn giao, không phải điểm mơ hồ còn chờ chọn phương án.
