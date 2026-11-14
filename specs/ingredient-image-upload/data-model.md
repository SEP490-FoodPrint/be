# Data Model: Upload ảnh/tài liệu

Không tạo bảng, Prisma model, migration hoặc metadata record mới. Các cấu trúc bên dưới là kiểu nội bộ/DTO trong bộ nhớ; `Ingredient.coverImage` và `Ingredient.imageDescription` giữ nguyên kiểu và semantics đã có.

## 1. UploadFile — nội bộ helper

| Trường       | Kiểu   | Quy tắc                                                                           |
| ------------ | ------ | --------------------------------------------------------------------------------- |
| buffer       | Buffer | Không rỗng; nội dung bytes thực tế                                                |
| size         | number | Số nguyên1..5.242.880, bằng buffer.length                                         |
| mimeType     | string | MIME allowlist theo hàm                                                           |
| originalName | string | Chỉ metadata; loại control/path separators, giới hạn255; không dùng sinh publicId |

Controller chọn đúng các trường Multer cần thiết rồi gọi validator. Schema không nhận toàn bộ Multer object, không nhận upload URL hoặc organization ID. Validation dùng strict Zod; Request DTO suy ra từ schema, không viết lại interface input trong DTO.

## 2. UploadContext — chỉ do caller tin cậy tạo

| Trường    | Kiểu        | Quy tắc                                                                    |
| --------- | ----------- | -------------------------------------------------------------------------- |
| namespace | string      | Segment lowercase kebab-case1..48; không slash, dot traversal hoặc control |
| ownerId   | UUID string | Định danh phạm vi tin cậy; helper không tự phân quyền                      |

Nguyên liệu dùng namespace `ingredients`, ownerId=supplierId hiện tại đã xác thực. Helper chung không import role, principal hoặc Request DTO. Tính năng khác phải tự xác lập ownerId hợp lệ trước gọi.

PublicId dự kiến: `foodprint/uploads/<namespace>/<ownerId>/<uuid>` cho ảnh; cùng cấu trúc thêm `.pdf/.png/.jpg` cho raw documents. Không chứa tên tệp người dùng hoặc thông tin nhạy cảm.

## 3. ImageAsset

| Trường        | Kiểu             | Quy tắc                                                             |
| ------------- | ---------------- | ------------------------------------------------------------------- |
| publicId      | string           | Khớp publicId hệ thống sinh                                         |
| url           | string           | HTTPS Cloudinary đúng cloud/phạm vi, không credentials, <=2048ký tự |
| format        | jpg / png / webp | Chuẩn hóa JPEG thành jpg                                            |
| bytes         | number           | Metadata số nguyên dương hợp lệ, không vượt giới hạn tệp            |
| width, height | number           | Số nguyên dương                                                     |

Không có credential, signature, raw SDK response hoặc metadata tự do.

## 4. DocumentAsset — chỉ hợp đồng nội bộ ở phiên bản này

| Trường       | Kiểu            | Quy tắc                                 |
| ------------ | --------------- | --------------------------------------- |
| publicId     | string          | Khớp định danh raw có extension đã sinh |
| fileName     | string          | Tên tệp đã làm sạch, <=255ký tự         |
| format       | pdf / png / jpg | Theo nội dung/loại khai báo đã xác minh |
| bytes        | number          | Số nguyên dương, <=5MiB                 |
| resourceType | raw             | Không suy ra từ extension               |
| deliveryType | authenticated   | Riêng tư mặc định                       |

Không yêu cầu URL công khai hoặc chiều rộng/chiều cao. Không sinh URL ký hoặc API download mới; future caller quản lý quyền và tham chiếu nếu có nghiệp vụ được duyệt riêng.

## 5. UploadItemResult<T>

Union:

- Thành công: `index` số nguyên bắt đầu0, `status: "success"`, `asset: T`.
- Thất bại: `index`, `status: "failed"`, `error: { code, message }`; không có asset.

Mã lỗi upload allowlist: `UPLOAD_FAILED`, `UPLOAD_TIMEOUT`, `UPLOAD_INVALID_RESULT`, `UPLOAD_COLLISION`. Message tiếng Việt không chứa raw SDK error. Mỗi input có đúng một kết quả, vị trí bằng index dù hoàn tất ngược thứ tự. Gửi lại chỉ tệp lỗi tạo index mới theo đầu vào mới; caller tự đối chiếu với lượt trước.

Input invalid, context sai và cấu hình thiếu là lỗi trước lượt, không tạo danh sách giả. Mọi tệp lỗi trong pha gửi vẫn là danh sách đầy đủ các phần tử failed.

## 6. Vòng đời

`received -> authorized -> parsed -> validated-all -> configured -> uploading -> success | failed`.

- Count/MIME/decode/size sai ở bất cứ input nào: dừng trước uploading cho cả lượt.
- Lỗi từng tệp ở uploading: đánh dấu failed, tiếp tục tệp còn lại; tài nguyên success được giữ.
- Deadline/local disconnect có thể để lại asset đã nhận ở remote mà chưa có xác nhận; không giả định rollback.
- Upload success không tạo/chỉnh sửa Ingredient. Lưu URL chỉ diễn ra ở request JSON create/update riêng, với quyền hiện hành của request đó.
- Thay/bỏ URL, ẩn nguyên liệu hoặc lưu nguyên liệu lỗi không tự xóa Cloudinary asset.

## 7. Quan hệ và quy tắc giữ nguyên

Nhà cung cấp là phạm vi ownership khi upload ảnh nguyên liệu. URL upload có thể được dùng làm một coverImage hoặc một phần tử imageDescription; không tạo quan hệ bắt buộc asset–ingredient trong DB, không xác minh quyền sở hữu mọi URL khi lưu. Giới hạn5 là mỗi lượt upload, không giới hạn tổng ảnh đã lưu.

Giữ nguyên onboarding20tệp, private download60giây và cleanup riêng. Bốn helper không thay thế hay thay kiểu metadata onboarding trong phạm vi này.
