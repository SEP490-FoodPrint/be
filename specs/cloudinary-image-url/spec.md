# Feature Specification: Dựng URL ảnh Cloudinary

**Feature Branch**: `feat/cloudinary-image-url`

**Created**: 2026-11-23

**Status**: Implemented

**Input**: Người dùng: "có hàm gọi ảnh từ cloudinary chưa? chưa thì làm 1 hàm để gọi ảnh từ url cloudinary" → chọn phương án "Dựng URL ảnh (resize)", tách PR riêng.

## Bối cảnh

Backend đã có upload ảnh (`src/utils/cloudinary-upload.ts`, trả `secure_url` dạng `https://res.cloudinary.com/<cloud>/image/upload/v<version>/<publicId>.<ext>`) và tải tài liệu riêng tư (`private_download_url` trong `src/utils/onboarding-documents.ts`), nhưng chưa có hàm dựng URL hiển thị ảnh đã resize/nén từ URL hoặc `publicId` đã lưu.

## Clarifications

### Session 2026-11-23

- Mục đích → dựng URL ảnh có phép biến đổi (resize, cắt, nén, định dạng tự động) để giao diện/email hiển thị; không tải ảnh về server, không gọi mạng.
- Phạm vi → PR riêng, chỉ thêm hàm tiện ích + test; chưa gắn vào endpoint nào.
- Quyết định mặc định: chỉ chấp nhận ảnh công khai (`image/upload`) của cloud trong `CLOUDINARY_CLOUD_NAME`; nguồn không hợp lệ trả `null` (để bên gọi tự xử lý/ẩn ảnh), tùy chọn sai là lỗi lập trình (`RangeError`).

## User Scenarios & Testing

### User Story 1 - Lấy ảnh thu nhỏ từ URL đã lưu (Priority: P1)

Service có `secure_url` của ảnh nguyên liệu/logo và cần ảnh 320×240 nhẹ hơn.

**Acceptance Scenarios**:

1. **Given** `secure_url` của cloud đã cấu hình, **When** gọi `cloudinaryImageUrl(url, { width: 320, height: 240, crop: "fill", gravity: "auto" })`, **Then** nhận URL `.../image/upload/c_fill,g_auto,w_320,h_240,q_auto,f_auto/v<version>/<publicId>.<ext>`.
2. **Given** URL của cloud khác, tài liệu `raw/authenticated`, `http`, host khác, có credentials/port/query, **Then** trả `null`.

## Requirements

### Functional Requirements

- **FR-001**: `cloudinaryImageUrl(source, options?, env?)` trong `src/utils/cloudinary.ts` nhận `secure_url` (https, host `res.cloudinary.com`, path `/<cloud>/image/upload/`, không username/password/port/query/hash) hoặc `publicId` (ký tự `A-Za-z0-9_-./`, không bắt đầu bằng `/`, không `//`, không đoạn `.`/`..`); trả URL `https://res.cloudinary.com/<cloud>/image/upload/<biến đổi>/<phần còn lại>` hoặc `null` khi nguồn không hợp lệ hay chưa cấu hình `CLOUDINARY_CLOUD_NAME` (bỏ giá trị mẫu `replace-…`).
- **FR-002**: Biến đổi (`cloudinaryTransformation`): `width`/`height` số nguyên 1–4000; `crop` `fill|fit|limit|pad|thumb` (mặc định `limit` khi có kích thước); `gravity` `auto|center|face` chỉ với `fill`/`thumb`; `quality` `auto` (mặc định) hoặc 1–100; `format` `auto` (mặc định)|`jpg`|`png`|`webp`. Thứ tự `c_,g_,w_,h_,q_,f_`. Tùy chọn sai ném `RangeError`.
- **FR-003**: URL có biến đổi cũ đứng trước đoạn version (`v<số>`) thì bỏ biến đổi cũ; giữ nguyên version và public id; các đoạn path được encode lại.
- **FR-004**: Hàm thuần, không gọi mạng, không dùng API key/secret.

## Success Criteria

- **SC-001**: Test `tests/cloudinary-image-url.test.ts` (trong `test:unit`) bao phủ FR-001–FR-003; `npm run validate` pass.

## Phạm vi

- Trong phạm vi: `src/utils/cloudinary.ts`, test, tài liệu.
- Ngoài phạm vi: gắn vào response DTO/endpoint, ảnh riêng tư/signed URL, tải ảnh về server.
