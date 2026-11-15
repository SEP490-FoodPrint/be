# Research: Supplier order creation

**Date**: 2026-11-15

## 1. Dùng Delivery hiện có với nguồn tùy chọn

**Decision**: Mở rộng Delivery/DeliveryItem, không tạo đối tượng đơn thương mại mới. Thêm Delivery.schoolId bắt buộc và DeliveryItem.ingredientId bắt buộc làm định danh tổ chức/nguyên liệu chuẩn; supplyRequestId và supplyRequestItemId được nullable. Thêm ingredientEntryId tùy chọn để lưu ánh xạ danh mục trường cho nhận kho. Tất cả phiếu vẫn có trường nhận; độc lập nghĩa là không có yêu cầu nguồn.

**Rationale**: Schema hiện bắt buộc hai FK nguồn; sửa thành nullable đơn thuần làm mất school scope và thông tin nguyên liệu. Đối tượng người dùng yêu cầu phục vụ giao hàng, có trạng thái CREATED đã có. Không tạo SupplyRequest giả hoặc tự tạo IngredientEntry vì entry yêu cầu handlingType do trường quyết định.

**Alternatives considered**: Bảng đơn mới tạo một tầng nghiệp vụ chưa được yêu cầu; nguồn giả trái FR-004; chỉ nullable FK làm hỏng đọc/kiểm nhận/kho.

## 2. Bảo toàn lịch sử và một đơn từ yêu cầu

**Decision**: Thêm creationMode nullable (REQUEST/STANDALONE; null chỉ cho lịch sử) và partial unique supplyRequestId WHERE creation_mode='REQUEST'. Service còn từ chối tạo từ yêu cầu nếu đã có bất kỳ Delivery liên quan, gồm lịch sử. Không đặt unique toàn cục supplyRequestId hoặc xóa/deduplicate lịch sử.

**Rationale**: Các fixture và nghiệp vụ hiện có nhiều Delivery cho một yêu cầu; global unique phá lịch sử. Null legacy giữ các phiếu cũ không bị gán thành các đơn tạo mới tuân theo quy tắc một đơn. Public sourceType của lịch sử nguồn có thể trình bày REQUEST, chỉ marker nội bộ phục vụ tương thích migration.

**Alternatives considered**: Backfill mọi lịch sử thành REQUEST rồi unique không thể áp dụng khi có nhiều phiếu; đánh số lại/xóa phiếu là sai phạm vi.

## 3. Quyền hiện hành

**Decision**: Tạo/options yêu cầu đúng hai role supplier và delivery.manage. List/detail management chấp nhận delivery.view HOẶC delivery.manage HOẶC delivery.receive như resource delivery hiện hành, đồng thời role supplier/membership hợp lệ. Dùng listScopes cho mọi list và supplierId tin cậy; schoolId body chỉ là target phải xác minh quan hệ ACTIVE, không phải scope do client quyết định.

**Rationale**: Cả hai role supplier đã có delivery.manage nhưng không có delivery.view. Bắt view đơn lẻ sẽ khóa người dùng hợp lệ. School inspections giữ quyền view/inspect và bốn role hiện hành.

**Alternatives considered**: Quyền mới/seed grants không cần thiết; role-only hoặc SYSTEM bypass không được phép.

## 4. Idempotency bền vững

**Decision**: Idempotency-Key UUID bắt buộc cho POST. Lưu creationKey và creationFingerprint (SHA-256 payload đã chuẩn hóa, gồm sourceType, nguồn/target/items và metadata) trên Delivery. Unique supplierId + createdByUserId + creationKey khi key khác null. Cùng actor/key/hash trả phiếu cũ, khác hash 409; key khác là ý định khác nhưng nguồn REQUEST vẫn chịu giới hạn một phiếu. Không dùng Redis để quyết định tạo trùng. Mã deliveryNo do hệ thống sinh DG-<UUID>, không có số tuần tự.

**Rationale**: Cần phân biệt retry với hai đơn độc lập trùng nội dung có chủ ý, kể cả sau restart hoặc nhiều process. Unique và Serializable xử lý race; helper transaction retry đọc lại kết quả đã commit.

**Alternatives considered**: Cache bộ nhớ/Redis không bảo đảm cùng transaction với ghi; dùng hash nội dung làm unique cấm các đơn độc lập riêng biệt hợp lệ.

## 5. Giao dịch và quan hệ ACTIVE

