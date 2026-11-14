# Research: Upload ảnh nguyên liệu và helper dùng chung

**Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

## 1. Runtime và dependency

**Decision**: Theo Node 24.22.1/npm11/TypeScript6.0.3/CommonJS thực tế trong `.nvmrc`, `package.json`, `tsconfig.json`; reuse Cloudinary2.11.0 và Multer2.5.0. Thêm Sharp0.35.5 vào dependency/lock trong bước implement.

**Rationale**: Không dùng giả định Node22 từ tài liệu cũ. Sharp có decoder JPEG/PNG/WebP và tương thích CommonJS/runtime hiện tại. Chưa cài thêm gì ở bước plan.

**Alternatives considered**: Signature-only không đáp ứng ảnh giải mã hợp lệ; nhiều decoder JS riêng làm phức tạp hỗ trợ WebP; xác minh từ xa vi phạm prevalidate toàn lượt trước upload.

**Sources**: `package.json`, `.nvmrc`; [Sharp install](https://sharp.pixelplumbing.com/install/), [release0.35.5](https://sharp.pixelplumbing.com/changelog/v0.35.5/).

## 2. Xác minh tệp trước gửi

**Decision**: Helper nhận cấu trúc buffer nội bộ, kiểm `size === buffer.length`, 1..5MiB, count chính xác, MIME và signature. Với ảnh, đọc metadata kiểm format rồi chạy thao tác pixel `stats()` với `failOn: "warning"`; xử lý mọi frame được hỗ trợ thay vì chỉ frame đầu, không transform bytes gốc. Giữ mặc định giới hạn an toàn decoder và decode tuần tự. PDF dùng MIME application/pdf và signature `%PDF-` để nhận diện định dạng.

**Rationale**: `metadata()` đọc header, không xác minh pixel. `stats()` buộc xử lý dữ liệu pixel. PNG/JPEG tài liệu tái sử dụng kiểm tra ảnh. Yêu cầu PDF hiện tại chỉ xác minh nội dung khớp loại; không mở rộng thành hệ thống kiểm định tài liệu.

**Alternatives considered**: `.raw().toBuffer()` tạo thêm full pixel buffer trong JS; chỉ sniff MIME bỏ lọt ảnh hỏng; thêm PDF parser chưa cần theo yêu cầu đã chốt. Không tự thêm giới hạn pixel nghiệp vụ nhỏ hơn hoặc giới hạn ảnh tĩnh chưa được yêu cầu.

**Sources**: [Sharp metadata/stats](https://sharp.pixelplumbing.com/api-input/), [constructor/failOn/animated/limitInputPixels](https://sharp.pixelplumbing.com/api-constructor/); `src/utils/onboarding-documents.ts` (tham khảo signature PDF, không sửa validator cũ).

## 3. Bốn hàm, public images và private documents

**Decision**: Dùng `upload_stream` chung. Ảnh là image/upload; PDF/PNG/JPEG ở hàm tài liệu đều là raw/authenticated. Tách namespace trusted theo nghiệp vụ/owner, UUID mỗi tệp; image public_id không extension, raw public_id có extension. Không trả URL công khai cho tài liệu.

**Rationale**: Cùng một PNG nhưng ảnh sản phẩm và tài liệu có chính sách khác. Raw giữ định dạng tài liệu và không yêu cầu metadata kích thước ảnh. Namespace do caller tin cậy xác lập, không do client chọn.

**Alternatives considered**: `resource_type:auto` phụ thuộc nội dung, không biểu đạt chính sách nghiệp vụ; tài liệu upload công khai sai giả định privacy; một generic HTTP upload endpoint mở rộng quyền vượt phạm vi.

**Sources**: [Node upload_stream](https://cloudinary.com/documentation/node_image_and_video_upload), [upload parameters](https://cloudinary.com/documentation/upload_parameters), [upload access control](https://cloudinary.com/documentation/upload_images).

## 4. Overwrite và kiểm kết quả

**Decision**: `overwrite:false`, định danh UUID. Chỉ chấp nhận response khớp public_id dự kiến, resource_type, delivery type và metadata allowlist. `existing:true` là lỗi `UPLOAD_COLLISION`, không trả asset cũ như kết quả mới. URL ảnh phải HTTPS không credentials, thuộc delivery host/path Cloudinary của cloud đã cấu hình và dài tối đa2048; format/bytes/dimensions phải hợp lệ.

**Rationale**: `overwrite:false` không nhất thiết throw khi ID có sẵn; có thể trả existing asset. Guard tránh báo thành công sai hoặc lộ sai phạm vi.

**Alternatives considered**: Tin response toàn bộ hoặc chỉ kiểm `secure_url` không đủ xác minh ownership. Retry UUID tự động không cần và trái chính sách không auto retry.

**Source**: [Cloudinary Upload API reference](https://cloudinary.com/documentation/image_upload_api_reference).

## 5. Cấu hình Cloudinary và onboarding

**Decision**: Adapter mới đọc ba biến CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET, từ chối thiếu/rỗng/placeholder với lỗi503 tại thời điểm sử dụng. Credentials truyền qua options mỗi upload thay vì sửa global config; không sửa onboarding helper/middleware.

**Rationale**: `node_modules/cloudinary/lib/utils/index.js` và `lib/utils/ensureOption.js` của bản2.11.0 đọc credentials ưu tiên từ options; typings hỗ trợ chúng. Đây là kết luận từ source SDK đang cài, không suy diễn từ hướng dẫn global config. Onboarding đang có20tệp, raw/authenticated, download60giây và cleanup riêng; phải giữ toàn bộ.

**Alternatives considered**: Bắt Cloudinary là cấu hình bắt buộc lúc khởi động sẽ chặn cả chức năng không dùng upload; migrate onboarding làm thay đổi phạm vi và semantics rollback.

## 6. Deadline và partial success

**Decision**: SDK `timeout:30000` cộng wall-clock deadline30giây/tệp. Timer/stream/callback settle một lần, dọn timer, xử lý callback muộn và lỗi stream, đóng stream best effort. Hai worker mỗi lượt, index cố định; sau preflight/config hợp lệ, mọi tệp được xử lý dù tệp khác lỗi, không destroy asset thành công và không auto retry.

**Rationale**: `node_modules/cloudinary/lib/uploader.js` dùng ClientRequest.setTimeout, là inactivity timeout; riêng SDK timeout không đủ đảm bảo deadline. Worker pool2 giới hạn kết nối mỗi lượt và giữ worst-case pha gửi khoảng90giây cho5tệp, thay vì150giây tuần tự. Deadline không đảm bảo hủy tài nguyên từ xa.

**Alternatives considered**: Promise.all fail-fast mất trạng thái từng tệp; all-or-nothing/rollback trái quyết định người dùng; mở5 upload mỗi lượt tăng tải. Không bổ sung quota distributed chưa được yêu cầu.

## 7. Phân quyền và transaction

**Decision**: Reuse management scope/permission. Service guard supplier ACTIVE trước Multer. Trước gửi tới helper, đọc lại actor/supplier qua repository và kiểm supplierId không đổi; mở actor read để tx tùy chọn. Không dùng `write()` và không mở transaction quanh upload.

**Rationale**: Management guard hiện tại chưa kiểm supplier ACTIVE. `write()` giữ lock và có retry Serializable, nên external side effect bên trong có thể bị lặp. Không có mutation DB cần atomicity ở upload.

**Alternatives considered**: Dùng principal ban đầu mãi sau body dài bỏ sót thay đổi quyền; lock supplier trong khi chờ mạng giữ tài nguyên DB mà không tạo atomicity với Cloudinary.

**Sources**: `src/modules/ingredient/ingredient.routes.ts`, `ingredient.service.ts`, `ingredient.repository.ts`, `src/utils/resource-access.ts`, `src/utils/authorization.ts`.

## 8. HTTP, DTO và kiểm thử

**Decision**: Single POST `/api/ingredients/management/upload-image` nhận field image; multi POST `/api/ingredients/management/upload-images` nhận repeated images. Single201, batch200 kể cả mọi item failed; invalidinput400, oversize413, thiếu cấu hình/single storage error503. Giữ envelope/CORS/CSRF/session/rate limit. Helper tài liệu chưa có HTTP API.

**Rationale**: Envelope success của batch biểu thị hoàn tất xử lý, item status biểu thị thành công upload. Tránh207 hoặc response shape phụ thuộc số tệp lỗi. DTO tách và allowlist theo quy tắc module hiện có.

**Alternatives considered**: Batch trả503 khi có lỗi sẽ làm client mất tài nguyên thành công nếu chỉ xử lý error envelope. Tăng JSON limit không cần cho multipart. Test Cloudinary thật làm CI phụ thuộc secret/tài nguyên bên ngoài.

**Sources**: `src/app.ts`, `src/utils/response.ts`, `src/middlewares/csrf.middleware.ts`, `tests/helpers/http.ts`, `tests/ingredient-management.test.ts`.

## 9. Vận hành và giới hạn được giữ

**Decision**: Fake transport trong test; smoke thật chỉ khi người vận hành chủ động cấu hình và upload. Nếu tương lai mở PDF, xác minh account Cloudinary cho phép delivery định dạng đó; không tự đổi setting trong tính năng này. Log chỉ mã lỗi an toàn, không buffer/secret/raw response.

**Rationale**: Upload thành công không có nghĩa mọi account đã bật delivery PDF. Hiện helper tài liệu không công bố URL tải nên không thêm endpoint hoặc thay account policy.

**Sources**: [Image delivery options](https://cloudinary.com/documentation/image_delivery_options), [PDF guide](https://cloudinary.com/documentation/ts_how_to_upload_manage_and_deliver_pdf_files).

## 10. Biên giới hạn multipart của parser đang cài

**Decision**: Parser đặt fileSize=5MiB+1byte và parts=maxFiles+1; files=maxFiles, fields=0, strict validator vẫn giữ size<=5MiB và count1/1..5. Không đổi middleware onboarding.

**Rationale**: Source `node_modules/busboy/lib/types/multipart.js` phát file limit khi `fileSize === fileSizeLimit`, partsLimit khi `++parts === partsLimit`; Multer biến các event đó thành lỗi. Đặt ngưỡng parser đúng giới hạn nghiệp vụ có thể loại nhầm ảnh đúng5MiB hoặc lượt đúng số part tối đa. Khoảng đệm chỉ phục vụ parser; kiểm thử HTTP thực tế phải chứng minh5MiB nhận,5MiB+1bị413,5tệp nhận,6tệp bị400.

**Alternatives considered**: Giữ parser bằng giới hạn nghiệp vụ không đáp ứng acceptance boundary; bỏ limits hoặc tăng JSON body limit không cần thiết.

Mọi điểm thiết kế cần nghiên cứu đã được giải quyết; không còn câu hỏi chặn tạo tasks.
