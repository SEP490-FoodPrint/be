# Research: Đổi trạng thái nguyên liệu

**Date**: 2026-11-16

**Scope**: Quyết định dựa trên mã nguồn và hợp đồng hiện có trong repository. Không đổi dependency hoặc triển khai ở bước nghiên cứu.

## 1. Hợp đồng đổi trạng thái

**Decision**: Thay `POST /api/ingredients/management/:ingredientId/hide` bằng `PATCH /api/ingredients/management/:ingredientId/status`, JSON bắt buộc có đúng `status: "ACTIVE" | "INACTIVE"`. Đặt tên handler/service/repository là `changeStatus`; schema là `ingredientChangeStatusSchema`.

**Rationale**: FR-001–004 yêu cầu một thao tác đặt trạng thái đích, có thể gửi lặp. Hình thức route `/:id/status` đã được dùng trong quản trị lớp, phù hợp với việc sửa riêng trạng thái; route PATCH sửa thông tin hiện có tiếp tục từ chối trường status.

**Alternatives considered**: Thêm route restore riêng gây hai thao tác; toggle tự đảo có thể đảo sai khi gửi lặp; giữ alias hide trái phạm vi đã xác nhận. Không dùng PATCH thông tin chung vì nó có hợp đồng editable riêng.

**Evidence**: `src/modules/ingredient/ingredient.routes.ts`, `ingredient.validation.ts`; `specs/016-school-class-management/contracts.md`; `spec.md` FR-001–004, FR-012.

## 2. Schema và dữ liệu

**Decision**: Dùng nguyên `Ingredient.status: EntityStatus` hiện có. Không đổi Prisma schema, enum, index hay migration. Mở lại giữ chính bản ghi đã ẩn.

**Rationale**: Hai giá trị ACTIVE/INACTIVE, chủ sở hữu và các quan hệ đã có đầy đủ. `updatedAt` dùng `@updatedAt`; tránh mọi lệnh ghi khi trạng thái đích trùng trạng thái hiện tại.

**Alternatives considered**: Cột isVisible riêng tạo hai nguồn trạng thái; bản ghi mới khi mở lại phá định danh/lịch sử; thêm audit hoặc history table vượt yêu cầu.

**Evidence**: `prisma/schema.prisma` model Ingredient; `spec.md` FR-003–004, FR-009.

## 3. Phân quyền và transaction

**Decision**: Tái sử dụng `ingredientManagementScope` và helper `write` của ingredient service. Trong một `authorizationTransaction`, nạp actor hiện tại, kiểm tra scope, khóa supplier và kiểm tra supplier ACTIVE, khóa target trong scope rồi đọc target. Không mở transaction mới ở repository.

**Rationale**: Luồng hiện có đã kiểm tra role, membership và ingredient.manage, so sánh membership hiện tại với principal ban đầu và dùng Serializable. Cả trường hợp không cần ghi cũng phải đi qua luồng này.

**Alternatives considered**: Chỉ kiểm tra middleware không phát hiện principal cũ ở service; dùng supplierId từ body phá cô lập; thêm bypass cho System Admin trái ma trận quyền.

**Evidence**: `src/modules/ingredient/ingredient.service.ts` helper write; `ingredient.repository.ts` actor/lockSupplier/lockTarget; `src/utils/resource-access.ts` ingredientManagementScope; `src/utils/authorization.ts`.

## 4. Yêu cầu lặp, khóa và ghi đồng thời

**Decision**: Service so sánh trạng thái sau khóa. Nếu bằng đích, map bản ghi hiện tại và trả, không gọi mutation. Nếu khác, gọi repository operation có input nội bộ là trạng thái đích, scope và transaction. Repository áp WHERE gồm id, supplierId, trạng thái khác đích rồi chỉ ghi status; đọc lại trong cùng transaction. Chỉ trả thành công sau commit.

**Rationale**: Giữ quyết định vòng đời tại service, truy vấn tại repository, tránh đổi updatedAt khi gửi lặp. Khóa target/supplier và retry có sẵn xử lý cạnh tranh với chỉnh sửa thông tin; ghi trạng thái không ghi đè các trường editable.

**Alternatives considered**: Luôn update làm đổi timestamp khi lặp; đọc ngoài transaction có cửa sổ cạnh tranh; thêm version/If-Match thay đổi hợp đồng vượt yêu cầu.

