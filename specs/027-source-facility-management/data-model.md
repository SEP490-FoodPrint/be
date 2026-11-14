# Data Model: Cơ sở cung cấp nguyên liệu

**Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

## 1. SourceFacility hiện có

Giữ model PascalCase và ánh xạ bảng foodprint.source_facilities. Không thay schema hoặc thêm trường.

| Thuộc tính      | Kiểu lưu hiện có               | Quy tắc chức năng                                                        |
| --------------- | ------------------------------ | ------------------------------------------------------------------------ |
| id              | UUID, primary key              | Hệ thống sinh; định danh trong đường dẫn API.                            |
| supplierId      | UUID, FK Supplier              | Từ trusted principal; không nhập hoặc chuyển sở hữu.                     |
| facilityCode    | varchar(80), nullable legacy   | Mới tạo luôn có mã hệ thống cấp; bất biến khi sửa/dừng.                  |
| name            | varchar(255), not null         | Bắt buộc, trim, không rỗng; unique trong supplier.                       |
| address         | text, nullable                 | Tùy chọn; trim; empty/null thành null.                                   |
| contactName     | varchar(255), nullable         | Tùy chọn; trim, tối đa 255 ký tự.                                        |
| contactPhone    | varchar(30), nullable          | Tùy chọn, chuỗi tối đa 30 ký tự; giữ số 0 và dấu +.                      |
| contactEmail    | citext, nullable               | Tùy chọn; trim, email hợp lệ nếu có thông tin.                           |
| status          | EntityStatus                   | Mới ACTIVE; chỉ chuyển ACTIVE sang INACTIVE.                             |
| isVisible       | boolean, default true          | Giữ nguyên quy tắc hiện có; không cho người dùng gửi.                    |
| createdByUserId | UUID, FK User, nullable legacy | Ghi actor hiện tại khi tạo; không sửa sau đó.                            |
| updatedByUserId | UUID, FK User, nullable legacy | Ghi actor tạo/sửa/chuyển trạng thái thật.                                |
| createdAt       | timestamptz                    | Hệ thống tạo; giữ nguyên sau đó.                                         |
| updatedAt       | timestamptz, @updatedAt        | Prisma cập nhật khi ghi; nếu có raw write tương lai phải đặt tường minh. |

Giữ unique (supplierId, name), partial unique (supplierId, facilityCode) với predicate facility_code IS NOT NULL, index (supplierId, status)/(supplierId, isVisible) và mọi FK hiện có. Không thêm unique toàn hệ thống trên facilityCode.

## 2. Quan hệ và truy cập

- Supplier có nhiều SourceFacility, mỗi SourceFacility thuộc đúng một Supplier.
- SourceFacility có nhiều IngredientLot qua sourceFacilityId nullable trên lô. Liên kết dùng UUID, không dùng facilityCode. Dừng không thay hoặc xóa lô.
- User được tham chiếu cho audit; API không trả quan hệ User hay thông tin tài khoản.
- SourceFacilityManagementScope là kiểu nội bộ readonly supplierId, được helper resource-access xác lập từ AuthPrincipal hợp lệ. Không phải trường nhận từ HTTP hay model lưu mới.

## 3. Dãy mã theo nhà cung cấp

Không tạo entity/counter lưu mới. Dãy suy ra từ mã đã lưu, độc lập theo supplier.

1. Nhận trusted scope; khóa hàng Supplier trong transaction ghi.
2. Repository chỉ xét facility_code trong supplier đó. Canonical có tiền tố đúng FP-SF-, hậu tố số dương dạng pad tối thiểu năm chữ số; dạng dài hơn năm chữ số không có số 0 thừa ở đầu.
3. Dùng PostgreSQL numeric MAX hậu tố, đọc kết quả dưới dạng text; không cast về bigint SQL hoặc Number JS. Bảo vệ cast từng hậu tố bằng CASE bên trong MAX, chỉ chạy với mã canonical; không dựa vào thứ tự regex AND cast trong WHERE hoặc CASE bên ngoài aggregate. Không lọc status/isVisible.
4. Không có mã canonical thì lấy 0; số mới bằng max + 1 bằng bigint JS. Format tiền tố + số padStart(5).
5. Nếu chuỗi mới vượt 80 ký tự thì trả 503 an toàn trước insert. Không quay vòng/cắt chữ số.
6. Insert và commit bằng cùng tx. Unique mã supplier bảo vệ race; giữ lỗi mã cho authorizationTransaction retry toàn attempt.

