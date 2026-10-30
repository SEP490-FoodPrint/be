# Liên kết NCC bằng hồ sơ hợp đồng

## Luồng và phạm vi

BGH tìm NCC toàn hệ thống qua danh mục riêng, kiểm tra hồ sơ, lưu nháp hợp đồng,
tải bản đã ký và hồ sơ pháp lý/ATTP, chọn phạm vi nguyên liệu rồi xác nhận.
API `/suppliers` cũ vẫn giữ nguyên phạm vi để các module khác không đổi hành vi.
Danh mục toàn hệ thống không trả hợp đồng hoặc giao dịch của trường khác.

Trạng thái quan hệ (`ACTIVE/SUSPENDED/UNLINKED`) độc lập với trạng thái hợp đồng
(`DRAFT/ACTIVE/CLOSED`) và điều kiện đặt hàng theo thời điểm. Hợp đồng hết hạn,
chứng nhận hết hiệu lực hoặc NCC/nguyên liệu ngừng hoạt động đều chặn đặt mới.
Hồ sơ miễn cấp/áp dụng khác cần ghi căn cứ và tải minh chứng để người phụ trách
kiểm tra; upload không thay thế việc thẩm tra tính pháp lý hay xác thực chữ ký.

Một nguyên liệu của cùng NCC/trường không được có hai hợp đồng ACTIVE chồng thời
hạn. Các phạm vi khác nhau có thể cùng tồn tại. Gia hạn dùng số hợp đồng/phụ lục
mới và tài liệu mới; không sửa bản đã kích hoạt. Hợp đồng bắt đầu trong tương lai
được lưu nháp và chỉ xác nhận khi đến hiệu lực. Quan hệ đang tạm dừng có thể bổ
sung hợp đồng mới nhưng không tự khôi phục đặt hàng.

## API

