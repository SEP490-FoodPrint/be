# Research: Nhà cung cấp xem trường đã liên kết

**Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

Nghiên cứu dựa trên mã nguồn hiện tại và hai nhánh nghiên cứu chỉ đọc: truy vấn/phân trang và phân quyền/tài liệu/kiểm thử. Không chạy truy vấn dữ liệu thực, thay đổi quyền hoặc thay đổi cấu trúc dữ liệu trong giai đoạn lập kế hoạch.

## R1. Tách chức năng tra cứu phía nhà cung cấp

- **Decision**: Tạo module `supplier-school`, mount tại `/api/supplier-schools`, có năm GET cho trường, hợp đồng và tệp; tái sử dụng hạ tầng dùng chung.
- **Rationale**: `src/modules/school-supplier/` hiện trả danh sách từng quan hệ, còn `supplier-onboarding.service.ts` chỉ cho phía SCHOOL đọc hợp đồng và tệp. Chức năng mới cần một trường một mục, vai trò admin và lịch sử hợp tác; sửa phạm vi các API cũ sẽ tác động quyền người dùng khác.
- **Alternatives considered**: Dùng danh sách tổ chức công khai không chứng minh quan hệ; sửa API hợp đồng phía trường làm mở rộng quyền ngoài tính năng; sao chép cả luồng onboarding tạo nghiệp vụ trùng lặp.

## R2. Phân quyền hiện tại và mặc định cho cài đặt mới

- **Decision**: Thêm `supplierSchoolReadScope` trong `src/utils/resource-access.ts`; yêu cầu `ROLES.INGREDIENT_SUPPLIER_ADMIN`, `ORG_TYPES.SUPPLIER`, supplierId có thật trong principal, không có schoolId/communeFoodSafetyUnitId và OR quyền `supplier_relationship.view`/`supplier_relationship.manage`. Thêm resource `supplier-school` vào `RESOURCE_PERMISSIONS` và `listScopes`, trả scope tối thiểu `{ supplierId }`; router và mọi service method dùng cùng helper, repository nhận scope tin cậy.
- **Rationale**: `listScopes["school-supplier"]` cũng cho SYSTEM/SCHOOL và không giới hạn staff, nên không dùng nguyên trạng. `authenticate` tải tài khoản ACTIVE, role, membership và quyền hiện tại cho mỗi request; không dùng JWT org claim, không cache quyền.
- **Decision về catalog**: Thêm duy nhất default grant existing `supplier_relationship.view` cho `INGREDIENT_SUPPLIER_ADMIN` trong `src/constants/permission-catalog.ts`. Không thêm permission, không cấp quyền manage, không cấp cho staff.
- **Rollout**: `authorization-bootstrap.ts` chỉ thêm grants mặc định khi role chưa tồn tại (ngoại trừ SYSTEM_ADMIN). Bootstrap không cập nhật grants của supplier admin hiện hữu. Trên hệ thống đang dùng, operator có thẩm quyền phải cấp quyền qua quy trình quản lý role hiện hành; không tự seed/startup/CD. Chi tiết tại [quickstart.md](quickstart.md).
- **Alternatives considered**: Bypass quyền khi đúng role trái hiến chương; thay bootstrap để cập nhật role đã có sẽ ghi đè chính sách bảo toàn grants.

## R3. Đại diện liên kết trước khi phân trang

- **Decision**: Repository dùng tagged `tx.$queryRaw`, CTE `DISTINCT ON (school_id)` trên `foodprint.school_supplier_relationships`, lọc supplierId trước. Thứ tự nội bộ: school_id, nhóm ACTIVE/SUSPENDED trước UNLINKED, linked_at giảm dần, id tăng dần. Truy vấn ngoài join `foodprint.schools`, sắp linked_at của đại diện giảm dần rồi school_id tăng dần; sau đó mới OFFSET và LIMIT limit+1.
- **Rationale**: Partial unique `uq_school_supplier_current` đảm bảo tối đa một ACTIVE/SUSPENDED cho mỗi cặp; nhiều UNLINKED vẫn hợp lệ. Thứ tự đại diện có thể khác bản ghi mới nhất nếu dữ liệu lịch sử có thời điểm bất thường. Quy tắc rõ ràng khớp FR-004 và không phụ thuộc thứ tự enum.
- **Projection**: Chọn cột tường minh, đặt alias kết quả theo kiểu persistence nội bộ; không SELECT *, không nội dung tài liệu. Dùng tham số UUID/offset/take đã chuẩn hóa, không nối chuỗi hoặc queryRawUnsafe.
- **Chi tiết**: Dùng cùng biểu thức chọn đại diện, bổ sung schoolId trong bộ lọc của CTE; projection thêm trường hồ sơ và mốc/lý do tạm ngưng, hủy.
- **Alternatives considered**: Phân trang quan hệ rồi distinct trong bộ nhớ làm thiếu/trùng trường; lấy toàn bộ quan hệ để sort/slice không giới hạn tải; Prisma distinct theo schoolId không thể hiện đầy đủ cả ưu tiên đại diện và thứ tự trang theo thời điểm đại diện.

