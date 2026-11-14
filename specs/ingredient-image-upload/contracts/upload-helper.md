# Contract: Bốn hàm upload dùng chung

Đây là hợp đồng nội bộ dự kiến cho `src/utils/cloudinary-upload.ts`; chưa phải code triển khai hoặc HTTP API tài liệu. Cấu trúc chi tiết tại [data-model.md](../data-model.md).

## Public surface của helper

| Hàm                             | Input                   | Output khi hoàn tất                                       |
| ------------------------------- | ----------------------- | --------------------------------------------------------- |
| uploadImage(file, context)      | Một UploadFile ảnh      | Promise<ImageAsset>; throw lỗi đầu vào/cấu hình/upload    |
| uploadImages(files, context)    | 1–5 UploadFile ảnh      | Promise<UploadItemResult<ImageAsset>[]>                   |
| uploadDocument(file, context)   | Một UploadFile tài liệu | Promise<DocumentAsset>; throw lỗi đầu vào/cấu hình/upload |
| uploadDocuments(files, context) | 1–5 UploadFile tài liệu | Promise<UploadItemResult<DocumentAsset>[]>                |

Export bốn hàm với adapter mặc định; cung cấp factory tạo cùng bốn hàm với transport/clock/UUID dependencies để kiểm thử không mạng. Không phụ thuộc Express/Multer, module nguyên liệu, Prisma hoặc API DTO.

## Input và preflight

- Tệp có buffer, size, mimeType, originalName; context có namespace và ownerId tin cậy, không có tùy chọn publicId/folder/overwrite do client gửi.
- Ảnh: MIME image/jpeg, image/png, image/webp. Tài liệu: application/pdf, image/png, image/jpeg. Mỗi tệp1..5.242.880byte, size đúng buffer.length.
- Single nhận đúng một tệp; many nhận1..5, không rỗng. Khác định dạng trong cùng nhóm hợp lệ được phép, ví dụ PDF+PNG+JPEG trong documents.
- Kiểm toàn bộ tệp và context trước lần gửi Cloudinary đầu tiên. Ảnh giải mã thực tế, gồm các frame được hỗ trợ; PDF xác minh MIME/chữ ký định dạng. Bộ validator không đổi bytes upload.
- Kiểm config một lần trước lượt và giữ snapshot credentials cho lượt đó. Lỗi input/count/context/config throw chung, không trả partial result.

## Pha upload và kết quả

- Public images: resource_type=image, type=upload. Private docs: resource_type=raw, type=authenticated. Định danh mới UUID theo namespace/owner, overwrite=false; không truyền nguyên tên tệp gốc làm publicId.
- Hai worker tối đa mỗi lượt; timeout SDK30giây cộng deadline30giây mỗi tệp, settle một lần và xử lý stream error/late callback. Deadline chỉ giới hạn chờ local, không bảo đảm remote đã hủy.
- Single: response guard thành công mới trả asset; lỗi adapter được chuẩn hóa sang lỗi dịch vụ an toàn.
- Many: sau khi bắt đầu, mỗi tệp có đúng một result thành công/thất bại, index0-based theo đầu vào. Một lỗi không làm dừng tệp khác. Không throw toàn lượt chỉ vì một hay tất cả tệp gặp lỗi dịch vụ.
- Không tự retry và không gọi destroy đối với asset thành công. `existing:true`, identity/type mismatch hoặc response thiếu metadata là failure, không tái sử dụng asset cũ.
- Kiểu success/failed và mã lỗi xác định trong data-model. Output private docs không có public URL; image output không trả raw SDK fields.

## Trách nhiệm caller và giới hạn

Caller kiểm quyền và tạo context trước gọi; helper chỉ kiểm cấu trúc context, không cấp quyền. Caller lưu tham chiếu sau upload bằng nghiệp vụ riêng nếu cần. Không có DB mutation/transaction trong helper. Tệp retry được caller gửi lại rõ ràng; context nguyên liệu không do người dùng chọn.

Onboarding tiếp tục dùng adapter cũ, không tự chuyển sang bốn hàm hoặc giới hạn5. Không export thao tác xóa/download trong phạm vi feature này.

## Checklist nghiệm thu hợp đồng

Kiểm bốn hàm; count0/1/5/6 và single2;5MiB/5MiB+1/empty/mismatch; JPEG/PNG/WebP ảnh, PDF/PNG/JPEG docs; malformed later-frame; full preflight trước transport; all/mixed failures; thứ tự hoàn tất đảo; private/public options;10upload/2scope không ghi đè; thiếu config; timeout/stream/callback; existing:true; không destroy/retry/secret leak.