| Endpoint                                                    | Chức năng / quyền                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/supplier-directory`                               | Danh mục toàn hệ thống; trường có `supplier.view`, `supplier.manage` hoặc `supplier_relationship.manage` |
| `GET /api/supplier-directory/:id`                           | Hồ sơ công bố; hợp đồng/nhật ký chỉ trả cho người có quyền xem hoặc quản lý quan hệ của chính trường     |
| `GET /api/supplier-directory-filters`                       | Nhóm nguyên liệu thực tế                                                                                 |
| `GET /api/supplier-locations?parentId=`                     | Danh mục địa bàn đang hoạt động; không truyền parentId lấy cấp tỉnh/thành                                |
| `GET /api/supplier-partnerships`                            | Quan hệ và điều kiện cung cấp của trường                                                                 |
| `POST /api/supplier-contracts`                              | Tạo hồ sơ nháp                                                                                           |
| `GET, PUT /api/supplier-contracts/:id`                      | Đọc / cập nhật nháp, PUT cần revision hiện tại                                                           |
| `POST /api/supplier-contracts/:id/documents`                | Multipart: kind và file                                                                                  |
| `GET, DELETE /api/supplier-contract-documents/:id`          | Tải file có xác thực / bỏ file nháp                                                                      |
| `POST /api/supplier-contracts/:id/activate`                 | revision và verified=true; kiểm tra hồ sơ và liên kết trong transaction                                  |
| `POST /api/supplier-contracts/:id/close`                    | Đóng hợp đồng, bắt buộc reason                                                                           |
| `POST /api/supplier-partnerships/:id/suspend,resume,unlink` | Chuyển trạng thái, bắt buộc reason                                                                       |
| `POST /api/supply-requests`                                 | Lập đơn nháp bằng quyền supply_request.create                                                            |
| `POST /api/supply-requests/:id/send`                        | Gửi đơn nháp bằng quyền supply_request.create; cần contractId hợp lệ                                     |
| `GET /api/supply-requests/:id/contract-evidence`            | Bằng chứng hợp đồng đã chốt; supply_request.view hoặc traceability.view, theo phạm vi tổ chức            |

Thay đổi hồ sơ/quan hệ yêu cầu role BGH hoặc quản trị trường **và** grant
`supplier_relationship.manage`. Không cấp quyền mới ngầm cho role hiện có.
Tất cả thao tác ghi tải lại principal trong transaction; không nhận schoolId từ
client. Advisory lock theo trường/NCC kết hợp Serializable và partial unique
index bảo vệ các lần xác nhận đồng thời. Khóa này cũng áp dụng lúc gửi đơn.

Danh mục hỗ trợ page/limit/q/provinceId/wardId/locationMode/category/status,
lọc và phân trang tại backend. REGISTERED lọc trụ sở; SERVICE lọc vùng phục vụ,
trong đó đăng ký phục vụ cả tỉnh bao gồm các xã/phường trực thuộc. Không suy
đoán địa bàn bằng việc tách chuỗi địa chỉ; dữ liệu thiếu được hiển thị rõ.

## Tài liệu và truy xuất

Tệp PDF/PNG/JPEG được kiểm tra dấu hiệu định dạng, giới hạn 10 MB/tệp, 10 tệp/hồ
sơ. Bản đầu lưu bytea trong PostgreSQL cùng metadata và SHA-256 để dùng được
ngay với DB cloud, không phụ thuộc URL giả hoặc ổ đĩa máy lập trình. Danh sách
không trả bytes; endpoint download xác thực quyền cùng trường, trả attachment,
nosniff và private/no-store. Có thể chuyển storage adapter sang object storage
khi dung lượng tăng; vẫn phải giữ quyền truy cập và hash/version bất biến.

Kích hoạt yêu cầu cả SIGNED_CONTRACT và COMPLIANCE. Tệp và metadata hợp đồng
ACTIVE/CLOSED không được sửa/xóa qua API. Tạm dừng hoặc ngừng liên kết không tự
hủy đơn đang thực hiện và không xóa lịch sử. Liên kết lại tạo quan hệ mới.

Gửi đơn kiểm tra ngày giao, quan hệ, NCC, chứng nhận, nguyên liệu của trường và
phạm vi hợp đồng. Mỗi đơn được chốt contractId + contractSnapshot (gồm metadata,
phạm vi, chứng nhận, danh sách tài liệu/hash và người xác nhận). FK ghép ngăn
tham chiếu hợp đồng của trường/NCC khác. Giao hàng → lô hàng → mẻ nấu → phân suất
tiếp tục dùng các quan hệ hiện có; truy ngược đơn lấy đúng snapshot đã chốt.

## Migration, seed và kiểm thử

`20261030000200_supplier_contract_linking` chỉ bổ sung cấu trúc, không backfill
hợp đồng đã ký giả cho quan hệ cũ. Những quan hệ cũ thiếu hợp đồng được hiển thị
cần bổ sung và chưa thể gửi đơn mới bằng luồng này. Đơn hàng cũ được giữ nguyên.

Azure đã có locations và trường có schema địa chỉ mở rộng; migration tái sử dụng
locations, không thay đổi hoặc xóa các cột địa chỉ của trường. Không dùng db push
hay chạy script diff để làm DB cloud giống toàn bộ schema cũ của nhánh.

Seed theo yêu cầu trên Azure dev, sau kiểm tra checksum và deploy migration:

```powershell
node node_modules/tsx/dist/cli.mjs src/scripts/seed-supplier-onboarding.ts --azure
```

Cần AZURE_DATABASE_HOST khớp chính xác và SEED_TEST_PASSWORD trong .env riêng.
Seed thêm 2 NCC gắn nhãn TEST chưa liên kết, nguyên liệu, hồ sơ chứng nhận minh
họa rõ là TEST và tài khoản school_warehouse_test. Không tạo bản hợp đồng ký giả
hoặc ghi đè mật khẩu/trạng thái hồ sơ đã có. Không sửa danh mục địa giới chung.

`test:unit` gồm kiểm tra điều kiện, dữ liệu đầu vào và quyền. `test:supplier-onboarding`
tạo một database tạm mới trên instance PostgreSQL loopback được chỉ định bởi
LOCAL_DATABASE_URL hoặc MIGRATION_TEST_DATABASE_URL, triển khai toàn bộ migrations
và đối chiếu drift trước khi kiểm tra HTTP thật: đăng nhập, lọc, file riêng tư,
revision, xác nhận đồng thời, điều kiện gửi đơn và giữ lịch sử khi liên kết lại.
CI chạy các kiểm thử này trên PostgreSQL tạm, không kết nối Azure.
