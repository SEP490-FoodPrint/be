# Công việc

## R1. Migration và schema

- [x] Viết migration `20261121000100_registration_request_versions`: enum, bảng, index, CHECK.
- [x] Cập nhật `prisma/schema.prisma`; chạy `prisma validate`, `prisma generate`.
- [x] Chạy migration trên PostgreSQL local dùng một lần; `prisma migrate diff` không còn khác biệt.

## R2. Hash tệp

- [x] Thêm `sha256` vào `OnboardingDocument`, `readDocuments` và `submissionData`; tính khi nộp.
- [x] Test trong `tests/onboarding.test.ts`: tệp mới có hash; proof chỉ được lên lịch sau khi commit.

## R3. Proof

- [x] Payload, repository, `prepareRegistrationSubmitted`, `prepareRegistrationApproved`.
- [x] Gắn vào `submit` và `approve`.
- [x] Xác minh: dựng lại payload và đối chiếu SHA-256 từng tệp.
- [x] Quyền: chỉ System Admin, áp dụng ở cả route và service.
- [x] `tests/registration-proof.test.ts`; thêm vào `test:unit`.

## R4. Tài liệu và kiểm tra

- [x] `docs/AUTHORIZATION.md`, `README.md`, `src/modules/README.md`.
- [x] `lint`, `typecheck`, `build`, `test:unit`, `test:spec-gate`.
- [x] Thử thật trên Sepolia với DB local.

`test:unit` 716/716, `test:spec-gate` 26/26. Trên Sepolia: nộp, nộp lại, duyệt tạo 3 version `CONFIRMED`; xác minh `VERIFIED`, từng tệp `MATCH`. Ghi đè tệp ATTP trên Cloudinary cho kết quả `MISMATCH` (`chung-nhan-attp.pdf`); khôi phục tệp thì lại `VERIFIED`. Tài khoản BGH nhận 403.