| Trạng thái dữ liệu supplier                      | Kết quả khi tạo                       |
| ------------------------------------------------ | ------------------------------------- |
| Chưa có mã canonical                             | FP-SF-00001                           |
| Có FP-SF-00001 và FP-SF-00002                    | FP-SF-00003                           |
| Có FP-SF-99999                                   | FP-SF-100000                          |
| Mã cao nhất thuộc cơ sở INACTIVE/isVisible=false | Tiếp tục sau mã đó                    |
| Supplier B chưa cấp mã, A đã cấp nhiều           | B vẫn FP-SF-00001                     |
| Chỉ có mã legacy null hoặc không chuẩn           | Giữ legacy, cấp mã mới từ FP-SF-00001 |

Ví dụ không canonical: FP-SF-00000, FP-SF-1, FP-SF-000001, fp-sf-00001 hoặc mã tự đặt cũ. Không sửa những giá trị này. Canonical cũ số lớn hơn 64-bit vẫn tham gia numeric max; cột cho tối đa 74 chữ số hậu tố.

## 4. Trạng thái và audit

| Thao tác     | Trước                | Sau            | Audit và bất biến                                                                 |
| ------------ | -------------------- | -------------- | --------------------------------------------------------------------------------- |
| Tạo          | Chưa tồn tại         | ACTIVE         | Tự sinh id/mã; đặt cả người tạo/cập nhật; isVisible=true.                         |
| Sửa          | ACTIVE hoặc INACTIVE | Giữ trạng thái | Chỉ năm trường nhập; đổi người/thời điểm cập nhật, giữ mã và người/thời điểm tạo. |
| Dừng lần đầu | ACTIVE               | INACTIVE       | Cập nhật người/thời điểm sửa; giữ mã, isVisible và liên kết.                      |
| Dừng lặp     | INACTIVE             | INACTIVE       | Trả trạng thái hiện tại; không ghi lại audit.                                     |

Không có chuyển về ACTIVE, đổi chủ sở hữu, đổi mã, xóa hoặc ẩn/hiện riêng.

## 5. Validation và DTO

Create: name bắt buộc; bốn trường liên hệ/địa chỉ tùy chọn mặc định null sau chuẩn hóa. PATCH: cùng năm trường nhưng đều optional, cần ít nhất một trường; omitted không ghi, null/empty của optional là xóa giá trị; name không được null/empty. Không áp default null cho trường omitted trong PATCH.

Request DTO infer từ Zod strict schemas cho create/update/list/params/deactivate; validation không import DTO. Repo dùng internal input types tách khỏi DTO và Prisma query nằm ở repository.

List response giữ id, supplierId, facilityCode, name, status, isVisible, createdAt, updatedAt. Detail/create/update/deactivate thêm address, contactName, contactPhone, contactEmail. Date trả ISO UTC; không trả bigint/scalar cấp số. Read/detail/update/deactivate cho phép facilityCode string|null để tương thích legacy; create mới có facilityCode string. Không tự sửa mã legacy khi đọc, sửa thông tin hoặc dừng.

## 6. Tính toàn vẹn và lỗi

Tên trùng, kể cả cơ sở INACTIVE, nhận 409; tên cùng supplier và mã cùng supplier vẫn được DB kiểm tra. Tên giống hoặc mã giống giữa hai supplier hợp lệ. Target không thuộc scope nhận cùng 404 như không tồn tại. Serialization/deadlock/unique mã rollback và retry toàn transaction theo helper hiện có; exhausted hoặc vượt chiều dài mã nhận 503.

Không có migration/backfill, không sửa baseline hoặc lịch sử SQL. Dữ liệu fixture cho concurrency/legacy chỉ tạo trong database disposable khi triển khai kiểm thử được phép.