**Decision**: Dùng authorizationTransaction Serializable hiện có. Khóa School -> Supplier -> User actor -> Role actor FOR SHARE -> cặp trường/supplier theo advisory lock hiện có -> quan hệ -> nguồn SupplyRequest nếu có -> Ingredient theo ID tăng dần. Nạp lại actor/quyền/membership; REQUEST dùng guard START_ORDER_PROCESSING + delivery.manage, đối chiếu đầy đủ dòng nguồn và nguồn chưa có phiếu. STANDALONE kiểm tra ACTIVE school/supplier/admin, intake hai đơn vị ACTIVE, quan hệ ACTIVE và Ingredient ACTIVE thuộc supplier, unit đúng defaultUnit; không tự tạo entry trường. Supplier pause hoặc school pause chặn standalone mới; retry đã tạo chỉ kiểm tra quyền và scope, không tạo ghi mới.

**Rationale**: REQUEST thực hiện công việc đã nhận, không được áp hồi tố điều kiện tạo độc lập. Standalone là cung ứng mới nên không được vượt chính sách pause. Guard hiện có không có operation source-less; thêm operation SUPPLIER_CREATE_STANDALONE_DELIVERY theo cùng protocol, không dùng source giả. Các writer liên kết/nguyên liệu có liên quan phải được rà soát và đồng bộ thứ tự khóa/retry để cùng bảo vệ việc recheck.

**Alternatives considered**: Kiểm tra một lần ở controller hoặc khóa chỉ Delivery không bảo vệ đổi quyền/quan hệ; gọi guard nhận yêu cầu sai operation và sai pause semantics.

## 6. Kiểm nhận và đường đọc không có nguồn

**Decision**: Dùng schoolId/ingredientId/ingredientEntryId chuẩn trên Delivery/Item. Cập nhật resource-access, delivery reads/inspections, warehouse, kitchen và menu để không bắt buộc đi qua nguồn. Với standalone, bốn role kiểm nhận vẫn áp dụng, nhưng không dùng request count/cancel/quantity budget; REJECT chỉ đóng phiếu đó, không gom mọi supplyRequestId null thành một nhóm. Đơn có nguồn giữ trọn giới hạn ba lần từ chối và ngân sách nhận theo dòng nguồn. Request number/budget có thể null và DTO thể hiện rõ sourceType.

**Rationale**: Source scan thấy resource-access.ts dùng request để scope warehouse/delivery/inventory/quality-feedback/traceability; kitchen/menu dùng source item -> IngredientEntry để chọn lô. Trước khi standalone lot được RECEIVED/AVAILABLE, phải có IngredientEntry của đúng trường/nguyên liệu để xác định handlingType; lookup entry đã có và gắn ingredientEntryId trong receipt transaction. Nếu chưa cấu hình, trả 409 rõ lý do, không tự tạo entry hay nhập kho. Tạo CREATED vẫn thành công khi entry chưa tồn tại. Không mở action giao vận/lập lô mới trong feature này.

**Alternatives considered**: Giữ đường join cũ làm mất đơn độc lập; bỏ tất cả kiểm nhận trái nguyên tắc; tự mặc định handlingType suy diễn nghiệp vụ. Gom đơn độc lập với yêu cầu cũ sẽ đổi quyết định người dùng đã chốt.

## 7. Phạm vi refactor và kiểm chứng

**Decision**: Module supplier-order mới chứa management API, layering đủ bảy file, persistence vẫn Delivery. Delivery legacy/inspection refactor tối thiểu: chuyển query đang nằm trong delivery.service.ts về delivery.repository.ts khi chạm vào nhánh đó. Không sửa toàn bộ module ngoài phần ảnh hưởng. Backfill schema bằng migration mới được review; thử trên disposable local, không deploy DB thành viên/Azure trong bước plan.

**Rationale**: Delivery.service hiện chứa select và Prisma args, repository inspection còn import Request DTO; các đường chạm sửa phải tuân AGENTS. Cô lập management giúp bảo toàn API GET/inspection cũ và giảm file trùng khi chia việc. Không thêm client hoặc framework.

**Alternatives considered**: Nhồi toàn bộ vào service hiện có duy trì vi phạm phân lớp; refactor toàn repository không liên quan làm tăng scope.

## Kết quả

Các quyết định kỹ thuật đã chốt theo source và spec, không còn câu hỏi bắt buộc trước thiết kế. Thay đổi schema được mô tả trong data-model; không có DDL/migration/code sản xuất nào được chạy ở bước plan. Các hành vi sau CREATED cần dữ liệu lô/đến nơi hợp lệ qua luồng riêng, không tự sinh trạng thái để vượt kiểm nhận.