## R4. Phạm vi hợp đồng và tính nhất quán

- **Decision**: Dùng `withReadTransaction` RepeatableRead cho mỗi service operation. Repository kiểm tra parent trường có quan hệ bất kỳ với supplierId hiện tại trước khi đọc danh sách hợp đồng; hợp đồng lọc cả schoolId, supplierId và ACTIVE/CLOSED. Danh sách hợp đồng dùng createdAt DESC, id ASC, skip/take limit+1.
- **Rationale**: `src/utils/read-transaction.ts` có sẵn snapshot nhất quán, giữ HttpError và chuẩn hóa lỗi hạ tầng thành503. Không gọi `readListPage` bao trùm parent check vì helper này chuyển mọi lỗi thành503, có thể làm mất404.
- **Lịch sử**: Không bắt relationshipId của hợp đồng trùng quan hệ đại diện, không lọc ngày hiệu lực, trạng thái trường hoặc trạng thái quan hệ. Hợp đồng legacy thiếu relationshipId vẫn đọc được khi đúng cặp có quan hệ. Không suy diễn quyền đặt hàng từ quyền đọc.
- **Alternatives considered**: Dùng write transaction/khóa hàng không cần thiết cho chức năng chỉ đọc; điều kiện còn hiệu lực làm mất hợp đồng lịch sử và hợp đồng đã kích hoạt trước ngày bắt đầu.

## R5. Tệp riêng tư từ nơi lưu hiện tại

- **Decision**: Đọc `SupplierContractDocument.content` ByteA qua endpoint nội dung riêng, chỉ cho SIGNED_CONTRACT/APPENDIX của hợp đồng ACTIVE/CLOSED thuộc đúng schoolId+supplierId+contractId. Parent phải còn tồn tại ít nhất một quan hệ bất kỳ. Không kiểm tra tổ chức hiện tại của uploader vì người tải có thể chuyển đơn vị.
- **Rationale**: Dữ liệu đã có đầy đủ metadata/content trong `prisma/schema.prisma`. `supplier-onboarding.rules.ts:validateDocument` hiện nhận PDF/PNG/JPEG; controller tải xuống hiện có thiết lập nosniff, CSP sandbox và private/no-store. Metadata không cần bytes hoặc sha256.
- **Response**: Query `disposition=inline|attachment` (mặc định inline) cho cùng tệp gốc. Content-Type theo dữ liệu hợp lệ đã lưu; tên UTF-8 được mã hóa an toàn trong Content-Disposition; nosniff, CSP sandbox và private/no-store. Không redirect URL công khai hoặc tạo link bỏ qua auth. Content-Length dùng số byte thực.
- **Lỗi**: Không có bản ghi/ngoài scope/nháp/COMPLIANCE đều404 chung. Có bản ghi nhưng bytes rỗng, dữ liệu nội dung không hợp lệ hoặc lỗi đọc thì503 tiếng Việt trước khi gửi headers nội dung; metadata và hồ sơ vẫn đọc độc lập.
- **Alternatives considered**: Trả content trong JSON danh sách tải cả tệp không cần thiết; đưa lên Cloudinary hoặc thêm kho mới gây thay đổi không có yêu cầu; reuse download phía trường mở sai actor.

## R6. Kiểm thử, triển khai và giới hạn nghiệm thu

- **Decision**: Unit/HTTP dùng Node test runner và injected auth/service/repository; thêm `tests/supplier-school.test.ts` vào test:unit. Thêm regression thực PostgreSQL vào `tests/supplier-onboarding.integration.test.ts`, vốn đã chạy qua CI và child của `test:local:authorization`; thêm regression scope/catalog/bootstrap vào test authorization hiện có khi thích hợp.
- **Rationale**: Không cần framework, suite runner hoặc database mới. Truy vấn DISTINCT ON phải được kiểm chứng bằng PostgreSQL thật, không chỉ mock. Fixture chỉ nằm trong database disposable được tạo và ghi manifest bởi hạ tầng test hiện tại.
- **SC-006**: Đây là nghiệm thu thao tác trên luồng sử dụng hoàn chỉnh, để trạng thái chưa đo cho đến khi có giao diện và người dùng; backend tests chỉ chứng minh SC-001–SC-005.
- **Alternatives considered**: Unit mô phỏng distinct không chứng minh SQL thực; tạo container riêng hoặc tự seed database của thành viên trái chính sách.

## Kết luận nghiên cứu

Các quyết định kỹ thuật đã được giải quyết bằng cấu trúc và dữ liệu hiện có. Không cần migration, model, thư viện hoặc biến môi trường mới. Thiết kế giữ nguyên các mặc định nghiệp vụ trong Assumptions của spec.
