# Công việc

## C1. Migration và schema

- [x] Viết migration `20261119000100_blockchain_proof_versions`: enum, ba bảng version, CHECK, unique.
- [x] Viết migration `20261119000200_traceability_verify_permission`.
- [x] Cập nhật `prisma/schema.prisma`; chạy `prisma:validate`, `prisma:generate`.

## C2. Hạ tầng dùng chung

- [x] Chép nguyên văn `src/utils/canonical-hash.ts`, `src/utils/blockchain.ts` và dependency `ethers` từ `feat/blockchain-modules`.
- [x] `.env.example`, `blockchain/README.md`.
- [x] `blockchain-proof.payload.ts` và test payload trong `tests/blockchain-proof.test.ts`.
- [x] `blockchain-proof.repository.ts`; các hàm `prepare*`, `anchorVersion`, `scheduleAnchor` trong `blockchain-proof.service.ts`; test gửi giao dịch trong `tests/blockchain-proof.test.ts`.

## C3. Gắn vào ba luồng nghiệp vụ

- [x] `decide()`, `complete()`, `create()`, `dispose()`: `prepare*` trong transaction, `scheduleAnchor` sau commit; truyền service qua tham số factory.
- [x] Test điểm gắn trong `tests/delivery-inspections.test.ts`, `tests/cooking-batch-groups.test.ts`, `tests/blockchain-proof.test.ts` (mẫu lưu): chỉ tạo version đúng điều kiện; không tạo khi tắt blockchain; kết quả nghiệp vụ không đổi.

## C4. API và quyền

- [x] Validation, DTO, controller, routes `/api/blockchain-proofs` (`versions`, `anchor`, `verify`); scope trong `resource-access.ts`.
- [x] `traceability.verify` trong `permission-catalog.ts`; cập nhật `docs/AUTHORIZATION.md`, `src/modules/README.md`, `README.md`.
- [x] Test verify trong `tests/blockchain-proof.test.ts`.
- [x] Thêm test mới vào `test:unit`; chạy `prisma:validate`, `typecheck`, `lint`, Prettier các file đã sửa, `build`, `test:unit`, `test:spec-gate`.

`prisma:validate`, `typecheck`, `lint`, `build` đạt; `test:unit` 554/554; `test:spec-gate` 26/26; Prettier các file đã sửa đạt. `canonical-hash.ts` và `blockchain.ts` giống hệt `feat/blockchain-modules`. Chưa chạy `test:migrations` và `prisma migrate diff` với database (cần PostgreSQL local dùng một lần), chưa gửi giao dịch thật lên Hardhat node hay Sepolia.
