# Research: Supplier order intake

**Date**: 2026-11-14

## 1. Hoàn thiện module hiện có

**Decision**: Mở rộng `src/modules/supply-order/`, giữ mount `/api/supply-requests`. Thêm GET chi tiết và mở rộng nhánh danh sách SUPPLIER; dùng lại POST `/:id/accept`.

**Rationale**: Routes, service, repository, validation và hai DTO đã có. GET hiện chỉ phân trang và trả định danh, trạng thái, thời điểm; chưa có chi tiết. POST đã ghi `acceptedByUserId`, `acceptedAt` và trả receipt bốn trường. Router supplier-onboarding tạo/gửi đơn được mount trực tiếp dưới `/api`, không có tiền tố tên module.

**Alternatives considered**: Module/đơn hàng mới tạo ra vòng đời trùng lặp; endpoint `/supply-orders` làm sai đường dẫn đang được đăng ký.

## 2. Quyền và vai trò

**Decision**: Dùng hai role trong `ROLES`, org `SUPPLIER` và membership hợp lệ, quyền `supply_request.view` cho đọc và `supply_request.accept` cho ghi. Kiểm tra hai vai trò tường minh trong nhánh SUPPLIER, trong service trước giao dịch và trong guard đối với actor được nạp lại trước khi ghi/return receipt. Giữ helper `listScopes["supply-order"]` làm nguồn scope cho GET danh sách.

**Rationale**: `src/constants/permission-catalog.ts` đã có cả hai quyền và grants cho cả admin/staff; không cần migration/bootstrap mới. `authenticate` nạp quyền hiện hành theo `sub`. Guard hiện chỉ yêu cầu org/quyền, chưa kiểm tra allowlist hai role riêng cho operation này.

**Alternatives considered**: Chặn staff như quản lý nguyên liệu trái yêu cầu; chỉ kiểm tra role bỏ qua denial; thêm quyền mới là dư thừa.

## 3. Danh sách và khả năng tương thích

**Decision**: SUPPLIER chỉ xem năm trạng thái `SENT`, `ACCEPTED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, thêm bộ lọc `status`. Dùng trạng thái làm tiêu chí đã rời nháp theo FR-004; không bổ sung điều kiện `sentAt != null`, để không ẩn các bản ghi lịch sử thiếu thời điểm gửi. Repository luôn giao scope tin cậy với tập trạng thái cho phép, không để query ghi đè scope. Giữ thứ tự `id asc`, `page/limit`, lấy thêm một bản ghi để tính `hasNext`.

**Rationale**: `resource-access.ts` hiện chỉ lọc supplierId, nên DRAFT xuất hiện trong danh sách nhà cung cấp. FR-004 xác định ranh giới bằng trạng thái; `sentAt` nullable và thông tin thiếu phải được giữ trống. SCHOOL/SYSTEM tiếp tục scope, projection và phân trang cũ; `status` chỉ được dùng cho SUPPLIER, nhánh khác gửi trường này trả 400 như trước.

**Alternatives considered**: Sửa scope toàn cục để ẩn DRAFT cho trường sẽ làm đổi luồng trường; thay toàn bộ response hoặc thêm total/sort/search vượt phạm vi.

## 4. Chi tiết và dữ liệu lịch sử

**Decision**: GET `/:id` chỉ dành cho hai role SUPPLIER có quyền xem, lọc id + supplierId + trạng thái ngoài nháp. Select các trường yêu cầu đã duyệt và `School.id/name`; từng dòng lấy `IngredientEntry.id -> Ingredient.name`. Không lọc ACTIVE cho nguyên liệu/entry lịch sử. Sắp xếp dòng `id asc`. Người nhận được biểu diễn bằng `acceptedByUserId`, không cần truy vấn hồ sơ người dùng.

**Rationale**: Schema sẵn có mọi quan hệ và trường. Số lượng/đơn vị lấy từ `SupplyRequestItem`, không lấy defaultUnit hiện tại. Không có ảnh chụp tên lịch sử nên dùng tên hiện tại theo giả định spec. Receipt cũ chỉ có id người nhận và phải giữ nguyên.

**Alternatives considered**: Trả toàn bộ contractSnapshot/tài khoản là thừa dữ liệu; thêm bảng snapshot chưa được yêu cầu; lọc nguyên liệu đang hoạt động sẽ làm mất dòng lịch sử.

## 5. Giao dịch và thử lại

**Decision**: Giữ `authorizationTransaction` Serializable, tối đa ba lượt thực thi khi xung đột được nhận diện. Giữ thứ tự khóa hiện có: School -> Supplier -> User theo ID -> Role actor (FOR SHARE) -> SupplyRequest. Mọi đọc kiểm tra lại và ghi đi qua cùng TransactionClient. Điều chỉnh riêng operation `SUPPLIER_ACCEPT_ORDER` trong intake guard để DRAFT trả 404 trước lỗi trạng thái và trước nhánh receipt; service/repository cũng không được làm lộ bản nháp.

**Rationale**: Guard đã khóa parent/resource, nạp lại actor, kiểm tra membership/quyền, rồi kiểm tra điều kiện intake/admin. `ACCEPTED`/`IN_PROGRESS` trả receipt trước kiểm tra tạm dừng; điều này đúng FR-010 và phải được giữ. Update có điều kiện id + supplierId + SENT và ghi ba trường cùng lúc. Role recheck phải áp dụng cả nhánh return receipt sau reload. Không thay guard của create/send/receive.

**Alternatives considered**: Giao dịch riêng trong repository làm mất tính nguyên tử; gán lại thông tin nhận khi thử lại làm mất người nhận đầu tiên; kiểm tra intake trước receipt phá hành vi thử lại.

## 6. Kiểm chứng

**Decision**: Mở rộng unit/HTTP trong `tests/supply-order-intake.test.ts`, guard tests trong `tests/intake-access.test.ts`, regression list trong `tests/modules.test.ts`; integration thực trong `tests/authorization.integration.test.ts` với harness disposable local hiện có. Các file unit hiện đã được đăng ký trong `test:unit`.

**Rationale**: Fake repository kiểm tra safe projection, Decimal/date và truyền đúng tx/scope; PostgreSQL mới chứng minh khóa/Serializable, race hai người nhận và thay quyền/intake. Integration dùng `MIGRATION_TEST_DATABASE_URL` tường minh và tự tạo database mới; không dùng database thành viên/Azure.

**Alternatives considered**: Chỉ mock không chứng minh được concurrency thật; framework mới hoặc DB remote không cần thiết.

## Kết luận nghiên cứu

Không còn điểm kỹ thuật chưa giải quyết. Không cần dependency, schema, migration, cấu hình hoặc seed mới. Đã đối chiếu trực tiếp source và schema repository; không cần tra cứu nguồn bên ngoài cho thiết kế này.