**Evidence**: `ingredient.repository.ts` hide hiện tại cập nhật có điều kiện; `authorizationTransaction` dùng Serializable, maxWait 10 giây, timeout 20 giây, tối đa ba lần thử với xung đột được nhận diện. Hết retry dùng lỗi 503 hiện có, không cam kết mọi yêu cầu cạnh tranh đều thành công.

## 5. Lựa chọn nguyên liệu và lịch sử

**Decision**: Giữ các bộ lọc đọc hiện hành. Quản trị thấy cả hai trạng thái; trường chỉ thấy nguyên liệu ACTIVE của đối tác đủ điều kiện. Mở lại chỉ phục hồi điều kiện status, không mở lại quan hệ hoặc giao dịch.

**Rationale**: `listScopes.ingredient` lọc status ACTIVE trong scope SCHOOL nhưng scope SUPPLIER đọc được cả hai. Không thể áp bộ lọc ACTIVE toàn cục vì sẽ làm sai quyền đọc lịch sử/quản trị.

**Alternatives considered**: Sửa mọi list thành ACTIVE hoặc mở lại mọi hồ sơ liên quan làm thay đổi nghiệp vụ ngoài phạm vi. Không bổ sung cache; module hiện không cache các lần đọc này.

**Evidence**: `src/utils/resource-access.ts` listScopes.ingredient; `tests/supplier-onboarding.integration.test.ts` kịch bản ẩn và ingredient-options; `spec.md` FR-009–012.

## 6. Tương thích và phạm vi cập nhật

**Decision**: Xóa đăng ký route hide và các symbol hide chuyên biệt trong module. Cập nhật callers trong tests, ma trận quyền và README module. Contract 008 là tài liệu lịch sử; bổ sung liên kết từ tài liệu sử dụng hiện tại sang contract mới, không sửa hàng loạt spec đã triển khai.

**Rationale**: Thay route là thay đổi hợp đồng có chủ đích theo user. Client ngoài repo cần chuyển sang PATCH status trong cùng đợt phát hành; POST hide với tài khoản hợp lệ sẽ đi vào xử lý 404 hiện có, không redirect.

**Alternatives considered**: Alias/deprecation tạm thời duy trì hai đường ghi trạng thái; làm mới spec lịch sử hàng loạt gây lệch phạm vi.

**Evidence**: `docs/AUTHORIZATION.md`, `src/modules/README.md`, `tests/ingredient-management.test.ts`, `tests/authorization.integration.test.ts`, `tests/supplier-onboarding.integration.test.ts`.

## 7. Kiểm chứng

**Decision**: Mở rộng file unit/HTTP/repository hiện có và integration authorization hiện có. Chuyển caller cũ trong supplier onboarding; đặt coverage cần thiết về biến mất/xuất hiện lại trong lựa chọn main/seasoning vào authorization integration để chạy qua wrapper quản lý DB. Chạy kiểm thử ghi chỉ trên PostgreSQL local tạm khi có ủy quyền cho lần chạy đó.

**Rationale**: Unit fixture không chứng minh được timestamp thực hoặc thứ tự khóa PostgreSQL; integration cần chứng minh no-op, rollback, cô lập và trạng thái sau cạnh tranh. Không thêm framework.

**Alternatives considered**: Chỉ test validator bỏ sót quyền/lịch sử; chạy trên database thành viên/Azure vi phạm chính sách. Không tạo container PostgreSQL mới cho từng lần chạy.

**Evidence**: `package.json`, `tests/helpers/run-local-tests.ts`; hướng dẫn cụ thể và giới hạn runner tại `quickstart.md`.

**Runner finding**: Suite supplier-onboarding.integration tự CREATE DATABASE/migrate, không ghi manifest của wrapper và chỉ đăng ký disconnect. Không khuyến nghị chạy suite này trực tiếp trong hướng dẫn local mặc định; cần quản lý instance tạm và cleanup riêng nếu thực thi. Điều này không ngăn cập nhật caller để tương thích route mới.

## Kết quả Phase 0

Các quyết định về route, dữ liệu, quyền, no-op, concurrency, tương thích và kiểm chứng đã được giải quyết. Đủ điều kiện sang Phase 1; không có câu hỏi mở cần người dùng xác nhận.
