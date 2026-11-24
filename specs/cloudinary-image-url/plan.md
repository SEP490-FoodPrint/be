# Implementation Plan: Dựng URL ảnh Cloudinary

**Branch**: `feat/cloudinary-image-url` | **Spec**: [spec.md](./spec.md)

## Summary

Thêm hàm thuần dựng URL ảnh Cloudinary đã resize/nén từ `secure_url` hoặc `publicId` đã lưu.

## Technical Context

TypeScript strict (CommonJS). Không dùng SDK `cloudinary` (chỉ cần nối chuỗi có kiểm tra), không cần secret; đọc `CLOUDINARY_CLOUD_NAME` từ env (tham số `env` để test).

## Constitution Check

- Spec-driven: `specs/cloudinary-image-url/`.
- Không đổi schema, không thao tác DB, không đổi API.

## Implementation

- `src/utils/cloudinary.ts`: `cloudinaryTransformation(options)`, `cloudinaryImageUrl(source, options, env)` (FR-001–FR-004).
- `src/utils/branded-email.ts`: hằng `EMAIL_LOGO_CLOUDINARY_ID = "logo_ko2iaa"`; `readEmailLogoUrl` trả link Cloudinary sau `EMAIL_LOGO_URL`, `null` khi chưa cấu hình cloud (FR-005). Mọi email đã gọi `readEmailLogoUrl` nên không phải sửa nơi gọi.
- `docs/ONBOARDING.md`, `docs/MAILER.md`, `.env.example`: ghi chú hàm dựng URL ảnh và nguồn logo.

## Testing

- `tests/cloudinary-image-url.test.ts` thêm vào `test:unit`.
- `npm run validate`, `npm run test:unit`, spec gate.
